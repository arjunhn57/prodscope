const fs = require("fs");

const path = "app.html";
let html = fs.readFileSync(path, "utf8");

if (html.includes("renderLivePreview(data.live, jobId);")) {
  console.log("live hook already present");
  process.exit(0);
}

const re = /const\s+data\s*=\s*await\s+response\.json\(\);\s*/;
if (!re.test(html)) {
  throw new Error("Could not find 'const data = await response.json();' in app.html");
}

html = html.replace(
  re,
  match => match + "\n      if (data.live) renderLivePreview(data.live, jobId);\n"
);

// optional: make currentJobId easier to inspect in console
if (!html.includes("window.currentJobId = currentJobId;")) {
  html = html.replace(
    /currentJobId\s*=\s*jobId\s*;/,
    m => m + "\n      window.currentJobId = currentJobId;"
  );
}

fs.writeFileSync(path, html, "utf8");
console.log("patched app.html with live render hook");
