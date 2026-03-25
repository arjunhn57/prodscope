const fs = require("fs");

const path = ".\\app.html";
let html = fs.readFileSync(path, "utf8");

if (html.includes("window.__prodscopeLiveRailPatched = true;")) {
  console.log("app.html already patched");
  process.exit(0);
}

const inject = `
<style id="prodscope-live-rail-enhancements">
  .ps-live-layout {
    display: grid;
    grid-template-columns: minmax(0, 720px) minmax(320px, 420px);
    gap: 24px;
    align-items: start;
  }

  .ps-live-main {
    min-width: 0;
  }

  .ps-live-rail {
    min-width: 0;
    position: sticky;
    top: 24px;
  }

  .ps-live-rail .live-panel {
    display: block !important;
    margin: 0 !important;
  }

  .ps-device-card {
    margin-top: 20px;
    border: 1px solid #e5e7eb;
    border-radius: 16px;
    background: #fff;
    padding: 18px;
  }

  .ps-device-title {
    font-size: 14px;
    font-weight: 600;
    color: #111827;
    margin-bottom: 6px;
  }

  .ps-device-subtitle {
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 12px;
  }

  .ps-device-select {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #d1d5db;
    border-radius: 10px;
    background: #fff;
    font-size: 14px;
    color: #111827;
  }

  .ps-live-placeholder {
    border: 1px solid #e5e7eb;
    border-radius: 16px;
    background: #fff;
    padding: 16px;
    color: #6b7280;
    font-size: 13px;
  }

  @media (max-width: 1180px) {
    .ps-live-layout {
      grid-template-columns: 1fr;
    }

    .ps-live-rail {
      position: static;
    }
  }
</style>

<script>
window.__prodscopeLiveRailPatched = true;
window.__selectedDeviceProfile = window.__selectedDeviceProfile || "pixel_7_android_14";
window.__deviceProfilesCache = window.__deviceProfilesCache || [
  { id: "pixel_7_android_14", label: "Pixel 7 · Android 14", androidVersionLabel: "Android 14", formFactor: "phone" },
  { id: "pixel_5_android_13", label: "Pixel 5 · Android 13", androidVersionLabel: "Android 13", formFactor: "phone" },
  { id: "pixel_tablet_android_14", label: "Pixel Tablet · Android 14", androidVersionLabel: "Android 14", formFactor: "tablet" },
  { id: "small_phone_android_12", label: "Small Phone · Android 12", androidVersionLabel: "Android 12", formFactor: "phone" }
];

async function psLoadDeviceProfiles() {
  try {
    const res = await fetch("/api/device-profiles", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load device profiles");
    const data = await res.json();
    if (data && Array.isArray(data.profiles) && data.profiles.length) {
      window.__deviceProfilesCache = data.profiles;
    }
  } catch (e) {
    console.warn("Using fallback device profiles", e);
  }
}

function psRenderDeviceOptions(select) {
  const profiles = window.__deviceProfilesCache || [];
  select.innerHTML = "";
  profiles.forEach(function (profile) {
    const opt = document.createElement("option");
    opt.value = profile.id;
    opt.textContent = profile.label || profile.id;
    select.appendChild(opt);
  });
  select.value = window.__selectedDeviceProfile || "pixel_7_android_14";
}

function psEnsureDeviceSelector() {
  const page =
    document.getElementById("page-new") ||
    document.querySelector("#page-new") ||
    document.querySelector('[data-page="new"]');

  if (!page) return;
  if (document.getElementById("psDeviceCard")) return;

  const card = document.createElement("div");
  card.id = "psDeviceCard";
  card.className = "ps-device-card";
  card.innerHTML =
    '<div class="ps-device-title">Device</div>' +
    '<div class="ps-device-subtitle">Choose which emulator profile to test on.</div>' +
    '<select id="psDeviceSelect" class="ps-device-select"></select>';

  const anchor =
    page.querySelector(".upload-section") ||
    page.querySelector(".card") ||
    page.firstElementChild ||
    page;

  if (anchor && anchor.parentNode) {
    anchor.parentNode.insertBefore(card, anchor.nextSibling);
  } else {
    page.appendChild(card);
  }

  const select = document.getElementById("psDeviceSelect");
  psRenderDeviceOptions(select);

  select.addEventListener("change", function () {
    window.__selectedDeviceProfile = select.value || "pixel_7_android_14";
    try {
      localStorage.setItem("prodscope.deviceProfile", window.__selectedDeviceProfile);
    } catch (e) {}
  });

  try {
    const saved = localStorage.getItem("prodscope.deviceProfile");
    if (saved) {
      window.__selectedDeviceProfile = saved;
      select.value = saved;
    }
  } catch (e) {}
}

function psEnsureJobLayout() {
  const page =
    document.getElementById("page-job") ||
    document.querySelector("#page-job") ||
    document.querySelector('[data-page="job"]');

  if (!page) return;

  let layout = document.getElementById("psLiveLayout");
  if (!layout) {
    layout = document.createElement("div");
    layout.id = "psLiveLayout";
    layout.className = "ps-live-layout";

    const main = document.createElement("div");
    main.id = "psLiveMain";
    main.className = "ps-live-main";

    const rail = document.createElement("div");
    rail.id = "psLiveRail";
    rail.className = "ps-live-rail";
    rail.innerHTML = '<div class="ps-live-placeholder">Waiting for live updates…</div>';

    while (page.firstChild) {
      main.appendChild(page.firstChild);
    }

    layout.appendChild(main);
    layout.appendChild(rail);
    page.appendChild(layout);
  }

  const rail = document.getElementById("psLiveRail");
  const panel = document.getElementById("livePanel");
  if (rail && panel) {
    if (!rail.contains(panel)) {
      rail.innerHTML = "";
      rail.appendChild(panel);
    }
    panel.classList.add("show");
    panel.style.display = "block";
  }
}

function psForceLivePanelVisible() {
  const panel = document.getElementById("livePanel");
  const rail = document.getElementById("psLiveRail");
  if (!rail) return;

  if (panel) {
    if (!rail.contains(panel)) {
      rail.innerHTML = "";
      rail.appendChild(panel);
    }
    panel.classList.add("show");
    panel.style.display = "block";
  }
}

function psPatchFetchForDeviceProfile() {
  if (window.__prodscopeFetchPatched) return;
  if (typeof window.fetch !== "function") return;

  const originalFetch = window.fetch.bind(window);

  window.fetch = function(input, init) {
    try {
      const url =
        typeof input === "string"
          ? input
          : (input && input.url) ? input.url : "";

      if (url && url.indexOf("/api/start-job") !== -1 && init && init.body && typeof init.body.append === "function") {
        if (!init.body.has("deviceProfile")) {
          init.body.append("deviceProfile", window.__selectedDeviceProfile || "pixel_7_android_14");
        }
      }
    } catch (e) {
      console.warn("deviceProfile fetch patch warning", e);
    }

    return originalFetch(input, init);
  };

  window.__prodscopeFetchPatched = true;
}

async function psInitLiveRailEnhancements() {
  await psLoadDeviceProfiles();
  psEnsureDeviceSelector();
  psEnsureJobLayout();
  psForceLivePanelVisible();
  psPatchFetchForDeviceProfile();
}

document.addEventListener("DOMContentLoaded", psInitLiveRailEnhancements);
setInterval(function () {
  try {
    psEnsureDeviceSelector();
    psEnsureJobLayout();
    psForceLivePanelVisible();
    psPatchFetchForDeviceProfile();
  } catch (e) {}
}, 1500);
</script>
`;

if (!html.includes("</body>")) {
  throw new Error("Could not find </body> in app.html");
}

html = html.replace("</body>", inject + "\\n</body>");
fs.writeFileSync(path, html, "utf8");
console.log("Patched app.html with permanent live rail enhancements");
