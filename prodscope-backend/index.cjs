require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const { execSync, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const Anthropic = require("@anthropic-ai/sdk");
const { Resend } = require("resend");

// Crawler v1
const { runCrawl } = require("./crawler/run");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "/tmp/uploads/" });
const jobs = {};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/** Feature flag: set USE_CRAWLER_V1=false to fall back to legacy inline crawl */
const USE_CRAWLER_V1 = process.env.USE_CRAWLER_V1 !== "false";

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/api/start-job", upload.single("apk"), async (req, res) => {
  const jobId = uuidv4();
  const { email, credentials, goldenPath, painPoints, goals } = req.body;

  jobs[jobId] = {
    status: "queued",
    step: 0,
    steps: [
      "Uploading",
      "Installing",
      "Crawling",
      "Analyzing",
      "Generating Report",
      "Sending Email",
    ],
    screenshots: [],
    report: null,
  };

  res.json({ jobId, status: "queued" });

  const originalName = req.file.originalname || "upload.apk";
  const ext = path.extname(originalName).toLowerCase() || ".apk";
  const apkPath = path.join(os.tmpdir(), jobId + ext);
  fs.copyFileSync(req.file.path, apkPath);

  processJob(jobId, apkPath, {
    email,
    credentials: JSON.parse(credentials || "{}"),
    goldenPath,
    painPoints,
    goals,
  });
});

