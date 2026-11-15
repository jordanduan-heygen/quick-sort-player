const state = {
  currentPath: "",
  parentPath: null,
  items: [],
  visibleItems: [],
  selected: new Set(),
  primary: null,
  locations: [],
  config: { destinations: {}, labels: {} },
  filter: "all",
  query: "",
  zoomMode: "fit",
  zoomScale: 1,
  pan: { x: 0, y: 0 },
  dragging: false,
  dragOrigin: null,
  goChord: false,
  toastTimer: null,
  renderLimit: 180,
  recentFolders: JSON.parse(localStorage.getItem("quick-sort-recent-folders") || "[]"),
  dragMoved: false,
  selectionAnchor: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const imagePreview = $("#image-preview");
const videoPreview = $("#video-preview");
const stage = $("#stage");

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function endpoint(path, params = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return `${url.pathname}${url.search}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try { message = (await response.json()).detail || message; } catch (_) { /* no JSON body */ }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function formatBytes(bytes) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** power;
  return `${value >= 10 || power === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[power]}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function shortLabel(name) {
  const matches = name.match(/[A-Za-z0-9]/g) || ["•"];
  return matches.slice(0, 2).join("").toUpperCase();
}

async function loadInitialData() {
  const data = await api("/api/locations");
  state.locations = data.locations;
  state.config = data.config;
  renderLocations();
  renderDestinations();
  renderSettings();
  const downloads = state.locations.find((location) => location.name === "Downloads");
  const linkedPath = new URLSearchParams(window.location.search).get("path");
  const rememberedPath = localStorage.getItem("quick-sort-last-path");
  await loadFolder(linkedPath || rememberedPath || downloads?.path || state.locations[0]?.path);
}

function renderLocations() {
  $("#locations").innerHTML = state.locations.map((location) => `
    <button class="nav-item ${location.path === state.currentPath ? "active" : ""}"
      data-path="${escapeHtml(location.path)}" data-short="${escapeHtml(shortLabel(location.name))}">
      <span>${escapeHtml(location.name)}</span><kbd>G ${escapeHtml(location.hotkey)}</kbd>
    </button>
  `).join("");
  $$("#locations .nav-item").forEach((button) => button.addEventListener("click", () => loadFolder(button.dataset.path)));
}

function renderDestinations() {
  const defaults = { apps: "Apps", videos: "Media", images: "Images", files: "Files" };
  const labels = { ...defaults, ...(state.config.labels || {}) };
  $("#destinations").innerHTML = Object.entries(labels).map(([category, label], index) => `
    <button class="destination-item" data-move="${category}" data-short="${index + 1}">
      <span>${escapeHtml(label)}</span><kbd>${index + 1}</kbd><span class="quick-edit" data-edit-destination="${category}" title="Choose folder">•••</span>
    </button>
  `).join("");
  $$("[data-move]").forEach((button) => {
    const category = button.dataset.move;
    const label = labels[category];
    const labelNode = button.querySelector('[data-role="destination-label"]');
    if (labelNode) labelNode.textContent = label;
    button.title = state.config.destinations?.[category] ? `${label} → ${state.config.destinations[category]}` : `Set ${label} folder`;
  });
  $$("#destinations [data-move]").forEach(bindMoveButton);
}

function renderSettings() {
  const defaults = { apps: "Apps", videos: "Media", images: "Images", files: "Files" };
  $("#settings-fields").innerHTML = Object.entries(defaults).map(([category, fallback], index) => `
    <div class="settings-field" data-settings-category="${category}">
      <label for="label-${category}">${index + 1}</label>
      <input id="label-${category}" data-destination-label="${category}" aria-label="Shortcut ${index + 1} name" value="${escapeHtml(state.config.labels?.[category] || fallback)}">
      <input id="destination-${category}" data-destination="${category}" value="${escapeHtml(state.config.destinations?.[category] || "")}">
      <button type="button" data-browse-destination="${category}">Choose…</button>
    </div>
  `).join("");
  $$('[data-browse-destination]').forEach((button) => button.addEventListener("click", () => chooseDestination(button.dataset.browseDestination, false)));
}

function bindMoveButton(button) {
  if (button.dataset.moveBound) return;
  button.dataset.moveBound = "true";
  button.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-destination]");
    if (edit) {
      event.stopPropagation();
      chooseDestination(edit.dataset.editDestination, true);
      return;
    }
    moveSelected(button.dataset.move);
  });
}

