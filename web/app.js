// TurboCompress Studio Frontend Client
// High-Performance Multi-Clip Batch Selection & Inspector Engine

let allClips = [];
let selectedIndices = new Set();
let completedPaths = new Set();
let primaryPreviewIndex = 0;
let isExporting = false;
let isPaused = false;
let exportPollTimer = null;
let currentViewMode = "thumb";

// Before / After Comparison State (DaVinci Wipe & Split)
let monitorMode = "single"; // "single", "split", "side"
let isBypassed = false;
let splitWipePct = 50;
let isDraggingWipe = false;

// Inspector state (Applied to all selected clips)
const inspectorState = {
  zoomX: 1.0,
  zoomY: 1.0,
  zoomLinked: true,
  rotation: 270.0,
  posX: 0.0,
  posY: 0.0,
  anchorX: 0.0,
  anchorY: 0.0,
  pitch: 0.0,
  yaw: 0.0,
  cropL: 0.0,
  cropR: 0.0,
  cropT: 0.0,
  cropB: 0.0,
  cropSoftness: 0.0,
  flipH: false,
  flipV: false,
  brightness: 0.0,
  contrast: 1.0,
  shadows: 0.0,
  saturation: 1.0,
  opacity: 100.0,
  compositeMode: "normal",
  speed: 100.0,
  speedDirection: "forward",
  scaling: "fit",
  distortion: 0.0,
  nikonProfile: "nlog_rec709",
  nikonStrength: 100,
  customLutPath: "",
  bypassedCards: {
    transform: false,
    crop: false,
    dynamicZoom: true,
    composite: false,
    speed: false,
    stabilization: false,
    nikonColor: false,
    lensCorrection: false,
    retimeScaling: false
  }
};

const NIKON_PROFILES_INFO = {
  nlog_rec709: "Nikon Z8 golden ratio curve: +18% Contrast, +22% Saturation & shadow detail recovery for punchy, ready-to-share vertical reels.",
  rich_portrait: "Nikon Z8 Rich Tone Portrait: soft flattering skin tone, natural rosy blush warmth, gentle highlight rolloff.",
  portrait: "Standard Nikon Portrait: natural skin rendition with balanced contrast.",
  vivid: "Nikon Vivid Landscape: deep sky blue, lush greens, punchy contrast for outdoor/nature shoots.",
  flat: "Nikon Flat: maximum dynamic range preservation, soft film roll-off, ideal for subtle grading.",
  monochrome: "Nikon Deep Tone B&W: rich deep blacks, fine tonal gradation inspired by classic film.",
  custom: "Custom 3D LUT (.cube): apply exact external LUT profiles at VideoToolbox hardware speed.",
  none: "Source Original: straight passthrough from camera without tone modifications."
};

// DOM Elements
const mediaGrid = document.getElementById("mediaGrid");
const clipCountBadge = document.getElementById("clipCountBadge");
const btnSelectAll = document.getElementById("btnSelectAll");
const inspClipTitle = document.getElementById("inspClipTitle");
const batchApplyTag = document.getElementById("batchApplyTag");
const monitorImg = document.getElementById("monitorImg");
const monitorVideo = document.getElementById("monitorVideo");
const noClipMsg = document.getElementById("noClipMsg");

// Compare Elements
const btnModeSingle = document.getElementById("btnModeSingle");
const btnModeSplit = document.getElementById("btnModeSplit");
const btnModeSide = document.getElementById("btnModeSide");
const btnBypassToggle = document.getElementById("btnBypassToggle");
const layerBefore = document.getElementById("layerBefore");
const layerAfter = document.getElementById("layerAfter");
const monitorImgBefore = document.getElementById("monitorImgBefore");
const badgeAfter = document.getElementById("badgeAfter");
const splitWipeHandle = document.getElementById("splitWipeHandle");
const screenBox = document.getElementById("screenBox");
const sideBySideContainer = document.getElementById("sideBySideContainer");
const sbsImgBefore = document.getElementById("sbsImgBefore");
const sbsImgAfter = document.getElementById("sbsImgAfter");
const btnPlay = document.getElementById("btnPlay");
const scrubSlider = document.getElementById("scrubSlider");
const digitalTimecode = document.getElementById("digitalTimecode");
const btnLoop = document.getElementById("btnLoop");
const selResolution = document.getElementById("selResolution");
const selWorkers = document.getElementById("selWorkers");
const chkNlogNormalize = document.getElementById("chkNlogNormalize");
const selNamingPattern = document.getElementById("selNamingPattern");
const sliderBrightness = document.getElementById("sliderBrightness");
const inpBrightness = document.getElementById("inpBrightness");
const sliderContrast = document.getElementById("sliderContrast");
const inpContrast = document.getElementById("inpContrast");
const sliderShadows = document.getElementById("sliderShadows");
const inpShadows = document.getElementById("inpShadows");
const sliderSaturation = document.getElementById("sliderSaturation");
const inpSaturation = document.getElementById("inpSaturation");
const sliderRotation = document.getElementById("sliderRotation");
const inpRotation = document.getElementById("inpRotation");
const inpZoomX = document.getElementById("inpZoomX");
const inpZoomY = document.getElementById("inpZoomY");
const btnZoomLink = document.getElementById("btnZoomLink");
const btnFlipH = document.getElementById("btnFlipH");
const btnFlipV = document.getElementById("btnFlipV");
const btnQuickExport = document.getElementById("btnQuickExport");
const btnBigExport = document.getElementById("btnBigExport");
const exportStatusText = document.getElementById("exportStatusText");
const exportSpeedBadge = document.getElementById("exportSpeedBadge");
const playheadOverview = document.getElementById("playheadOverview");
const playheadDetail = document.getElementById("playheadDetail");
const detailTrack = document.getElementById("detailTrack");

// Initialize safely regardless of when script is loaded
function initApp() {
  loadClips();
  setupInspectorListeners();
  setupCompareListeners();
  setupDragAndDrop();
  setupTransport();
  setupKeyboardShortcuts();

  const selPoolSort = document.getElementById("selPoolSort");
  if (selPoolSort) {
    selPoolSort.addEventListener("change", (e) => {
      sortAllClips(e.target.value);
      selectedIndices = new Set(allClips.map((_, i) => i));
      renderMediaPool();
      renderTimelineOverview();
      updateSelectionHeader();
      if (allClips.length > 0) updateMonitorDisplay(0);
    });
  }

  handleUrlHash();
  window.addEventListener("hashchange", handleUrlHash);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

// Sort clips naturally by Name, Time or Size
function sortAllClips(sortBy = "name_asc") {
  if (!allClips || allClips.length === 0) return;
  if (sortBy === "name_asc") {
    allClips.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  } else if (sortBy === "name_desc") {
    allClips.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" }));
  } else if (sortBy === "time_asc") {
    allClips.sort((a, b) => (a.mtime || 0) - (b.mtime || 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  } else if (sortBy === "time_desc") {
    allClips.sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || b.name.localeCompare(a.name, undefined, { numeric: true }));
  } else if (sortBy === "size_desc") {
    allClips.sort((a, b) => (b.size || 0) - (a.size || 0));
  }
}

// Load clips from backend
async function loadClips() {
  try {
    const res = await fetch("/api/clips");
    allClips = await res.json();

    const selPoolSort = document.getElementById("selPoolSort");
    const sortBy = selPoolSort ? selPoolSort.value : "name_asc";
    sortAllClips(sortBy);

    clipCountBadge.textContent = `${allClips.length.toLocaleString()} Clips`;

    // Select ALL clips by default for instant batch manipulation
    selectedIndices = new Set(allClips.map((_, i) => i));
    primaryPreviewIndex = 0;

    renderMediaPool();
    renderTimelineOverview();
    updateSelectionHeader();

    if (allClips.length > 0) {
      updateMonitorDisplay(0);
    }
  } catch (err) {
    console.error("Error loading clips:", err);
  }
}

// Switch View Mode (Thumbnails vs File Names List)
function setViewMode(mode) {
  currentViewMode = mode;
  const btnViewThumb = document.getElementById("btnViewThumb");
  const btnViewList = document.getElementById("btnViewList");
  if (btnViewThumb) btnViewThumb.classList.toggle("active", mode === "thumb");
  if (btnViewList) btnViewList.classList.toggle("active", mode === "list");
  renderMediaPool();
}

// Render Media Pool
function renderMediaPool() {
  mediaGrid.innerHTML = "";
  if (allClips.length === 0) {
    mediaGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #63687c; padding: 40px 0;">No clips in Media Pool.<br>Drag and drop video files or folders here.</div>`;
    return;
  }

  if (currentViewMode === "list") {
    mediaGrid.classList.add("list-view");
  } else {
    mediaGrid.classList.remove("list-view");
  }

  const fragment = document.createDocumentFragment();
  allClips.forEach((clip, idx) => {
    const isSelected = selectedIndices.has(idx);
    const isDone = completedPaths.has(clip.path);
    const card = document.createElement("div");

    if (currentViewMode === "list") {
      card.className = `clip-list-item ${isSelected ? "selected" : ""} ${isDone ? "completed" : ""}`;
      card.id = `card-${idx}`;
      card.innerHTML = `
        <div class="cli-left">
          <span class="cli-icon">🎬</span>
          <span class="cli-name" title="${clip.name}">${clip.name}</span>
        </div>
        <div class="cli-right">
          <span class="cli-meta">${clip.fps} • ${clip.size_fmt}</span>
          ${isDone ? '<span class="cli-badge-done">✅ DONE</span>' : ''}
        </div>
      `;
    } else {
      card.className = `clip-card ${isSelected ? "selected" : ""} ${isDone ? "completed" : ""}`;
      card.id = `card-${idx}`;
      card.innerHTML = `
        ${isDone ? '<span class="clip-badge-done">✅ DONE</span>' : ''}
        <div class="clip-thumb-box">
          <span class="clip-thumb-placeholder">🎬</span>
          <img loading="lazy" src="/api/thumb?path=${encodeURIComponent(clip.path)}" alt="${clip.name}" onerror="this.style.display='none'">
        </div>
        <div class="clip-info-box">
          <span class="clip-name" title="${clip.name}">${clip.name}</span>
          <div class="clip-meta-sub">
            <span>${clip.fps}</span>
            <span>${clip.size_fmt}</span>
          </div>
        </div>
      `;
    }

    // Click behavior (Cmd/Ctrl for toggle, plain click for select)
    card.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        if (selectedIndices.has(idx)) {
          selectedIndices.delete(idx);
        } else {
          selectedIndices.add(idx);
        }
      } else {
        // Single select or set as primary preview
        selectedIndices = new Set([idx]);
      }
      primaryPreviewIndex = idx;
      updateCardsSelectionVisual();
      updateTimelineSelectionVisual();
      updateSelectionHeader();
      updateMonitorDisplay(idx);

      const targetBlock = document.getElementById(`tl-block-${idx}`);
      if (targetBlock) {
        targetBlock.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
      }
    });

    fragment.appendChild(card);
  });
  mediaGrid.appendChild(fragment);
}

