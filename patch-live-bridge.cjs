const fs = require("fs");

const path = "app.html";
let html = fs.readFileSync(path, "utf8");

if (html.includes("__liveBridgeInstalled")) {
  console.log("live bridge already present");
  process.exit(0);
}

const bridge = `
/* live bridge */
window.__liveBridgeInstalled = true;

(function () {
  const __origPollJobStatus =
    typeof pollJobStatus === 'function' ? pollJobStatus : null;

  if (__origPollJobStatus && !window.__pollJobStatusWrapped) {
    pollJobStatus = async function(jobId) {
      window.currentJobId = jobId;
      return __origPollJobStatus.apply(this, arguments);
    };
    window.__pollJobStatusWrapped = true;
  }

  async function __fetchAndRenderLive() {
    try {
      const jobId = window.currentJobId;
      if (!jobId) return;
      if (typeof renderLivePreview !== 'function') return;
      if (!document.getElementById('livePanel')) return;

      const res = await fetch('/api/job-status/' + encodeURIComponent(jobId), {
        cache: 'no-store'
      });
      if (!res.ok) return;

      const data = await res.json();
      if (data && data.live) {
        renderLivePreview(data.live, jobId);
      }
    } catch (e) {
      // keep silent; this is only a UI helper
    }
  }

  __fetchAndRenderLive();

  if (!window.__liveBridgeTimer) {
    window.__liveBridgeTimer = setInterval(__fetchAndRenderLive, 3000);
  }
})();
`;

if (!html.includes("</script>")) {
  throw new Error("Could not find </script> in app.html");
}

html = html.replace("</script>", bridge + "\n</script>");
fs.writeFileSync(path, html, "utf8");
console.log("patched app.html with live bridge");
