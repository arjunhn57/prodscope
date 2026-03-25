const fs = require("fs");

const path = "app.html";
let html = fs.readFileSync(path, "utf8");

if (html.includes("renderLivePreview(data.live, jobId);")) {
  console.log("live render hook already present");
  process.exit(0);
}

const fnRe = /async function pollJobStatus\s*\(\s*jobId\s*\)\s*\{[\s\S]*?\n\}/;
const m = html.match(fnRe);

if (!m) {
  throw new Error("Could not find pollJobStatus(jobId) in app.html");
}

let fn = m[0];

if (!fn.includes("renderLivePreview(data.live, jobId);")) {
  fn = fn.replace(
    /await\s+response\.json\(\)\s*;/,
    (x) => x + "\n      if (data.live) renderLivePreview(data.live, jobId);"
  );
}

if (!fn.includes("window.currentJobId = currentJobId;")) {
  fn = fn.replace(
    /currentJobId\s*=\s*jobId\s*;/,
    (x) => x + "\n      window.currentJobId = currentJobId;"
  );
}

html = html.replace(fnRe, fn);
fs.writeFileSync(path, html, "utf8");
console.log("patched pollJobStatus live hook");
