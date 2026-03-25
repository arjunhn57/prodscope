const fs = require("fs");

const file = ".\\app.html";
let s = fs.readFileSync(file, "utf8");

const re = /function renderLivePreview\(live, jobId\) \{[\s\S]*?\n\}\n\n\n\/\* live bridge \*\//;

const replacement = `function renderLivePreview(live, jobId) {
  const panel = document.getElementById('livePanel');
  if (!panel || !live) return;

  panel.classList.add('show');

  const phase = String(live.phase || 'running');
  const dot = document.getElementById('livePanelDot');
  const phaseEl = document.getElementById('livePanelPhase');
  const counterEl = document.getElementById('livePanelCounter');
  const activityEl = document.getElementById('livePanelActivity');
  const intentEl = document.getElementById('livePanelIntent');
  const actionEl = document.getElementById('livePanelAction');
  const captureEl = document.getElementById('livePanelCapture');
  const messageEl = document.getElementById('livePanelMessage');
  const thumbEl = document.getElementById('livePanelThumb');

  if (dot) dot.className = 'live-panel-dot ' + phase;
  if (phaseEl) phaseEl.textContent = phase.replace(/_/g, ' ');

  const stepPart = (live.rawStep != null && live.maxRawSteps != null)
    ? (live.rawStep + '/' + live.maxRawSteps)
    : ((live.countedUniqueScreens != null && live.targetUniqueScreens != null)
      ? (live.countedUniqueScreens + '/' + live.targetUniqueScreens)
      : '-');
  if (counterEl) counterEl.textContent = stepPart;

  if (activityEl) activityEl.textContent = live.activity || live.packageName || '-';
  if (intentEl) intentEl.textContent = live.intentType || '-';

  let actionText = '-';
  if (live.latestAction && typeof live.latestAction === 'object') {
    actionText = [
      live.latestAction.type,
      live.latestAction.description,
      live.latestAction.decisionSource
    ].filter(Boolean).join(': ');
  } else if (live.latestAction) {
    actionText = String(live.latestAction);
  }
  if (actionEl) actionEl.textContent = actionText;
  if (captureEl) captureEl.textContent = live.captureMode || (live.screenshotUnavailable ? 'xml_only' : '-');
  if (messageEl) messageEl.textContent = live.message || live.stopReason || 'Live progress update';

  const base = (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE : window.location.origin;

  if (thumbEl && jobId) {
    let img = document.getElementById('livePanelStream');
    if (!img) {
      thumbEl.innerHTML = '';
      img = document.createElement('img');
      img.id = 'livePanelStream';
      img.alt = 'Live emulator stream';
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      img.style.display = 'block';
      thumbEl.appendChild(img);
    }

    const srcBase = base + '/api/job-live-stream/' + encodeURIComponent(jobId);
    const currentJob = String(jobId);

    if (img.dataset.jobId !== currentJob) {
      img.dataset.jobId = currentJob;
      img.dataset.phase = phase;
      img.dataset.streamBase = srcBase;
      img.src = srcBase + '?t=' + Date.now();
    } else {
      img.dataset.phase = phase;
    }

    if ((phase === 'complete' || phase === 'failed') && !img.dataset.terminalPhase) {
      img.dataset.terminalPhase = phase;
    }
  }
}

/* live bridge */`;

if (!re.test(s)) {
  throw new Error("Could not find renderLivePreview() block in app.html");
}

s = s.replace(re, replacement);
fs.writeFileSync(file, s, "utf8");
console.log("Patched app.html to use /api/job-live-stream");
