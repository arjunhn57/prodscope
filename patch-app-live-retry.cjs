const fs = require("fs");

const file = "app.html";
let s = fs.readFileSync(file, "utf8");

function mustReplace(from, to, label) {
  if (!s.includes(from)) {
    throw new Error("Missing block: " + label);
  }
  s = s.replace(from, to);
  console.log("[patched]", label);
}

mustReplace(
`      thumbEl.appendChild(img);
    }

    const srcBase = base + '/api/job-live-stream/' + encodeURIComponent(jobId);`,
`      thumbEl.appendChild(img);
    }

    if (!img.dataset.boundRetry) {
      img.dataset.boundRetry = '1';

      img.onerror = function () {
        const phaseNow = img.dataset.phase || '';
        if (phaseNow === 'complete' || phaseNow === 'failed') return;

        const retryCount = Number(img.dataset.retryCount || '0') + 1;
        img.dataset.retryCount = String(retryCount);

        const delay = Math.min(4000, Math.max(1000, retryCount * 1000));
        clearTimeout(img.__retryTimer);

        img.__retryTimer = setTimeout(function () {
          const streamBase = img.dataset.streamBase;
          if (streamBase) {
            img.src = streamBase + '?retry=' + Date.now();
          }
        }, delay);
      };

      img.onload = function () {
        img.dataset.retryCount = '0';
      };
    }

    const srcBase = base + '/api/job-live-stream/' + encodeURIComponent(jobId);`,
"stream retry handlers"
);

mustReplace(
`    if (img.dataset.jobId !== currentJob) {
      img.dataset.jobId = currentJob;
      img.dataset.phase = phase;
      img.dataset.streamBase = srcBase;
      img.src = srcBase + '?t=' + Date.now();
    } else {
      img.dataset.phase = phase;
    }`,
`    if (img.dataset.jobId !== currentJob) {
      img.dataset.jobId = currentJob;
      img.dataset.phase = phase;
      img.dataset.streamBase = srcBase;
      img.dataset.retryCount = '0';
      delete img.dataset.terminalPhase;
      clearTimeout(img.__retryTimer);
      img.src = srcBase + '?t=' + Date.now();
    } else {
      img.dataset.phase = phase;
    }`,
"stream state reset"
);

fs.writeFileSync(file, s, "utf8");
console.log("app.html stream retry patch complete");
