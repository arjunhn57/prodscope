const fs = require("fs");

const path = ".\\dev-server.mjs";
let s = fs.readFileSync(path, "utf8");

const from = `    if (pathname.startsWith('/api/job-status/') && req.method === 'GET') {
      await proxyRequest(req, res, pathname);
      return;
    }

    if (pathname.startsWith('/api/job-screenshot/') && req.method === 'GET') {`;

const to = `    if (pathname.startsWith('/api/job-status/') && req.method === 'GET') {
      await proxyRequest(req, res, pathname);
      return;
    }

    if (pathname === '/api/device-profiles' && req.method === 'GET') {
      await proxyRequest(req, res, pathname);
      return;
    }

    if (pathname.startsWith('/api/job-screenshot/') && req.method === 'GET') {`;

if (!s.includes("pathname === '/api/device-profiles'")) {
  if (!s.includes(from)) {
    throw new Error("Could not find exact insertion point in dev-server.mjs");
  }
  s = s.replace(from, to);
}

fs.writeFileSync(path, s, "utf8");
console.log("Patched dev-server.mjs");
