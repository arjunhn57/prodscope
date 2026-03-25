const fs = require("fs");

const file = "dev-server.mjs";
let s = fs.readFileSync(file, "utf8");

function mustReplace(from, to, label) {
  if (!s.includes(from)) {
    throw new Error("Missing block: " + label);
  }
  s = s.replace(from, to);
  console.log("[patched]", label);
}

mustReplace(
`      const timeoutMs = (isJobStatus || isLiveStream) ? Math.max(PROXY_TIMEOUT_MS, 120000) : PROXY_TIMEOUT_MS;

      upstreamReq.setTimeout(timeoutMs, () => {
        upstreamReq.destroy(new Error(\`Proxy request timed out after \${timeoutMs}ms\`));
      });`,
`      if (isLiveStream) {
        upstreamReq.setTimeout(0);
      } else {
        const timeoutMs = isJobStatus ? Math.max(PROXY_TIMEOUT_MS, 120000) : PROXY_TIMEOUT_MS;

        upstreamReq.setTimeout(timeoutMs, () => {
          upstreamReq.destroy(new Error(\`Proxy request timed out after \${timeoutMs}ms\`));
        });
      }`,
"live stream timeout block"
);

fs.writeFileSync(file, s, "utf8");
console.log("dev-server.mjs live stream timeout patch complete");