async function chooseDestination(category, saveImmediately) {
  try {
    const result = await api("/api/pick-folder", { method: "POST", body: "{}" });
    if (!result.path) return;
    if (!saveImmediately) {
      $(`[data-destination="${category}"]`).value = result.path;
      return;
    }
    const destinations = { ...state.config.destinations, [category]: result.path };
    state.config = await api("/api/config", {
      method: "PUT",
      body: JSON.stringify({ destinations, labels: state.config.labels }),
    });
    renderDestinations();
    renderSettings();
    showToast(`Shortcut ${category} now sends to ${result.path}`);
  } catch (error) { showToast(error.message); }
}

async function loadFolder(path) {
  if (!path) return;
  try {
    $("#folder-name").textContent = "Loading…";
    $("#file-count").textContent = "Reading this folder";
    $("#file-list").innerHTML = '<div class="empty-list">Indexing files and preparing thumbnails…</div>';
    const data = await api(endpoint("/api/list", { path }));
    state.currentPath = data.path;
    localStorage.setItem("quick-sort-last-path", data.path);
    state.recentFolders = [data.path, ...state.recentFolders.filter((value) => value !== data.path)].slice(0, 8);
    localStorage.setItem("quick-sort-recent-folders", JSON.stringify(state.recentFolders));
    state.parentPath = data.parent;
    state.items = data.items;
    state.selected.clear();
    state.primary = null;
    state.renderLimit = 180;
    renderLocations();
    renderBreadcrumbs();
    renderFiles();
    showPreview(null);
  } catch (error) {
    showToast(error.message);
  }
}

function pathParts(path) {
  const separator = path.includes("\\") ? "\\" : "/";
  const rawParts = path.split(/[\\/]/).filter(Boolean);
  if (separator === "\\") {
    return rawParts.map((name, index) => ({
      name,
      path: index === 0 && /^[A-Za-z]:$/.test(name) ? `${name}\\` : rawParts.slice(0, index + 1).join("\\"),
    }));
  }
  return rawParts.map((name, index) => ({ name, path: `/${rawParts.slice(0, index + 1).join("/")}` }));
}

function renderBreadcrumbs() {
  const parts = pathParts(state.currentPath);
  $("#breadcrumbs").innerHTML = parts.map((part, index) => `
    ${index ? '<span class="breadcrumb-separator">/</span>' : ""}
    <button class="breadcrumb" data-path="${escapeHtml(part.path)}">${escapeHtml(part.name)}</button>
  `).join("");
  $$("#breadcrumbs .breadcrumb").forEach((button) => button.addEventListener("click", () => loadFolder(button.dataset.path)));
  $("#folder-name").textContent = parts.at(-1)?.name || state.currentPath;
  $("#parent-folder").disabled = !state.parentPath;
}

function itemMatches(item) {
  const queryMatch = !state.query || item.name.toLowerCase().includes(state.query.toLowerCase());
  const categoryMatch = state.filter === "all" || item.is_dir || item.category === state.filter;
  return queryMatch && categoryMatch;
}

