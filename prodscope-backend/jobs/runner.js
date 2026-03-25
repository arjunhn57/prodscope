"use strict";

require("dotenv").config();
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");

const store = require("./store");
const { bootEmulator, installApk, killEmulator } = require("../emulator/manager");
const { sendReportEmail } = require("../output/email-sender");
const { sleep } = require("../utils/sleep");
const {
  USE_CRAWLER_V1,
  SKIP_AI_FOR_TESTS,
  SCREENSHOT_DIR_PREFIX,
  MAX_CRAWL_STEPS,
  ANALYSIS_MODEL,
  REPORT_MODEL,
} = require("../config/defaults");

const { runCrawl } = require("../crawler/run");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
      let packageName = "";
      try {
        const packages = execSync("adb shell pm list packages -3")
          .toString()
          .trim()
          .split("\n");
        packageName = packages[packages.length - 1]
          .replace("package:", "")
          .trim();

        execSync(
          "adb shell monkey -p " +
            packageName +
            " -c android.intent.category.LAUNCHER 1",
        );
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

    // Step 4: Analyze with Claude
    store.updateJob(jobId, { step: 4 });
    const analyses = await analyzeScreenshots(screenshots, opts);

    // Step 5: Generate final report with Sonnet
    store.updateJob(jobId, { step: 5 });
    const job = store.getJob(jobId);
    const report = await generateReport(analyses, opts, job);
    store.updateJob(jobId, { report });

    // Step 6: Send email
    store.updateJob(jobId, { step: 6, emailStatus: "not_requested" });

    if (opts.email) {
      store.updateJob(jobId, { emailStatus: "sending" });
      const emailResult = await sendReportEmail(opts.email, report, analyses.length);
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

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------

async function analyzeScreenshots(screenshots, opts) {
  const analyses = [];
  for (const ss of screenshots) {
    try {
      const imgData = fs.readFileSync(ss.path).toString("base64");
      const response = await anthropic.messages.create({
        model: ANALYSIS_MODEL,
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: imgData,
                },
              },
              {
                type: "text",
                text:
                  'Analyze this app screenshot for bugs and UX issues. Return JSON: {"bugs":[],"ux_issues":[],"suggestions":[],"severity":"low|medium|high"}. UI XML context: ' +
                  (ss.xml || "").substring(0, 500),
              },
            ],
          },
        ],
      });

      analyses.push({ screen: ss.index, analysis: response.content[0].text });
    } catch (e) {
      console.error("Screen analysis failed for screen", ss.index, e.message);
      analyses.push({
        screen: ss.index,
        analysis:
          '{"bugs":[],"ux_issues":["Analysis failed"],"suggestions":[],"severity":"unknown","error":' +
          JSON.stringify(e.message) +
          "}",
      });
    }
  }
  return analyses;
}

async function generateReport(analyses, opts, job) {
  const screenAnalyses = analyses
    .map(function (a) {
      return "Screen " + a.screen + ": " + a.analysis;
    })
    .join("\n\n");

  let crawlContext = "";
  if (job.crawlGraph) {
    crawlContext =
      "\nCrawl statistics: " +
      JSON.stringify(job.crawlStats) +
      "\nStop reason: " +
      (job.stopReason || "unknown") +
      "\nUnique screens discovered: " +
      (job.crawlGraph.uniqueStates || "N/A") +
      "\n";
  }

  const finalPrompt =
    "You are a senior QA engineer. Based on these per-screen analyses of an Android app, generate a comprehensive report.\n\n" +
    "User known pain points: " +
    (opts.painPoints || "None specified") +
    "\n" +
    "User analysis goals: " +
    (opts.goals || "General review") +
    "\n" +
    "Golden path: " +
    (opts.goldenPath || "Not specified") +
    "\n" +
    crawlContext +
    "\n" +
    "Per-screen analyses:\n" +
    screenAnalyses +
    "\n\n" +
    'Return a detailed JSON report with: {"overall_score":0-100,"summary":"","critical_bugs":[],"ux_issues":[],"suggestions":[],"quick_wins":[],"detailed_findings":[]}';

  const finalResponse = await anthropic.messages.create({
    model: REPORT_MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: finalPrompt }],
  });

  return finalResponse.content[0].text;
}

module.exports = { processJob };
