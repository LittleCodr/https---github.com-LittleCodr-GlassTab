const defaults = {
  blur: 24,
  opacity: 0.7,
  saturation: 1.1,
  motion: true,
  wallpaperType: "none"
};

const state = {
  settings: { ...defaults },
  wallpaper: { type: "none", url: "" },
  currentUrl: null
};

const qs = (sel) => document.querySelector(sel);

const DB_NAME = "glasstab";
const DB_VERSION = 1;
const STORE = "wallpapers";

const debounce = (fn, delay = 120) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
};

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putWallpaper(file, type) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put({ id: "current", blob: file, type, updated: Date.now() });
    });
  } catch (err) {
    console.warn("Failed to persist wallpaper", err);
    setStatus("Could not save wallpaper (storage)");
  }
}

async function loadWallpaper() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      tx.onerror = () => reject(tx.error);
      const req = tx.objectStore(STORE).get("current");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Failed to load wallpaper", err);
    return null;
  }
}

async function clearWallpaperBlob() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete("current");
    });
  } catch (err) {
    console.warn("Failed to clear wallpaper", err);
  }
}

async function loadSettings() {
  if (globalThis.chrome?.storage?.sync) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(["settings"], (result) => {
        resolve({ ...defaults, ...(result.settings || {}) });
      });
    });
  }
  const raw = localStorage.getItem("glasstab:settings");
  return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
}

const persistSettings = debounce(async (settings) => {
  state.settings = { ...settings };
  if (globalThis.chrome?.storage?.sync) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ settings }, resolve);
    });
  }
  localStorage.setItem("glasstab:settings", JSON.stringify(settings));
}, 120);

function setStatus(message) {
  const el = qs("#status");
  if (el) el.textContent = message;
}

function applyVisuals() {
  const { blur, opacity, saturation } = state.settings;
  const overlay = qs(".wallpaper-overlay");
  const image = qs(".wallpaper-image");
  const video = qs(".wallpaper-video");
  if (overlay) {
    overlay.style.backdropFilter = `blur(${blur}px)`;
    overlay.style.opacity = String(opacity);
  }
  if (image) image.style.filter = `saturate(${saturation}) brightness(0.95)`;
  if (video) video.style.filter = `saturate(${saturation}) brightness(0.95)`;
  setStatus("Saved");
}

function hydrateControls() {
  const map = [
    ["#blur", "blur", "px"],
    ["#opacity", "opacity", ""],
    ["#saturation", "saturation", "x"],
    ["#motion", "motion", ""]
  ];
  map.forEach(([sel, key, suffix]) => {
    const el = qs(sel);
    if (!el) return;
    if (el.type === "checkbox") {
      el.checked = !!state.settings[key];
    } else {
      el.value = state.settings[key];
      const valueEl = qs(`${sel}-value`);
      if (valueEl) valueEl.textContent = `${state.settings[key]}${suffix}`;
    }
  });
}

function bindControls() {
  const pairs = [
    ["#blur", "blur"],
    ["#opacity", "opacity"],
    ["#saturation", "saturation"],
    ["#motion", "motion", "checkbox"]
  ];

  pairs.forEach(([sel, key, kind]) => {
    const el = qs(sel);
    if (!el) return;
    el.addEventListener("input", (evt) => {
      const next = { ...state.settings };
      if (kind === "checkbox") {
        next[key] = evt.target.checked;
      } else {
        next[key] = Number(evt.target.value);
        const valueEl = qs(`${sel}-value`);
        if (valueEl) valueEl.textContent = `${next[key]}${key === "blur" ? "px" : key === "saturation" ? "x" : ""}`;
      }
      setStatus("Saving...");
      persistSettings(next).then(applyVisuals);
    });
  });

  const fileInput = qs("#wallpaper-file");
  fileInput?.addEventListener("change", onWallpaperSelected);

  qs("#reset-btn")?.addEventListener("click", async () => {
    await persistSettings({ ...defaults });
    hydrateControls();
    applyVisuals();
    await clearWallpaper();
    setStatus("Reset to defaults");
  });
}

