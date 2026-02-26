// ============================================================
// GlassTab — Minimalist newtab.js
// ============================================================

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ── Default state ──
const defaultState = {
  search: { engine: "https://www.google.com/search?q=" },
  weather: { temp: "", cond: "", loc: "", unit: "C", show: false },
  shortcuts: [
    { title: "Gmail",    url: "https://mail.google.com" },
    { title: "YouTube",  url: "https://www.youtube.com" },
    { title: "GitHub",   url: "https://github.com" },
    { title: "ChatGPT",  url: "https://chat.openai.com" },
    { title: "Drive",    url: "https://drive.google.com" },
    { title: "WhatsApp", url: "https://web.whatsapp.com" },
    { title: "LinkedIn", url: "https://www.linkedin.com" },
    { title: "Reddit",   url: "https://www.reddit.com" },
  ],
  clocks: [
    { city: "New York", tz: "America/New_York" },
    { city: "London",   tz: "Europe/London" },
    { city: "Tokyo",    tz: "Asia/Tokyo" },
  ],
  tasks: [],
  appearance: {
    blur: 24,
    brightness: 1,
    vignette: 0.32,
    accent: "#ffffff",
    videoSpeed: 1,
  },
  wallpaper: {
    type: "video",
    source: { kind: "built-in", path: "hp.mp4" },
  },
};

const STORAGE_KEY = "glasstab:min:v1";
const DB_NAME     = "glasstab";
const DB_STORE    = "wallpapers";
const DB_VERSION  = 1;

const state = JSON.parse(JSON.stringify(defaultState));
let db       = null;
let objUrl   = null;

// ── Debounce ──
const debounce = (fn, ms = 200) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

// ── Deep merge ──
const merge = (target, src) => {
  for (const [k, v] of Object.entries(src || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      target[k] = (target[k] && typeof target[k] === "object") ? target[k] : {};
      merge(target[k], v);
    } else {
      target[k] = Array.isArray(v) ? [...v] : v;
    }
  }
};

// ── Persist ──
const persist = debounce(async () => {
  try { await chrome.storage.local.set({ [STORAGE_KEY]: state }); }
  catch {}
});

const loadState = async () => {
  try {
    const saved = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    if (saved) merge(state, saved);
  } catch {}
};

// ── IndexedDB (wallpaper blobs) ──
const openDB = () => new Promise((res, rej) => {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains(DB_STORE))
      req.result.createObjectStore(DB_STORE, { keyPath: "id" });
  };
  req.onsuccess = () => res(req.result);
  req.onerror   = () => rej(req.error);
});

const ensureDB = async () => { db = db ?? await openDB(); return db; };