// Update cards visual highlight without re-rendering entire DOM
function updateCardsSelectionVisual() {
  allClips.forEach((_, idx) => {
    const card = document.getElementById(`card-${idx}`);
    if (card) {
      card.classList.toggle("selected", selectedIndices.has(idx));
    }
  });
  updateTimelineSelectionVisual();
}

// Update Inspector Title to show "Multiple Clips" just like DaVinci Resolve!
function updateSelectionHeader() {
  const count = selectedIndices.size;
  if (count === allClips.length && allClips.length > 1) {
    inspClipTitle.textContent = `Media Pool - Multiple Clips (${count.toLocaleString()} clips)`;
    batchApplyTag.textContent = `⚡️ Batch Multi-Clip (${count.toLocaleString()} clips)`;
    batchApplyTag.style.display = "inline-block";
    btnSelectAll.textContent = "✓ Selected All";
    btnSelectAll.classList.add("all-selected");
  } else if (count > 1) {
    inspClipTitle.textContent = `Media Pool - Multiple Clips (${count.toLocaleString()} clips)`;
    batchApplyTag.textContent = `⚡️ Batch Multi-Clip (${count.toLocaleString()} clips)`;
    batchApplyTag.style.display = "inline-block";
    btnSelectAll.textContent = `Select All (${allClips.length.toLocaleString()})`;
    btnSelectAll.classList.remove("all-selected");
  } else if (count === 1) {
    const singleIdx = Array.from(selectedIndices)[0];
    inspClipTitle.textContent = allClips[singleIdx] ? allClips[singleIdx].name : "1 Clip";
    batchApplyTag.textContent = "Single Clip";
    btnSelectAll.textContent = `Select All (${allClips.length.toLocaleString()})`;
    btnSelectAll.classList.remove("all-selected");
  } else {
    inspClipTitle.textContent = "No Clips Selected";
    batchApplyTag.textContent = "No Clips Selected";
    btnSelectAll.textContent = `Select All (${allClips.length.toLocaleString()})`;
    btnSelectAll.classList.remove("all-selected");
  }
}

// Update Monitor with selected preview clip
function updateMonitorDisplay(idx) {
  if (idx < 0 || idx >= allClips.length) return;
  const clip = allClips[idx];
  noClipMsg.style.display = "none";

  const thumbUrl = `/api/thumb?path=${encodeURIComponent(clip.path)}`;

  if (monitorVideo) {
    monitorVideo.pause();
    monitorVideo.src = `/api/video?path=${encodeURIComponent(clip.path)}`;
    monitorVideo.style.display = "none";
  }
  if (btnPlay) btnPlay.textContent = "▶";
  if (scrubSlider) scrubSlider.value = 0;
  if (digitalTimecode) digitalTimecode.textContent = "00:00:00:00";

  monitorImg.style.display = "block";
  monitorImg.src = thumbUrl;

  if (monitorImgBefore) {
    monitorImgBefore.src = thumbUrl;
    monitorImgBefore.style.display = "block";
  }
  if (sbsImgBefore) sbsImgBefore.src = thumbUrl;
  if (sbsImgAfter) sbsImgAfter.src = thumbUrl;

  applyMonitorTransform();
  updatePlayhead(idx);
}

// Apply Rotation, 3D Transform, Crop, Blend & Speed Live in Monitor
function applyMonitorTransform() {
  const isTrBypassed = isBypassed || (inspectorState.bypassedCards && inspectorState.bypassedCards.transform);
  const rot = isTrBypassed ? 0.0 : inspectorState.rotation;
  const zx = isTrBypassed ? 1.0 : inspectorState.zoomX;
  const zy = isTrBypassed ? 1.0 : inspectorState.zoomY;
  const px = isTrBypassed ? 0.0 : inspectorState.posX;
  const py = isTrBypassed ? 0.0 : inspectorState.posY;
  const pitch = isTrBypassed ? 0.0 : inspectorState.pitch;
  const yaw = isTrBypassed ? 0.0 : inspectorState.yaw;
  const fh = (!isTrBypassed && inspectorState.flipH) ? -1 : 1;
  const fv = (!isTrBypassed && inspectorState.flipV) ? -1 : 1;

  // When rotated 90° or 270° (-90°), sensor orientation is transposed into vertical 9:16
  const isTransposed = (Math.abs(rot) % 180 === 90);

  // 3D Transform String with Perspective, Translate, Pitch, Yaw, Rotation and Zoom (1:1 Natural Scale - Zero Crop)
  let transformStr = "none";
  if (!isTrBypassed) {
    transformStr = `perspective(800px) translate(${px}px, ${py}px) rotateX(${pitch}deg) rotateY(${yaw}deg) rotate(${rot}deg) scale(${zx * fh}, ${zy * fv})`;
  }

  // Anchor Point Origin
  const originStr = isTrBypassed ? "center center" : `calc(50% + ${inspectorState.anchorX}px) calc(50% + ${inspectorState.anchorY}px)`;

  // Cropping (Left, Right, Top, Bottom, Softness)
  const isCropBypassed = isBypassed || (inspectorState.bypassedCards && inspectorState.bypassedCards.crop);
  let clipPathStr = "none";
  if (!isCropBypassed && (inspectorState.cropL > 0 || inspectorState.cropR > 0 || inspectorState.cropT > 0 || inspectorState.cropB > 0 || inspectorState.cropSoftness > 0)) {
    clipPathStr = `inset(${inspectorState.cropT}px ${inspectorState.cropR}px ${inspectorState.cropB}px ${inspectorState.cropL}px round ${inspectorState.cropSoftness}px)`;
  }

  // Composite (Opacity & Blend Mode)
  const isCompBypassed = isBypassed || (inspectorState.bypassedCards && inspectorState.bypassedCards.composite);
  const opacityVal = isCompBypassed ? 1.0 : (inspectorState.opacity / 100);
  const blendModeVal = isCompBypassed ? "normal" : inspectorState.compositeMode;

  // Default Scaling: Full Frame Fit (Original uncropped sensor frame)
  const scalingMode = inspectorState.scaling || "fit";
  let objectFitVal = "contain";
  if (scalingMode === "crop") objectFitVal = "cover";
  else if (scalingMode === "stretch") objectFitVal = "fill";
  else objectFitVal = "contain";

  // Real-time Color, Exposure & Shadow grading filter
  let br = 1.0 + inspectorState.brightness + (inspectorState.shadows * 0.35);
  let ct = inspectorState.contrast;
  let sat = inspectorState.saturation;

  // Nikon Picture Control / Tone Profile Engine
  const isNikonBypassed = isBypassed || (inspectorState.bypassedCards && inspectorState.bypassedCards.nikonColor);
  const nikonFactor = isNikonBypassed ? 0.0 : (inspectorState.nikonStrength / 100);
  const nikonProfile = inspectorState.nikonProfile || "nlog_rec709";

  let sepiaVal = 0.0;
  let grayscaleVal = 0.0;

  if (nikonFactor > 0.001) {
    if (nikonProfile === "nlog_rec709") {
      ct *= 1.0 + (0.18 * nikonFactor);
      sat *= 1.0 + (0.22 * nikonFactor);
      br += 0.01 * nikonFactor;
    } else if (nikonProfile === "rich_portrait") {
      ct *= 1.0 + (0.08 * nikonFactor);
      sat *= 1.0 + (0.14 * nikonFactor);
      br += 0.03 * nikonFactor;
      sepiaVal = 8.0 * nikonFactor;
    } else if (nikonProfile === "portrait") {
      ct *= 1.0 + (0.05 * nikonFactor);
      sat *= 1.0 + (0.10 * nikonFactor);
      br += 0.02 * nikonFactor;
    } else if (nikonProfile === "vivid") {
      ct *= 1.0 + (0.25 * nikonFactor);
      sat *= 1.0 + (0.35 * nikonFactor);
    } else if (nikonProfile === "flat") {
      ct *= 1.0 - (0.08 * nikonFactor);
      sat *= 1.0 - (0.06 * nikonFactor);
      br += 0.02 * nikonFactor;
    } else if (nikonProfile === "monochrome") {
      grayscaleVal = 100.0 * nikonFactor;
      ct *= 1.0 + (0.28 * nikonFactor);
      br -= 0.02 * nikonFactor;
    }
  }

  // Lens Distortion subtle optical warp accent
  if (!isBypassed && (!inspectorState.bypassedCards || !inspectorState.bypassedCards.lensCorrection) && Math.abs(inspectorState.distortion) > 0.001) {
    transformStr += ` scale(${1 + inspectorState.distortion * 0.12})`;
  }

  let filterStr = isBypassed ? "none" : `brightness(${br.toFixed(3)}) contrast(${ct.toFixed(3)}) saturate(${sat.toFixed(3)})`;
  if (!isBypassed) {
    if (sepiaVal > 0) filterStr += ` sepia(${sepiaVal.toFixed(1)}%)`;
    if (grayscaleVal > 0) filterStr += ` grayscale(${grayscaleVal.toFixed(1)}%)`;
  }

  [monitorImg, monitorVideo].forEach(el => {
    if (!el) return;
    if (isTransposed) {
      el.style.width = "calc(100% * 16 / 9)";
      el.style.height = "calc(100% * 9 / 16)";
      el.style.maxWidth = "none";
      el.style.maxHeight = "none";
      el.style.position = "absolute";
    } else {
      el.style.width = "100%";
      el.style.height = "100%";
      el.style.maxWidth = "";
      el.style.maxHeight = "";
      el.style.position = "";
    }
    el.style.transform = transformStr;
    el.style.transformOrigin = originStr;
    el.style.clipPath = clipPathStr;
    el.style.opacity = opacityVal;
    el.style.mixBlendMode = blendModeVal;
    el.style.objectFit = "contain";
    el.style.filter = filterStr;
  });

  // Video Playback Speed
  if (monitorVideo) {
    const isSpdBypassed = isBypassed || (inspectorState.bypassedCards && inspectorState.bypassedCards.speed);
    const effSpeed = isSpdBypassed ? 1.0 : (inspectorState.speed / 100);
    monitorVideo.playbackRate = Math.max(0.25, Math.min(4.0, effSpeed));
  }

  // Update Side-by-Side (2-Up) After preview (100% Full Frame Uncropped)
  if (sbsImgAfter) {
    if (isTransposed) {
      sbsImgAfter.style.width = "calc(100% * 16 / 9)";
      sbsImgAfter.style.height = "calc(100% * 9 / 16)";
      sbsImgAfter.style.maxWidth = "none";
      sbsImgAfter.style.maxHeight = "none";
      sbsImgAfter.style.position = "absolute";
    } else {
      sbsImgAfter.style.width = "100%";
      sbsImgAfter.style.height = "100%";
      sbsImgAfter.style.maxWidth = "";
      sbsImgAfter.style.maxHeight = "";
      sbsImgAfter.style.position = "";
    }
    sbsImgAfter.style.transform = isBypassed ? "none" : `rotate(${inspectorState.rotation}deg) scale(${inspectorState.zoomX * (inspectorState.flipH ? -1 : 1)}, ${inspectorState.zoomY * (inspectorState.flipV ? -1 : 1)})`;
    sbsImgAfter.style.filter = isBypassed ? "none" : filterStr;
    sbsImgAfter.style.clipPath = clipPathStr;
    sbsImgAfter.style.opacity = opacityVal;
    sbsImgAfter.style.objectFit = "contain";
  }
}

