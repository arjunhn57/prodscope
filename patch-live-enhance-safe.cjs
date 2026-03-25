const fs = require("fs");

const file = ".\\app.html";
let html = fs.readFileSync(file, "utf8");

if (html.includes("window.__psLiveEnhancePatch")) {
  console.log("Patch already present, skipping.");
  process.exit(0);
}

const inject = `
<style id="ps-live-enhance-style">
  /* larger live rail */
  #livePanel{
    width: 100% !important;
    max-width: 540px !important;
  }

  #livePanel .live-panel-body{
    grid-template-columns: 260px 1fr !important;
    gap: 16px !important;
    align-items: start !important;
  }

  #livePanelThumb{
    width: 260px !important;
    height: 520px !important;
    max-width: none !important;
    max-height: none !important;
    position: relative !important;
    overflow: hidden !important;
    border-radius: 14px !important;
  }

  #livePanelThumb img,
  #livePanelThumb video,
  #livePanelThumb canvas{
    width: 100% !important;
    height: 100% !important;
    object-fit: contain !important;
    display: block !important;
  }

  /* tap highlight */
  .ps-live-tap{
    position: absolute;
    width: 34px;
    height: 34px;
    border-radius: 999px;
    background: rgba(250, 204, 21, 0.30);
    border: 2px solid rgba(250, 204, 21, 0.95);
    box-shadow: 0 0 0 10px rgba(250, 204, 21, 0.18);
    transform: translate(-50%, -50%) scale(0.72);
    opacity: 0;
    pointer-events: none;
    z-index: 50;
  }

  .ps-live-tap.show{
    animation: psLiveTapPulse 850ms ease-out forwards;
  }

  @keyframes psLiveTapPulse{
    0%{opacity:0;transform:translate(-50%,-50%) scale(0.72);}
    15%{opacity:1;transform:translate(-50%,-50%) scale(1);}
    100%{opacity:0;transform:translate(-50%,-50%) scale(1.55);}
  }

  @media (max-width: 1200px){
    #livePanel .live-panel-body{
      grid-template-columns: 220px 1fr !important;
    }
    #livePanelThumb{
      width: 220px !important;
      height: 440px !important;
    }
  }
</style>

<script>
(function(){
  if (window.__psLiveEnhancePatch) return;
  window.__psLiveEnhancePatch = true;

  function getThumb(){
    return document.getElementById("livePanelThumb");
  }

  function getPreviewNode(){
    const thumb = getThumb();
    if (!thumb) return null;
    return thumb.querySelector("img,video,canvas");
  }

  function ensureTapOverlay(){
    const thumb = getThumb();
    if (!thumb) return null;
    let el = thumb.querySelector(".ps-live-tap");
    if (!el) {
      el = document.createElement("div");
      el.className = "ps-live-tap";
      thumb.appendChild(el);
    }
    return el;
  }

  function readTapPoint(){
    const actionText = (document.getElementById("livePanelAction") || {}).textContent || "";
    const msgText = (document.getElementById("livePanelMessage") || {}).textContent || "";
    const combined = actionText + " " + msgText;
    const m = combined.match(/tap\\((\\d+)\\s*,\\s*(\\d+)\\)/i);
    if (!m) return null;
    return { x: Number(m[1]), y: Number(m[2]) };
  }

  function getIntrinsicSize(node){
    if (!node) return { w: 1080, h: 2400 };

    if (node.tagName === "IMG") {
      return {
        w: node.naturalWidth || 1080,
        h: node.naturalHeight || 2400
      };
    }

    if (node.tagName === "VIDEO") {
      return {
        w: node.videoWidth || 1080,
        h: node.videoHeight || 2400
      };
    }

    if (node.tagName === "CANVAS") {
      return {
        w: node.width || 1080,
        h: node.height || 2400
      };
    }

    return { w: 1080, h: 2400 };
  }

  function placeTapOverlay(){
    const thumb = getThumb();
    const preview = getPreviewNode();
    const tap = readTapPoint();
    const overlay = ensureTapOverlay();

    if (!thumb || !preview || !tap || !overlay) return;

    const thumbRect = thumb.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    if (!previewRect.width || !previewRect.height) return;

    const size = getIntrinsicSize(preview);
    if (!size.w || !size.h) return;

    const left = (previewRect.left - thumbRect.left) + (tap.x / size.w) * previewRect.width;
    const top  = (previewRect.top  - thumbRect.top)  + (tap.y / size.h) * previewRect.height;

    const key = tap.x + "," + tap.y + "|" + Math.round(left) + "," + Math.round(top);
    if (overlay.dataset.lastKey === key) return;
    overlay.dataset.lastKey = key;

    overlay.style.left = left + "px";
    overlay.style.top = top + "px";
    overlay.classList.remove("show");
    void overlay.offsetWidth;
    overlay.classList.add("show");
  }

  function keepEnhanced(){
    const thumb = getThumb();
    if (thumb) {
      thumb.style.position = "relative";
    }
    placeTapOverlay();
  }

  document.addEventListener("DOMContentLoaded", keepEnhanced);
  setInterval(keepEnhanced, 500);
})();
</script>
`;

if (!html.includes("</body>")) {
  throw new Error("Could not find </body> in app.html");
}

html = html.replace("</body>", inject + "\n</body>");
fs.writeFileSync(file, html, "utf8");
console.log("Patched app.html with larger live preview + tap pulse overlay");