const saveBlob = async (file, type) => {
  const d = await ensureDB();
  return new Promise((res, rej) => {
    const tx = d.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put({ id: "current", blob: file, type, ts: Date.now() });
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
};

const readBlob = async () => {
  try {
    const d = await ensureDB();
    return await new Promise((res, rej) => {
      const req = d.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get("current");
      req.onsuccess = () => res(req.result ?? null);
      req.onerror   = () => rej(req.error);
    });
  } catch { return null; }
};

const clearBlob = async () => {
  try {
    const d = await ensureDB();
    await new Promise((res, rej) => {
      const tx = d.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete("current");
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch {}
};

// ── Wallpaper ──
const applyWallpaper = (url, type) => {
  const vid = $(".wp-video");
  const img = $(".wp-img");
  if (!vid || !img) return;
  if (type === "video") {
    img.style.opacity = "0";
    vid.src = url;
    vid.loop = true; vid.muted = true;
    vid.playbackRate = state.appearance.videoSpeed ?? 1;
    vid.oncanplay = () => {
      vid.style.opacity = "1";
      vid.play().catch(() => {});
    };
    vid.load();
  } else if (type === "image") {
    vid.pause(); vid.removeAttribute("src"); vid.load(); vid.style.opacity = "0";
    img.src = url;
    img.onload = () => { img.style.opacity = "1"; };
  } else {
    vid.pause(); vid.removeAttribute("src"); vid.load(); vid.style.opacity = "0";
    img.src = ""; img.style.opacity = "0";
  }
};

const loadWallpaper = async () => {
  const saved = await readBlob();
  if (saved?.blob && saved.type) {
    if (objUrl) URL.revokeObjectURL(objUrl);
    objUrl = URL.createObjectURL(saved.blob);
    applyWallpaper(objUrl, saved.type);
    return;
  }
  const wp = state.wallpaper;
  if (wp.source?.kind === "built-in" && wp.source.path) {
    try { applyWallpaper(chrome.runtime.getURL(wp.source.path), wp.type); }
    catch { applyWallpaper(wp.source.path, wp.type); }
  }
};

// ── Appearance CSS vars ──
const applyAppearance = () => {
  const a = state.appearance;
  const r = document.documentElement.style;
  r.setProperty("--blur",       `${a.blur}px`);
  r.setProperty("--brightness", a.brightness);
  r.setProperty("--vignette",   a.vignette);
  r.setProperty("--accent",     a.accent);
  if ($(".wp-video")) $(".wp-video").playbackRate = a.videoSpeed ?? 1;
};

// ── Clock ──
const renderClock = () => {
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2, "0");
  const mm  = String(now.getMinutes()).padStart(2, "0");
  const clockEl = $("#clock");
  const dateEl  = $("#date");
  if (clockEl) clockEl.textContent = `${hh}:${mm}`;
  if (dateEl)  dateEl.textContent  = now.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
};

// ── Weather ──
const renderWeather = () => {
  const w   = state.weather;
  const el  = $("#weather-line");
  if (!el) return;
  if (w.show && (w.temp || w.cond || w.loc)) {
    el.removeAttribute("hidden");
    const tp = $("#w-temp");   if (tp) tp.textContent = w.temp ? `${w.temp}°${w.unit || "C"}` : "";
    const cd = $("#w-cond");   if (cd) cd.textContent = w.cond || "";
    const lc = $("#w-loc");    if (lc) lc.textContent = w.loc  || "";
  } else {
    el.setAttribute("hidden", "");
  }
};

// ── Favicon ──
const favicon = (url) => {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`; }
  catch { return ""; }
};

const LINK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;

// ── Shortcuts ──
const renderShortcuts = () => {
  const row = $("#shortcut-row");
  if (!row) return;
  row.innerHTML = "";
  state.shortcuts.slice(0, 8).forEach((s, i) => {
    const a = document.createElement("a");
    a.className = "sc"; a.href = s.url; a.rel = "noreferrer"; a.dataset.i = i;

    const icon = document.createElement("div"); icon.className = "sc-icon";
    const img  = document.createElement("img"); img.alt = "";
    img.src    = favicon(s.url);
    img.onerror = () => { icon.innerHTML = LINK_SVG; };
    icon.append(img);

    const del = document.createElement("button");
    del.className = "sc-del"; del.dataset.act = "del"; del.dataset.i = i;
    del.setAttribute("aria-label", "Remove"); del.textContent = "✕";
    del.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      state.shortcuts.splice(i, 1);
      renderShortcuts(); renderShortcutEditor(); persist();
    });

    const label = document.createElement("span"); label.className = "sc-label";
    label.textContent = s.title || s.url;

    a.append(icon, del, label);
    row.append(a);
  });
};

// ── Shortcut editor in drawer ──
const renderShortcutEditor = () => {
  const list = $("#shortcut-edit-list"); if (!list) return;
  list.innerHTML = "";
  state.shortcuts.forEach((s, i) => {
    const row   = document.createElement("div"); row.className = "sc-edit-row";
    const inp1  = document.createElement("input"); inp1.placeholder = "Label"; inp1.value = s.title;
    const inp2  = document.createElement("input"); inp2.placeholder = "URL";   inp2.value = s.url;
    const del   = document.createElement("button"); del.className = "edit-del"; del.textContent = "✕";
    inp1.addEventListener("input", () => { state.shortcuts[i].title = inp1.value; renderShortcuts(); persist(); });
    inp2.addEventListener("input", () => { state.shortcuts[i].url   = inp2.value; renderShortcuts(); persist(); });
    del.addEventListener("click",  () => { state.shortcuts.splice(i, 1); renderShortcuts(); renderShortcutEditor(); persist(); });
    row.append(inp1, inp2, del);
    list.append(row);
  });
};

// ── Clock editor ──
const renderClockEditor = () => {
  const list = $("#clock-edit-list"); if (!list) return;
  list.innerHTML = "";
  state.clocks.forEach((c, i) => {
    const row  = document.createElement("div"); row.className = "clk-edit-row";
    const inp1 = document.createElement("input"); inp1.placeholder = "City";     inp1.value = c.city;
    const inp2 = document.createElement("input"); inp2.placeholder = "Timezone"; inp2.value = c.tz;
    const del  = document.createElement("button"); del.className = "edit-del"; del.textContent = "✕";
    inp1.addEventListener("input", () => { state.clocks[i].city = inp1.value; persist(); });
    inp2.addEventListener("input", () => { state.clocks[i].tz   = inp2.value; persist(); });
    del.addEventListener("click",  () => { state.clocks.splice(i, 1); renderClockEditor(); persist(); });
    row.append(inp1, inp2, del);
    list.append(row);
  });
};

// ── Task editor ──
const renderTaskEditor = () => {
  const list = $("#task-list"); if (!list) return;
  list.innerHTML = "";
  state.tasks.forEach((t, i) => {
    const row  = document.createElement("div"); row.className = "task-edit-row";
    const cb   = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!t.done;
    const inp  = document.createElement("input"); inp.value = t.text; inp.placeholder = "Task";
    const del  = document.createElement("button"); del.className = "edit-del"; del.textContent = "✕";
    cb.addEventListener("change",  () => { state.tasks[i].done = cb.checked; persist(); });
    inp.addEventListener("input",  () => { state.tasks[i].text = inp.value;  persist(); });
    del.addEventListener("click",  () => { state.tasks.splice(i, 1); renderTaskEditor(); persist(); });
    row.append(cb, inp, del);
    list.append(row);
  });
};

// ── Populate appearance sliders ──
const populateAppearance = () => {
  const a = state.appearance;
  const syncRange = (id, val, unit = "") => {
    const el = $(`#${id}`); if (!el) return;
    el.value = val;
    const sp = $(`#${id}-val`); if (sp) sp.textContent = `${val}${unit}`;
  };
  syncRange("blur",         a.blur,       "px");
  syncRange("brightness",   a.brightness, "x");
  syncRange("vignette",     a.vignette,   "");
  syncRange("video-speed",  a.videoSpeed, "x");
  const ac = $("#accent-color"); if (ac) ac.value = a.accent || "#ffffff";
  const en = $("#engine-select"); if (en) en.value = state.search.engine;
  // weather
  const wCity = $("#w-city"); if (wCity) wCity.value = state.weather.loc  || "";
  const wTemp = $("#w-temp-in"); if (wTemp) wTemp.value = state.weather.temp || "";
  const wCond = $("#w-cond-in"); if (wCond) wCond.value = state.weather.cond || "";
  const wUnit = $("#w-unit"); if (wUnit) wUnit.value   = state.weather.unit || "C";
};

// ── Drawer open/close ──
const openDrawer = () => {
  const d = $("#drawer"); if (!d) return;
  d.setAttribute("aria-hidden", "false");
  populateAppearance();
  renderShortcutEditor();
  renderClockEditor();
  renderTaskEditor();
};
const closeDrawer = () => {
  const d = $("#drawer"); if (!d) return;
  d.setAttribute("aria-hidden", "true");
};

// ── Bind all ──
const bindAll = () => {
  // Clock
  renderClock();
  setInterval(renderClock, 1000);

  // Search
  $("#search-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#search-input")?.value.trim();
    if (!q) return;
    window.location.href = `${state.search.engine}${encodeURIComponent(q)}`;
  });

  // Settings drawer
  $("#settings-btn")?.addEventListener("click", openDrawer);
  $("#close-drawer")?.addEventListener("click", closeDrawer);
  $("#drawer-backdrop")?.addEventListener("click", closeDrawer);

  // Search engine select
  $("#engine-select")?.addEventListener("change", (e) => {
    state.search.engine = e.target.value; persist();
  });

  // Save weather
  $("#save-weather")?.addEventListener("click", () => {
    const c = $("#w-city")?.value.trim()    || "";
    const t = $("#w-temp-in")?.value.trim() || "";
    const d = $("#w-cond-in")?.value.trim() || "";
    const u = $("#w-unit")?.value           || "C";
    state.weather = { loc: c, temp: t, cond: d, unit: u, show: !!(c || t || d) };
    renderWeather(); persist();
  });

  // Weather line click → open drawer
  $("#weather-line")?.addEventListener("click", openDrawer);

  // Add shortcut
  $("#add-shortcut")?.addEventListener("click", () => {
    state.shortcuts.push({ title: "", url: "" });
    renderShortcuts(); renderShortcutEditor(); persist();
  });

  // Add clock
  $("#add-clock")?.addEventListener("click", () => {
    state.clocks.push({ city: "", tz: "" });
    renderClockEditor(); persist();
  });

  // Add task
  $("#add-task")?.addEventListener("click", () => {
    state.tasks.push({ text: "", done: false });
    renderTaskEditor(); persist();
  });

  // Appearance sliders
  [
    ["#blur",        "appearance.blur",       "px", true ],
    ["#brightness",  "appearance.brightness", "x",  true ],
    ["#vignette",    "appearance.vignette",   "",   true ],
    ["#video-speed", "appearance.videoSpeed", "x",  false],
  ].forEach(([sel, path, unit, css]) => {
    const el = $(sel); if (!el) return;
    el.addEventListener("input", (e) => {
      const val = Number(e.target.value);
      const keys = path.split(".");
      let cur = state;
      while (keys.length > 1) cur = cur[keys.shift()];
      cur[keys[0]] = val;
      const sp = $(`${sel}-val`); if (sp) sp.textContent = `${val}${unit}`;
      if (css) applyAppearance();
      if (sel === "#video-speed") {
        const v = $(".wp-video"); if (v) v.playbackRate = val;
      }
      persist();
    });
  });

  // Accent color
  $("#accent-color")?.addEventListener("input", (e) => {
    state.appearance.accent = e.target.value;
    applyAppearance(); persist();
  });

  // Wallpaper upload
  $("#wallpaper-file")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const isVid = file.type.startsWith("video/");
    if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
    objUrl = URL.createObjectURL(file);
    const type = isVid ? "video" : "image";
    state.wallpaper = { type, source: { kind: "upload" } };
    applyWallpaper(objUrl, type);
    await saveBlob(file, type);
    persist();
  });

  // Reset
  $("#reset-btn")?.addEventListener("click", async () => {
    merge(state, JSON.parse(JSON.stringify(defaultState)));
    await clearBlob();
    if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
    applyAppearance();
    applyWallpaper("", "none");
    await loadWallpaper();
    renderShortcuts();
    renderWeather();
    populateAppearance();
    renderShortcutEditor();
    renderClockEditor();
    renderTaskEditor();
    persist();
  });

  // Escape key closes drawer
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });
};

// ── Init ──
const init = async () => {
  await loadState();
  applyAppearance();
  renderWeather();
  renderShortcuts();
  bindAll();
  await loadWallpaper();
};

init();