async function clearWallpaper() {
  const image = qs(".wallpaper-image");
  const video = qs(".wallpaper-video");
  if (image) {
    image.src = "";
    image.style.opacity = 0;
  }
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.style.opacity = 0;
  }
  if (state.currentUrl) {
    URL.revokeObjectURL(state.currentUrl);
    state.currentUrl = null;
  }
  state.wallpaper = { type: "none", url: "" };
  await clearWallpaperBlob();
  await persistSettings({ ...state.settings, wallpaperType: "none" });
}

function isVideo(file) {
  return file.type.startsWith("video/");
}

async function onWallpaperSelected(evt) {
  const file = evt.target.files?.[0];
  if (!file) return;
  const tooLarge = isVideo(file) ? file.size > 50 * 1024 * 1024 : file.size > 15 * 1024 * 1024;
  if (tooLarge) {
    setStatus("File too large");
    evt.target.value = "";
    return;
  }

  await setWallpaperFromFile(file);
}

async function setWallpaperFromFile(file) {
  const type = isVideo(file) ? "video" : "image";
  const url = URL.createObjectURL(file);
  applyWallpaperUrl(url, type);
  await putWallpaper(file, type);
  await persistSettings({ ...state.settings, wallpaperType: type });
  setStatus("Wallpaper set");
}

function applyWallpaperUrl(url, type) {
  const image = qs(".wallpaper-image");
  const video = qs(".wallpaper-video");
  if (state.currentUrl) URL.revokeObjectURL(state.currentUrl);
  state.currentUrl = url;

  if (type === "video") {
    if (video) {
      video.src = url;
      video.loop = true;
      video.muted = true;
      video.style.opacity = 1;
      if (state.settings.motion) video.play().catch(() => {});
    }
    if (image) image.style.opacity = 0;
  } else if (type === "image") {
    if (image) {
      image.src = url;
      image.style.opacity = 1;
    }
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.style.opacity = 0;
    }
  }
  state.wallpaper = { type, url };
}

function startClock() {
  const clock = qs("#clock");
  const date = qs("#date");
  const update = () => {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, "0");
    const minutes = now.getMinutes().toString().padStart(2, "0");
    if (clock) clock.textContent = `${hours}:${minutes}`;
    if (date) date.textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  };
  update();
  setInterval(update, 1000);
}

function handleVisibility() {
  document.addEventListener("visibilitychange", () => {
    const video = qs(".wallpaper-video");
    if (!video || state.wallpaper.type !== "video") return;
    if (document.visibilityState === "hidden") {
      video.pause();
    } else if (state.settings.motion) {
      video.play().catch(() => {});
    }
  });
}

function detectBackdropSupport() {
  const supported = CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)");
  if (!supported) {
    document.documentElement.classList.add("no-blur");
    setStatus("Running without live blur (fallback)");
  }
}

function bindSettingsDrawer() {
  const trigger = qs("#settings-btn");
  const drawer = qs("#settings-drawer");
  if (!trigger || !drawer) return;
  const toggle = () => {
    const open = drawer.classList.toggle("open");
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
  };
  trigger.addEventListener("click", toggle);
  document.addEventListener("click", (e) => {
    if (!drawer.classList.contains("open")) return;
    const isInside = drawer.contains(e.target) || trigger.contains(e.target);
    if (!isInside) {
      drawer.classList.remove("open");
      drawer.setAttribute("aria-hidden", "true");
    }
  });
}

async function hydrateWallpaperFromStorage() {
  const saved = await loadWallpaper();
  if (!saved || !saved.blob || !saved.type) return;
  const url = URL.createObjectURL(saved.blob);
  applyWallpaperUrl(url, saved.type);
  setStatus("Wallpaper restored");
}

(async function init() {
  state.settings = await loadSettings();
  hydrateControls();
  applyVisuals();
  bindControls();
  bindSettingsDrawer();
  await hydrateWallpaperFromStorage();
  startClock();
  handleVisibility();
  detectBackdropSupport();
  setStatus("Ready");
})();

// quick links
document.addEventListener("click", (e) => {
  const target = e.target.closest?.(".quick-pill");
  if (!target) return;
  const href = target.getAttribute("data-href");
  if (href) {
    window.location.href = href;
  }
});