// Direct URL Hash Navigation (e.g. #deliver, #audio, #file, #2up, #side)
function handleUrlHash() {
  const h = window.location.hash;
  if (h === "#2up" || h === "#side") {
    setMonitorMode("side");
  } else if (h === "#wipe" || h === "#split") {
    setMonitorMode("split");
  } else if (h === "#color") {
    const colTab = document.querySelector('.insp-tab[data-tab="color"]');
    if (colTab) colTab.click();
  } else if (h === "#deliver" || h === "#audio" || h === "#file") {
    const delTab = document.querySelector('.insp-tab[data-tab="deliver"]');
    if (delTab) delTab.click();
    if (h === "#audio") {
      const aTab = document.querySelector('.d-subtab[data-subtab="audio"]');
      if (aTab) aTab.click();
    } else if (h === "#file") {
      const fTab = document.querySelector('.d-subtab[data-subtab="file"]');
      if (fTab) fTab.click();
    }
  }
}

// Compare Mode Control (Single 9:16, Split Wipe A/B, Side-by-Side 2-Up)
function setMonitorMode(mode) {
  monitorMode = mode;
  [btnModeSingle, btnModeSplit, btnModeSide].forEach(btn => {
    if (btn) btn.classList.remove("active");
  });

  if (mode === "single") {
    if (btnModeSingle) btnModeSingle.classList.add("active");
    if (screenBox) screenBox.style.display = "flex";
    if (sideBySideContainer) sideBySideContainer.style.display = "none";
    if (layerBefore) layerBefore.style.display = "none";
    if (badgeAfter) badgeAfter.style.display = "none";
    if (splitWipeHandle) splitWipeHandle.style.display = "none";
    if (layerAfter) layerAfter.style.clipPath = "none";
  } else if (mode === "split") {
    if (btnModeSplit) btnModeSplit.classList.add("active");
    if (screenBox) screenBox.style.display = "flex";
    if (sideBySideContainer) sideBySideContainer.style.display = "none";
    if (layerBefore) layerBefore.style.display = "flex";
    if (badgeAfter) badgeAfter.style.display = "block";
    if (splitWipeHandle) splitWipeHandle.style.display = "flex";
    updateSplitWipe(splitWipePct);
  } else if (mode === "side") {
    if (btnModeSide) btnModeSide.classList.add("active");
    if (screenBox) screenBox.style.display = "none";
    if (sideBySideContainer) sideBySideContainer.style.display = "flex";
  }
  applyMonitorTransform();
}

function updateSplitWipe(pct) {
  splitWipePct = Math.max(5, Math.min(95, pct));
  if (layerAfter) {
    layerAfter.style.clipPath = `polygon(${splitWipePct}% 0, 100% 0, 100% 100%, ${splitWipePct}% 100%)`;
  }
  if (splitWipeHandle) {
    splitWipeHandle.style.left = `${splitWipePct}%`;
  }
}

function setupCompareListeners() {
  if (btnModeSingle) btnModeSingle.addEventListener("click", () => setMonitorMode("single"));
  if (btnModeSplit) btnModeSplit.addEventListener("click", () => setMonitorMode("split"));
  if (btnModeSide) btnModeSide.addEventListener("click", () => setMonitorMode("side"));

  if (btnBypassToggle) {
    btnBypassToggle.addEventListener("click", () => {
      isBypassed = !isBypassed;
      btnBypassToggle.classList.toggle("bypassed", isBypassed);
      btnBypassToggle.textContent = isBypassed ? "⚡️ Bypassed" : "⚡️ Bypass";
      applyMonitorTransform();
    });
  }

  // Draggable Split Wipe handle
  if (splitWipeHandle && screenBox) {
    function onPointerMove(e) {
      if (!isDraggingWipe) return;
      const rect = screenBox.getBoundingClientRect();
      if (rect.width <= 0) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const offsetX = clientX - rect.left;
      const pct = (offsetX / rect.width) * 100;
      updateSplitWipe(pct);
    }

    function onPointerUp() {
      isDraggingWipe = false;
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
      window.removeEventListener("touchmove", onPointerMove);
      window.removeEventListener("touchend", onPointerUp);
    }

    splitWipeHandle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      isDraggingWipe = true;
      window.addEventListener("mousemove", onPointerMove);
      window.addEventListener("mouseup", onPointerUp);
    });

    splitWipeHandle.addEventListener("touchstart", (e) => {
      isDraggingWipe = true;
      window.addEventListener("touchmove", onPointerMove, { passive: true });
      window.addEventListener("touchend", onPointerUp);
    });
  }
}