function renderFiles({ preserveScroll = false } = {}) {
  state.visibleItems = state.items.filter(itemMatches);
  const list = $("#file-list");
  const previousScroll = preserveScroll ? list.scrollTop : 0;
  const countLabel = `${state.visibleItems.length} ${state.visibleItems.length === 1 ? "item" : "items"}`;
  $("#file-count").textContent = state.query || state.filter !== "all" ? `${countLabel} in this view` : countLabel;
  if (!state.visibleItems.length) {
    list.innerHTML = `<div class="empty-list">Nothing matches this view.<br>Clear the filter or open another folder.</div>`;
    return;
  }
  const renderedItems = state.visibleItems.slice(0, state.renderLimit);
  list.innerHTML = renderedItems.map((item) => {
    let thumbnail;
    if (item.is_dir) {
      thumbnail = '<span class="thumbnail folder-thumb"><i class="folder-shape"></i></span>';
    } else if (item.thumbnail) {
      thumbnail = `<span class="thumbnail"><img loading="lazy" src="${endpoint("/api/thumbnail", { path: item.path })}" alt=""></span>`;
    } else {
      thumbnail = `<span class="thumbnail">${escapeHtml((item.extension || "file").replace(".", "").slice(0, 5).toUpperCase())}</span>`;
    }
    return `
      <button class="file-row ${state.selected.has(item.path) ? "selected" : ""}" role="option"
        aria-selected="${state.selected.has(item.path)}" data-path="${escapeHtml(item.path)}">
        ${thumbnail}
        <span class="file-copy"><span class="file-name">${escapeHtml(item.name)}</span><span class="file-kind">${escapeHtml(item.kind)}</span></span>
        <span class="file-size">${formatBytes(item.size)}</span>
      </button>`;
  }).join("") + (renderedItems.length < state.visibleItems.length ? `
    <div class="load-more" role="status">Showing ${renderedItems.length.toLocaleString()} of ${state.visibleItems.length.toLocaleString()} · scroll for more</div>
  ` : "");
  $$(".file-row").forEach((row) => {
    row.addEventListener("click", (event) => {
      const item = state.items.find((candidate) => candidate.path === row.dataset.path);
      const toggle = event.metaKey || event.ctrlKey;
      if (item?.is_dir && !toggle && !event.shiftKey) loadFolder(item.path);
      else selectItem(row.dataset.path, toggle, event.shiftKey);
    });
  });
  $$(".thumbnail img").forEach((image) => image.addEventListener("error", () => image.closest(".thumbnail").classList.add("thumb-failed")));
  if (preserveScroll) list.scrollTop = previousScroll;
}

