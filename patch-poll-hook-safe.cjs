const fs = require("fs");

const path = "app.html";
let html = fs.readFileSync(path, "utf8");

if (html.includes("renderLivePreview(data.live, jobId);")) {
  console.log("live render hook already present");
  process.exit(0);
}

const nameIdx = html.indexOf("pollJobStatus");
if (nameIdx === -1) {
  throw new Error("Could not find pollJobStatus in app.html");
}

const braceStart = html.indexOf("{", nameIdx);
if (braceStart === -1) {
  throw new Error("Could not find opening brace for pollJobStatus");
}

let depth = 0;
let endIdx = -1;
for (let i = braceStart; i < html.length; i++) {
  const ch = html[i];
  if (ch === "{") depth++;
  if (ch === "}") depth--;
  if (depth === 0) {
    endIdx = i;
    break;
  }
}

if (endIdx === -1) {
  throw new Error("Could not find closing brace for pollJobStatus");
}

let fn = html.slice(nameIdx, endIdx + 1);

if (!/response\.json\(\)\s*;/.test(fn)) {
  throw new Error("Could not find response.json(); inside pollJobStatus");
}

fn = fn.replace(
  /response\.json\(\)\s*;/,
  m => m + "\n      if (data.live) renderLivePreview(data.live, jobId);"
);

if (fn.includes("currentJobId = jobId;") && !fn.includes("window.currentJobId = currentJobId;")) {
  fn = fn.replace(
    /currentJobId\s*=\s*jobId\s*;/,
    m => m + "\n      window.currentJobId = currentJobId;"
  );
}

html = html.slice(0, nameIdx) + fn + html.slice(endIdx + 1);

fs.writeFileSync(path, html, "utf8");
console.log("patched pollJobStatus hook successfully");
