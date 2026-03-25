"use strict";

require("dotenv").config();
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const store = require("./store");
const { bootEmulator, installApk, killEmulator } = require("../emulator/manager");
const { sendReportEmail } = require("../output/email-sender");
const { sleep } = require("../utils/sleep");
const {
  USE_CRAWLER_V1,
  SKIP_AI_FOR_TESTS,
  SCREENSHOT_DIR_PREFIX,
  MAX_CRAWL_STEPS,
} = require("../config/defaults");

const { runCrawl } = require("../crawler/run");
const { parseApk } = require("../ingestion/manifest-parser");

// Oracle pipeline (Week 4)
const { triageForAI } = require("../oracle/triage");
const { analyzeTriagedScreens } = require("../oracle/ai-oracle");
const { buildReport } = require("../output/report-builder");
const { renderReportEmail } = require("../output/email-renderer");

// ---------------------------------------------------------------------------
// Job orchestrator
// ---------------------------------------------------------------------------

async function processJob(jobId, apkPath, opts) {
  try {
    store.updateJob(jobId, { status: "processing", step: 1 });

    // Step 1: Start emulator
    await bootEmulator();

    // Step 2: Install APK
    store.updateJob(jobId, { step: 2 });
    installApk(apkPath);

    // Step 3: Crawl screens
    store.updateJob(jobId, { step: 3 });
    console.log("Starting crawl for job", jobId);
    const screenshotDir = SCREENSHOT_DIR_PREFIX + jobId;
    fs.mkdirSync(screenshotDir, { recursive: true });

    let screenshots = [];

    if (USE_CRAWLER_V1) {
      // Parse APK manifest for package name + metadata
      let appProfile = { packageName: "", activities: [], permissions: [], appName: "" };
      try {
        appProfile = parseApk(apkPath);
        console.log(`Manifest: package=${appProfile.packageName}, launcher=${appProfile.launcherActivity}, activities=${appProfile.activities.length}`);
      } catch (e) {
        console.log("Manifest parsing failed, falling back to pm list:", e.message);
      }

      let packageName = appProfile.packageName;

      // Fallback: use pm list packages if manifest parsing didn't get the package name
      if (!packageName) {
        try {
          const packages = execSync("adb shell pm list packages -3")
            .toString()
            .trim()
            .split("\n");
          packageName = packages[packages.length - 1]
            .replace("package:", "")
            .trim();
        } catch (e) {
          console.log("Could not detect package name:", e.message);
        }
      }

      // Launch app using launcher activity from manifest, or monkey fallback
      try {
        if (appProfile.launcherActivity) {
          execSync(
            `adb shell am start -n ${packageName}/${appProfile.launcherActivity}`,
          );
        } else {
          execSync(
            "adb shell monkey -p " +
              packageName +
              " -c android.intent.category.LAUNCHER 1",
          );
        }
      } catch (e) {
        console.log("Could not launch app:", e.message);
      }

      await sleep(3000);

      const crawlResult = await runCrawl({
        screenshotDir,
        packageName,
        credentials: opts.credentials,
        goldenPath: opts.goldenPath,
        goals: opts.goals,
        painPoints: opts.painPoints,
        maxSteps: MAX_CRAWL_STEPS,
        appProfile,
        onProgress: (step, total) => {
          store.updateJob(jobId, { crawlProgress: { step, total } });
        },
      });

      screenshots = (crawlResult.screens || []).map((s) => ({
        path: s.path,
        xml: s.xml,
        index: s.index,
      }));

      store.updateJob(jobId, {
        screenshots: screenshots.map((s) => s.path),
        crawlGraph: crawlResult.graph,
        crawlStats: crawlResult.stats,
        stopReason: crawlResult.stopReason,
      });

      const crawlStopReason = crawlResult.stopReason;
      const isCrawlFailed =
        !screenshots ||
        screenshots.length === 0 ||
        crawlStopReason === "device_offline" ||
        crawlStopReason === "capture_failed";

      const isCrawlDegraded =
        !isCrawlFailed &&
        screenshots.length < 3;

      if (isCrawlFailed) {
        console.error(
          `Job ${jobId}: crawl failed - stopReason=${crawlStopReason}, screens=${screenshots ? screenshots.length : 0}`
        );
        store.updateJob(jobId, {
          status: "failed",
          error: "Crawl failed: " + (crawlStopReason || "no screens captured"),
        });
        return;
      }

      if (isCrawlDegraded) {
        store.updateJob(jobId, { crawlQuality: "degraded" });
        console.log(`Job ${jobId}: crawl degraded - only ${screenshots.length} screens captured`);
      } else {
        store.updateJob(jobId, { crawlQuality: "good" });
      }
    } else {
      screenshots = await legacyCrawl(jobId, screenshotDir);
    }

    if (SKIP_AI_FOR_TESTS) {
      console.log(`Job ${jobId}: SKIP_AI_FOR_TESTS=true - skipping analysis, report generation, and email`);

      const job = store.getJob(jobId);
      store.updateJob(jobId, {
        step: 4,
        analyses: [],
        report: JSON.stringify({
          test_mode: true,
          summary: "AI analysis skipped for test run",
          screens_captured: screenshots.length,
          crawl_quality: job.crawlQuality || "unknown",
          stop_reason: job.stopReason || "unknown",
          oracle_findings: crawlResult.oracleFindings || [],
        }, null, 2),
      });

      const updatedJob = store.getJob(jobId);
      store.updateJob(jobId, {
        step: 6,
        emailStatus: "skipped_test_mode",
        status: updatedJob.crawlQuality === "degraded" ? "degraded" : "complete",
      });

      killEmulator();
      try { fs.unlinkSync(apkPath); } catch (e) {}
      return;
    }

    // Step 4: Oracle pipeline — triage → gated AI → structured report
    store.updateJob(jobId, { step: 4 });
    const tokenUsage = { input_tokens: 0, output_tokens: 0 };

    // 4a: Triage — select max 8 screens for AI analysis
    const triageResult = triageForAI(
      screenshots,
      crawlResult.oracleFindingsByStep || {},
      crawlResult.coverage || {},
    );
    console.log(
      `Job ${jobId}: triage selected ${triageResult.screensToAnalyze.length} screens for AI (skipped ${triageResult.skippedScreens.length})`
    );

    // 4b: Gated AI analysis — only on triaged screens
    const { analyses, totalTokens: analysisTokens } = await analyzeTriagedScreens(
      triageResult.screensToAnalyze,
      {
        appCategory: crawlResult.plan?.appCategory || "unknown",
        coverage: crawlResult.coverage,
      }
    );
    tokenUsage.input_tokens += analysisTokens.input_tokens;
    tokenUsage.output_tokens += analysisTokens.output_tokens;

    // Step 5: Structured report (1 Sonnet LLM call)
    store.updateJob(jobId, { step: 5 });
    const job = store.getJob(jobId);

    const { report, tokenUsage: reportTokens } = await buildReport({
      packageName: appProfile.packageName || "",
      coverageSummary: crawlResult.coverage || {},
      deterministicFindings: crawlResult.oracleFindings || [],
      aiAnalyses: analyses,
      flows: crawlResult.flows || [],
      crawlStats: crawlResult.stats || {},
      opts,
      crawlHealth: {
        stopReason: crawlResult.stopReason,
        totalSteps: (crawlResult.stats || {}).totalSteps,
        uniqueStates: (crawlResult.stats || {}).uniqueStates,
        oracleFindingsCount: (crawlResult.oracleFindings || []).length,
        aiScreensAnalyzed: triageResult.screensToAnalyze.length,
        aiScreensSkipped: triageResult.skippedScreens.length,
      },
    });
    tokenUsage.input_tokens += reportTokens.input_tokens;
    tokenUsage.output_tokens += reportTokens.output_tokens;

    store.updateJob(jobId, {
      report,
      tokenUsage,
      triageLog: triageResult.triageLog,
    });

    console.log(
      `Job ${jobId}: tokens used — ${tokenUsage.input_tokens} input + ${tokenUsage.output_tokens} output = ${tokenUsage.input_tokens + tokenUsage.output_tokens} total`
    );

    // Step 6: Send email
    store.updateJob(jobId, { step: 6, emailStatus: "not_requested" });

    if (opts.email) {
      store.updateJob(jobId, { emailStatus: "sending" });
      const emailResult = await sendReportEmail(opts.email, report, triageResult.screensToAnalyze.length);
      store.updateJob(jobId, { emailStatus: emailResult.status });
      if (emailResult.error) {
        store.updateJob(jobId, { emailError: emailResult.error });
        console.error(`Job ${jobId}: email ${emailResult.status} - ${emailResult.error}`);
      }
      if (emailResult.response) {
        store.updateJob(jobId, { emailResponse: emailResult.response });
        console.log(`Job ${jobId}: resend response = ${JSON.stringify(emailResult.response)}`);
      }
    }

    const finalJob = store.getJob(jobId);
    store.updateJob(jobId, {
      status: finalJob.crawlQuality === "degraded" ? "degraded" : "complete",
    });

    killEmulator();
    try { fs.unlinkSync(apkPath); } catch (e) {}
  } catch (err) {
    console.error("Job failed:", err);
    store.updateJob(jobId, { status: "failed", error: err.message });
    killEmulator();
  }
}

// ---------------------------------------------------------------------------
// Legacy crawl (preserved behind USE_CRAWLER_V1=false flag)
// ---------------------------------------------------------------------------

async function legacyCrawl(jobId, screenshotDir) {
  throw new Error("Legacy crawl is disabled in this VM build. Use crawler v1.");
}

module.exports = { processJob };