function selectItem(path, multi = false, range = false) {
  const item = state.items.find((candidate) => candidate.path === path);
  if (!item) return;
  if (range && state.selectionAnchor) {
    const anchorIndex = state.visibleItems.findIndex((candidate) => candidate.path === state.selectionAnchor);
    const itemIndex = state.visibleItems.findIndex((candidate) => candidate.path === path);
    if (anchorIndex >= 0 && itemIndex >= 0) {
      if (!multi) state.selected.clear();
      const [start, end] = [anchorIndex, itemIndex].sort((a, b) => a - b);
      state.visibleItems.slice(start, end + 1).forEach((candidate) => state.selected.add(candidate.path));
    }
  } else {
    if (!multi) state.selected.clear();
    if (multi && state.selected.has(path)) state.selected.delete(path);
    else state.selected.add(path);
    state.selectionAnchor = path;
  }
  state.primary = state.selected.has(path) ? item : state.items.find((candidate) => state.selected.has(candidate.path)) || null;
  renderFiles();
  showPreview(state.primary);
  updateActionBar();
  requestAnimationFrame(() => document.querySelector(`.file-row[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "nearest" }));
}

function selectedItems() {
  return state.items.filter((item) => state.selected.has(item.path));
}

function updateActionBar() {
  const count = state.selected.size;
  $("#action-bar").classList.toggle("hidden", !count);
  $("#selection-count").textContent = `${count} selected`;
}

function resetPreviewElements() {
  imagePreview.classList.add("hidden");
  videoPreview.classList.add("hidden");
  $("#empty-preview").classList.add("hidden");
  $("#file-preview").classList.add("hidden");
  $("#transport").classList.add("hidden");
  $("#zoom-controls").classList.add("hidden");
  $("#pixel-badge").classList.add("hidden");
  videoPreview.pause();
  videoPreview.removeAttribute("src");
  videoPreview.load();
  state.zoomMode = "fit";
  state.zoomScale = 1;
  state.pan = { x: 0, y: 0 };
}

function showPreview(item) {
  resetPreviewElements();
  if (!item) {
    document.body.classList.remove("inspecting");
    $("#empty-preview").classList.remove("hidden");
    $("#selected-name").textContent = "Select a file";
    $("#selected-meta").textContent = "Images and video open here at full fidelity.";
    updateActionBar();
    return;
  }
  if (!item.is_dir) document.body.classList.add("inspecting");
  $("#selected-name").textContent = item.name;
  $("#selected-meta").textContent = `${item.kind} · ${formatBytes(item.size)} · ${new Date(item.modified * 1000).toLocaleString()}`;
  if (item.is_dir) {
    showFileFallback(item, "FOLDER");
  } else if (item.category === "images") {
    imagePreview.alt = item.name;
    imagePreview.src = endpoint("/api/media", { path: item.path });
    imagePreview.classList.remove("hidden");
    $("#zoom-controls").classList.remove("hidden");
  } else if (item.category === "videos") {
    videoPreview.autoplay = true;
    videoPreview.playsInline = true;
    videoPreview.src = endpoint("/api/media", { path: item.path });
    videoPreview.classList.remove("hidden");
    $("#transport").classList.remove("hidden");
    $("#zoom-controls").classList.remove("hidden");
    videoPreview.play().catch(() => { /* Browser may require one click before audio playback. */ });
  } else {
    showFileFallback(item, (item.extension || "FILE").replace(".", "").toUpperCase());
  }
  updateActionBar();
}

function showFileFallback(item, extension) {
  $("#file-preview").classList.remove("hidden");
  $("#file-extension").textContent = extension || "FILE";
  $("#file-preview-name").textContent = item.name;
}

function activeMedia() {
  if (!imagePreview.classList.contains("hidden")) return imagePreview;
  if (!videoPreview.classList.contains("hidden")) return videoPreview;
  return null;
}

function mediaDimensions(media) {
  if (media === imagePreview) return { width: media.naturalWidth, height: media.naturalHeight };
  return { width: media.videoWidth, height: media.videoHeight };
}

function fitScale(media) {
  const dimensions = mediaDimensions(media);
  if (!dimensions.width || !dimensions.height) return 1;
  return Math.min((stage.clientWidth - 40) / dimensions.width, (stage.clientHeight - 40) / dimensions.height, 1);
}

function applyZoom() {
  const media = activeMedia();
  if (!media) return;
  const scale = state.zoomMode === "fit" ? fitScale(media) : state.zoomScale;
  media.style.transform = `translate(-50%, -50%) translate(${state.pan.x}px, ${state.pan.y}px) scale(${scale})`;
  media.classList.toggle("pixelated", scale >= 3);
  stage.classList.toggle("pannable", scale > fitScale(media) + 0.01);
  $("#pixel-badge").classList.toggle("hidden", scale < 3);
  $("#zoom-value").textContent = state.zoomMode === "fit" ? "Fit" : `${Math.round(scale * 100)}%`;
}

function setZoom(action) {
  const media = activeMedia();
  if (!media) return;
  const levels = [0.25, 0.5, 1, 2, 4, 8];
  if (action === "fit") {
    state.zoomMode = "fit";
    state.pan = { x: 0, y: 0 };
  } else if (action === "actual") {
    state.zoomMode = "scale";
    state.zoomScale = 1;
    state.pan = { x: 0, y: 0 };
  } else {
    const current = state.zoomMode === "fit" ? fitScale(media) : state.zoomScale;
    state.zoomMode = "scale";
    if (action === "in") state.zoomScale = levels.find((level) => level > current + 0.01) || levels.at(-1);
    else state.zoomScale = [...levels].reverse().find((level) => level < current - 0.01) || levels[0];
  }
  applyZoom();
}

function toggleVideo() {
  if (videoPreview.classList.contains("hidden")) return;
  if (videoPreview.paused) videoPreview.play(); else videoPreview.pause();
}

function jumpVideo(seconds) {
  if (videoPreview.classList.contains("hidden")) return;
  videoPreview.currentTime = Math.max(0, Math.min(videoPreview.duration || 0, videoPreview.currentTime + seconds));
}

async function moveSelected(category) {
  const paths = selectedItems().filter((item) => !item.is_dir || category === "files").map((item) => item.path);
  const destination = state.config.destinations?.[category];
  if (!paths.length) return showToast("Select at least one file first");
  if (!destination) return $("#settings").showModal();
  const nextIndex = state.primary ? state.items.findIndex((item) => item.path === state.primary.path) : -1;
  try {
    const result = await api("/api/move", { method: "POST", body: JSON.stringify({ paths, destination }) });
    showToast(`Moved ${result.moved} item${result.moved === 1 ? "" : "s"} · Ctrl+Z to undo`);
    await loadFolder(state.currentPath);
    const startIndex = Math.min(Math.max(nextIndex, 0), Math.max(state.items.length - 1, 0));
    const nextItem = state.items.slice(startIndex).find((item) => !item.is_dir)
      || state.items.slice(0, startIndex).reverse().find((item) => !item.is_dir);
    if (nextItem) selectItem(nextItem.path);
  } catch (error) { showToast(error.message); }
}

async function undoMove() {
  try {
    const result = await api("/api/undo", { method: "POST", body: "{}" });
    showToast(result.restored ? `Restored ${result.restored} item${result.restored === 1 ? "" : "s"}` : "Nothing to undo");
    await loadFolder(state.currentPath);
  } catch (error) { showToast(error.message); }
}

function askToTrash() {
  if (!state.selected.size) return showToast("Select at least one item first");
  const count = state.selected.size;
  $("#trash-message").textContent = `${count} selected ${count === 1 ? "item" : "items"} can be restored from your operating system’s Recycle Bin or Trash.`;
  $("#confirm-trash").showModal();
}

async function trashSelected() {
  const paths = selectedItems().map((item) => item.path);
  try {
    const result = await api("/api/trash", { method: "POST", body: JSON.stringify({ paths }) });
    showToast(`Moved ${result.trashed} item${result.trashed === 1 ? "" : "s"} to the Recycle Bin`);
    await loadFolder(state.currentPath);
  } catch (error) { showToast(error.message); }
}

async function revealSelected() {
  if (!state.primary) return;
  try {
    await api("/api/reveal", { method: "POST", body: JSON.stringify({ path: state.primary.path }) });
  } catch (error) { showToast(error.message); }
}

async function openSelected() {
  if (!state.primary) return;
  try {
    await api("/api/open", { method: "POST", body: JSON.stringify({ path: state.primary.path }) });
  } catch (error) { showToast(error.message); }
}

async function pickFolder() {
  try {
    const result = await api("/api/pick-folder", { method: "POST", body: "{}" });
    if (result.path) await loadFolder(result.path);
  } catch (error) { showToast(error.message); }
}

function selectRelative(delta) {
  if (!state.visibleItems.length) return;
  const current = state.primary ? state.visibleItems.findIndex((item) => item.path === state.primary.path) : -1;
  const next = Math.max(0, Math.min(state.visibleItems.length - 1, current + delta));
  if (next >= state.renderLimit) {
    state.renderLimit = Math.min(state.visibleItems.length, state.renderLimit + 180);
    renderFiles({ preserveScroll: true });
  }
  selectItem(state.visibleItems[next].path);
}

function buildCommands() {
  const commands = [
    { label: "Open another folder", hint: "Picker", run: pickFolder },
    ...state.locations.map((location) => ({ label: `Go to ${location.name}`, hint: `G ${location.hotkey}`, run: () => loadFolder(location.path) })),
    ...state.recentFolders.slice(0, 5).map((path) => ({ label: `Recent: ${path.split(/[\\/]/).filter(Boolean).at(-1) || path}`, hint: path, run: () => loadFolder(path) })),
    { label: "Reveal selected in system explorer", hint: "", run: revealSelected },
    { label: "Open selected in default app", hint: "", run: openSelected },
    { label: "Move selected to Apps", hint: "1", run: () => moveSelected("apps") },
    { label: "Move selected to Media", hint: "2", run: () => moveSelected("videos") },
    { label: "Move selected to Images", hint: "3", run: () => moveSelected("images") },
    { label: "Move selected to Other files", hint: "4", run: () => moveSelected("files") },
    { label: "Move selected to Recycle Bin", hint: "Ctrl Backspace", run: askToTrash },
    { label: "Undo last move", hint: "Ctrl Z", run: undoMove },
    { label: "Edit sort destinations", hint: "", run: () => $("#settings").showModal() },
    { label: "Show keyboard map", hint: "?", run: () => $("#shortcuts").showModal() },
  ];
  return commands;
}

function renderPalette() {
  const query = $("#palette-input").value.toLowerCase();
  const commands = buildCommands().filter((command) => command.label.toLowerCase().includes(query));
  $("#palette-results").innerHTML = commands.map((command, index) => `
    <button type="button" class="palette-result ${index === 0 ? "active" : ""}" data-command="${index}">
      <span>${escapeHtml(command.label)}</span><span>${escapeHtml(command.hint)}</span>
    </button>
  `).join("");
  $$(".palette-result").forEach((button) => button.addEventListener("click", () => {
    $("#palette").close();
    commands[Number(button.dataset.command)].run();
  }));
}

function openPalette() {
  $("#palette-input").value = "";
  renderPalette();
  $("#palette").showModal();
  requestAnimationFrame(() => $("#palette-input").focus());
}

function handleGoChord(key) {
  const location = state.locations.find((candidate) => candidate.hotkey.toLowerCase() === key.toLowerCase());
  state.goChord = false;
  if (location) loadFolder(location.path);
  else showToast("No location uses that key");
}

function isTyping(event) {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) || event.target.isContentEditable;
}

function handleKeydown(event) {
  if (state.goChord && !isTyping(event)) {
    event.preventDefault();
    handleGoChord(event.key);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openPalette(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undoMove(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key === "Backspace") { event.preventDefault(); askToTrash(); return; }
  if (isTyping(event) || $("dialog[open]")) return;
  const key = event.key.toLowerCase();
  if (key === "g") {
    state.goChord = true;
    showToast("Go to: D Downloads · P Pictures · V Videos · H Home · B Desktop");
    setTimeout(() => { state.goChord = false; }, 1800);
    return;
  }
  const actions = {
    arrowdown: () => selectRelative(1), arrowup: () => selectRelative(-1),
    "/": () => $("#search").focus(), "?": () => $("#shortcuts").showModal(),
    "1": () => moveSelected("apps"), "2": () => moveSelected("videos"),
    "3": () => moveSelected("images"), "4": () => moveSelected("files"),
    " ": toggleVideo, "+": () => setZoom("in"), "=": () => setZoom("in"),
    "-": () => setZoom("out"), "0": () => setZoom("fit"),
    j: () => jumpVideo(event.shiftKey ? -30 : -10), l: () => jumpVideo(event.shiftKey ? 30 : 10),
    enter: () => { if (state.primary?.is_dir) loadFolder(state.primary.path); },
  };
  if (actions[key]) { event.preventDefault(); actions[key](); }
}

function bindEvents() {
  $("#open-folder").addEventListener("click", pickFolder);
  $("#open-palette").addEventListener("click", openPalette);
  $("#parent-folder").addEventListener("click", () => loadFolder(state.parentPath));
  $("#back-browser").addEventListener("click", () => document.body.classList.remove("inspecting"));
  $("#settings-button").addEventListener("click", () => $("#settings").showModal());
  $("#shortcuts-button").addEventListener("click", () => $("#shortcuts").showModal());
  $("#undo-button").addEventListener("click", undoMove);
  $("#reveal-button").addEventListener("click", revealSelected);
  $("#open-default-button").addEventListener("click", openSelected);
  $("#trash-button").addEventListener("click", askToTrash);
  $("#play-button").addEventListener("click", toggleVideo);
  $("#back-10").addEventListener("click", () => jumpVideo(-10));
  $("#forward-10").addEventListener("click", () => jumpVideo(10));
  $("#speed").addEventListener("change", (event) => { videoPreview.playbackRate = Number(event.target.value); });
  $("#seek").addEventListener("input", (event) => {
    if (Number.isFinite(videoPreview.duration)) videoPreview.currentTime = videoPreview.duration * Number(event.target.value) / 1000;
  });
  $("#search").addEventListener("input", (event) => {
    state.query = event.target.value;
    state.renderLimit = 180;
    renderFiles();
  });
  $("#file-list").addEventListener("scroll", (event) => {
    const list = event.currentTarget;
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 240 && state.renderLimit < state.visibleItems.length) {
      state.renderLimit = Math.min(state.visibleItems.length, state.renderLimit + 180);
      renderFiles({ preserveScroll: true });
    }
  });
  $("#category-filters").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    state.renderLimit = 180;
    $$("#category-filters button").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    renderFiles();
  });
  $$("[data-zoom]").forEach((button) => button.addEventListener("click", () => setZoom(button.dataset.zoom)));
  $$(".action-buttons [data-move]").forEach(bindMoveButton);
  $$("[data-close]").forEach((button) => button.addEventListener("click", () => $("#" + button.dataset.close).close()));
  $("#palette-input").addEventListener("input", renderPalette);
  $("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const destinations = Object.fromEntries($$("[data-destination]").map((input) => [input.dataset.destination, input.value]));
    const labels = Object.fromEntries($$("[data-destination-label]").map((input) => [input.dataset.destinationLabel, input.value.trim() || input.dataset.destinationLabel]));
    try {
      state.config = await api("/api/config", { method: "PUT", body: JSON.stringify({ destinations, labels }) });
      renderDestinations();
      renderSettings();
      $("#settings").close();
      showToast("Sort destinations saved");
    } catch (error) { showToast(error.message); }
  });
  $("#confirm-trash").addEventListener("close", () => { if ($("#confirm-trash").returnValue === "confirm") trashSelected(); });
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", applyZoom);
  imagePreview.addEventListener("load", () => {
    const dimensions = mediaDimensions(imagePreview);
    $("#selected-meta").textContent += ` · ${dimensions.width} × ${dimensions.height}px`;
    applyZoom();
  });
  videoPreview.addEventListener("loadedmetadata", () => {
    const dimensions = mediaDimensions(videoPreview);
    if (dimensions.width) $("#selected-meta").textContent += ` · ${dimensions.width} × ${dimensions.height}px`;
    applyZoom();
  });
  videoPreview.addEventListener("timeupdate", () => {
    $("#seek").value = Number.isFinite(videoPreview.duration) && videoPreview.duration ? Math.round(videoPreview.currentTime / videoPreview.duration * 1000) : 0;
    $("#time-value").textContent = `${formatTime(videoPreview.currentTime)} / ${formatTime(videoPreview.duration)}`;
  });
  videoPreview.addEventListener("play", () => { $("#play-button").textContent = "Pause"; });
  videoPreview.addEventListener("pause", () => { $("#play-button").textContent = "Play"; });
  videoPreview.addEventListener("click", () => {
    if (!state.dragMoved) toggleVideo();
    state.dragMoved = false;
  });
  stage.addEventListener("wheel", (event) => {
    if (!activeMedia()) return;
    event.preventDefault();
    setZoom(event.deltaY < 0 ? "in" : "out");
  }, { passive: false });
  stage.addEventListener("pointerdown", (event) => {
    if (!stage.classList.contains("pannable")) return;
    state.dragging = true;
    state.dragMoved = false;
    state.dragOrigin = { x: event.clientX - state.pan.x, y: event.clientY - state.pan.y };
    stage.classList.add("dragging");
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    if (Math.abs(event.clientX - state.dragOrigin.x - state.pan.x) > 4 || Math.abs(event.clientY - state.dragOrigin.y - state.pan.y) > 4) state.dragMoved = true;
    state.pan = { x: event.clientX - state.dragOrigin.x, y: event.clientY - state.dragOrigin.y };
    applyZoom();
  });
  stage.addEventListener("pointerup", () => { state.dragging = false; stage.classList.remove("dragging"); });
}

function startLiveReload() {
  let lastSeen = sessionStorage.getItem("quick-sort-version");
  setInterval(async () => {
    try {
      const response = await fetch(`/api/health?now=${Date.now()}`, { cache: "no-store" });
      const data = await response.json();
      if (lastSeen && data.version !== lastSeen) {
        sessionStorage.setItem("quick-sort-version", data.version);
        window.location.reload();
        return;
      }
      lastSeen = data.version;
      sessionStorage.setItem("quick-sort-version", data.version);
    } catch (_) {
      // A short failure is expected while the development server restarts.
    }
  }, 900);
}

bindEvents();
startLiveReload();
loadInitialData().catch((error) => showToast(error.message));