app.get("/api/job-status/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

// ---------------------------------------------------------------------------
// Job processing ΓÇö orchestrator
// ---------------------------------------------------------------------------

async function processJob(jobId, apkPath, opts) {
  try {
    jobs[jobId].status = "processing";
    jobs[jobId].step = 1;

    // Step 1: Start emulator (robust boot logic)
    execSync("sudo chmod 666 /dev/kvm", { stdio: "ignore" });
    try { execSync("adb kill-server", { stdio: "ignore" }); } catch (e) {}
    try { execSync("pkill -f emulator", { stdio: "ignore" }); } catch (e) {}
    try { execSync("pkill -f qemu-system-x86_64", { stdio: "ignore" }); } catch (e) {}
    await sleep(2000);

    exec(
      "nohup emulator -avd prodscope-test -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot > /tmp/prodscope-emulator.log 2>&1 &",
    );

    await sleep(8000);
    try { execSync("adb start-server", { stdio: "ignore" }); } catch (e) {}

    let booted = false;
    for (let i = 0; i < 120; i++) {
      try {
        const devices = execSync("adb devices").toString();
        const hasEmulator = devices.includes("emulator-") && !devices.includes("offline");

        if (hasEmulator) {
          const result = execSync("adb shell getprop sys.boot_completed")
            .toString()
            .trim();

          if (result === "1") {
            booted = true;
            break;
          }
        }
      } catch (e) {}
      await sleep(2000);
    }

    if (!booted) {
      let emuLog = "";
      try {
        emuLog = execSync("tail -n 80 /tmp/prodscope-emulator.log").toString();
      } catch (e) {}
      throw new Error("Emulator failed to boot. " + emuLog);
    }

    await sleep(5000);

    // Step 2: Install APK
    jobs[jobId].step = 2;
    execSync('adb install -r "' + apkPath + '"', { timeout: 60000 });

    // Step 3: Crawl screens
    jobs[jobId].step = 3;
    console.log("Starting crawl for job", jobId);
    const screenshotDir = "/tmp/screenshots-" + jobId;
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
        maxSteps: 20,
        onProgress: (step, total) => {
          jobs[jobId].crawlProgress = { step, total };
        },
      });

      screenshots = (crawlResult.screens || []).map((s) => ({
        path: s.path,
        xml: s.xml,
        index: s.index,
      }));

      jobs[jobId].screenshots = screenshots.map((s) => s.path);
      jobs[jobId].crawlGraph = crawlResult.graph;
      jobs[jobId].crawlStats = crawlResult.stats;
      jobs[jobId].stopReason = crawlResult.stopReason;

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
          `Job ${jobId}: crawl failed ΓÇö stopReason=${crawlStopReason}, screens=${screenshots ? screenshots.length : 0}`
        );
        jobs[jobId].status = "failed";
        jobs[jobId].error = "Crawl failed: " + (crawlStopReason || "no screens captured");
        return;
      }

      if (isCrawlDegraded) {
        jobs[jobId].crawlQuality = "degraded";
        console.log(`Job ${jobId}: crawl degraded ΓÇö only ${screenshots.length} screens captured`);
      } else {
        jobs[jobId].crawlQuality = "good";
      }
    } else {
      screenshots = await legacyCrawl(jobId, screenshotDir);
    }

    // Step 4: Analyze with Claude
    jobs[jobId].step = 4;
    const analyses = await analyzeScreenshots(screenshots, opts);

    // Step 5: Generate final report with Sonnet
    jobs[jobId].step = 5;
    const report = await generateReport(analyses, opts, jobs[jobId]);
    jobs[jobId].report = report;

    // Step 6: Send email
    jobs[jobId].step = 6;
    jobs[jobId].emailStatus = "not_requested";

    if (opts.email) {
      if (!resend) {
        jobs[jobId].emailStatus = "not_configured";
        jobs[jobId].emailError = "RESEND_API_KEY is missing or Resend is not initialized";
        console.error(`Job ${jobId}: email not configured`);
      } else {
        try {
          jobs[jobId].emailStatus = "sending";

          const emailResult = await resend.emails.send({
            from: "ProdScope <onboarding@resend.dev>",
            to: opts.email,
            subject: "Your ProdScope Analysis Report is Ready",
            html: renderReportEmail(jobs[jobId].report, analyses.length),
          });

          if (emailResult && emailResult.error) {
            jobs[jobId].emailStatus = "failed";
            jobs[jobId].emailError =
              emailResult.error.message || JSON.stringify(emailResult.error);
            jobs[jobId].emailResponse = emailResult;
            console.error(
              `Job ${jobId}: resend returned error = ${JSON.stringify(emailResult)}`
            );
          } else {
            jobs[jobId].emailStatus = "sent";
            jobs[jobId].emailResponse = emailResult;
            console.log(`Job ${jobId}: resend response = ${JSON.stringify(emailResult)}`);
          }
        } catch (emailErr) {
          jobs[jobId].emailStatus = "failed";
          jobs[jobId].emailError = emailErr.message;
          console.error(`Job ${jobId}: email send failed`, emailErr);
        }
      }
    }

    jobs[jobId].status =
      jobs[jobId].crawlQuality === "degraded" ? "degraded" : "complete";

    try {
      execSync("adb emu kill", { stdio: "ignore" });
    } catch (e) {}

    try {
      fs.unlinkSync(apkPath);
    } catch (e) {}
  } catch (err) {
    console.error("Job failed:", err);
    jobs[jobId].status = "failed";
    jobs[jobId].error = err.message;
    try {
      execSync("adb emu kill", { stdio: "ignore" });
    } catch (e) {}
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
        model: "claude-haiku-4-5-20251001",
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
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    messages: [{ role: "user", content: finalPrompt }],
  });

  return finalResponse.content[0].text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderStringList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p style="margin:8px 0 0;color:#6b7280;">None</p>';
  }

  return (
    '<ul style="margin:8px 0 0 18px;padding:0;color:#111827;">' +
    items.map((item) => `<li style="margin:6px 0;">${escapeHtml(item)}</li>`).join('') +
    '</ul>'
  );
}