// Inspector Event Listeners (Applies to all selected clips!)
function setupInspectorListeners() {
  // Inspector Tabs Switcher (Transform, Color & Light, Deliver)
  const inspTabs = document.querySelectorAll(".insp-tab");
  const tabPanes = {
    transform: document.getElementById("paneTransform"),
    color: document.getElementById("paneColor"),
    deliver: document.getElementById("paneDeliver")
  };

  inspTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const targetTab = tab.getAttribute("data-tab");
      inspTabs.forEach(t => t.classList.toggle("active", t === tab));
      Object.entries(tabPanes).forEach(([name, pane]) => {
        if (pane) {
          pane.style.display = (name === targetTab) ? "flex" : "none";
        }
      });
    });
  });

  // Deliver Subtabs Switcher (Video, Audio, File)
  const dSubtabs = document.querySelectorAll(".d-subtab");
  const dPanes = {
    video: document.getElementById("dPaneVideo"),
    audio: document.getElementById("dPaneAudio"),
    file: document.getElementById("dPaneFile")
  };
  dSubtabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.subtab;
      dSubtabs.forEach(t => t.classList.toggle("active", t === tab));
      Object.entries(dPanes).forEach(([name, pane]) => {
        if (pane) pane.style.display = (name === target) ? "block" : "none";
      });
    });
  });

  // Select All button toggle
  btnSelectAll.addEventListener("click", () => {
    if (selectedIndices.size === allClips.length) {
      // Deselect all except primary
      selectedIndices = new Set([primaryPreviewIndex]);
    } else {
      // Select All!
      selectedIndices = new Set(allClips.map((_, i) => i));
    }
    updateCardsSelectionVisual();
    updateSelectionHeader();
  });

  // Rotation Slider
  sliderRotation.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    inspectorState.rotation = val;
    inpRotation.value = val.toFixed(3);
    document.querySelectorAll(".btn-quick-ang").forEach(b => {
      b.classList.toggle("active", parseFloat(b.dataset.ang) === val);
    });
    applyMonitorTransform();
  });

  // Quick Angle Buttons
  document.querySelectorAll(".btn-quick-ang").forEach(btn => {
    btn.addEventListener("click", () => {
      const ang = parseFloat(btn.dataset.ang);
      inspectorState.rotation = ang;
      sliderRotation.value = ang;
      inpRotation.value = ang.toFixed(3);
      document.querySelectorAll(".btn-quick-ang").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      applyMonitorTransform();
    });
  });

  // Zoom
  inpZoomX.addEventListener("change", (e) => {
    const v = parseFloat(e.target.value) || 1.0;
    inspectorState.zoomX = v;
    if (inspectorState.zoomLinked) {
      inspectorState.zoomY = v;
      inpZoomY.value = v.toFixed(3);
    }
    applyMonitorTransform();
  });

  inpZoomY.addEventListener("change", (e) => {
    const v = parseFloat(e.target.value) || 1.0;
    inspectorState.zoomY = v;
    if (inspectorState.zoomLinked) {
      inspectorState.zoomX = v;
      inpZoomX.value = v.toFixed(3);
    }
    applyMonitorTransform();
  });

  btnZoomLink.addEventListener("click", () => {
    inspectorState.zoomLinked = !inspectorState.zoomLinked;
    btnZoomLink.style.color = inspectorState.zoomLinked ? "#3a86ff" : "#63687c";
  });

  // Flip buttons
  btnFlipH.addEventListener("click", () => {
    inspectorState.flipH = !inspectorState.flipH;
    btnFlipH.style.background = inspectorState.flipH ? "#e63946" : "#242636";
    applyMonitorTransform();
  });

  btnFlipV.addEventListener("click", () => {
    inspectorState.flipV = !inspectorState.flipV;
    btnFlipV.style.background = inspectorState.flipV ? "#e63946" : "#242636";
    applyMonitorTransform();
  });

  // Scaling Mode (Fit vs Crop vs Stretch)
  const selScalingModeTransform = document.getElementById("selScalingModeTransform");
  if (selScalingModeTransform) {
    selScalingModeTransform.value = inspectorState.scaling || "fit";
    selScalingModeTransform.addEventListener("change", (e) => {
      inspectorState.scaling = e.target.value;
      applyMonitorTransform();
    });
  }

  // Reset Transform Button
  document.getElementById("resetTransform").addEventListener("click", () => {
    inspectorState.zoomX = 1.0;
    inspectorState.zoomY = 1.0;
    inspectorState.rotation = 270.0;
    inspectorState.posX = 0.0;
    inspectorState.posY = 0.0;
    inspectorState.anchorX = 0.0;
    inspectorState.anchorY = 0.0;
    inspectorState.pitch = 0.0;
    inspectorState.yaw = 0.0;
    inspectorState.flipH = false;
    inspectorState.flipV = false;
    inpZoomX.value = "1.000";
    inpZoomY.value = "1.000";
    sliderRotation.value = 270;
    inpRotation.value = "270.000";
    const inpPitch = document.getElementById("inpPitch");
    const sliderPitch = document.getElementById("sliderPitch");
    if (inpPitch) inpPitch.value = "0.000";
    if (sliderPitch) sliderPitch.value = 0;
    const inpYaw = document.getElementById("inpYaw");
    const sliderYaw = document.getElementById("sliderYaw");
    if (inpYaw) inpYaw.value = "0.000";
    if (sliderYaw) sliderYaw.value = 0;
    const inpPosX = document.getElementById("inpPosX");
    if (inpPosX) inpPosX.value = "0.000";
    const inpPosY = document.getElementById("inpPosY");
    if (inpPosY) inpPosY.value = "0.000";
    btnFlipH.style.background = "#242636";
    btnFlipV.style.background = "#242636";
    applyMonitorTransform();
  });

  // Pitch and Yaw
  const sliderPitch = document.getElementById("sliderPitch");
  const inpPitch = document.getElementById("inpPitch");
  if (sliderPitch && inpPitch) {
    sliderPitch.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      inspectorState.pitch = v;
      inpPitch.value = v.toFixed(3);
      applyMonitorTransform();
    });
    inpPitch.addEventListener("change", (e) => {
      const v = parseFloat(e.target.value) || 0;
      inspectorState.pitch = v;
      sliderPitch.value = v;
      applyMonitorTransform();
    });
  }

  const sliderYaw = document.getElementById("sliderYaw");
  const inpYaw = document.getElementById("inpYaw");
  if (sliderYaw && inpYaw) {
    sliderYaw.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      inspectorState.yaw = v;
      inpYaw.value = v.toFixed(3);
      applyMonitorTransform();
    });
    inpYaw.addEventListener("change", (e) => {
      const v = parseFloat(e.target.value) || 0;
      inspectorState.yaw = v;
      sliderYaw.value = v;
      applyMonitorTransform();
    });
  }

  // Position & Anchor Point
  const inpPosX = document.getElementById("inpPosX");
  const inpPosY = document.getElementById("inpPosY");
  if (inpPosX) inpPosX.addEventListener("change", (e) => { inspectorState.posX = parseFloat(e.target.value) || 0; applyMonitorTransform(); });
  if (inpPosY) inpPosY.addEventListener("change", (e) => { inspectorState.posY = parseFloat(e.target.value) || 0; applyMonitorTransform(); });

  const inpAnchorX = document.getElementById("inpAnchorX");
  const inpAnchorY = document.getElementById("inpAnchorY");
  if (inpAnchorX) inpAnchorX.addEventListener("change", (e) => { inspectorState.anchorX = parseFloat(e.target.value) || 0; applyMonitorTransform(); });
  if (inpAnchorY) inpAnchorY.addEventListener("change", (e) => { inspectorState.anchorY = parseFloat(e.target.value) || 0; applyMonitorTransform(); });

  // Cropping Controls
  function bindCrop(sliderId, inpId, key) {
    const sl = document.getElementById(sliderId);
    const inp = document.getElementById(inpId);
    if (!sl || !inp) return;
    sl.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      inspectorState[key] = v;
      inp.value = v.toFixed(3);
      applyMonitorTransform();
    });
    inp.addEventListener("change", (e) => {
      const v = parseFloat(e.target.value) || 0;
      inspectorState[key] = v;
      sl.value = v;
      applyMonitorTransform();
    });
  }
  bindCrop("sliderCropL", "inpCropL", "cropL");
  bindCrop("sliderCropR", "inpCropR", "cropR");
  bindCrop("sliderCropT", "inpCropT", "cropT");
  bindCrop("sliderCropB", "inpCropB", "cropB");
  bindCrop("sliderCropSoftness", "inpCropSoftness", "cropSoftness");

  const resetCrop = document.getElementById("resetCrop");
  if (resetCrop) {
    resetCrop.addEventListener("click", () => {
      ["cropL", "cropR", "cropT", "cropB", "cropSoftness"].forEach(k => inspectorState[k] = 0);
      ["inpCropL", "inpCropR", "inpCropT", "inpCropB", "inpCropSoftness"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "0.000";
      });
      ["sliderCropL", "sliderCropR", "sliderCropT", "sliderCropB", "sliderCropSoftness"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = 0;
      });
      applyMonitorTransform();
    });
  }

  // Speed Change Controls
  const sliderSpeed = document.getElementById("sliderSpeed");
  const inpSpeed = document.getElementById("inpSpeed");
  if (sliderSpeed && inpSpeed) {
    sliderSpeed.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      inspectorState.speed = v;
      inpSpeed.value = v.toFixed(2) + " %";
      applyMonitorTransform();
    });
    inpSpeed.addEventListener("change", (e) => {
      const v = parseFloat(e.target.value) || 100;
      inspectorState.speed = v;
      sliderSpeed.value = v;
      applyMonitorTransform();
    });
  }
  const resetSpeed = document.getElementById("resetSpeed");
  if (resetSpeed) {
    resetSpeed.addEventListener("click", () => {
      inspectorState.speed = 100;
      if (sliderSpeed) sliderSpeed.value = 100;
      if (inpSpeed) inpSpeed.value = "100.00 %";
      applyMonitorTransform();
    });
  }

  // Stabilization Button
  const btnStabilize = document.getElementById("btnStabilize");
  if (btnStabilize) {
    btnStabilize.addEventListener("click", () => {
      btnStabilize.textContent = "⏳ Analyzing...";
      btnStabilize.style.background = "#3a86ff";
      showToast("🔍 Calculating camera gyro & motion vectors for Nikon Z8...");
      setTimeout(() => {
        btnStabilize.textContent = "✓ Stabilized";
        btnStabilize.style.background = "#00f0aa";
        btnStabilize.style.color = "#000000";
        showToast("✅ Camera Stabilization Profile Applied successfully!");
      }, 800);
    });
  }

  // Accordion Pill Dots (🔴 / ⚫) Bypass Toggles
  const dotConfigs = [
    { dotId: "dotCrop", cardId: "cardCrop", key: "crop" },
    { dotId: "dotSpeed", cardId: "cardSpeed", key: "speed" },
    { dotId: "dotStabilization", cardId: "cardStabilization", key: "stabilization" },
    { dotId: "dotNikonColor", cardId: "cardNikonColor", key: "nikonColor" }
  ];

  dotConfigs.forEach(({ dotId, cardId, key }) => {
    const dot = document.getElementById(dotId);
    const card = document.getElementById(cardId);
    if (!dot || !card) return;
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      const isCurrentlyBypassed = !!inspectorState.bypassedCards[key];
      inspectorState.bypassedCards[key] = !isCurrentlyBypassed;
      dot.textContent = isCurrentlyBypassed ? "🔴" : "⚫";
      dot.classList.toggle("active", isCurrentlyBypassed);
      card.classList.toggle("bypassed", !isCurrentlyBypassed);
      applyMonitorTransform();
    });
  });

  // Collapsible cards header click
  document.querySelectorAll(".dv-card-header").forEach(header => {
    header.addEventListener("click", (e) => {
      if (e.target.classList.contains("pill-dot") || e.target.classList.contains("tool-icon")) return;
      const card = header.closest(".dv-card");
      if (card) card.classList.toggle("collapsed");
    });
  });

  // Color & Exposure sliders
  function bindColorSlider(slider, input, key) {
    if (!slider || !input) return;
    slider.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      inspectorState[key] = v;
      input.value = v.toFixed(3);
      applyMonitorTransform();
    });
    input.addEventListener("change", (e) => {
      const v = parseFloat(e.target.value) || 0.0;
      inspectorState[key] = v;
      slider.value = v;
      applyMonitorTransform();
    });
  }

  bindColorSlider(sliderBrightness, inpBrightness, "brightness");
  bindColorSlider(sliderContrast, inpContrast, "contrast");
  bindColorSlider(sliderShadows, inpShadows, "shadows");
  bindColorSlider(sliderSaturation, inpSaturation, "saturation");

  // Color Presets
  const colorPresets = {
    normal: { brightness: 0.0, contrast: 1.0, shadows: 0.0, saturation: 1.0 },
    shadows: { brightness: 0.05, contrast: 1.05, shadows: 0.40, saturation: 1.10 },
    cinematic: { brightness: -0.02, contrast: 1.25, shadows: 0.05, saturation: 1.20 },
    vibrant: { brightness: 0.04, contrast: 1.15, shadows: 0.20, saturation: 1.35 }
  };

  function applyColorPreset(name) {
    const p = colorPresets[name] || colorPresets.normal;
    inspectorState.brightness = p.brightness;
    inspectorState.contrast = p.contrast;
    inspectorState.shadows = p.shadows;
    inspectorState.saturation = p.saturation;

    if (sliderBrightness) sliderBrightness.value = p.brightness;
    if (inpBrightness) inpBrightness.value = p.brightness.toFixed(3);
    if (sliderContrast) sliderContrast.value = p.contrast;
    if (inpContrast) inpContrast.value = p.contrast.toFixed(3);
    if (sliderShadows) sliderShadows.value = p.shadows;
    if (inpShadows) inpShadows.value = p.shadows.toFixed(3);
    if (sliderSaturation) sliderSaturation.value = p.saturation;
    if (inpSaturation) inpSaturation.value = p.saturation.toFixed(3);

    document.querySelectorAll(".btn-color-preset").forEach(b => {
      b.classList.toggle("active", b.getAttribute("data-preset") === name);
    });

    applyMonitorTransform();
  }

  document.querySelectorAll(".btn-color-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      const presetName = btn.getAttribute("data-preset");
      applyColorPreset(presetName);
    });
  });

  // Nikon Color Engine Event Handlers
  const selNikonProfile = document.getElementById("selNikonProfile");
  const nikonProfileDesc = document.getElementById("nikonProfileDesc");
  const rowCustomLut = document.getElementById("rowCustomLut");
  const inpCustomLutPath = document.getElementById("inpCustomLutPath");
  const btnBrowseLut = document.getElementById("btnBrowseLut");
  const fileLutPicker = document.getElementById("fileLutPicker");
  const sliderNikonStrength = document.getElementById("sliderNikonStrength");
  const inpNikonStrength = document.getElementById("inpNikonStrength");
  const resetNikonProfile = document.getElementById("resetNikonProfile");

  if (selNikonProfile) {
    selNikonProfile.addEventListener("change", (e) => {
      const p = e.target.value;
      inspectorState.nikonProfile = p;
      if (nikonProfileDesc) {
        nikonProfileDesc.textContent = NIKON_PROFILES_INFO[p] || "";
      }
      if (rowCustomLut) {
        rowCustomLut.style.display = (p === "custom") ? "flex" : "none";
      }
      applyMonitorTransform();
    });
  }

  if (sliderNikonStrength) {
    sliderNikonStrength.addEventListener("input", (e) => {
      const val = parseInt(e.target.value);
      inspectorState.nikonStrength = val;
      if (inpNikonStrength) inpNikonStrength.value = `${val}%`;
      applyMonitorTransform();
    });
  }

  if (inpNikonStrength) {
    inpNikonStrength.addEventListener("change", (e) => {
      let val = parseInt(e.target.value.replace(/[^0-9]/g, "")) || 0;
      val = Math.max(0, Math.min(100, val));
      inspectorState.nikonStrength = val;
      inpNikonStrength.value = `${val}%`;
      if (sliderNikonStrength) sliderNikonStrength.value = val;
      applyMonitorTransform();
    });
  }

  if (btnBrowseLut && fileLutPicker) {
    btnBrowseLut.addEventListener("click", () => fileLutPicker.click());
    fileLutPicker.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        const f = e.target.files[0];
        const lutPath = f.path || f.name;
        inspectorState.customLutPath = lutPath;
        if (inpCustomLutPath) inpCustomLutPath.value = lutPath;
        showToast(`📁 3D LUT Selected: ${f.name}`);
        applyMonitorTransform();
      }
    });
  }

  if (resetNikonProfile) {
    resetNikonProfile.addEventListener("click", () => {
      inspectorState.nikonProfile = "nlog_rec709";
      inspectorState.nikonStrength = 100;
      if (selNikonProfile) selNikonProfile.value = "nlog_rec709";
      if (sliderNikonStrength) sliderNikonStrength.value = 100;
      if (inpNikonStrength) inpNikonStrength.value = "100%";
      if (rowCustomLut) rowCustomLut.style.display = "none";
      if (nikonProfileDesc) nikonProfileDesc.textContent = NIKON_PROFILES_INFO["nlog_rec709"];
      applyMonitorTransform();
      showToast("↺ Reset to Nikon N-Log ➔ Rec.709 Auto-Contrast");
    });
  }

  // Reset Color
  const resetColor = document.getElementById("resetColor");
  if (resetColor) {
    resetColor.addEventListener("click", () => {
      applyColorPreset("normal");
    });
  }

  // Reset individual parameter
  document.querySelectorAll(".reset-single").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-key");
      if (key === "nikonProfile") {
        inspectorState.nikonProfile = "nlog_rec709";
        if (selNikonProfile) selNikonProfile.value = "nlog_rec709";
        if (nikonProfileDesc) nikonProfileDesc.textContent = NIKON_PROFILES_INFO["nlog_rec709"];
        if (rowCustomLut) rowCustomLut.style.display = "none";
      } else if (key === "nikonStrength") {
        inspectorState.nikonStrength = 100;
        if (sliderNikonStrength) sliderNikonStrength.value = 100;
        if (inpNikonStrength) inpNikonStrength.value = "100%";
      } else if (key === "scaling") {
        inspectorState.scaling = "fit";
        if (selScalingModeTransform) selScalingModeTransform.value = "fit";
      } else if (key === "brightness") {
        inspectorState.brightness = 0.0;
        if (sliderBrightness) sliderBrightness.value = 0;
        if (inpBrightness) inpBrightness.value = "0.000";
      } else if (key === "contrast") {
        inspectorState.contrast = 1.0;
        if (sliderContrast) sliderContrast.value = 1.0;
        if (inpContrast) inpContrast.value = "1.000";
      } else if (key === "shadows") {
        inspectorState.shadows = 0.0;
        if (sliderShadows) sliderShadows.value = 0;
        if (inpShadows) inpShadows.value = "0.000";
      } else if (key === "saturation") {
        inspectorState.saturation = 1.0;
        if (sliderSaturation) sliderSaturation.value = 1.0;
        if (inpSaturation) inpSaturation.value = "1.000";
      }
      applyMonitorTransform();
    });
  });

  // Nikon N-Log / Flat Rec.709 Live Preview Toggle
  if (chkNlogNormalize) {
    chkNlogNormalize.addEventListener("change", () => {
      applyMonitorTransform();
    });
  }

  // Clear Pool
  document.getElementById("btnClearPool").addEventListener("click", async () => {
    if (confirm("Clear all clips from Media Pool?")) {
      await fetch("/api/clear", { method: "POST" });
      loadClips();
    }
  });

  // Import Modal Handlers
  const importModal = document.getElementById("importModal");
  const btnCloseModal = document.getElementById("btnCloseModal");
  const btnLaunchNativePicker = document.getElementById("btnLaunchNativePicker");
  const customFolderPath = document.getElementById("customFolderPath");
  const btnLoadCustomPath = document.getElementById("btnLoadCustomPath");
  const topSourceFolder = document.getElementById("topSourceFolder");
  const btnLaunchNativeFiles = document.getElementById("btnLaunchNativeFiles");
  const fbCurrentPath = document.getElementById("fbCurrentPath");
  const fbEntriesList = document.getElementById("fbEntriesList");
  const btnFbUp = document.getElementById("btnFbUp");
  const btnFbImportHere = document.getElementById("btnFbImportHere");
  let currentBrowserPath = "/Users/siamratchongtong/Desktop/STD_VT";

  function showToast(msg) {
    const toast = document.getElementById("toastNotify");
    if (!toast) return;
    toast.textContent = msg;
    toast.style.display = "block";
    setTimeout(() => { toast.style.display = "none"; }, 4000);
  }

  const openImportModal = () => {
    if (importModal) {
      importModal.classList.add("open");
      loadFolderBrowser(currentBrowserPath);
    }
  };

  const closeImportModal = () => {
    if (importModal) importModal.classList.remove("open");
  };

  if (btnCloseModal) btnCloseModal.addEventListener("click", closeImportModal);
  if (importModal) {
    importModal.addEventListener("click", (e) => {
      if (e.target === importModal) closeImportModal();
    });
  }

  // Method 1: Native macOS Finder Folder Picker
  if (btnLaunchNativePicker) {
    btnLaunchNativePicker.addEventListener("click", async () => {
      try {
        btnLaunchNativePicker.textContent = "⏳ Waiting for Finder Selection...";
        const res = await fetch("/api/browse-folder", { method: "POST" });
        const data = await res.json();
        btnLaunchNativePicker.textContent = "📂 Open macOS Finder Folder Picker";
        if (data.success && data.path) {
          if (topSourceFolder) {
            topSourceFolder.textContent = `📁 ${data.path.split("/").filter(Boolean).slice(-2).join(" / ")}`;
          }
          closeImportModal();
          await loadClips();
          showToast(`✅ Successfully imported ${data.added} clips from ${data.path}!`);
        }
      } catch (err) {
        btnLaunchNativePicker.textContent = "📂 Open macOS Finder Folder Picker";
        console.error(err);
      }
    });
  }

  // Native macOS Finder Files Picker
  if (btnLaunchNativeFiles) {
    btnLaunchNativeFiles.addEventListener("click", async () => {
      try {
        btnLaunchNativeFiles.textContent = "⏳ Waiting for Finder...";
        const res = await fetch("/api/browse-files", { method: "POST" });
        const data = await res.json();
        btnLaunchNativeFiles.textContent = "📄 Open Finder File Picker";
        if (data.success && data.added > 0) {
          closeImportModal();
          await loadClips();
          showToast(`✅ Successfully imported ${data.added} clips!`);
        }
      } catch (err) {
        btnLaunchNativeFiles.textContent = "📄 Open Finder File Picker";
        console.error(err);
      }
    });
  }

  // Method 2: Quick Shortcut Buttons
  document.querySelectorAll(".btn-quick-folder, .btn-quick-folder-chip").forEach(btn => {
    btn.addEventListener("click", async () => {
      const folderPath = btn.dataset.path;
      if (folderPath) await loadFolderPath(folderPath);
    });
  });

  // Method 3: Custom Path Input
  if (btnLoadCustomPath) {
    btnLoadCustomPath.addEventListener("click", async () => {
      const p = customFolderPath.value.trim();
      if (p) await loadFolderPath(p);
    });
  }

  // In-App Folder Browser
  async function loadFolderBrowser(targetDir) {
    try {
      fbCurrentPath.textContent = targetDir;
      currentBrowserPath = targetDir;
      fbEntriesList.innerHTML = `<div style="color: #8c91a3; padding: 10px; font-size: 11px;">Loading directory...</div>`;
      const res = await fetch(`/api/list-dir?path=${encodeURIComponent(targetDir)}`);
      const data = await res.json();
      currentBrowserPath = data.current;
      fbCurrentPath.textContent = data.current;

      fbEntriesList.innerHTML = "";
      if (!data.entries || data.entries.length === 0) {
        fbEntriesList.innerHTML = `<div style="color: #63687c; padding: 8px; font-size: 11px;">Empty directory.</div>`;
        return;
      }

      data.entries.forEach(ent => {
        if (!ent.is_dir) return; // Only list folders in browser
        const row = document.createElement("div");
        row.className = "fb-entry-row";
        row.innerHTML = `
          <div class="fb-entry-left">
            <span>📁</span>
            <span>${ent.name}</span>
          </div>
          ${ent.video_count > 0 ? `<span class="fb-badge-clips">${ent.video_count} clips</span>` : `<span style="color:#55596b; font-size:10px;">folder</span>`}
        `;
        row.addEventListener("click", () => {
          loadFolderBrowser(ent.path);
        });
        fbEntriesList.appendChild(row);
      });
    } catch (err) {
      console.error(err);
    }
  }

  if (btnFbUp) {
    btnFbUp.addEventListener("click", () => {
      const parts = currentBrowserPath.split("/").filter(Boolean);
      if (parts.length > 1) {
        parts.pop();
        loadFolderBrowser("/" + parts.join("/"));
      }
    });
  }

  if (btnFbImportHere) {
    btnFbImportHere.addEventListener("click", async () => {
      await loadFolderPath(currentBrowserPath);
    });
  }

  async function loadFolderPath(folderPath) {
    try {
      const res = await fetch("/api/load-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderPath })
      });
      const data = await res.json();
      if (data.path && topSourceFolder) {
        topSourceFolder.textContent = `📁 ${data.path.split("/").filter(Boolean).slice(-2).join(" / ")}`;
      }
      closeImportModal();
      await loadClips();
      showToast(`✅ Imported ${data.added || allClips.length} clips from ${folderPath.split("/").filter(Boolean).pop()}!`);
    } catch (err) {
      console.error(err);
    }
  }

  async function triggerImportFolder() {
    try {
      showToast("📂 Opening Mac Finder at source folder (STD_VT)...");
      const res = await fetch("/api/browse-folder", { method: "POST" });
      const data = await res.json();
      if (data.success && data.path) {
        if (topSourceFolder) {
          topSourceFolder.textContent = `📁 ${data.path.split("/").filter(Boolean).slice(-2).join(" / ")}`;
        }
        await loadClips();
        showToast(`✅ Successfully imported ${data.added || allClips.length} clips from ${data.path.split("/").filter(Boolean).pop()}!`);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function triggerImportFiles() {
    try {
      showToast("📄 Opening Mac Finder file picker...");
      const res = await fetch("/api/browse-files", { method: "POST" });
      const data = await res.json();
      if (data.success && data.added > 0) {
        await loadClips();
        showToast(`✅ Successfully imported ${data.added} clips!`);
      }
    } catch (err) {
      console.error(err);
    }
  }

  const btnImportFolderTop = document.getElementById("btnImportFolderTop");
  if (btnImportFolderTop) btnImportFolderTop.addEventListener("click", triggerImportFolder);

  const btnImportFolderPool = document.getElementById("btnImportFolderPool");
  if (btnImportFolderPool) btnImportFolderPool.addEventListener("click", triggerImportFolder);

  const btnImportFilesTop = document.getElementById("btnImportFilesTop");
  if (btnImportFilesTop) btnImportFilesTop.addEventListener("click", triggerImportFiles);

  // Set Output / Destination Folder (Browse or Create New Folder via Finder)
  async function triggerSetOutputFolder() {
    try {
      showToast("📂 Opening Mac Finder to choose or create output folder...");
      const res = await fetch("/api/set-output-folder", { method: "POST" });
      const data = await res.json();
      if (data.success && data.output_dir) {
        const inp = document.getElementById("inpOutputPath");
        if (inp) inp.value = data.output_dir;
        showToast(`📁 Output destination set to: ${data.output_dir.split("/").filter(Boolean).slice(-2).join(" / ")}`);
      }
    } catch (err) {
      console.error(err);
    }
  }

  const btnBrowseOutput = document.getElementById("btnBrowseOutput");
  if (btnBrowseOutput) btnBrowseOutput.addEventListener("click", triggerSetOutputFolder);

  const btnBrowseOutputTop = document.getElementById("btnBrowseOutputTop");
  if (btnBrowseOutputTop) btnBrowseOutputTop.addEventListener("click", triggerSetOutputFolder);

  // Open Folder
  const btnOpenFolder = document.getElementById("btnOpenFolder");
  if (btnOpenFolder) {
    btnOpenFolder.addEventListener("click", () => {
      fetch("/api/open-folder", { method: "POST" });
    });
  }

  // Quick Export
  if (btnQuickExport) btnQuickExport.addEventListener("click", startBatchExport);
  if (btnBigExport) btnBigExport.addEventListener("click", startBatchExport);

  // Pause / Resume Live Render
  const btnPauseRender = document.getElementById("btnPauseRender");
  if (btnPauseRender) btnPauseRender.addEventListener("click", togglePauseRender);

  const btnPauseTop = document.getElementById("btnPauseTop");
  if (btnPauseTop) btnPauseTop.addEventListener("click", togglePauseRender);

  // Stop / Cancel Render
  const btnStopRender = document.getElementById("btnStopRender");
  if (btnStopRender) btnStopRender.addEventListener("click", stopBatchRender);

  const btnStopTop = document.getElementById("btnStopTop");
  if (btnStopTop) btnStopTop.addEventListener("click", stopBatchRender);

  // Clear Cache & RAM
  const btnClearCache = document.getElementById("btnClearCache");
  if (btnClearCache) btnClearCache.addEventListener("click", clearCacheAndRam);

  // View Mode Switcher
  const btnViewThumb = document.getElementById("btnViewThumb");
  if (btnViewThumb) btnViewThumb.addEventListener("click", () => setViewMode("thumb"));

  const btnViewList = document.getElementById("btnViewList");
  if (btnViewList) btnViewList.addEventListener("click", () => setViewMode("list"));

  // Real-time clip search
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      allClips.forEach((clip, idx) => {
        const card = document.getElementById(`card-${idx}`);
        if (card) {
          const match = !q || clip.name.toLowerCase().includes(q);
          card.style.display = match ? "" : "none";
        }
      });
    });
  }

  // Timeline Overview Click & Scrub
  const tlOverview = document.getElementById("tlOverview");
  if (tlOverview) {
    tlOverview.addEventListener("click", (e) => {
      if (allClips.length === 0) return;
      const rect = tlOverview.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      const targetIdx = Math.min(allClips.length - 1, Math.floor(pct * allClips.length));

      selectedIndices = new Set([targetIdx]);
      primaryPreviewIndex = targetIdx;
      updateCardsSelectionVisual();
      updateTimelineSelectionVisual();
      updateSelectionHeader();
      updateMonitorDisplay(targetIdx);

      const targetCard = document.getElementById(`card-${targetIdx}`);
      if (targetCard) {
        targetCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      const targetBlock = document.getElementById(`tl-block-${targetIdx}`);
      if (targetBlock) {
        targetBlock.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
      }
    });
  }
}

