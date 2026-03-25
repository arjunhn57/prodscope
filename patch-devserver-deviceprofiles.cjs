const fs = require("fs");

const path = ".\\dev-server.mjs";
let s = fs.readFileSync(path, "utf8");

const oldBlock = `  if (pathname.startsWith("/api/job-screenshot/") && req.method === "GET") {
    proxyToBackend(req, res, pathname + search);
    return;
  }

  if (pathname.startsWith("/api/job-report/") && req.method === "GET") {
    proxyToBackend(req, res, pathname + search);
    return;
  }`;

const newBlock = `  if (pathname === "/api/device-profiles" && req.method === "GET") {
    proxyToBackend(req, res, pathname + search);
    return;
  }

  if (pathname.startsWith("/api/job-screenshot/") && req.method === "GET") {
    proxyToBackend(req, res, pathname + search);
    return;
  }

  if (pathname.startsWith("/api/job-report/") && req.method === "GET") {
    proxyToBackend(req, res, pathname + search);
    return;
  }`;

if (!s.includes('/api/device-profiles')) {
  if (!s.includes(oldBlock)) {
    throw new Error("Could not find expected proxy block in dev-server.mjs");
  }
  s = s.replace(oldBlock, newBlock);
}

fs.writeFileSync(path, s, "utf8");
console.log("Patched dev-server.mjs with /api/device-profiles proxy");
