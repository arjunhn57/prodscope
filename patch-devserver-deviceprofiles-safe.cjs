const fs = require("fs");

const path = ".\\dev-server.mjs";
let s = fs.readFileSync(path, "utf8");

if (!s.includes('pathname === "/api/device-profiles"')) {
  const marker = 'if (pathname.startsWith("/api/job-screenshot/") && req.method === "GET") {';
  const insert = `if (pathname === "/api/device-profiles" && req.method === "GET") {
    proxyToBackend(req, res, pathname + search);
    return;
  }

  `;

  if (!s.includes(marker)) {
    throw new Error('Could not find job-screenshot proxy marker in dev-server.mjs');
  }

  s = s.replace(marker, insert + marker);
}

fs.writeFileSync(path, s, "utf8");
console.log("Patched dev-server.mjs with /api/device-profiles proxy");