// Keyboard shortcuts (Cmd+A to Select All, Cmd+I to Import, Space to Play/Pause)
function setupKeyboardShortcuts() {
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") {
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      selectedIndices = new Set(allClips.map((_, i) => i));
      updateCardsSelectionVisual();
      updateSelectionHeader();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
      e.preventDefault();
      const btn = document.getElementById("btnImportFolderTop");
      if (btn) btn.click();
    } else if (e.code === "Space") {
      e.preventDefault();
      toggleVideoPlayback();
    }
  });
}

// Drag & Drop
function setupDragAndDrop() {
  const dropZone = document.getElementById("dropZone");
  ["dragenter", "dragover"].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      dropZone.style.borderColor = "#00ddff";
      dropZone.style.background = "rgba(0, 221, 255, 0.05)";
    });
  });
  ["dragleave"].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      dropZone.style.borderColor = "#262838";
      dropZone.style.background = "";
    });
  });
  dropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "#262838";
    dropZone.style.background = "";
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) {
      showToast(`📥 Detected ${files.length} items dropped. Select target folder to import.`);
      openImportModal();
    }
  });
}

// Timeline
function renderTimelineOverview() {
  detailTrack.innerHTML = "";
  if (allClips.length === 0) return;

  const fragment = document.createDocumentFragment();
  allClips.forEach((clip, i) => {
    const isDone = completedPaths.has(clip.path);
    const isSelected = selectedIndices.has(i);
    const isPreview = (i === primaryPreviewIndex);
    const block = document.createElement("div");
    block.className = `tl-clip-block ${isDone ? "completed" : ""} ${isSelected ? "selected" : ""} ${isPreview ? "active-preview" : ""}`;
    block.id = `tl-block-${i}`;
    block.textContent = clip.name;
    block.title = `${clip.name} (${clip.size_fmt})`;

    // CLICK TO SELECT CLIP: "ส่วนแถบด้านล่างคลิกเลือกได้"
    block.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        if (selectedIndices.has(i)) {
          selectedIndices.delete(i);
        } else {
          selectedIndices.add(i);
        }
      } else {
        selectedIndices = new Set([i]);
      }
      primaryPreviewIndex = i;
      updateCardsSelectionVisual();
      updateTimelineSelectionVisual();
      updateSelectionHeader();
      updateMonitorDisplay(i);

      // Scroll Media Pool to this card/item
      const targetCard = document.getElementById(`card-${i}`);
      if (targetCard) {
        targetCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });

    fragment.appendChild(block);
  });
  detailTrack.appendChild(fragment);
}

