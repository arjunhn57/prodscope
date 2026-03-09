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
const resend = new Resend(process.env.RESEND_API_KEY);

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
// Job processing — orchestrator
// ---------------------------------------------------------------------------

async function processJob(jobId, apkPath, opts) {
  try {
    jobs[jobId].status = "processing";
    jobs[jobId].step = 1;

    // Step 1: Start emulator
    execSync("sudo chmod 666 /dev/kvm", { stdio: "ignore" });
    exec(
      "emulator -avd prodscope-test -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect &",
    );
    execSync("adb wait-for-device");

    // Wait for boot
    let booted = false;
    for (let i = 0; i < 60; i++) {
      try {
        const result = execSync("adb shell getprop sys.boot_completed")
          .toString()
          .trim();
        if (result === "1") {
          booted = true;
          break;
        }
      } catch (e) {}
      await sleep(2000);
    }
    if (!booted) throw new Error("Emulator failed to boot");
    await sleep(5000);

    // Step 2: Install APK
    jobs[jobId].step = 2;
    execSync('adb install -r "' + apkPath + '"', { timeout: 60000 });

    // Step 3: Crawl screens
    jobs[jobId].step = 3;
    console.log("Starting crawl for job", jobId);
    const screenshotDir = "/tmp/screenshots-" + jobId;
    fs.mkdirSync(screenshotDir, { recursive: true });

    let screenshots;

    if (USE_CRAWLER_V1) {
      // ── Crawler v1: modular, deterministic ──────────────────────────
      // Get package name
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

      // Map crawl result to the format expected by analysis
      screenshots = crawlResult.screens.map((s) => ({
        path: s.path,
        xml: s.xml,
        index: s.index,
      }));
      jobs[jobId].screenshots = screenshots.map((s) => s.path);
      jobs[jobId].crawlGraph = crawlResult.graph;
      jobs[jobId].crawlStats = crawlResult.stats;
      jobs[jobId].stopReason = crawlResult.stopReason;
    } else {
      // ── Legacy crawl (preserved for A/B comparison) ─────────────────
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
    if (opts.email) {
      await resend.emails.send({
        from: "ProdScope <onboarding@resend.dev>",
        to: opts.email,
        subject: "Your ProdScope Analysis Report is Ready",
        html:
          "<h1>Your App Analysis is Complete</h1><p>Your report has been generated with " +
          analyses.length +
          " screens analyzed.</p><pre>" +
          jobs[jobId].report +
          "</pre>",
      });
    }

    jobs[jobId].status = "complete";

    // Cleanup
    try {
      execSync("adb emu kill", { stdio: "ignore" });
    } catch (e) {}
    fs.unlinkSync(apkPath);
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

const clickables =
  xmlDump.match(
    /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*clickable="true"/g,
  ) || [];

if (clickables.length > 0) {
  const parsed = clickables
    .map((item) => {
      const match = item.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      if (!match) return null;

      const x1 = parseInt(match[1], 10);
      const y1 = parseInt(match[2], 10);
      const x2 = parseInt(match[3], 10);
      const y2 = parseInt(match[4], 10);

      return {
        raw: item,
        x1,
        y1,
        x2,
        y2,
        centerX: Math.floor((x1 + x2) / 2),
        centerY: Math.floor((y1 + y2) / 2),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.centerY !== b.centerY) return a.centerY - b.centerY;
      return a.centerX - b.centerX;
    });

  const chosen = parsed[0];
  if (chosen) {
    execSync(`adb shell input tap ${chosen.centerX} ${chosen.centerY}`);
    await sleep(2000);
  }
} else {
  execSync("adb shell input swipe 540 1800 540 900 300");
  await sleep(1500);
}
// ---------------------------------------------------------------------------
// Analysis helpers (extracted from inline for clarity, same logic)
// ---------------------------------------------------------------------------

async function analyzeScreenshots(screenshots, opts) {
  const analyses = [];
  for (const ss of screenshots) {
    try {
      const imgData = fs.readFileSync(ss.path).toString("base64");
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
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

  // Include crawl graph summary if available (v1 crawler)
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