function renderObjectList(items, type) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p style="margin:8px 0 0;color:#6b7280;">None</p>';
  }

  return items.map((item) => {
    if (typeof item === "string") {
      return `
        <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:10px 0;background:#ffffff;">
          <div style="color:#111827;line-height:1.6;">${escapeHtml(item)}</div>
        </div>
      `;
    }

    const title =
      item.title ||
      item.category ||
      item.id ||
      (type === "critical" ? "Critical Issue" : "Item");

    const priority = item.priority ? `<span style="color:#2563eb;"> (${escapeHtml(item.priority)})</span>` : "";
    const severity = item.severity ? `<div style="margin-top:8px;font-size:12px;color:#6b7280;">Severity: ${escapeHtml(item.severity)}</div>` : "";
    const description = item.description ? `<div style="margin-top:8px;color:#374151;line-height:1.6;">${escapeHtml(item.description)}</div>` : "";
    const impact = item.impact ? `<div style="margin-top:8px;font-size:12px;color:#6b7280;">Impact: ${escapeHtml(item.impact)}</div>` : "";
    const innerItems = Array.isArray(item.items) ? renderStringList(item.items) : "";
    const recommendations = Array.isArray(item.recommendations) ? renderStringList(item.recommendations) : "";
    const issues = Array.isArray(item.issues) ? renderStringList(item.issues) : "";
    const fixes = Array.isArray(item.fixes) ? renderStringList(item.fixes) : "";

    const bg =
      type === "critical" ? "#fef2f2" :
      type === "suggestion" ? "#eff6ff" :
      type === "quickwin" ? "#f0fdf4" :
      "#ffffff";

    const border =
      type === "critical" ? "#fecaca" :
      type === "suggestion" ? "#bfdbfe" :
      type === "quickwin" ? "#bbf7d0" :
      "#e5e7eb";

    return `
      <div style="border:1px solid ${border};border-radius:12px;padding:14px 16px;margin:10px 0;background:${bg};">
        <div style="font-weight:700;color:#111827;">${escapeHtml(title)}${priority}</div>
        ${description}
        ${issues}
        ${recommendations}
        ${fixes}
        ${innerItems}
        ${impact}
        ${severity}
      </div>
    `;
  }).join('');
}

function renderReportEmail(reportText, analysesCount) {
  let report;
  const cleanedReportText = String(reportText || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    report = JSON.parse(cleanedReportText);
  } catch (e) {
    return `
      <div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;padding:24px;background:#f9fafb;color:#111827;">
        <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:24px;">
          <h1 style="margin:0 0 8px;font-size:28px;line-height:1.2;">Your ProdScope Analysis Report</h1>
          <p style="margin:0 0 16px;color:#4b5563;">${analysesCount} screens analyzed</p>
          <p style="margin:0 0 16px;color:#374151;line-height:1.6;">We could not format the report as structured sections, so the raw report is included below.</p>
          <div style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:12px;padding:16px;white-space:pre-wrap;font-family:monospace;font-size:13px;line-height:1.5;color:#111827;">${escapeHtml(cleanedReportText)}</div>
        </div>
      </div>
    `;
  }

  return `
    <div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;padding:24px;background:#f9fafb;color:#111827;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:24px;">
        <h1 style="margin:0 0 8px;font-size:28px;line-height:1.2;">Your ProdScope Analysis Report</h1>
        <p style="margin:0 0 20px;color:#4b5563;">${analysesCount} screens analyzed</p>

        <div style="display:inline-block;background:#eef2ff;color:#4338ca;font-weight:700;border-radius:999px;padding:8px 14px;margin-bottom:18px;">
          Overall Score: ${escapeHtml(report.overall_score ?? "N/A")}/100
        </div>

        <div style="margin:0 0 24px;padding:16px;background:#f3f4f6;border-radius:12px;">
          <h2 style="margin:0 0 8px;font-size:18px;">Summary</h2>
          <div style="color:#374151;line-height:1.7;">${escapeHtml(report.summary || "No summary available.")}</div>
        </div>

        <div style="margin:0 0 24px;">
          <h2 style="margin:0 0 10px;font-size:18px;">Critical Bugs</h2>
          ${renderObjectList(report.critical_bugs || [], "critical")}
        </div>

        <div style="margin:0 0 24px;">
          <h2 style="margin:0 0 10px;font-size:18px;">UX Issues</h2>
          ${renderObjectList(report.ux_issues || [], "ux")}
        </div>

        <div style="margin:0 0 24px;">
          <h2 style="margin:0 0 10px;font-size:18px;">Suggestions</h2>
          ${renderObjectList(report.suggestions || [], "suggestion")}
        </div>

        <div style="margin:0 0 24px;">
          <h2 style="margin:0 0 10px;font-size:18px;">Quick Wins</h2>
          ${renderObjectList(report.quick_wins || [], "quickwin")}
        </div>

        <div style="margin:0 0 24px;">
          <h2 style="margin:0 0 10px;font-size:18px;">Detailed Findings</h2>
          ${renderObjectList(report.detailed_findings || [], "finding")}
        </div>

        <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">
          Generated by ProdScope automated app testing.
        </p>
      </div>
    </div>
  `;
}

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", function () {
  console.log("ProdScope backend running on port " + PORT);
  console.log("Crawler v1:", USE_CRAWLER_V1 ? "ENABLED" : "DISABLED (legacy)");
});