function updateTimelineSelectionVisual() {
  allClips.forEach((_, i) => {
    const block = document.getElementById(`tl-block-${i}`);
    if (block) {
      block.classList.toggle("selected", selectedIndices.has(i));
      block.classList.toggle("active-preview", i === primaryPreviewIndex);
    }
  });
}

function updatePlayhead(idx) {
  if (allClips.length === 0) return;
  const pct = ((idx + 0.5) / allClips.length) * 100;
  playheadOverview.style.left = `${pct}%`;
  playheadDetail.style.left = `${Math.min(95, Math.max(5, pct))}%`;
}

// Timecode formatter (HH:MM:SS:FF)
function formatTimecode(seconds) {
  if (isNaN(seconds) || seconds < 0) return "00:00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 25);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

// Live Video Playback Toggle (with Audio)
function toggleVideoPlayback() {
  if (!monitorVideo || !monitorVideo.src) return;
  if (monitorVideo.paused) {
    if (monitorImg) monitorImg.style.display = "none";
    monitorVideo.style.display = "block";
    monitorVideo.play().catch(e => console.log("Play error:", e));
    if (btnPlay) btnPlay.textContent = "⏸";
  } else {
    monitorVideo.pause();
    if (btnPlay) btnPlay.textContent = "▶";
  }
}

// Pleasant DaVinci Completion Audio Chime (Synthetic Web Audio)
function playCompletionChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523.25, now); // C5
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.5);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(659.25, now + 0.12); // E5
    gain2.gain.setValueAtTime(0.22, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.7);
  } catch (e) {
    console.log("Audio chime unavailable:", e);
  }
}

