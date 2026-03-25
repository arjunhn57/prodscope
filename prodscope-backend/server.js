"use strict";

require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const os = require("os");

const store = require("./jobs/store");
const { processJob } = require("./jobs/runner");
const { PORT, UPLOAD_DEST, USE_CRAWLER_V1, SKIP_AI_FOR_TESTS } = require("./config/defaults");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: UPLOAD_DEST });

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/api/start-job", upload.single("apk"), async (req, res) => {
  const jobId = uuidv4();
  const { email, credentials, goldenPath, painPoints, goals } = req.body;

  store.createJob(jobId, {
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
  });

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
  const job = store.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.listen(PORT, "0.0.0.0", function () {
  console.log("ProdScope backend running on port " + PORT);
  console.log("Crawler v1:", USE_CRAWLER_V1 ? "ENABLED" : "DISABLED (legacy)");
  console.log("SKIP_AI_FOR_TESTS:", SKIP_AI_FOR_TESTS ? "ENABLED" : "DISABLED");
});
