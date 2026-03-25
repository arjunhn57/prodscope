const fs = require("fs");

const path = "app.html";
let html = fs.readFileSync(path, "utf8");

if (html.includes('id="livePanel"') || html.includes("function renderLivePreview(")) {
  console.log("live panel already present, no patch applied");
  process.exit(0);
}

const cssBlock = `
/* === live panel === */
.live-panel{display:none;margin:18px 0;padding:16px;border:1px solid #e5e7eb;border-radius:14px;background:#fff}
.live-panel.show{display:block}
.live-panel-header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}
.live-panel-badge{display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:13px;padding:6px 10px;border-radius:999px;background:#f3f4f6;color:#111827}
.live-panel-dot{width:8px;height:8px;border-radius:999px;background:#9ca3af}
.live-panel-dot.crawling,.live-panel-dot.installing,.live-panel-dot.launching,.live-panel-dot.booting_emulator{background:#16a34a}
.live-panel-dot.analyzing,.live-panel-dot.reporting,.live-panel-dot.emailing,.live-panel-dot.crawl_done{background:#eab308}
.live-panel-dot.failed{background:#dc2626}
.live-panel-dot.complete{background:#16a34a}
.live-panel-body{display:grid;grid-template-columns:160px 1fr;gap:14px}
.live-panel-thumb{width:160px;height:300px;border:1px solid #e5e7eb;border-radius:12px;background:#f9fafb;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#6b7280;font-size:12px;text-align:center;padding:10px}
.live-panel-thumb img{max-width:100%;max-height:100%;display:block}
.live-panel-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.live-panel-item{padding:10px 12px;border:1px solid #e5e7eb;border-radius:12px;background:#fafafa}
.live-panel-label{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
.live-panel-value{font-size:13px;color:#111827;word-break:break-word}
.live-panel-msg{margin-top:12px;padding:10px 12px;border-radius:12px;background:#eff6ff;color:#1d4ed8;font-size:13px}
@media (max-width:720px){.live-panel-body{grid-template-columns:1fr}.live-panel-thumb{width:100%;height:220px}}
`;

const htmlBlock = `
<div class="live-panel" id="livePanel">
  <div class="live-panel-header">
    <div class="live-panel-badge">
      <span class="live-panel-dot" id="livePanelDot"></span>
      <span id="livePanelPhase">Live progress</span>
    </div>
    <div class="live-panel-badge" id="livePanelCounter">0/0</div>
  </div>

  <div class="live-panel-body">
    <div class="live-panel-thumb" id="livePanelThumb">Waiting for first screen…</div>

    <div>
      <div class="live-panel-grid">
        <div class="live-panel-item">
          <div class="live-panel-label">Activity</div>
          <div class="live-panel-value" id="livePanelActivity">-</div>
        </div>
        <div class="live-panel-item">
          <div class="live-panel-label">Intent</div>
          <div class="live-panel-value" id="livePanelIntent">-</div>
        </div>
        <div class="live-panel-item">
          <div class="live-panel-label">Action</div>
          <div class="live-panel-value" id="livePanelAction">-</div>
        </div>
        <div class="live-panel-item">
          <div class="live-panel-label">Capture</div>
          <div class="live-panel-value" id="livePanelCapture">-</div>
        </div>
      </div>
      <div class="live-panel-msg" id="livePanelMessage">Waiting for crawl updates…</div>
    </div>
  </div>
</div>
`;

const jsBlock = `
function renderLivePreview(live, jobId) {
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

  if (thumbEl) {
    if (live.screenshotPath && !live.screenshotUnavailable) {
      const filename = String(live.screenshotPath).split('/').pop();
      thumbEl.innerHTML = '<img alt="Latest crawl screen">';
      const img = thumbEl.querySelector('img');
      img.onerror = function () {
        thumbEl.textContent = live.captureMode === 'xml_only' ? 'XML-only mode' : 'Preview unavailable';
      };
      img.src = base + '/api/job-screenshot/' + encodeURIComponent(jobId) + '/' + encodeURIComponent(filename) + '?t=' + Date.now();
    } else {
      thumbEl.textContent = live.captureMode === 'xml_only' ? 'XML-only mode' : 'Preview unavailable';
    }
  }
}
`;

if (html.includes("</style>")) {
  html = html.replace("</style>", cssBlock + "\n</style>");
} else {
  throw new Error("Could not find </style> in app.html");
}

const notePatterns = [
  /(<div[^>]*>[\s\S]{0,1200}?We'll email the complete report[\s\S]{0,1200}?<\/div>)/i,
  /(<div[^>]*>[\s\S]{0,1200}?You don't need to wait here[\s\S]{0,1200}?<\/div>)/i,
  /(<button[^>]*>[\s\S]{0,300}?New Analysis[\s\S]{0,300}?<\/button>)/i
];

let insertedHtml = false;
for (const re of notePatterns) {
  if (re.test(html)) {
    html = html.replace(re, htmlBlock + "\n$1");
    insertedHtml = true;
    break;
  }
}
if (!insertedHtml) {
  throw new Error("Could not find running-page anchor for live panel HTML");
}

if (/function\s+resetJobSteps\s*\(\)\s*\{/.test(html)) {
  html = html.replace(
    /function\s+resetJobSteps\s*\(\)\s*\{/,
    match => match + "\n  const __livePanel = document.getElementById('livePanel');\n  if (__livePanel) __livePanel.classList.remove('show');\n"
  );
}

if (/async\s+function\s+pollJobStatus\s*\(\s*jobId\s*\)\s*\{/.test(html)) {
  html = html.replace(
    /const\s+data\s*=\s*await\s+response\.json\(\);\s*/m,
    match => match + "\n      if (data.live) renderLivePreview(data.live, jobId);\n"
  );
}

if (html.includes("</script>")) {
  html = html.replace("</script>", jsBlock + "\n</script>");
} else {
  throw new Error("Could not find </script> in app.html");
}

fs.writeFileSync(path, html, "utf8");
console.log("patched app.html with live panel only");