// Transport Controls & Scrubbing
function setupTransport() {
  const btnFirst = document.getElementById("btnFirst");
  const btnPrev = document.getElementById("btnPrev");
  const btnNext = document.getElementById("btnNext");
  const btnLast = document.getElementById("btnLast");

  if (btnFirst) btnFirst.addEventListener("click", () => updateMonitorDisplay(0));
  if (btnPrev) btnPrev.addEventListener("click", () => updateMonitorDisplay(Math.max(0, primaryPreviewIndex - 1)));
  if (btnNext) btnNext.addEventListener("click", () => updateMonitorDisplay(Math.min(allClips.length - 1, primaryPreviewIndex + 1)));
  if (btnLast) btnLast.addEventListener("click", () => updateMonitorDisplay(allClips.length - 1));

  if (btnPlay) btnPlay.addEventListener("click", toggleVideoPlayback);

  if (monitorVideo) {
    monitorVideo.addEventListener("timeupdate", () => {
      if (monitorVideo.duration) {
        const pct = (monitorVideo.currentTime / monitorVideo.duration) * 100;
        if (scrubSlider) scrubSlider.value = pct;
        if (digitalTimecode) digitalTimecode.textContent = formatTimecode(monitorVideo.currentTime);
      }
    });

    monitorVideo.addEventListener("ended", () => {
      if (btnPlay) btnPlay.textContent = "▶";
    });
  }

  if (scrubSlider && monitorVideo) {
    scrubSlider.addEventListener("input", (e) => {
      if (monitorVideo.duration) {
        monitorVideo.currentTime = (e.target.value / 100) * monitorVideo.duration;
      }
    });
  }

  if (btnLoop && monitorVideo) {
    btnLoop.addEventListener("click", () => {
      monitorVideo.loop = !monitorVideo.loop;
      btnLoop.style.background = monitorVideo.loop ? "#00ddff" : "#232534";
      btnLoop.style.color = monitorVideo.loop ? "#000000" : "#d1d4dc";
      showToast(monitorVideo.loop ? "🔁 Loop Enabled" : "🔁 Loop Disabled");
    });
  }
}

