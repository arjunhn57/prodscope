const fs = require("fs");

const file = ".\\app.html";
let s = fs.readFileSync(file, "utf8");

function mustReplace(find, replace, label) {
  if (!s.includes(find)) throw new Error("Missing block: " + label);
  s = s.replace(find, replace);
}

/* 1) add CSS for overlay */
mustReplace(
`.live-panel-thumb{width:160px;height:300px;border:1px solid #e5e7eb;border-radius:12px;background:#f9fafb;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#6b7280;font-size:12px;text-align:center;padding:10px}
.live-panel-thumb img{max-width:100%;max-height:100%;display:block}`,
`.live-panel-thumb{width:160px;height:300px;border:1px solid #e5e7eb;border-radius:12px;background:#f9fafb;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#6b7280;font-size:12px;text-align:center;padding:10px;position:relative}
.live-panel-thumb img{max-width:100%;max-height:100%;display:block}
.live-panel-tap{
  position:absolute;
  width:34px;
  height:34px;
  border-radius:999px;
  background:rgba(250,204,21,0.30);
  border:2px solid rgba(250,204,21,0.95);
  box-shadow:0 0 0 10px rgba(250,204,21,0.18);
  transform:translate(-50%,-50%) scale(0.72);
  opacity:0;
  pointer-events:none;
  z-index:20;
}
.live-panel-tap.show{
  animation:liveTapPulse 850ms ease-out forwards;
}
@keyframes liveTapPulse{
  0%{opacity:0;transform:translate(-50%,-50%) scale(0.72);}
  15%{opacity:1;transform:translate(-50%,-50%) scale(1);}
  100%{opacity:0;transform:translate(-50%,-50%) scale(1.55);}
}`,
'live-panel tap overlay css'
);

/* 2) insert helper functions before renderLivePreview */
mustReplace(
`function renderLivePreview(live, jobId) {`,
`function extractTapPointFromLive(live){
  const candidates = [
    live && live.latestAction && live.latestAction.description,
    live && live.latestAction && live.latestAction.reason,
    live && live.latestAction && live.latestAction.raw,
    live && live.message
  ];

  for(const value of candidates){
    const text = String(value || '');
    const m = text.match(/tap\\((\\d+)\\s*,\\s*(\\d+)\\)/i);
    if(m) return { x: Number(m[1]), y: Number(m[2]) };
  }
  return null;
}

function ensureLiveTapOverlay(container){
  let overlay = container.querySelector('.live-panel-tap');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.className = 'live-panel-tap';
    container.appendChild(overlay);
  }
  return overlay;
}

function placeTapOverlay(container, img, point){
  if(!container || !img || !point) return;
  if(!img.complete) return;

  const sourceW = img.naturalWidth || 1080;
  const sourceH = img.naturalHeight || 2400;
  if(!sourceW || !sourceH) return;

  const imgRect = img.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  const offsetLeft = imgRect.left - containerRect.left;
  const offsetTop = imgRect.top - containerRect.top;

  const x = offsetLeft + (point.x / sourceW) * imgRect.width;
  const y = offsetTop + (point.y / sourceH) * imgRect.height;

  const overlay = ensureLiveTapOverlay(container);
  const key = point.x + ',' + point.y;

  if(overlay.dataset.lastKey === key) return;
  overlay.dataset.lastKey = key;

  overlay.style.left = x + 'px';
  overlay.style.top = y + 'px';
  overlay.classList.remove('show');
  void overlay.offsetWidth;
  overlay.classList.add('show');
}

function renderLivePreview(live, jobId) {`,
'insert tap overlay helpers'
);

/* 3) after image is rendered, place overlay if action is a tap */
mustReplace(
`      img.src = base + '/api/job-screenshot/' + encodeURIComponent(jobId) + '/' + encodeURIComponent(filename) + '?t=' + Date.now();
    } else {
      thumbEl.textContent = live.captureMode === 'xml_only' ? 'XML-only mode' : 'Preview unavailable';
    }
  }
}`,
`      img.src = base + '/api/job-screenshot/' + encodeURIComponent(jobId) + '/' + encodeURIComponent(filename) + '?t=' + Date.now();

      const tapPoint = extractTapPointFromLive(live);
      if(tapPoint){
        const applyOverlay = () => placeTapOverlay(thumbEl, img, tapPoint);
        if(img.complete) {
          applyOverlay();
        } else {
          img.onload = function(){
            applyOverlay();
          };
        }
      }
    } else {
      thumbEl.textContent = live.captureMode === 'xml_only' ? 'XML-only mode' : 'Preview unavailable';
    }
  }
}`,
'apply tap overlay in renderLivePreview'
);

fs.writeFileSync(file, s, "utf8");
console.log("Patched app.html with tap overlay");
