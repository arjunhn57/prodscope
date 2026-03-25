const fs = require("fs");

const file = ".\\dev-server.mjs";
let s = fs.readFileSync(file, "utf8");

if (!s.includes("const isLiveStream = targetPath.startsWith('/api/job-live-stream/');")) {
  s = s.replace(
`  const isStartJob = targetPath === '/api/start-job';
  const isStartStatus = targetPath.startsWith('/api/job-status/');
  const isJobStatus = targetPath.startsWith('/api/job-status/');`,
`  const isStartJob = targetPath === '/api/start-job';
  const isStartStatus = targetPath.startsWith('/api/job-status/');
  const isJobStatus = targetPath.startsWith('/api/job-status/');
  const isLiveStream = targetPath.startsWith('/api/job-live-stream/');`
  );
}

s = s.replace(
`      if (isStartJob || isJobStatus) {`,
`      if (isStartJob || isJobStatus || isLiveStream) {`
);

s = s.replace(
`          if (isStartJob || isJobStatus) {`,
`          if (isStartJob || isJobStatus || isLiveStream) {`
);

s = s.replace(
`      const timeoutMs = isJobStatus ? Math.max(PROXY_TIMEOUT_MS, 120000) : PROXY_TIMEOUT_MS;`,
`      const timeoutMs = (isJobStatus || isLiveStream) ? Math.max(PROXY_TIMEOUT_MS, 120000) : PROXY_TIMEOUT_MS;`
);

if (!s.includes("pathname.startsWith('/api/job-live-stream/') && req.method === 'GET'")) {
  s = s.replace(
`    if (pathname.startsWith('/api/job-screenshot/') && req.method === 'GET') {
      await proxyRequest(req, res, pathname);
      return;
    }`,
`    if (pathname.startsWith('/api/job-live-stream/') && req.method === 'GET') {
      await proxyRequest(req, res, pathname);
      return;
    }

    if (pathname.startsWith('/api/job-screenshot/') && req.method === 'GET') {
      await proxyRequest(req, res, pathname);
      return;
    }`
  );
}

fs.writeFileSync(file, s, "utf8");
console.log("Patched dev-server.mjs for /api/job-live-stream");