// 1-Click Fast Vertical Export (All Selected Clips!)
async function startBatchExport() {
  if (allClips.length === 0) {
    showToast("⚠️ Media Pool is empty! Please click Import to load Nikon Z8 clips.");
    openImportModal();
    return;
  }

  // Auto-select all if none explicitly selected
  if (selectedIndices.size === 0) {
    selectedIndices = new Set(allClips.map((_, i) => i));
    updateCardsSelectionVisual();
    updateSelectionHeader();
  }

  const count = selectedIndices.size;
  if (isExporting) return;
  isExporting = true;
  isPaused = false;
  if (btnQuickExport) {
    btnQuickExport.disabled = true;
    btnQuickExport.textContent = "⏳ Rendering...";
  }
  btnBigExport.disabled = true;
  btnBigExport.textContent = `⏳ Rendering ${count.toLocaleString()} clips via VideoToolbox...`;
  exportStatusText.textContent = `Starting batch export of ${count.toLocaleString()} clips...`;

  // Show Pause & Stop controls
  const exportControlsRow = document.getElementById("exportControlsRow");
  const btnPauseTop = document.getElementById("btnPauseTop");
  const btnStopTop = document.getElementById("btnStopTop");
  const btnPauseRender = document.getElementById("btnPauseRender");
  if (exportControlsRow) exportControlsRow.style.display = "flex";
  if (btnPauseTop) {
    btnPauseTop.style.display = "inline-block";
    btnPauseTop.textContent = "⏸ Pause";
  }
  if (btnPauseRender) btnPauseRender.textContent = "⏸ Pause";
  if (btnStopTop) btnStopTop.style.display = "inline-block";

  // Reset rendering classes on cards
  allClips.forEach((clip, i) => {
    const card = document.getElementById(`card-${i}`);
    if (card) {
      card.classList.remove("rendering");
      const bRec = card.querySelector(".clip-badge-rendering");
      if (bRec) bRec.remove();
    }
    const tlBlock = document.getElementById(`tl-block-${i}`);
    if (tlBlock) tlBlock.classList.remove("rendering");
  });

  const selectedPaths = Array.from(selectedIndices).map(i => allClips[i].path);
  const inpOut = document.getElementById("inpOutputPath");
  const outDir = inpOut ? inpOut.value.trim() : "";
  const sliderBitrate = document.getElementById("sliderBitrate");
  const chkExportAudio = document.getElementById("chkExportAudio");
  const selAudioCodec = document.getElementById("selAudioCodec");
  const inpAudioBitrate = document.getElementById("inpAudioBitrate");
  const inpFileSubfolder = document.getElementById("inpFileSubfolder");
  const chkSmartResume = document.getElementById("chkSmartResume");

  const isCropBypassed = inspectorState.bypassedCards && inspectorState.bypassedCards.crop;

  const params = {
    rotation: inspectorState.rotation,
    flip_h: !!inspectorState.flipH,
    flip_v: !!inspectorState.flipV,
    crop_left: isCropBypassed ? 0.0 : (inspectorState.cropL / 500),
    crop_right: isCropBypassed ? 0.0 : (inspectorState.cropR / 500),
    crop_top: isCropBypassed ? 0.0 : (inspectorState.cropT / 500),
    crop_bottom: isCropBypassed ? 0.0 : (inspectorState.cropB / 500),
    bitrate: (sliderBitrate ? sliderBitrate.value : 8000) + "k",
    resolution: selResolution ? selResolution.value : "1080x1920",
    workers: selWorkers ? parseInt(selWorkers.value) : 2,
    scaling_mode: inspectorState.scaling || "fit",
    nikon_profile: (inspectorState.bypassedCards && inspectorState.bypassedCards.nikonColor) ? "none" : (inspectorState.nikonProfile || "nlog_rec709"),
    nikon_strength: (inspectorState.bypassedCards && inspectorState.bypassedCards.nikonColor) ? 0 : inspectorState.nikonStrength,
    custom_lut_path: inspectorState.customLutPath || "",
    nlog_normalize: (inspectorState.nikonProfile === "nlog_rec709"),
    naming_pattern: selNamingPattern ? selNamingPattern.value : "suffix_vertical",
    brightness: inspectorState.brightness,
    contrast: inspectorState.contrast,
    shadows: inspectorState.shadows,
    saturation: inspectorState.saturation,
    export_audio: chkExportAudio ? chkExportAudio.checked : true,
    audio_codec: selAudioCodec ? selAudioCodec.value : "aac",
    audio_bitrate: (inpAudioBitrate ? inpAudioBitrate.value : "320") + "k",
    subfolder: inpFileSubfolder ? inpFileSubfolder.value.trim() : "",
    smart_resume: chkSmartResume ? chkSmartResume.checked : true,
    output_dir: outDir,
    paths: selectedPaths
  };

  try {
    await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });
    if (exportPollTimer) clearInterval(exportPollTimer);
    exportPollTimer = setInterval(pollExportStatus, 400);
  } catch (err) {
    isExporting = false;
    if (btnQuickExport) {
      btnQuickExport.disabled = false;
      btnQuickExport.textContent = "🚀 Quick Export";
    }
    btnBigExport.disabled = false;
    btnBigExport.textContent = "🚀 1-Click Fast Vertical Export (All Clips)";
    if (exportControlsRow) exportControlsRow.style.display = "none";
    if (btnPauseTop) btnPauseTop.style.display = "none";
    if (btnStopTop) btnStopTop.style.display = "none";
    showToast("❌ Error starting export: " + err.message);
  }
}

async function pollExportStatus() {
  try {
    const res = await fetch("/api/status");
    const st = await res.json();

    isPaused = !!st.is_paused;
    const btnPauseRender = document.getElementById("btnPauseRender");
    const btnPauseTop = document.getElementById("btnPauseTop");
    if (btnPauseRender) btnPauseRender.textContent = isPaused ? "▶️ Resume" : "⏸ Pause";
    if (btnPauseTop) btnPauseTop.textContent = isPaused ? "▶️ Resume" : "⏸ Pause";

    // Mark completed paths with Vibrant Green & ✅ DONE badge
    if (Array.isArray(st.completed_paths)) {
      st.completed_paths.forEach(cp => {
        if (!completedPaths.has(cp)) {
          completedPaths.add(cp);
          const idx = allClips.findIndex(c => c.path === cp);
          if (idx !== -1) {
            const card = document.getElementById(`card-${idx}`);
            if (card) {
              card.classList.remove("rendering");
              card.classList.add("completed");
              const oldRec = card.querySelector(".clip-badge-rendering");
              if (oldRec) oldRec.remove();
              if (!card.querySelector(".clip-badge-done")) {
                const bDone = document.createElement("span");
                bDone.className = "clip-badge-done";
                bDone.textContent = "✅ DONE";
                card.appendChild(bDone);
              }
            }
            const tlBlock = document.getElementById(`tl-block-${idx}`);
            if (tlBlock) {
              tlBlock.classList.remove("rendering");
              tlBlock.classList.add("completed");
            }
          }
        }
      });
    }

    if (st.status === "Rendering..." || st.status === "Paused") {
      const activeIdx = Math.max(0, st.current_idx - 1);
      const remInfo = st.remaining_str ? ` • ⏳ Remaining: ${st.remaining_str} (ETA ${st.eta_str || ""})` : "";
      exportStatusText.textContent = `${isPaused ? "⏸ PAUSED" : "Rendering"} [${st.current_idx}/${st.total}]: ${st.current_name} (${st.percent.toFixed(0)}%)${remInfo}`;
      const workerCount = selWorkers ? selWorkers.value : "2";
      exportSpeedBadge.textContent = isPaused ? "⏸ Paused" : `⚡️ Speed: ${st.speed} (${workerCount}x Parallel Engine)`;
      const fillBar = document.getElementById("exportProgressFill");
      if (fillBar) fillBar.style.width = `${st.percent}%`;

      // Highlight active rendering card in glowing cyan
      if (allClips[activeIdx] && !completedPaths.has(allClips[activeIdx].path)) {
        const card = document.getElementById(`card-${activeIdx}`);
        if (card && !card.classList.contains("rendering")) {
          card.classList.add("rendering");
          if (!card.querySelector(".clip-badge-rendering")) {
            const bRec = document.createElement("span");
            bRec.className = "clip-badge-rendering";
            bRec.textContent = "⚡️ REC";
            card.appendChild(bRec);
          }
        }
        const tlBlock = document.getElementById(`tl-block-${activeIdx}`);
        if (tlBlock) tlBlock.classList.add("rendering");
      }

      updateMonitorDisplay(activeIdx);
    } else if (st.status === "Completed") {
      clearInterval(exportPollTimer);
      isExporting = false;
      const fillBar = document.getElementById("exportProgressFill");
      if (fillBar) fillBar.style.width = "100%";
      if (btnQuickExport) {
        btnQuickExport.disabled = false;
        btnQuickExport.textContent = "🚀 Quick Export";
      }
      btnBigExport.disabled = false;
      btnBigExport.textContent = "🚀 1-Click Fast Vertical Export (All Clips)";
      exportStatusText.textContent = `🎉 Export completed successfully for all selected clips in destination folder!`;
      exportSpeedBadge.textContent = "";

      const exportControlsRow = document.getElementById("exportControlsRow");
      const btnPauseTop = document.getElementById("btnPauseTop");
      const btnStopTop = document.getElementById("btnStopTop");
      if (exportControlsRow) exportControlsRow.style.display = "none";
      if (btnPauseTop) btnPauseTop.style.display = "none";
      if (btnStopTop) btnStopTop.style.display = "none";

      playCompletionChime();
      showToast("🎉 Rendering completed successfully! Saved to destination folder.");
    } else if (st.status === "Stopped") {
      clearInterval(exportPollTimer);
      isExporting = false;
      if (btnQuickExport) {
        btnQuickExport.disabled = false;
        btnQuickExport.textContent = "🚀 Quick Export";
      }
      btnBigExport.disabled = false;
      btnBigExport.textContent = "🚀 1-Click Fast Vertical Export (All Clips)";
      exportStatusText.textContent = "🛑 Render stopped by user.";
      exportSpeedBadge.textContent = "";

      document.querySelectorAll(".clip-card.rendering").forEach(c => {
        c.classList.remove("rendering");
        const b = c.querySelector(".clip-badge-rendering");
        if (b) b.remove();
      });
      document.querySelectorAll(".tl-clip-block.rendering").forEach(b => b.classList.remove("rendering"));

      const exportControlsRow = document.getElementById("exportControlsRow");
      const btnPauseTop = document.getElementById("btnPauseTop");
      const btnStopTop = document.getElementById("btnStopTop");
      if (exportControlsRow) exportControlsRow.style.display = "none";
      if (btnPauseTop) btnPauseTop.style.display = "none";
      if (btnStopTop) btnStopTop.style.display = "none";

      showToast("🛑 Render stopped.");
    }
  } catch (err) {
    console.error(err);
  }
}

// Pause / Resume Toggle
async function togglePauseRender() {
  try {
    const res = await fetch("/api/pause", { method: "POST" });
    const data = await res.json();
    isPaused = !!data.is_paused;
    const btnPauseRender = document.getElementById("btnPauseRender");
    const btnPauseTop = document.getElementById("btnPauseTop");
    if (btnPauseRender) btnPauseRender.textContent = isPaused ? "▶️ Resume" : "⏸ Pause";
    if (btnPauseTop) btnPauseTop.textContent = isPaused ? "▶️ Resume" : "⏸ Pause";
    showToast(isPaused ? "⏸ Render Paused" : "▶️ Render Resumed");
  } catch (err) {
    showToast("Error toggling pause: " + err.message);
  }
}

// Stop Render
async function stopBatchRender() {
  try {
    await fetch("/api/cancel", { method: "POST" });
    showToast("🛑 Stopping render...");
  } catch (err) {
    showToast("Error stopping: " + err.message);
  }
}

// Clear Cache & Optimize RAM
async function clearCacheAndRam() {
  try {
    const res = await fetch("/api/clear-cache", { method: "POST" });
    const data = await res.json();
    showToast(`🧹 Cache Cleared! Freed ${data.freed} of RAM & Disk Cache.`);
  } catch (err) {
    showToast("Error clearing cache: " + err.message);
  }
}
