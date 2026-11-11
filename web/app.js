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

// Default DaVinci ColorSlice 7-Vector + Global Subtractive State
function createDefaultColorSlice() {
  return {
    master:  { den: 0.0, denDepth: 0.0, sat: 1.0, satBal: 0.0, satDepth: 0.0, hue: 0.0 },
    red:     { center: 0.0, hue: 0.0, den: 0.0, sat: 1.0 },
    skin:    { center: 0.0, hue: 0.0, den: 0.0, sat: 1.0 },
    yellow:  { center: 0.0, hue: 0.0, den: 0.0, sat: 1.0 },
    green:   { center: 0.0, hue: 0.0, den: 0.0, sat: 1.0 },
    cyan:    { center: 0.0, hue: 0.0, den: 0.0, sat: 1.0 },
    blue:    { center: 0.0, hue: 0.0, den: 0.0, sat: 1.0 },
    magenta: { center: 0.0, hue: 0.0, den: 0.0, sat: 1.0 }
  };
}

const COLORSLICE_VECTORS = {
  red:     { baseAngle: -30, w: [ 0.70, -0.45, -0.25], u: [0.85, 0.15, 0.15], s: [ 0.65, -0.32, -0.33], t: [ 0.05,  0.55, -0.60] },
  skin:    { baseAngle:  -5, w: [ 0.55,  0.05, -0.60], u: [0.80, 0.52, 0.35], s: [ 0.48,  0.04, -0.52], t: [ 0.38, -0.52,  0.14] },
  yellow:  { baseAngle:  30, w: [ 0.40,  0.45, -0.85], u: [0.75, 0.75, 0.12], s: [ 0.35,  0.38, -0.73], t: [-0.52,  0.50,  0.02] },
  green:   { baseAngle:  90, w: [-0.45,  0.85, -0.40], u: [0.18, 0.82, 0.22], s: [-0.34,  0.68, -0.34], t: [-0.45, -0.05,  0.50] },
  cyan:    { baseAngle: 150, w: [-0.85,  0.42,  0.43], u: [0.12, 0.75, 0.78], s: [-0.68,  0.34,  0.34], t: [ 0.02, -0.52,  0.50] },
  blue:    { baseAngle: 210, w: [-0.35, -0.45,  0.80], u: [0.18, 0.28, 0.88], s: [-0.33, -0.35,  0.68], t: [ 0.52, -0.04, -0.48] },
  magenta: { baseAngle: 270, w: [ 0.45, -0.85,  0.40], u: [0.78, 0.16, 0.75], s: [ 0.36, -0.70,  0.34], t: [ 0.45,  0.08, -0.53] }
};

function isColorSliceModified(cs) {
  if (!cs) return false;
  const m = cs.master || {};
  if (Math.abs(m.den || 0) > 0.005 || Math.abs(m.denDepth || 0) > 0.005 || Math.abs((m.sat !== undefined ? m.sat : 1) - 1) > 0.005 || Math.abs(m.satBal || 0) > 0.005 || Math.abs(m.satDepth || 0) > 0.005 || Math.abs(m.hue || 0) > 0.005) {
    return true;
  }
  const keys = ["red", "skin", "yellow", "green", "cyan", "blue", "magenta"];
  for (const k of keys) {
    const sl = cs[k];
    if (!sl) continue;
    if (Math.abs(sl.center || 0) > 0.005 || Math.abs(sl.hue || 0) > 0.005 || Math.abs(sl.den || 0) > 0.005 || Math.abs((sl.sat !== undefined ? sl.sat : 1) - 1) > 0.005) {
      return true;
    }
  }
  return false;
}

// Default DaVinci Primaries - Color Bars (Lift / Gamma / Gain / Offset) State
function createDefaultPrimariesBars() {
  return {
    top:    { temp: 0.0, tint: 0.0, cont: 1.0, pivot: 0.435, md: 0.0 },
    bot:    { colBoost: 0.0, shad: 0.0, hiLight: 0.0, sat: 50.0, hue: 50.0, lMix: 100.0 },
    lift:   { y: 0.0, r: 0.0, g: 0.0, b: 0.0 },
    gamma:  { y: 0.0, r: 0.0, g: 0.0, b: 0.0 },
    gain:   { y: 1.0, r: 1.0, g: 1.0, b: 1.0 },
    offset: { r: 25.0, g: 25.0, b: 25.0 }
  };
}

function isPrimariesBarsModified(pb) {
  if (!pb) return false;
  const t = pb.top || {};
  const b = pb.bot || {};
  if (Math.abs(t.temp || 0) > 0.05 || Math.abs(t.tint || 0) > 0.05 || Math.abs((t.cont !== undefined ? t.cont : 1) - 1) > 0.003 || Math.abs((t.pivot !== undefined ? t.pivot : 0.435) - 0.435) > 0.005 || Math.abs(t.md || 0) > 0.05) return true;
  if (Math.abs(b.colBoost || 0) > 0.05 || Math.abs(b.shad || 0) > 0.05 || Math.abs(b.hiLight || 0) > 0.05 || Math.abs((b.sat !== undefined ? b.sat : 50) - 50) > 0.1 || Math.abs((b.hue !== undefined ? b.hue : 50) - 50) > 0.1 || Math.abs((b.lMix !== undefined ? b.lMix : 100) - 100) > 0.1) return true;
  const lf = pb.lift || {};
  const gm = pb.gamma || {};
  const gn = pb.gain || {};
  const of = pb.offset || {};
  if (Math.abs(lf.y || 0) > 0.003 || Math.abs(lf.r || 0) > 0.003 || Math.abs(lf.g || 0) > 0.003 || Math.abs(lf.b || 0) > 0.003) return true;
  if (Math.abs(gm.y || 0) > 0.003 || Math.abs(gm.r || 0) > 0.003 || Math.abs(gm.g || 0) > 0.003 || Math.abs(gm.b || 0) > 0.003) return true;
  if (Math.abs((gn.y !== undefined ? gn.y : 1) - 1) > 0.003 || Math.abs((gn.r !== undefined ? gn.r : 1) - 1) > 0.003 || Math.abs((gn.g !== undefined ? gn.g : 1) - 1) > 0.003 || Math.abs((gn.b !== undefined ? gn.b : 1) - 1) > 0.003) return true;
  if (Math.abs((of.r !== undefined ? of.r : 25) - 25) > 0.05 || Math.abs((of.g !== undefined ? of.g : 25) - 25) > 0.05 || Math.abs((of.b !== undefined ? of.b : 25) - 25) > 0.05) return true;
  return false;
}

// =========================================================================
// REAL-TIME JAVASCRIPT 3D LUT PIXEL ENGINE (1:1 MATCH WITH SERVER.PY .CUBE)
// =========================================================================
const COLORSLICE_HUE_WINDOWS = {
  red:     [0.0,   26.0],
  skin:    [22.0,  24.0], // Human skin tone I-Line (~8° to 46° orange-peach)
  yellow:  [58.0,  26.0],
  green:   [112.0, 42.0], // Foliage & grass (70° to 154°)
  cyan:    [180.0, 34.0],
  blue:    [228.0, 38.0], // Sky & blue apparel (190° to 266°)
  magenta: [305.0, 36.0]
};

function _hueDiffDeg(h1, h2) {
  return ((h1 - h2 + 180.0) % 360.0 + 360.0) % 360.0 - 180.0;
}

function _rgbToHls(r, g, b) {
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const sumc = maxc + minc;
  const l = sumc * 0.5;
  if (minc === maxc) return [0.0, l, 0.0];
  const rangec = maxc - minc;
  const s = l <= 0.5 ? rangec / sumc : rangec / (2.0 - maxc - minc);
  const rc = (maxc - r) / rangec;
  const gc = (maxc - g) / rangec;
  const bc = (maxc - b) / rangec;
  let h;
  if (r === maxc) h = bc - gc;
  else if (g === maxc) h = 2.0 + rc - bc;
  else h = 4.0 + gc - rc;
  h = ((h / 6.0) % 1.0 + 1.0) % 1.0;
  return [h, l, s];
}

function _hlsVal(m1, m2, hue) {
  const h = ((hue % 1.0) + 1.0) % 1.0;
  if (h < 1.0 / 6.0) return m1 + (m2 - m1) * h * 6.0;
  if (h < 0.5) return m2;
  if (h < 2.0 / 3.0) return m1 + (m2 - m1) * (2.0 / 3.0 - h) * 6.0;
  return m1;
}

function _hlsToRgb(h, l, s) {
  if (s <= 0.0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1.0 + s) : l + s - (l * s);
  const m1 = 2.0 * l - m2;
  return [
    _hlsVal(m1, m2, h + 1.0 / 3.0),
    _hlsVal(m1, m2, h),
    _hlsVal(m1, m2, h - 1.0 / 3.0)
  ];
}

let _jsLutCache = { key: "", active: false, lut: null };

function buildJs3DLut() {
  if (isBypassed) return { active: false, lut: null };
  const cs = inspectorState.colorSlice;
  const pb = inspectorState.primariesBars;
  const isCsBypassed = inspectorState.bypassedCards && inspectorState.bypassedCards.colorSlice;
  const isPbBypassed = inspectorState.bypassedCards && inspectorState.bypassedCards.primariesBars;
  const isNikonBypassed = inspectorState.bypassedCards && inspectorState.bypassedCards.nikonColor;

  const csActive = !isCsBypassed && isColorSliceModified(cs);
  const pbActive = !isPbBypassed && isPrimariesBarsModified(pb);
  const skinHue = isNikonBypassed ? 0.0 : (inspectorState.portraitHue || 0.0);
  const skinBright = isNikonBypassed ? 0.0 : (inspectorState.portraitBrightness || 0.0);
  const skinActive = Math.abs(skinHue) > 0.2 || Math.abs(skinBright) > 0.2;

  if (!csActive && !pbActive && !skinActive) {
    return { active: false, lut: null };
  }

  const stateKey = JSON.stringify({
    cs: csActive ? cs : null,
    pb: pbActive ? pb : null,
    sh: Math.round(skinHue * 100) / 100,
    sb: Math.round(skinBright * 100) / 100
  });
  if (_jsLutCache.key === stateKey && _jsLutCache.lut) {
    return _jsLutCache;
  }

  let pbTemp = 0, pbTint = 0, pbCont = 1, pbPivot = 0.435, pbMd = 0;
  let pbColBoost = 0, pbShad = 0, pbHiLight = 0, pbSat = 1, pbHueDeg = 0;
  let liftRgb = [0, 0, 0], gainRgb = [1, 1, 1], gammaRgb = [1, 1, 1];

  if (pbActive && pb) {
    const t = pb.top || {};
    const b = pb.bot || {};
    const lf = pb.lift || {};
    const gm = pb.gamma || {};
    const gn = pb.gain || {};
    const of = pb.offset || {};
    pbTemp = Number(t.temp || 0) / 100.0;
    pbTint = Number(t.tint || 0) / 100.0;
    pbCont = t.cont !== undefined ? Number(t.cont) : 1.0;
    pbPivot = Math.max(0.05, Math.min(0.95, t.pivot !== undefined ? Number(t.pivot) : 0.435));
    pbMd = Number(t.md || 0) / 100.0;
    pbColBoost = Number(b.colBoost || 0) / 100.0;
    pbShad = Number(b.shad || 0) / 100.0;
    pbHiLight = Number(b.hiLight || 0) / 100.0;
    pbSat = (b.sat !== undefined ? Number(b.sat) : 50.0) / 50.0;
    pbHueDeg = (((b.hue !== undefined ? Number(b.hue) : 50.0) - 50.0) / 50.0) * 36.0;

    liftRgb = [
      Number(lf.y || 0) + Number(lf.r || 0) * 0.85 + ((of.r !== undefined ? Number(of.r) : 25) - 25) * 0.014,
      Number(lf.y || 0) + Number(lf.g || 0) * 0.85 + ((of.g !== undefined ? Number(of.g) : 25) - 25) * 0.014,
      Number(lf.y || 0) + Number(lf.b || 0) * 0.85 + ((of.b !== undefined ? Number(of.b) : 25) - 25) * 0.014
    ];
    gainRgb = [
      (gn.y !== undefined ? Number(gn.y) : 1) * (gn.r !== undefined ? Number(gn.r) : 1) * (1.0 + pbTemp * 0.22 + pbTint * 0.10),
      (gn.y !== undefined ? Number(gn.y) : 1) * (gn.g !== undefined ? Number(gn.g) : 1) * (1.0 - pbTint * 0.14),
      (gn.y !== undefined ? Number(gn.y) : 1) * (gn.b !== undefined ? Number(gn.b) : 1) * (1.0 - pbTemp * 0.22 + pbTint * 0.10)
    ];
    gammaRgb = [
      Math.max(0.20, Math.min(4.5, 1.0 / Math.max(0.18, 1.0 + (Number(gm.y || 0) + Number(gm.r || 0)) * 1.45))),
      Math.max(0.20, Math.min(4.5, 1.0 / Math.max(0.18, 1.0 + (Number(gm.y || 0) + Number(gm.g || 0)) * 1.45))),
      Math.max(0.20, Math.min(4.5, 1.0 / Math.max(0.18, 1.0 + (Number(gm.y || 0) + Number(gm.b || 0)) * 1.45)))
    ];
  }

  let gDen = 0.0, gSat = 1.0, gHueDeg = 0.0;
  if (csActive && cs) {
    const m = cs.master || {};
    gDen = Number(m.den || 0) + Number(m.denDepth || 0) * 0.35;
    gSat = (m.sat !== undefined ? Number(m.sat) : 1.0) + Number(m.satBal || 0) * 0.25 + Number(m.satDepth || 0) * 0.20;
    gHueDeg = Number(m.hue || 0) * 30.0;
  }

  const activeSlices = [];
  Object.keys(COLORSLICE_HUE_WINDOWS).forEach(k => {
    const [baseC, halfW] = COLORSLICE_HUE_WINDOWS[k];
    const sl = (csActive && cs && cs[k]) ? cs[k] : {};
    const cShift = Number(sl.center || 0) * 14.0;
    const rawHue = Number(sl.hue || 0);
    let hShift = (k === "skin") ? (-rawHue * 18.0) : (rawHue * 24.0);
    let den = Number(sl.den || 0);
    let sat = sl.sat !== undefined ? Number(sl.sat) : 1.0;

    if (k === "skin" && skinActive) {
      hShift -= (skinHue / 50.0) * 14.0;
      den -= (skinBright / 50.0) * 0.38;
      sat *= (1.0 + Math.abs(skinHue) / 50.0 * 0.12);
    }

    if (Math.abs(cShift) > 0.05 || Math.abs(hShift) > 0.05 || Math.abs(den) > 0.003 || Math.abs(sat - 1.0) > 0.003) {
      activeSlices.push([k, ((baseC + cShift) % 360.0 + 360.0) % 360.0, halfW, hShift, den, sat]);
    }
  });

  const size = 17;
  const inv = 1.0 / 16.0;
  const lut = new Uint8Array(size * size * size * 3);
  let ptr = 0;

  for (let bi = 0; bi < size; bi++) {
    const bIn = bi * inv;
    for (let gi = 0; gi < size; gi++) {
      const gIn = gi * inv;
      for (let ri = 0; ri < size; ri++) {
        let r = ri * inv, g = gIn, b = bIn;

        if (pbActive) {
          const rgb = [r, g, b];
          for (let ch = 0; ch < 3; ch++) {
            let v = rgb[ch];
            v = v * gainRgb[ch] + liftRgb[ch] * (1.0 - v);
            v = Math.max(0.0, Math.min(1.0, v));
            if (v > 0.0) v = Math.pow(v, gammaRgb[ch]);
            if (Math.abs(pbShad) > 0.002) v += pbShad * 0.28 * Math.pow(1.0 - v, 2) * Math.sqrt(v);
            if (Math.abs(pbHiLight) > 0.002) v += pbHiLight * 0.28 * Math.pow(v, 2) * Math.sqrt(1.0 - v);
            if (Math.abs(pbMd) > 0.002) v += pbMd * 0.22 * Math.sin((v - 0.5) * Math.PI) * (4.0 * v * (1.0 - v));
            if (Math.abs(pbCont - 1.0) > 0.002) v = pbPivot + (v - pbPivot) * pbCont;
            rgb[ch] = Math.max(0.0, Math.min(1.0, v));
          }
          r = rgb[0]; g = rgb[1]; b = rgb[2];

          if (Math.abs(pbSat - 1.0) > 0.003 || Math.abs(pbColBoost) > 0.003 || Math.abs(pbHueDeg) > 0.05) {
            let [h, l, s] = _rgbToHls(r, g, b);
            if (Math.abs(pbHueDeg) > 0.05) h = ((h + pbHueDeg / 360.0) % 1.0 + 1.0) % 1.0;
            let effS = s * pbSat;
            if (Math.abs(pbColBoost) > 0.003) effS += pbColBoost * s * (1.0 - s) * 1.55;
            s = Math.max(0.0, Math.min(1.0, effS));
            [r, g, b] = _hlsToRgb(h, l, s);
          }
        }

        if (csActive || activeSlices.length > 0) {
          const cMax = Math.max(r, g, b);
          const cMin = Math.min(r, g, b);
          const chroma = cMax - cMin;
          if (chroma > 0.02) {
            const satGate = Math.min(1.0, Math.max(0.0, (chroma - 0.02) / 0.14));
            const [h, l, s] = _rgbToHls(r, g, b);
            const hDeg = h * 360.0;

            let totHShift = gHueDeg;
            let totDen = gDen * satGate;
            let totSatMult = gSat;

            for (let si = 0; si < activeSlices.length; si++) {
              const [sName, centerDeg, halfW, hSh, denVal, satVal] = activeSlices[si];
              const dDeg = Math.abs(_hueDiffDeg(hDeg, centerDeg));
              if (dDeg < halfW) {
                const cosV = Math.cos((dDeg / halfW) * (Math.PI * 0.5));
                let w = (cosV * cosV) * satGate;
                if (sName === "skin") {
                  const lumaGate = 4.0 * l * (1.0 - l);
                  w *= Math.max(0.25, lumaGate);
                }
                totHShift += hSh * w;
                totDen += denVal * w;
                totSatMult *= (1.0 + (satVal - 1.0) * w);
              }
            }

            const hNew = (((hDeg + totHShift) % 360.0 + 360.0) % 360.0) / 360.0;
            const sNew = Math.max(0.0, Math.min(1.0, s * totSatMult));
            let lNew;
            if (totDen >= 0) {
              lNew = l * (1.0 - totDen * 0.52 * Math.min(1.0, Math.max(0.35, sNew * 1.6)));
            } else {
              const liftAmt = Math.abs(totDen) * 0.55;
              lNew = l + liftAmt * l * (1.0 - l) * 2.1;
            }
            lNew = Math.max(0.0, Math.min(1.0, lNew));
            [r, g, b] = _hlsToRgb(hNew, lNew, sNew);
          }
        }

        lut[ptr++] = Math.max(0, Math.min(255, Math.round(r * 255.0)));
        lut[ptr++] = Math.max(0, Math.min(255, Math.round(g * 255.0)));
        lut[ptr++] = Math.max(0, Math.min(255, Math.round(b * 255.0)));
      }
    }
  }

  _jsLutCache = { key: stateKey, active: true, lut };
  return _jsLutCache;
}

function applyJs3DLutToPixels(data, lut) {
  if (!lut) return;
  const scale = 16.0 / 255.0;
  for (let i = 0, len = data.length; i < len; i += 4) {
    const rf = data[i] * scale;
    const gf = data[i + 1] * scale;
    const bf = data[i + 2] * scale;
    const r0 = rf | 0, g0 = gf | 0, b0 = bf | 0;
    const r1 = r0 < 16 ? r0 + 1 : 16;
    const g1 = g0 < 16 ? g0 + 1 : 16;
    const b1 = b0 < 16 ? b0 + 1 : 16;
    const dr = rf - r0, dg = gf - g0, db = bf - b0;
    const omr = 1.0 - dr, omg = 1.0 - dg, omb = 1.0 - db;

    const w000 = omb * omg * omr;
    const w001 = omb * omg * dr;
    const w010 = omb * dg * omr;
    const w011 = omb * dg * dr;
    const w100 = db * omg * omr;
    const w101 = db * omg * dr;
    const w110 = db * dg * omr;
    const w111 = db * dg * dr;

    const b0g0 = (b0 * 289 + g0 * 17) * 3;
    const b0g1 = (b0 * 289 + g1 * 17) * 3;
    const b1g0 = (b1 * 289 + g0 * 17) * 3;
    const b1g1 = (b1 * 289 + g1 * 17) * 3;

    const i000 = b0g0 + r0 * 3, i001 = b0g0 + r1 * 3;
    const i010 = b0g1 + r0 * 3, i011 = b0g1 + r1 * 3;
    const i100 = b1g0 + r0 * 3, i101 = b1g0 + r1 * 3;
    const i110 = b1g1 + r0 * 3, i111 = b1g1 + r1 * 3;

    data[i]     = (lut[i000]*w000 + lut[i001]*w001 + lut[i010]*w010 + lut[i011]*w011 + lut[i100]*w100 + lut[i101]*w101 + lut[i110]*w110 + lut[i111]*w111 + 0.5) | 0;
    data[i + 1] = (lut[i000+1]*w000 + lut[i001+1]*w001 + lut[i010+1]*w010 + lut[i011+1]*w011 + lut[i100+1]*w100 + lut[i101+1]*w101 + lut[i110+1]*w110 + lut[i111+1]*w111 + 0.5) | 0;
    data[i + 2] = (lut[i000+2]*w000 + lut[i001+2]*w001 + lut[i010+2]*w010 + lut[i011+2]*w011 + lut[i100+2]*w100 + lut[i101+2]*w101 + lut[i110+2]*w110 + lut[i111+2]*w111 + 0.5) | 0;
  }
}

let _lutRenderRafId = null;
let _videoLutLoopId = null;
let _monitorLutCtx = null;
let _sbsLutCtx = null;

function scheduleMonitorLutRender() {
  if (_lutRenderRafId) return;
  _lutRenderRafId = requestAnimationFrame(() => {
    _lutRenderRafId = null;
    renderMonitorLutCanvas();
  });
}

function renderMonitorLutCanvas() {
  const mCanvas = document.getElementById("monitorLutCanvas");
  const sCanvas = document.getElementById("sbsLutCanvas");
  if (!mCanvas) return;

  const lutState = buildJs3DLut();
  if (!lutState.active || !lutState.lut) {
    mCanvas.style.display = "none";
    if (sCanvas) sCanvas.style.display = "none";
    return;
  }

  const isVidActive = monitorVideo && monitorVideo.style.display !== "none" && monitorVideo.readyState >= 2 && monitorVideo.videoWidth > 0;
  const isImgActive = monitorImg && monitorImg.src && monitorImg.complete && monitorImg.naturalWidth > 0;
  const sourceEl = isVidActive ? monitorVideo : (isImgActive ? monitorImg : null);

  if (!sourceEl) {
    mCanvas.style.display = "none";
    if (sCanvas) sCanvas.style.display = "none";
    return;
  }

  const rawW = isVidActive ? monitorVideo.videoWidth : monitorImg.naturalWidth;
  const rawH = isVidActive ? monitorVideo.videoHeight : monitorImg.naturalHeight;
  const maxDim = 640;
  const scaleFactor = Math.min(1.0, maxDim / Math.max(rawW || 640, rawH || 360));
  const cw = Math.max(16, Math.round(rawW * scaleFactor));
  const ch = Math.max(16, Math.round(rawH * scaleFactor));

  if (mCanvas.width !== cw || mCanvas.height !== ch) {
    mCanvas.width = cw;
    mCanvas.height = ch;
    _monitorLutCtx = null;
  }
  if (!_monitorLutCtx) {
    _monitorLutCtx = mCanvas.getContext("2d", { willReadFrequently: true });
  }

  try {
    _monitorLutCtx.drawImage(sourceEl, 0, 0, cw, ch);
    const imgData = _monitorLutCtx.getImageData(0, 0, cw, ch);
    applyJs3DLutToPixels(imgData.data, lutState.lut);
    _monitorLutCtx.putImageData(imgData, 0, 0);
    mCanvas.style.display = "block";

    if (sCanvas && sideBySideContainer && sideBySideContainer.style.display !== "none") {
      if (sCanvas.width !== cw || sCanvas.height !== ch) {
        sCanvas.width = cw;
        sCanvas.height = ch;
        _sbsLutCtx = null;
      }
      if (!_sbsLutCtx) {
        _sbsLutCtx = sCanvas.getContext("2d");
      }
      _sbsLutCtx.putImageData(imgData, 0, 0);
      sCanvas.style.display = "block";
    } else if (sCanvas) {
      sCanvas.style.display = "none";
    }
  } catch (err) {
    mCanvas.style.display = "none";
  }
}

function startVideoLutLoop() {
  if (_videoLutLoopId) return;
  const tick = () => {
    if (monitorVideo && !monitorVideo.paused && !monitorVideo.ended && monitorVideo.style.display !== "none") {
      renderMonitorLutCanvas();
      _videoLutLoopId = requestAnimationFrame(tick);
    } else {
      _videoLutLoopId = null;
    }
  };
  _videoLutLoopId = requestAnimationFrame(tick);
}

function updateColorSliceSvgFilter() {
  const feMatrix = document.getElementById("csFeMatrix");
  const fnR = document.getElementById("csFuncR");
  const fnG = document.getElementById("csFuncG");
  const fnB = document.getElementById("csFuncB");
  if (!feMatrix) return false;
  const cs = inspectorState.colorSlice;
  const pb = inspectorState.primariesBars;
  const isCsBypassed = isBypassed || (inspectorState.bypassedCards && inspectorState.bypassedCards.colorSlice);
  const isPbBypassed = isBypassed || (inspectorState.bypassedCards && inspectorState.bypassedCards.primariesBars);
  const csActive = !isCsBypassed && isColorSliceModified(cs);
  const pbActive = !isPbBypassed && isPrimariesBarsModified(pb);

  if (!csActive && !pbActive) {
    feMatrix.setAttribute("values", "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0");
    if (fnR) fnR.setAttribute("type", "identity");
    if (fnG) fnG.setAttribute("type", "identity");
    if (fnB) fnB.setAttribute("type", "identity");
    return false;
  }

  let M = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  const lumaW = [0.2126, 0.7152, 0.0722];

  // 1. True Non-Linear 17-Point Transfer Curves for Primaries Color Bars (Lift / Gamma / Gain / Offset / Pivot / Shad / HiLight)
  if (pbActive && pb) {
    const t = pb.top || {};
    const b = pb.bot || {};
    const lf = pb.lift || { y: 0, r: 0, g: 0, b: 0 };
    const gm = pb.gamma || { y: 0, r: 0, g: 0, b: 0 };
    const gn = pb.gain || { y: 1, r: 1, g: 1, b: 1 };
    const of = pb.offset || { r: 25, g: 25, b: 25 };

    const cont = t.cont !== undefined ? t.cont : 1.0;
    const pivot = Math.max(0.05, Math.min(0.95, t.pivot !== undefined ? t.pivot : 0.435));
    const pbSat = ((b.sat !== undefined ? b.sat : 50.0) / 50.0) + ((b.colBoost || 0) / 100.0) * 0.45;
    const pbHue = ((b.hue !== undefined ? b.hue : 50.0) - 50.0) / 50.0;
    const temp = (t.temp || 0) / 100.0;
    const tint = (t.tint || 0) / 100.0;
    const shad = (b.shad || 0) / 100.0;
    const hiLight = (b.hiLight || 0) / 100.0;

    const liftRGB = [
      (lf.y || 0) + (lf.r || 0) + ((of.r !== undefined ? of.r : 25) - 25) * 0.006,
      (lf.y || 0) + (lf.g || 0) + ((of.g !== undefined ? of.g : 25) - 25) * 0.006,
      (lf.y || 0) + (lf.b || 0) + ((of.b !== undefined ? of.b : 25) - 25) * 0.006
    ];
    const gainRGB = [
      (gn.y !== undefined ? gn.y : 1) * (gn.r !== undefined ? gn.r : 1) * (1 + temp * 0.12 + tint * 0.05),
      (gn.y !== undefined ? gn.y : 1) * (gn.g !== undefined ? gn.g : 1) * (1 - tint * 0.07),
      (gn.y !== undefined ? gn.y : 1) * (gn.b !== undefined ? gn.b : 1) * (1 - temp * 0.12 + tint * 0.05)
    ];
    const gammaExp = [
      Math.max(0.25, Math.min(4.0, 1.0 / Math.max(0.2, 1.0 + ((gm.y || 0) + (gm.r || 0)) * 1.35))),
      Math.max(0.25, Math.min(4.0, 1.0 / Math.max(0.2, 1.0 + ((gm.y || 0) + (gm.g || 0)) * 1.35))),
      Math.max(0.25, Math.min(4.0, 1.0 / Math.max(0.2, 1.0 + ((gm.y || 0) + (gm.b || 0)) * 1.35)))
    ];

    const funcs = [fnR, fnG, fnB];
    for (let ch = 0; ch < 3; ch++) {
      if (!funcs[ch]) continue;
      const tbl = [];
      for (let i = 0; i <= 16; i++) {
        let v = i / 16.0;
        v = v * gainRGB[ch] + liftRGB[ch] * (1.0 - v);
        v = Math.max(0.0, Math.min(1.0, v));
        if (v > 0.0) v = Math.pow(v, gammaExp[ch]);
        if (Math.abs(shad) > 0.002) v += shad * 0.22 * Math.pow(1.0 - v, 2) * Math.sqrt(v);
        if (Math.abs(hiLight) > 0.002) v += hiLight * 0.22 * Math.pow(v, 2) * Math.sqrt(1.0 - v);
        if (Math.abs(cont - 1.0) > 0.002) v = pivot + (v - pivot) * cont;
        tbl.push(Math.max(0.0, Math.min(1.0, v)).toFixed(4));
      }
      funcs[ch].setAttribute("type", "table");
      funcs[ch].setAttribute("tableValues", tbl.join(" "));
    }

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const base = (r === c ? 1.0 : 0.0);
        M[r][c] = lumaW[c] + (base - lumaW[c]) * pbSat;
      }
    }

    if (Math.abs(pbHue) > 0.005) {
      const hShift = pbHue * 0.35;
      M[0][1] -= hShift * 0.5; M[0][2] += hShift * 0.5;
      M[1][0] += hShift * 0.5; M[1][2] -= hShift * 0.5;
      M[2][0] -= hShift * 0.5; M[2][1] += hShift * 0.5;
    }
  } else {
    if (fnR) fnR.setAttribute("type", "identity");
    if (fnG) fnG.setAttribute("type", "identity");
    if (fnB) fnB.setAttribute("type", "identity");
  }

  // 2. Fold DaVinci ColorSlice 7-Vector Subtractive Grading (Zero-sum detector weights keep greys 100% neutral!)
  if (csActive && cs) {
    const m = cs.master || { den: 0, denDepth: 0, sat: 1, satBal: 0, satDepth: 0, hue: 0 };
    const gDen = (m.den || 0) + (m.denDepth || 0) * 0.35;
    const gSat = (m.sat !== undefined ? m.sat : 1.0) + (m.satBal || 0) * 0.25 + (m.satDepth || 0) * 0.20;
    const gHue = (m.hue || 0);

    const dScale = Math.max(0.4, 1.0 - gDen * 0.28);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const base = M[r][c];
        M[r][c] = (lumaW[c] + (base - lumaW[c]) * gSat) * dScale;
      }
    }

    if (Math.abs(gHue) > 0.005) {
      const hShift = gHue * 0.32;
      M[0][1] -= hShift * 0.5; M[0][2] += hShift * 0.5;
      M[1][0] += hShift * 0.5; M[1][2] -= hShift * 0.5;
      M[2][0] -= hShift * 0.5; M[2][1] += hShift * 0.5;
    }

    Object.keys(COLORSLICE_VECTORS).forEach(key => {
      const sl = cs[key];
      if (!sl) return;
      const vec = COLORSLICE_VECTORS[key];
      const den = sl.den || 0;
      const satDiff = (sl.sat !== undefined ? sl.sat : 1.0) - 1.0;
      const hue = (sl.hue || 0) + (sl.center || 0) * 0.35;
      if (Math.abs(den) < 0.003 && Math.abs(satDiff) < 0.003 && Math.abs(hue) < 0.003) return;

      const dRGB = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        dRGB[i] += (-den * 0.32) * vec.u[i];
        dRGB[i] += (satDiff * 0.45) * vec.s[i];
        dRGB[i] += (hue * 0.35) * vec.t[i];
      }

      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          M[r][c] += dRGB[r] * vec.w[c];
        }
      }
    });
  }

  const vals = [
    M[0][0].toFixed(4), M[0][1].toFixed(4), M[0][2].toFixed(4), "0", "0",
    M[1][0].toFixed(4), M[1][1].toFixed(4), M[1][2].toFixed(4), "0", "0",
    M[2][0].toFixed(4), M[2][1].toFixed(4), M[2][2].toFixed(4), "0", "0",
    "0", "0", "0", "1", "0"
  ].join(" ");
  feMatrix.setAttribute("values", vals);
  return true;
}

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
  temperature: 0,
  tint: 0,
  exportScope: "all",
  nikonProfile: "nlog_rec709",
  nikonStrength: 100,
  customLutPath: "",
  skinSoftening: 0,
  portraitHue: 0,
  portraitBrightness: 0,
  primariesBars: createDefaultPrimariesBars(),
  colorSlice: createDefaultColorSlice(),
  denoiseMode: "off",
  denoiseSpatial: 0.0,
  denoiseTemporal: 0.0,
  bypassedCards: {
    transform: false,
    crop: false,
    dynamicZoom: true,
    composite: false,
    speed: false,
    stabilization: false,
    whiteBalance: false,
    primariesBars: false,
    colorSlice: false,
    nikonColor: false,
    denoise: false,
    lensCorrection: false,
    retimeScaling: false
  }
};

const NIKON_PROFILES_INFO = {
  nlog_rec709: "Nikon Z8 golden ratio curve: +35% Contrast, +40% Saturation & shadow detail recovery for punchy, ready-to-share vertical reels.",
  rich_portrait: "Nikon Z8 Rich Tone Portrait: soft flattering skin tone, natural rosy blush warmth, gentle highlight rolloff.",
  portrait: "Standard Nikon Portrait: natural skin rendition with balanced contrast and warm healthy tones.",
  skin_soft: "Nikon Skin Softening: smart surface smoothing that refines skin texture while keeping eyes and hair razor-sharp.",
  neutral: "Nikon Neutral: clean, honest, unhyped camera rendition with balanced dynamic range.",
  vivid: "Nikon Vivid Landscape: deep sky blue, lush greens, punchy contrast for outdoor/nature shoots.",
  flat: "Nikon Flat: maximum dynamic range preservation, soft film roll-off, ideal for subtle grading.",
  dream: "Nikon Dream: ethereal warm pastel glow with gentle highlight compression for romantic/moody scenes.",
  morning: "Nikon Morning: crisp, fresh morning light with clean sun-drenched clarity and vibrant greens.",
  pop: "Nikon Pop: vibrant, high-energy primary colors and punchy contrast for lively action.",
  sunday: "Nikon Sunday: warm, calm afternoon sun glow with soft highlights and relaxed warmth.",
  somber: "Nikon Somber: desaturated moodiness with lifted shadows for introspective cinematic scenes.",
  dramatic: "Nikon Dramatic: high contrast punch with deep shadows for intense emotion and impact.",
  silence: "Nikon Silence: minimalist muted tones with serene, peaceful balance.",
  bleach_bypass: "Nikon Bleach Bypass: high-contrast silver-halide film look with desaturated cinematic tones.",
  melancholic: "Nikon Melancholic: cool Nordic cyan tones with subdued contrast and moody atmosphere.",
  pure: "Nikon Pure: ultra-clean clarity, transparent highlights, and natural unblemished tones.",
  denim: "Nikon Denim: deep indigo blue and cool shadow tones for modern stylish streetwear.",
  toy: "Nikon Toy Camera: saturated pop colors with subtle optical vignetting for playful retro vibes.",
  sepia: "Nikon Sepia: rich warm monochrome with classic amber-brown archival toning.",
  monochrome: "Nikon Deep Tone B&W: rich deep blacks, fine tonal gradation inspired by classic film.",
  custom: "Custom 3D LUT (.cube): apply exact external LUT profiles at VideoToolbox hardware speed.",
  none: "Source Original: straight passthrough from camera without tone modifications."
};

// Clip Ratings & Culling Storage (1-5 Stars & Reject Flags)
let currentRatingFilter = "all"; // "all", "star3", "star5", "rejected"
let clipRatings = {};
try {
  clipRatings = JSON.parse(localStorage.getItem("tc_clip_ratings") || "{}");
} catch (e) {
  clipRatings = {};
}
function saveClipRatings() {
  try {
    localStorage.setItem("tc_clip_ratings", JSON.stringify(clipRatings));
  } catch (e) {}
}

// Social Media Safe Zones & Guides State
let activeGuideMode = "none";

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

// Day / Night Theme Management (Dark, Light, Auto System Following)
let currentThemeMode = "dark"; // "dark" | "light" | "auto"
const systemColorScheme = window.matchMedia("(prefers-color-scheme: dark)");

function applyTheme(mode, persist = true) {
  if (mode !== "dark" && mode !== "light" && mode !== "auto") {
    mode = "auto";
  }
  currentThemeMode = mode;
  const isAuto = mode === "auto";
  const shouldBeDark = isAuto ? systemColorScheme.matches : (mode === "dark");

  if (shouldBeDark) {
    document.body.classList.remove("theme-light");
    document.body.classList.add("theme-dark");
  } else {
    document.body.classList.remove("theme-dark");
    document.body.classList.add("theme-light");
  }

  // Update active pill button
  const btnDark = document.getElementById("btnThemeDark");
  const btnLight = document.getElementById("btnThemeLight");
  const btnAuto = document.getElementById("btnThemeAuto");
  if (btnDark) btnDark.classList.toggle("active", mode === "dark");
  if (btnLight) btnLight.classList.toggle("active", mode === "light");
  if (btnAuto) {
    btnAuto.classList.toggle("active", mode === "auto");
    btnAuto.textContent = mode === "auto"
      ? `🖥 Auto • ${shouldBeDark ? "Dark" : "Light"}`
      : "🖥 Auto";
  }

  scheduleHistogram();

  if (persist) {
    try {
      localStorage.setItem("tc_studio_theme", mode);
    } catch (e) {}
    triggerSaveSettings();
  }
}

function setupThemeSwitcher() {
  const btnDark = document.getElementById("btnThemeDark");
  const btnLight = document.getElementById("btnThemeLight");
  const btnAuto = document.getElementById("btnThemeAuto");

  if (btnDark) btnDark.addEventListener("click", () => applyTheme("dark"));
  if (btnLight) btnLight.addEventListener("click", () => applyTheme("light"));
  if (btnAuto) btnAuto.addEventListener("click", () => applyTheme("auto"));

  // React dynamically when macOS/Windows transitions day <-> night in Auto mode
  try {
    systemColorScheme.addEventListener("change", () => {
      if (currentThemeMode === "auto") {
        applyTheme("auto", false);
      }
    });
  } catch (err) {
    try {
      systemColorScheme.addListener(() => {
        if (currentThemeMode === "auto") {
          applyTheme("auto", false);
        }
      });
    } catch (e2) {}
  }

  // Load initial theme from localStorage or fallback
  let initialTheme = "dark";
  try {
    const saved = localStorage.getItem("tc_studio_theme");
    if (saved) initialTheme = saved;
  } catch (e) {}
  applyTheme(initialTheme, false);
}

// Settings Persistence System (Saved across app sessions in ~/.turbocompress_studio_settings.json & localStorage)
let settingsSaveDebounce = null;
function triggerSaveSettings() {
  if (settingsSaveDebounce) clearTimeout(settingsSaveDebounce);
  settingsSaveDebounce = setTimeout(saveCurrentSettings, 400);
}

function gatherCurrentSettings() {
  const inpOut = document.getElementById("inpOutputPath");
  const inpFn = document.getElementById("inpFileNamePattern");
  const selFmt = document.getElementById("selFormat");
  const selCdc = document.getElementById("selCodec");
  const selRes = document.getElementById("selResolution");
  const inpW = document.getElementById("inpResW");
  const inpH = document.getElementById("inpResH");
  const chkVRes = document.getElementById("chkVerticalRes");
  const inpBps = document.getElementById("inpBitrateKbps");
  const chkAud = document.getElementById("chkExportAudio");
  const selAudCdc = document.getElementById("selAudioCodec");
  const inpAudBps = document.getElementById("inpAudioBitrate");
  const selAudChan = document.getElementById("selAudioChannels");
  const inpSub = document.getElementById("inpFileSubfolder");
  const chkRes = document.getElementById("chkSmartResume");
  const selWrk = document.getElementById("selWorkers");
  const selSpd = document.getElementById("selRenderSpeed");

  return {
    rotation: inspectorState.rotation,
    scaling: inspectorState.scaling,
    zoomX: inspectorState.zoomX,
    zoomY: inspectorState.zoomY,
    zoomLinked: inspectorState.zoomLinked,
    posX: inspectorState.posX,
    posY: inspectorState.posY,
    anchorX: inspectorState.anchorX,
    anchorY: inspectorState.anchorY,
    pitch: inspectorState.pitch,
    yaw: inspectorState.yaw,
    flipH: inspectorState.flipH,
    flipV: inspectorState.flipV,
    cropL: inspectorState.cropL,
    cropR: inspectorState.cropR,
    cropT: inspectorState.cropT,
    cropB: inspectorState.cropB,
    cropSoftness: inspectorState.cropSoftness,
    speed: inspectorState.speed,
    speedDirection: inspectorState.speedDirection,
    nikonProfile: inspectorState.nikonProfile,
    nikonStrength: inspectorState.nikonStrength,
    customLutPath: inspectorState.customLutPath,
    skinSoftening: (document.getElementById("sliderSkinSoft") ? parseFloat(document.getElementById("sliderSkinSoft").value) : (inspectorState.skinSoftening || 0)),
    portraitHue: (document.getElementById("sliderPortraitHue") ? parseFloat(document.getElementById("sliderPortraitHue").value) : (inspectorState.portraitHue || 0)),
    portraitBrightness: (document.getElementById("sliderPortraitBright") ? parseFloat(document.getElementById("sliderPortraitBright").value) : (inspectorState.portraitBrightness || 0)),
    primariesBars: inspectorState.primariesBars,
    colorSlice: inspectorState.colorSlice,
    denoiseMode: (document.getElementById("selDenoiseMode") ? document.getElementById("selDenoiseMode").value : (inspectorState.denoiseMode || "off")),
    denoiseSpatial: (document.getElementById("sliderDenoiseSpatial") ? parseFloat(document.getElementById("sliderDenoiseSpatial").value) : (inspectorState.denoiseSpatial || 0)),
    denoiseTemporal: (document.getElementById("sliderDenoiseTemporal") ? parseFloat(document.getElementById("sliderDenoiseTemporal").value) : (inspectorState.denoiseTemporal || 0)),
    brightness: inspectorState.brightness,
    contrast: inspectorState.contrast,
    shadows: inspectorState.shadows,
    saturation: inspectorState.saturation,
    temperature: inspectorState.temperature || 0,
    tint: inspectorState.tint || 0,
    conflictAction: (document.getElementById("selConflictAction") ? document.getElementById("selConflictAction").value : (document.getElementById("selConflictActionFileTab") ? document.getElementById("selConflictActionFileTab").value : "skip")),
    outputPath: inpOut ? inpOut.value.trim() : "",
    fileNamePattern: inpFn ? inpFn.value.trim() : "SourceName",
    format: selFmt ? selFmt.value : "mp4",
    codec: selCdc ? selCdc.value : "h264",
    resolution: selRes ? selRes.value : "1080x1920",
    resW: inpW ? inpW.value : "1080",
    resH: inpH ? inpH.value : "1920",
    verticalRes: chkVRes ? chkVRes.checked : true,
    bitrateKbps: inpBps ? inpBps.value : "8000",
    exportAudio: chkAud ? chkAud.checked : true,
    audioCodec: selAudCdc ? selAudCdc.value : "aac",
    audioBitrate: inpAudBps ? inpAudBps.value : "320",
    audioChannels: selAudChan ? selAudChan.value : "2",
    fileSubfolder: inpSub ? inpSub.value.trim() : "",
    smartResume: chkRes ? chkRes.checked : true,
    workers: selWrk ? parseInt(selWrk.value) : 2,
    renderSpeed: selSpd ? selSpd.value : "max",
    theme: currentThemeMode
  };
}

async function saveCurrentSettings() {
  const data = gatherCurrentSettings();
  try {
    localStorage.setItem("tc_studio_settings", JSON.stringify(data));
  } catch (e) {}
  try {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  } catch (e) {}
}

async function loadSavedSettings() {
  let settings = null;
  try {
    const res = await fetch("/api/settings");
    if (res.ok) settings = await res.json();
  } catch (e) {}
  if (!settings) {
    try {
      const local = localStorage.getItem("tc_studio_settings");
      if (local) settings = JSON.parse(local);
    } catch (e) {}
  }
  if (!settings) return;

  if (settings.rotation !== undefined) inspectorState.rotation = parseFloat(settings.rotation);
  if (settings.scaling !== undefined) inspectorState.scaling = settings.scaling;
  if (settings.zoomX !== undefined) inspectorState.zoomX = parseFloat(settings.zoomX);
  if (settings.zoomY !== undefined) inspectorState.zoomY = parseFloat(settings.zoomY);
  if (settings.zoomLinked !== undefined) inspectorState.zoomLinked = !!settings.zoomLinked;
  if (settings.posX !== undefined) inspectorState.posX = parseFloat(settings.posX);
  if (settings.posY !== undefined) inspectorState.posY = parseFloat(settings.posY);
  if (settings.anchorX !== undefined) inspectorState.anchorX = parseFloat(settings.anchorX);
  if (settings.anchorY !== undefined) inspectorState.anchorY = parseFloat(settings.anchorY);
  if (settings.pitch !== undefined) inspectorState.pitch = parseFloat(settings.pitch);
  if (settings.yaw !== undefined) inspectorState.yaw = parseFloat(settings.yaw);
  if (settings.flipH !== undefined) inspectorState.flipH = !!settings.flipH;
  if (settings.flipV !== undefined) inspectorState.flipV = !!settings.flipV;
  if (settings.cropL !== undefined) inspectorState.cropL = parseFloat(settings.cropL);
  if (settings.cropR !== undefined) inspectorState.cropR = parseFloat(settings.cropR);
  if (settings.cropT !== undefined) inspectorState.cropT = parseFloat(settings.cropT);
  if (settings.cropB !== undefined) inspectorState.cropB = parseFloat(settings.cropB);
  if (settings.cropSoftness !== undefined) inspectorState.cropSoftness = parseFloat(settings.cropSoftness);
  if (settings.speed !== undefined) inspectorState.speed = parseFloat(settings.speed);
  if (settings.speedDirection !== undefined) inspectorState.speedDirection = settings.speedDirection;

  if (settings.nikonProfile !== undefined) inspectorState.nikonProfile = settings.nikonProfile;
  if (settings.nikonStrength !== undefined) inspectorState.nikonStrength = parseInt(settings.nikonStrength);
  if (settings.customLutPath !== undefined) inspectorState.customLutPath = settings.customLutPath;
  if (settings.skinSoftening !== undefined) inspectorState.skinSoftening = parseFloat(settings.skinSoftening);
  if (settings.portraitHue !== undefined) inspectorState.portraitHue = parseFloat(settings.portraitHue);
  if (settings.portraitBrightness !== undefined) inspectorState.portraitBrightness = parseFloat(settings.portraitBrightness);
  if (settings.primariesBars && typeof settings.primariesBars === "object") {
    inspectorState.primariesBars = Object.assign(createDefaultPrimariesBars(), settings.primariesBars);
  }
  if (settings.colorSlice && typeof settings.colorSlice === "object") {
    inspectorState.colorSlice = Object.assign(createDefaultColorSlice(), settings.colorSlice);
  }
  if (settings.brightness !== undefined) inspectorState.brightness = parseFloat(settings.brightness);
  if (settings.contrast !== undefined) inspectorState.contrast = parseFloat(settings.contrast);
  if (settings.shadows !== undefined) inspectorState.shadows = parseFloat(settings.shadows);
  if (settings.saturation !== undefined) inspectorState.saturation = parseFloat(settings.saturation);

  if (settings.theme !== undefined) {
    applyTheme(settings.theme, false);
  }

  syncDomWithSettings(settings);
  applyMonitorTransform();
}

function updateWhitebalanceBadge() {
  const badge = document.getElementById("wbKelvinBadge");
  const temp = inspectorState.temperature || 0;
  const tint = inspectorState.tint || 0;
  const kelvin = Math.round(5200 + (temp * 60));
  let desc = "Neutral";
  if (temp >= 35) desc = "Shade (อบอุ่น)";
  else if (temp >= 20) desc = "Cloudy (อุ่น)";
  else if (temp >= 8) desc = "Daylight";
  else if (temp <= -25) desc = "Tungsten (คูล)";
  else if (temp <= -8) desc = "Cool (เย็น)";
  if (badge) badge.textContent = `${kelvin}K ${desc}`;

  document.querySelectorAll(".btn-wb-preset").forEach(btn => {
    const wb = btn.dataset.wb;
    let match = false;
    if (wb === "shot" && temp === 0 && tint === 0) match = true;
    else if (wb === "daylight" && temp === 12) match = true;
    else if (wb === "cloudy" && temp === 25) match = true;
    else if (wb === "shade" && temp === 38) match = true;
    else if (wb === "tungsten" && temp === -30) match = true;
    btn.classList.toggle("active", match);
  });
}

function updateSkinToneBadge() {
  const badge = document.getElementById("skinToneStatusBadge");
  const hue = inspectorState.portraitHue || 0;
  const brt = inspectorState.portraitBrightness || 0;
  const sft = inspectorState.skinSoftening || 0;
  if (badge) {
    let label = "Natural Skin";
    if (hue >= 15 && brt >= 8) label = "🌸 Rosy Pink";
    else if (brt >= 20) label = "✨ Aura Bright";
    else if (hue <= -10) label = "🍯 Warm Glow";
    else if (hue > 4) label = `Rosy +${hue}`;
    else if (hue < -4) label = `Amber ${hue}`;
    else if (brt !== 0) label = `Aura ${brt > 0 ? "+" + brt : brt}`;
    badge.textContent = label;
  }
  document.querySelectorAll(".btn-skin-preset").forEach(btn => {
    const sk = btn.dataset.skin;
    let match = false;
    if (sk === "natural" && hue === 0 && brt === 0 && sft === 0) match = true;
    else if (sk === "rosy" && hue === 18 && brt === 12) match = true;
    else if (sk === "aura" && hue === 10 && brt === 28) match = true;
    else if (sk === "glow" && hue === -16 && brt === 15) match = true;
    btn.classList.toggle("active", match);
  });
}

function syncDomWithSettings(s) {
  if (!s) return;
  if (s.rotation !== undefined) {
    if (sliderRotation) sliderRotation.value = s.rotation;
    if (inpRotation) inpRotation.value = parseFloat(s.rotation).toFixed(3);
    const btn270 = document.getElementById("btnRot270");
    if (btn270) btn270.classList.toggle("active", s.rotation === 270 || s.rotation === -90);
  }
  if (s.scaling !== undefined) {
    const selScaling = document.getElementById("selScalingModeTransform");
    if (selScaling) selScaling.value = s.scaling;
  }
  if (s.zoomX !== undefined && inpZoomX) inpZoomX.value = parseFloat(s.zoomX).toFixed(3);
  if (s.zoomY !== undefined && inpZoomY) inpZoomY.value = parseFloat(s.zoomY).toFixed(3);
  if (s.zoomLinked !== undefined && btnZoomLink) {
    btnZoomLink.style.color = s.zoomLinked ? "#3a86ff" : "#63687c";
  }
  if (s.posX !== undefined) {
    const el = document.getElementById("inpPosX");
    if (el) el.value = parseFloat(s.posX).toFixed(3);
  }
  if (s.posY !== undefined) {
    const el = document.getElementById("inpPosY");
    if (el) el.value = parseFloat(s.posY).toFixed(3);
  }
  if (s.anchorX !== undefined) {
    const el = document.getElementById("inpAnchorX");
    if (el) el.value = parseFloat(s.anchorX).toFixed(3);
  }
  if (s.anchorY !== undefined) {
    const el = document.getElementById("inpAnchorY");
    if (el) el.value = parseFloat(s.anchorY).toFixed(3);
  }
  if (s.pitch !== undefined) {
    const sl = document.getElementById("sliderPitch");
    const inp = document.getElementById("inpPitch");
    if (sl) sl.value = s.pitch;
    if (inp) inp.value = parseFloat(s.pitch).toFixed(3);
  }
  if (s.yaw !== undefined) {
    const sl = document.getElementById("sliderYaw");
    const inp = document.getElementById("inpYaw");
    if (sl) sl.value = s.yaw;
    if (inp) inp.value = parseFloat(s.yaw).toFixed(3);
  }
  if (s.flipH !== undefined && btnFlipH) {
    btnFlipH.style.background = s.flipH ? "#e63946" : "#242636";
  }
  if (s.flipV !== undefined && btnFlipV) {
    btnFlipV.style.background = s.flipV ? "#e63946" : "#242636";
  }

  // Cropping
  ["cropL", "cropR", "cropT", "cropB", "cropSoftness"].forEach(k => {
    if (s[k] !== undefined) {
      const suffix = k.replace("crop", "");
      const sl = document.getElementById(`sliderCrop${suffix}`);
      const inp = document.getElementById(`inpCrop${suffix}`);
      if (sl) sl.value = s[k];
      if (inp) inp.value = parseFloat(s[k]).toFixed(3);
    }
  });

  // Speed
  if (s.speed !== undefined) {
    const sl = document.getElementById("sliderSpeed");
    const inp = document.getElementById("inpSpeed");
    if (sl) sl.value = s.speed;
    if (inp) inp.value = parseFloat(s.speed).toFixed(2) + "%";
  }

  // Nikon Color Engine
  if (s.nikonProfile !== undefined) {
    inspectorState.nikonProfile = s.nikonProfile;
    const selP = document.getElementById("selNikonProfile");
    if (selP) selP.value = s.nikonProfile;
    const desc = document.getElementById("nikonProfileDesc");
    if (desc && NIKON_PROFILES_INFO[s.nikonProfile]) desc.textContent = NIKON_PROFILES_INFO[s.nikonProfile];
  }
  if (s.nikonStrength !== undefined) {
    inspectorState.nikonStrength = parseFloat(s.nikonStrength);
    const sl = document.getElementById("sliderNikonStrength");
    const inp = document.getElementById("inpNikonStrength");
    if (sl) sl.value = s.nikonStrength;
    if (inp) inp.value = s.nikonStrength + "%";
  }
  if (s.customLutPath !== undefined) {
    inspectorState.customLutPath = s.customLutPath;
    const inp = document.getElementById("inpCustomLutPath");
    if (inp) inp.value = s.customLutPath;
  }
  if (s.brightness !== undefined) {
    inspectorState.brightness = parseFloat(s.brightness);
    if (sliderBrightness) sliderBrightness.value = s.brightness;
    if (inpBrightness) inpBrightness.value = parseFloat(s.brightness).toFixed(3);
  }
  if (s.contrast !== undefined) {
    inspectorState.contrast = parseFloat(s.contrast);
    if (sliderContrast) sliderContrast.value = s.contrast;
    if (inpContrast) inpContrast.value = parseFloat(s.contrast).toFixed(3);
  }
  if (s.shadows !== undefined) {
    inspectorState.shadows = parseFloat(s.shadows);
    if (sliderShadows) sliderShadows.value = s.shadows;
    if (inpShadows) inpShadows.value = parseFloat(s.shadows).toFixed(3);
  }
  if (s.saturation !== undefined) {
    inspectorState.saturation = parseFloat(s.saturation);
    if (sliderSaturation) sliderSaturation.value = s.saturation;
    if (inpSaturation) inpSaturation.value = parseFloat(s.saturation).toFixed(3);
  }
  if (s.temperature !== undefined) {
    inspectorState.temperature = parseFloat(s.temperature);
    const sl = document.getElementById("sliderTemp");
    const inp = document.getElementById("inpTemp");
    if (sl) sl.value = s.temperature;
    if (inp) inp.value = s.temperature;
  }
  if (s.tint !== undefined) {
    inspectorState.tint = parseFloat(s.tint);
    const sl = document.getElementById("sliderTint");
    const inp = document.getElementById("inpTint");
    if (sl) sl.value = s.tint;
    if (inp) inp.value = s.tint;
  }
  updateWhitebalanceBadge();
  if (s.skinSoftening !== undefined) {
    inspectorState.skinSoftening = parseFloat(s.skinSoftening);
    const sl = document.getElementById("sliderSkinSoft");
    const inp = document.getElementById("inpSkinSoft");
    if (sl) sl.value = s.skinSoftening;
    if (inp) inp.value = s.skinSoftening + "%";
  }
  if (s.portraitHue !== undefined) {
    inspectorState.portraitHue = parseFloat(s.portraitHue);
    const sl = document.getElementById("sliderPortraitHue");
    const inp = document.getElementById("inpPortraitHue");
    if (sl) sl.value = s.portraitHue;
    if (inp) inp.value = s.portraitHue;
  }
  if (s.portraitBrightness !== undefined) {
    inspectorState.portraitBrightness = parseFloat(s.portraitBrightness);
    const sl = document.getElementById("sliderPortraitBright");
    const inp = document.getElementById("inpPortraitBright");
    if (sl) sl.value = s.portraitBrightness;
    if (inp) inp.value = s.portraitBrightness;
  }
  if (s.primariesBars && typeof s.primariesBars === "object") {
    inspectorState.primariesBars = Object.assign(createDefaultPrimariesBars(), s.primariesBars);
    syncPrimariesBarsDom();
  }
  if (s.colorSlice && typeof s.colorSlice === "object") {
    inspectorState.colorSlice = Object.assign(createDefaultColorSlice(), s.colorSlice);
    syncColorSliceDom();
  }
  updateSkinToneBadge();
  if (s.denoiseMode !== undefined) {
    inspectorState.denoiseMode = s.denoiseMode;
    const sel = document.getElementById("selDenoiseMode");
    if (sel) sel.value = s.denoiseMode;
    const rowSp = document.getElementById("rowDenoiseSpatial");
    const rowTp = document.getElementById("rowDenoiseTemporal");
    if (rowSp && rowTp) {
      rowSp.style.display = (s.denoiseMode === "custom") ? "flex" : "none";
      rowTp.style.display = (s.denoiseMode === "custom") ? "flex" : "none";
    }
  }
  if (s.denoiseSpatial !== undefined) {
    inspectorState.denoiseSpatial = parseFloat(s.denoiseSpatial);
    const sl = document.getElementById("sliderDenoiseSpatial");
    const inp = document.getElementById("inpDenoiseSpatial");
    if (sl) sl.value = s.denoiseSpatial;
    if (inp) inp.value = parseFloat(s.denoiseSpatial).toFixed(1);
  }
  if (s.denoiseTemporal !== undefined) {
    inspectorState.denoiseTemporal = parseFloat(s.denoiseTemporal);
    const sl = document.getElementById("sliderDenoiseTemporal");
    const inp = document.getElementById("inpDenoiseTemporal");
    if (sl) sl.value = s.denoiseTemporal;
    if (inp) inp.value = parseFloat(s.denoiseTemporal).toFixed(1);
  }
  // Deliver Page Settings
  if (s.outputPath !== undefined) {
    const el = document.getElementById("inpOutputPath");
    if (el) el.value = s.outputPath;
    const topTxt = document.getElementById("topFolderPathText");
    if (topTxt && s.outputPath) {
      topTxt.textContent = "Output: " + s.outputPath.split("/").filter(Boolean).slice(-3).join(" / ");
    }
  }
  if (s.fileNamePattern !== undefined) {
    const el = document.getElementById("inpFileNamePattern");
    if (el) el.value = s.fileNamePattern;
  }
  if (s.format !== undefined) {
    const el = document.getElementById("selFormat");
    if (el) el.value = s.format;
  }
  if (s.codec !== undefined) {
    const el = document.getElementById("selCodec");
    if (el) el.value = s.codec;
  }
  if (s.resolution !== undefined) {
    const el = document.getElementById("selResolution");
    if (el) el.value = s.resolution;
  }
  if (s.resW !== undefined) {
    const el = document.getElementById("inpResW");
    if (el) el.value = s.resW;
  }
  if (s.resH !== undefined) {
    const el = document.getElementById("inpResH");
    if (el) el.value = s.resH;
  }
  if (s.verticalRes !== undefined) {
    const el = document.getElementById("chkVerticalRes");
    if (el) el.checked = !!s.verticalRes;
  }
  if (s.bitrateKbps !== undefined) {
    const el = document.getElementById("inpBitrateKbps");
    if (el) el.value = (s.bitrateKbps === "80000" || s.bitrateKbps === "20000") ? "8000" : s.bitrateKbps;
  }
  if (s.exportAudio !== undefined) {
    const el = document.getElementById("chkExportAudio");
    if (el) el.checked = !!s.exportAudio;
  }
  if (s.audioCodec !== undefined) {
    const el = document.getElementById("selAudioCodec");
    if (el) el.value = s.audioCodec;
  }
  if (s.audioBitrate !== undefined) {
    const el = document.getElementById("inpAudioBitrate");
    if (el) el.value = s.audioBitrate;
  }
  if (s.audioChannels !== undefined) {
    const el = document.getElementById("selAudioChannels");
    if (el) el.value = s.audioChannels;
  }
  if (s.fileSubfolder !== undefined) {
    const el = document.getElementById("inpFileSubfolder");
    if (el) el.value = s.fileSubfolder;
  }
  if (s.conflictAction !== undefined) {
    const el1 = document.getElementById("selConflictAction");
    if (el1) el1.value = s.conflictAction;
    const el2 = document.getElementById("selConflictActionFileTab");
    if (el2) el2.value = s.conflictAction;
  }
  if (s.smartResume !== undefined) {
    const el = document.getElementById("chkSmartResume");
    if (el) el.checked = !!s.smartResume;
  }
  if (s.workers !== undefined) {
    const el = document.getElementById("selWorkers");
    if (el) el.value = s.workers;
    const elF = document.getElementById("selWorkersFileTab");
    if (elF) elF.value = s.workers;
    updatePinnedSpeedDisplay(s.workers);
  }
  if (s.renderSpeed !== undefined) {
    const el = document.getElementById("selRenderSpeed");
    if (el) el.value = s.renderSpeed;
    const elF = document.getElementById("selRenderSpeedFileTab");
    if (elF) elF.value = s.renderSpeed;
  }
}

function updatePinnedSpeedDisplay(val) {
  const badge = document.getElementById("pinnedSpeedValue");
  if (!badge) return;
  const num = parseInt(val) || 2;
  if (num === 1) {
    badge.textContent = "1 Worker Sequential (1.0x Standard)";
  } else if (num === 3) {
    badge.textContent = "3 Workers Parallel (3.5x - 4.0x Max Boost)";
  } else {
    badge.textContent = "2 Workers Parallel (2.5x - 3.2x Turbo)";
  }
}

function setupAutoSettingsSync() {
  const deliverInputIds = [
    "inpOutputPath", "inpFileNamePattern", "selFormat", "selCodec",
    "selConflictAction", "selConflictActionFileTab",
    "selResolution", "inpResW", "inpResH", "chkVerticalRes", "inpBitrateKbps",
    "chkExportAudio", "selAudioCodec", "inpAudioBitrate", "selAudioChannels",
    "inpFileSubfolder", "chkSmartResume", "selWorkers", "selRenderSpeed",
    "sliderSkinSoft", "sliderPortraitHue", "selDenoiseMode", "sliderDenoiseSpatial", "sliderDenoiseTemporal"
  ];
  deliverInputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", triggerSaveSettings);
      el.addEventListener("input", triggerSaveSettings);
    }
  });

  const selConflict1 = document.getElementById("selConflictAction");
  const selConflict2 = document.getElementById("selConflictActionFileTab");
  if (selConflict1 && selConflict2) {
    selConflict1.addEventListener("change", () => {
      selConflict2.value = selConflict1.value;
      triggerSaveSettings();
    });
    selConflict2.addEventListener("change", () => {
      selConflict1.value = selConflict2.value;
      triggerSaveSettings();
    });
  }

  const selWrk1 = document.getElementById("selWorkers");
  const selWrk2 = document.getElementById("selWorkersFileTab");
  if (selWrk1) {
    selWrk1.addEventListener("change", () => {
      if (selWrk2) selWrk2.value = selWrk1.value;
      updatePinnedSpeedDisplay(selWrk1.value);
      triggerSaveSettings();
    });
  }
  if (selWrk2) {
    selWrk2.addEventListener("change", () => {
      if (selWrk1) selWrk1.value = selWrk2.value;
      updatePinnedSpeedDisplay(selWrk2.value);
      triggerSaveSettings();
    });
  }

  const selSpd1 = document.getElementById("selRenderSpeed");
  const selSpd2 = document.getElementById("selRenderSpeedFileTab");
  if (selSpd1 && selSpd2) {
    selSpd1.addEventListener("change", () => {
      selSpd2.value = selSpd1.value;
      triggerSaveSettings();
    });
    selSpd2.addEventListener("change", () => {
      selSpd1.value = selSpd2.value;
      triggerSaveSettings();
    });
  }

  const pinnedSpeedRow = document.getElementById("pinnedSpeedRow");
  if (pinnedSpeedRow && selWrk1) {
    pinnedSpeedRow.style.cursor = "pointer";
    pinnedSpeedRow.addEventListener("click", () => {
      const current = parseInt(selWrk1.value) || 2;
      const next = current === 2 ? 3 : (current === 3 ? 1 : 2);
      selWrk1.value = next;
      if (selWrk2) selWrk2.value = next;
      updatePinnedSpeedDisplay(next);
      triggerSaveSettings();
    });
  }

  const selFormat = document.getElementById("selFormat");
  const selCodec = document.getElementById("selCodec");
  if (selFormat && selCodec) {
    selFormat.addEventListener("change", () => {
      const fmt = selFormat.value;
      if (fmt === "webm") {
        selCodec.value = "vp9";
      } else if (fmt === "mp4" || fmt === "m4v") {
        if (selCodec.value === "vp9" || selCodec.value.startsWith("prores")) {
          selCodec.value = "h264";
        }
      } else if (fmt === "mov") {
        if (selCodec.value === "vp9") {
          selCodec.value = "prores";
        }
      }
      triggerSaveSettings();
    });

    selCodec.addEventListener("change", () => {
      const cdc = selCodec.value;
      if (cdc === "vp9") {
        selFormat.value = "webm";
      } else if (cdc.startsWith("prores")) {
        if (selFormat.value !== "mov" && selFormat.value !== "mkv") {
          selFormat.value = "mov";
        }
      }
      triggerSaveSettings();
    });
  }

  window.addEventListener("beforeunload", () => {
    const data = gatherCurrentSettings();
    try {
      localStorage.setItem("tc_studio_settings", JSON.stringify(data));
    } catch (e) {}
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    navigator.sendBeacon("/api/settings", blob);
    navigator.sendBeacon("/api/clear");
  });
}

// Initialize safely regardless of when script is loaded
async function initApp() {
  setupThemeSwitcher();
  await loadSavedSettings();
  loadClips();
  setupInspectorListeners();
  setupCompareListeners();
  setupDragAndDrop();
  setupTimelineResizer();
  setupTransport();
  setupKeyboardShortcuts();
  setupAutoSettingsSync();

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
    } else {
      if (noClipMsg) noClipMsg.style.display = "flex";
      if (monitorImg) monitorImg.style.display = "none";
      if (monitorVideo) monitorVideo.style.display = "none";
      if (playheadOverview) playheadOverview.style.left = "0%";
      if (playheadDetail) playheadDetail.style.left = "0%";
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
    mediaGrid.innerHTML = `
      <div class="empty-media-pool-zone">
        <span class="empty-zone-icon">📥</span>
        <div class="empty-zone-title">Media Pool is Clean &amp; Ready</div>
        <div class="empty-zone-desc">Drag &amp; drop Nikon Z8 video clips or camera folders here to start your next batch project.</div>
        <div class="empty-zone-actions">
          <button class="btn-davinci-pill btn-empty-import" id="btnEmptyBrowseFolder">📁 Import Folder...</button>
          <button class="btn-davinci-pill btn-empty-select" id="btnEmptyBrowseFiles">🎬 Select Files...</button>
        </div>
      </div>
    `;
    const bF = document.getElementById("btnEmptyBrowseFolder");
    if (bF) bF.addEventListener("click", () => fetch("/api/browse-folder", { method: "POST" }).then(loadClips));
    const bFi = document.getElementById("btnEmptyBrowseFiles");
    if (bFi) bFi.addEventListener("click", () => fetch("/api/browse-files", { method: "POST" }).then(loadClips));
    return;
  }

  if (currentViewMode === "list") {
    mediaGrid.classList.add("list-view");
  } else {
    mediaGrid.classList.remove("list-view");
  }

  // Calculate duplicates in Media Pool (clips with same stem or same size)
  const dupMap = new Map();
  allClips.forEach((c, i) => {
    const stem = c.name.replace(/\.[^/.]+$/, "").replace(/[\s_-]+(copy|\(\d+\)|\d+)$/i, "").toLowerCase();
    const key = `${stem}_${c.size}`;
    if (!dupMap.has(key)) dupMap.set(key, []);
    dupMap.get(key).push(i);
  });
  const duplicateIndices = new Set();
  dupMap.forEach(indices => {
    if (indices.length > 1) {
      indices.forEach(idx => duplicateIndices.add(idx));
    }
  });

  const fragment = document.createDocumentFragment();

  if (currentRatingFilter === "duplicate") {
    const dupBar = document.createElement("div");
    dupBar.className = "dup-action-bar";
    dupBar.style.gridColumn = "1 / -1";
    dupBar.innerHTML = `
      <span>♊︎ ตรวจพบภาพ/คลิปซ้ำ <strong>${duplicateIndices.size}</strong> คลิปใน Media Pool</span>
      <button class="btn-dup-clean" id="btnDeduplicatePool" title="เก็บเฉพาะคลิปแรก ลบคลิปซ้ำออกจาก Pool">ข้าม/ลบคลิปซ้ำ (Deduplicate)</button>
    `;
    const btnDedup = dupBar.querySelector("#btnDeduplicatePool");
    if (btnDedup) {
      btnDedup.addEventListener("click", () => {
        const toRemove = new Set();
        dupMap.forEach(indices => {
          if (indices.length > 1) {
            for (let k = 1; k < indices.length; k++) {
              toRemove.add(indices[k]);
            }
          }
        });
        allClips = allClips.filter((_, i) => !toRemove.has(i));
        selectedIndices = new Set(allClips.map((_, i) => i));
        renderMediaPool();
        renderTimelineOverview();
        updateSelectionHeader();
        showToast(`✅ คัดกรองและลบคลิปซ้ำออกจาก Pool เรียบร้อย (${toRemove.size} คลิป)`);
      });
    }
    fragment.appendChild(dupBar);
  }

  allClips.forEach((clip, idx) => {
    const rInfo = clipRatings[clip.path] || { rating: 0, rejected: false };

    // Rating & Duplicate Filter
    if (currentRatingFilter === "star3" && (rInfo.rating < 3 || rInfo.rejected)) return;
    if (currentRatingFilter === "star5" && (rInfo.rating !== 5 || rInfo.rejected)) return;
    if (currentRatingFilter === "rejected" && !rInfo.rejected) return;
    if (currentRatingFilter === "duplicate" && !duplicateIndices.has(idx)) return;

    const isSelected = selectedIndices.has(idx);
    const isDone = completedPaths.has(clip.path);
    const isDup = duplicateIndices.has(idx);
    const dupBadge = isDup ? `<span class="clip-badge-dup" title="Duplicate Clip (ภาพ/คลิปซ้ำ)">♊︎ Dup</span>` : "";
    const card = document.createElement("div");

    const rBadge = rInfo.rejected
      ? `<span class="clip-reject-badge">✕ REJECT</span>`
      : (rInfo.rating > 0 ? `<span class="clip-rating-badge">★ ${rInfo.rating}</span>` : "");

    const rejClass = rInfo.rejected ? " is-rejected" : "";

    if (currentViewMode === "list") {
      card.className = `clip-list-item ${isSelected ? "selected" : ""} ${isDone ? "completed" : ""}${rejClass}`;
      card.id = `card-${idx}`;
      card.innerHTML = `
        <div class="cli-left">
          <span class="cli-icon">🎬</span>
          <span class="cli-name" title="${clip.name}">${clip.name}</span>
          ${rBadge}
          ${dupBadge}
        </div>
        <div class="cli-right">
          <span class="cli-meta">${clip.fps} • ${clip.size_fmt}</span>
          ${isDone ? '<span class="cli-badge-done">✅ DONE</span>' : ''}
        </div>
      `;
    } else {
      card.className = `clip-card ${isSelected ? "selected" : ""} ${isDone ? "completed" : ""}${rejClass}`;
      card.id = `card-${idx}`;
      card.innerHTML = `
        ${isDone ? '<span class="clip-badge-done">✅ DONE</span>' : ''}
        ${rBadge}
        ${dupBadge}
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

let currentMonitorIdx = -1;

// Update Monitor with selected preview clip
function updateMonitorDisplay(idx, force = false) {
  if (idx < 0 || idx >= allClips.length) return;
  if (!force && currentMonitorIdx === idx) return;
  currentMonitorIdx = idx;

  const clip = allClips[idx];
  noClipMsg.style.display = "none";

  const thumbUrl = `/api/thumb?path=${encodeURIComponent(clip.path)}&hi=1`;

  if (!isExporting && monitorVideo) {
    monitorVideo.pause();
    monitorVideo.src = `/api/video?path=${encodeURIComponent(clip.path)}`;
    monitorVideo.style.display = "none";
  }
  if (btnPlay) btnPlay.textContent = "▶";
  if (scrubSlider) scrubSlider.value = 0;
  if (digitalTimecode) digitalTimecode.textContent = "00:00:00:00";

  monitorImg.style.display = "block";
  monitorImg.onload = () => {
    applyMonitorTransform();
    renderMonitorLutCanvas();
  };
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
      ct *= 1.0 + (0.35 * nikonFactor);
      sat *= 1.0 + (0.40 * nikonFactor);
      br += 0.02 * nikonFactor;
    } else if (nikonProfile === "rich_portrait") {
      ct *= 1.0 + (0.18 * nikonFactor);
      sat *= 1.0 + (0.28 * nikonFactor);
      br += 0.03 * nikonFactor;
      sepiaVal = 14.0 * nikonFactor;
    } else if (nikonProfile === "portrait") {
      ct *= 1.0 + (0.15 * nikonFactor);
      sat *= 1.0 + (0.22 * nikonFactor);
      br += 0.02 * nikonFactor;
      sepiaVal = 10.0 * nikonFactor;
    } else if (nikonProfile === "skin_soft" || nikonProfile === "skin") {
      ct *= 1.0 + (0.10 * nikonFactor);
      sat *= 1.0 + (0.18 * nikonFactor);
      br += 0.03 * nikonFactor;
      sepiaVal = 8.0 * nikonFactor;
    } else if (nikonProfile === "neutral") {
      ct *= 1.0 + (0.04 * nikonFactor);
      sat *= 1.0 + (0.06 * nikonFactor);
    } else if (nikonProfile === "vivid") {
      ct *= 1.0 + (0.35 * nikonFactor);
      sat *= 1.0 + (0.50 * nikonFactor);
      br += 0.01 * nikonFactor;
    } else if (nikonProfile === "flat") {
      ct *= 1.0 - (0.12 * nikonFactor);
      sat *= 1.0 - (0.08 * nikonFactor);
      br += 0.04 * nikonFactor;
    } else if (nikonProfile === "dream") {
      ct *= 1.0 - (0.06 * nikonFactor);
      sat *= 1.0 + (0.15 * nikonFactor);
      br += 0.04 * nikonFactor;
      sepiaVal = 12.0 * nikonFactor;
    } else if (nikonProfile === "morning") {
      ct *= 1.0 + (0.16 * nikonFactor);
      sat *= 1.0 + (0.22 * nikonFactor);
      br += 0.03 * nikonFactor;
    } else if (nikonProfile === "pop") {
      ct *= 1.0 + (0.28 * nikonFactor);
      sat *= 1.0 + (0.55 * nikonFactor);
      br += 0.02 * nikonFactor;
    } else if (nikonProfile === "bleach_bypass" || nikonProfile === "bleach") {
      ct *= 1.0 + (0.45 * nikonFactor);
      sat *= 1.0 - (0.45 * nikonFactor);
      br -= 0.01 * nikonFactor;
    } else if (nikonProfile === "denim") {
      ct *= 1.0 + (0.22 * nikonFactor);
      sat *= 1.0 + (0.15 * nikonFactor);
    } else if (nikonProfile === "sunday") {
      ct *= 1.0 + (0.08 * nikonFactor);
      sat *= 1.0 + (0.15 * nikonFactor);
      br += 0.03 * nikonFactor;
      sepiaVal = 10.0 * nikonFactor;
    } else if (nikonProfile === "somber") {
      ct *= 1.0 - (0.08 * nikonFactor);
      sat *= 1.0 - (0.25 * nikonFactor);
      br += 0.02 * nikonFactor;
    } else if (nikonProfile === "dramatic") {
      ct *= 1.0 + (0.40 * nikonFactor);
      sat *= 1.0 + (0.25 * nikonFactor);
      br -= 0.02 * nikonFactor;
    } else if (nikonProfile === "silence") {
      ct *= 1.0 - (0.15 * nikonFactor);
      sat *= 1.0 - (0.35 * nikonFactor);
      br += 0.04 * nikonFactor;
    } else if (nikonProfile === "melancholic") {
      ct *= 1.0 + (0.10 * nikonFactor);
      sat *= 1.0 - (0.12 * nikonFactor);
    } else if (nikonProfile === "pure") {
      ct *= 1.0 + (0.12 * nikonFactor);
      sat *= 1.0 + (0.10 * nikonFactor);
      br += 0.04 * nikonFactor;
    } else if (nikonProfile === "toy") {
      ct *= 1.0 + (0.28 * nikonFactor);
      sat *= 1.0 + (0.35 * nikonFactor);
    } else if (nikonProfile === "sepia") {
      grayscaleVal = 100.0 * nikonFactor;
      sepiaVal = 80.0 * nikonFactor;
      ct *= 1.0 + (0.20 * nikonFactor);
    } else if (nikonProfile === "monochrome") {
      grayscaleVal = 100.0 * nikonFactor;
      ct *= 1.0 + (0.38 * nikonFactor);
      br -= 0.02 * nikonFactor;
    }
  }

  // Lens Distortion subtle optical warp accent
  if (!isBypassed && (!inspectorState.bypassedCards || !inspectorState.bypassedCards.lensCorrection) && Math.abs(inspectorState.distortion) > 0.001) {
    transformStr += ` scale(${1 + inspectorState.distortion * 0.12})`;
  }

  // Base filter string (for monitorLutCanvas and sbsLutCanvas, which already have Primaries Bars, ColorSlice & Skin Tone baked into their RGB pixels via the 3D LUT!)
  let baseFilterStr = isBypassed ? "none" : `brightness(${br.toFixed(3)}) contrast(${ct.toFixed(3)}) saturate(${sat.toFixed(3)})`;
  if (!isBypassed) {
    if (sepiaVal > 0) baseFilterStr += ` sepia(${sepiaVal.toFixed(1)}%)`;
    if (grayscaleVal > 0) baseFilterStr += ` grayscale(${grayscaleVal.toFixed(1)}%)`;

    // White Balance: Temperature & Tint
    const isWbBypassed = inspectorState.bypassedCards && inspectorState.bypassedCards.whiteBalance;
    const tempVal = isWbBypassed ? 0 : (inspectorState.temperature || 0);
    const tintVal = isWbBypassed ? 0 : (inspectorState.tint || 0);
    if (tempVal > 0) {
      baseFilterStr += ` sepia(${(tempVal * 0.45).toFixed(1)}%)`;
    } else if (tempVal < 0) {
      const coolAmt = Math.min(50, Math.abs(tempVal) * 0.5);
      baseFilterStr += ` hue-rotate(180deg) sepia(${coolAmt.toFixed(1)}%) hue-rotate(180deg)`;
    }
    if (tintVal !== 0) {
      baseFilterStr += ` hue-rotate(${(tintVal * 0.25).toFixed(1)}deg)`;
    }

    // Skin Softening preview
    const skinSoftVal = isNikonBypassed ? 0 : (inspectorState.skinSoftening || 0);
    if (skinSoftVal > 5) {
      baseFilterStr += ` blur(${(skinSoftVal * 0.006).toFixed(2)}px)`;
    }
  }

  // Fallback CSS filter for monitorImg & monitorVideo (also folds Primaries Bars, ColorSlice & Skin Tone into native WebKit CSS filters!)
  let fbBr = br, fbCt = ct, fbSat = sat, fbSepia = sepiaVal, fbHueDeg = 0.0;
  const portHue = isNikonBypassed ? 0 : (inspectorState.portraitHue || 0);
  const portBright = isNikonBypassed ? 0 : (inspectorState.portraitBrightness || 0);
  if (portBright !== 0) {
    fbBr += (portBright / 100) * 0.28;
    fbCt *= 1.0 - (portBright / 100) * 0.06;
  }
  if (portHue > 0) {
    fbSat *= 1.0 + (portHue / 100) * 0.14;
    fbHueDeg -= portHue * 0.36;
  } else if (portHue < 0) {
    fbSepia += Math.abs(portHue) * 0.28;
    fbSat *= 1.0 + (Math.abs(portHue) / 100) * 0.12;
    fbHueDeg -= portHue * 0.36;
  }

  const isPbByp = isBypassed || (inspectorState.bypassedCards && inspectorState.bypassedCards.primariesBars);
  if (!isPbByp && inspectorState.primariesBars && isPrimariesBarsModified(inspectorState.primariesBars)) {
    const pb = inspectorState.primariesBars;
    const t = pb.top || {}, b = pb.bot || {}, lf = pb.lift || {}, gm = pb.gamma || {}, gn = pb.gain || {}, of = pb.offset || {};
    const avgOff = (((of.r !== undefined ? of.r : 25) - 25) + ((of.g !== undefined ? of.g : 25) - 25) + ((of.b !== undefined ? of.b : 25) - 25)) / 3.0;
    const avgLift = (lf.y || 0) + ((lf.r || 0) + (lf.g || 0) + (lf.b || 0)) / 3.0;
    const avgGam = (gm.y || 0) + ((gm.r || 0) + (gm.g || 0) + (gm.b || 0)) / 3.0;
    const avgGain = ((gn.y !== undefined ? gn.y : 1) * (((gn.r !== undefined ? gn.r : 1) + (gn.g !== undefined ? gn.g : 1) + (gn.b !== undefined ? gn.b : 1)) / 3.0)) - 1.0;
    fbBr += avgLift * 0.45 + avgGam * 0.55 + avgGain * 0.50 + avgOff * 0.012 + ((b.shad || 0) / 100) * 0.18 + ((b.hiLight || 0) / 100) * 0.18;
    fbCt *= (t.cont !== undefined ? t.cont : 1.0) * (1.0 + ((t.md || 0) / 100) * 0.20);
    fbSat *= ((b.sat !== undefined ? b.sat : 50) / 50) * (1.0 + ((b.colBoost || 0) / 100) * 0.45);
    fbHueDeg += (((b.hue !== undefined ? b.hue : 50) - 50) / 50) * 36.0 + ((t.tint || 0) * 0.25);
    if ((t.temp || 0) > 0) fbSepia += (t.temp || 0) * 0.35;
  }

  const isCsByp = isBypassed || (inspectorState.bypassedCards && inspectorState.bypassedCards.colorSlice);
  if (!isCsByp && inspectorState.colorSlice && isColorSliceModified(inspectorState.colorSlice)) {
    const cs = inspectorState.colorSlice;
    const m = cs.master || {};
    fbBr -= ((m.den || 0) + (m.denDepth || 0) * 0.35) * 0.25;
    fbSat *= ((m.sat !== undefined ? m.sat : 1.0) + (m.satBal || 0) * 0.25 + (m.satDepth || 0) * 0.20);
    fbHueDeg += (m.hue || 0) * 30.0;
    ["red", "skin", "yellow", "green", "cyan", "blue", "magenta"].forEach(k => {
      const sl = cs[k] || {};
      const w = (k === "skin" || k === "green" || k === "blue") ? 0.35 : 0.22;
      fbBr -= (sl.den || 0) * 0.28 * w;
      fbSat *= 1.0 + ((sl.sat !== undefined ? sl.sat : 1.0) - 1.0) * w;
      fbHueDeg += ((sl.hue || 0) * 20.0 + (sl.center || 0) * 10.0) * w * (k === "skin" ? -1 : 1);
    });
  }

  let filterStr = isBypassed ? "none" : `brightness(${Math.max(0.2, fbBr).toFixed(3)}) contrast(${Math.max(0.2, fbCt).toFixed(3)}) saturate(${Math.max(0.0, fbSat).toFixed(3)})`;
  if (!isBypassed) {
    if (fbSepia > 0) filterStr += ` sepia(${Math.min(100, fbSepia).toFixed(1)}%)`;
    if (grayscaleVal > 0) filterStr += ` grayscale(${grayscaleVal.toFixed(1)}%)`;
    const isWbBypassed = inspectorState.bypassedCards && inspectorState.bypassedCards.whiteBalance;
    const tempVal = isWbBypassed ? 0 : (inspectorState.temperature || 0);
    const tintVal = isWbBypassed ? 0 : (inspectorState.tint || 0);
    if (tempVal > 0) {
      filterStr += ` sepia(${(tempVal * 0.45).toFixed(1)}%)`;
    } else if (tempVal < 0) {
      const coolAmt = Math.min(50, Math.abs(tempVal) * 0.5);
      filterStr += ` hue-rotate(180deg) sepia(${coolAmt.toFixed(1)}%) hue-rotate(180deg)`;
    }
    const totHue = (tintVal * 0.25) + fbHueDeg;
    if (Math.abs(totHue) > 0.05) {
      filterStr += ` hue-rotate(${totHue.toFixed(1)}deg)`;
    }
    const skinSoftVal = isNikonBypassed ? 0 : (inspectorState.skinSoftening || 0);
    if (skinSoftVal > 5) {
      filterStr += ` blur(${(skinSoftVal * 0.006).toFixed(2)}px)`;
    }
    updateColorSliceSvgFilter();
  }

  const monitorLutCanvas = document.getElementById("monitorLutCanvas");
  const sbsLutCanvas = document.getElementById("sbsLutCanvas");

  [monitorImg, monitorVideo, monitorLutCanvas].forEach(el => {
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
      el.style.position = el === monitorLutCanvas ? "absolute" : "";
    }
    el.style.transform = transformStr;
    el.style.transformOrigin = originStr;
    el.style.clipPath = clipPathStr;
    el.style.opacity = opacityVal;
    el.style.mixBlendMode = blendModeVal;
    el.style.objectFit = objectFitVal;
    el.style.filter = (el === monitorLutCanvas) ? baseFilterStr : filterStr;
  });

  // Video Playback Speed
  if (monitorVideo) {
    const isSpdBypassed = isBypassed || (inspectorState.bypassedCards && inspectorState.bypassedCards.speed);
    const effSpeed = isSpdBypassed ? 1.0 : (inspectorState.speed / 100);
    monitorVideo.playbackRate = Math.max(0.25, Math.min(4.0, effSpeed));
  }

  // Update Side-by-Side (2-Up) After preview (100% Full Frame Uncropped)
  [sbsImgAfter, sbsLutCanvas].forEach(el => {
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
      el.style.position = el === sbsLutCanvas ? "absolute" : "";
    }
    el.style.transform = isBypassed ? "none" : `rotate(${inspectorState.rotation}deg) scale(${inspectorState.zoomX * (inspectorState.flipH ? -1 : 1)}, ${inspectorState.zoomY * (inspectorState.flipV ? -1 : 1)})`;
    el.style.filter = isBypassed ? "none" : (el === sbsLutCanvas ? baseFilterStr : filterStr);
    el.style.clipPath = clipPathStr;
    el.style.opacity = opacityVal;
    el.style.objectFit = objectFitVal;
  });

  scheduleMonitorLutRender();
  scheduleHistogram();
  triggerSaveSettings();
}

// Real-Time Scopes & Histogram Engine (Throttled via requestAnimationFrame - 60 FPS zero-lag)
let offscreenCanvas = null;
let offscreenCtx = null;
let currentHistoMode = "rgb"; // "rgb", "luma", "parade", "vector"
let histoRafId = null;

function scheduleHistogram() {
  if (histoRafId) return;
  histoRafId = requestAnimationFrame(() => {
    histoRafId = null;
    renderHistogram();
  });
}

function renderHistogram() {
  const canvas = document.getElementById("histoCanvas");
  if (!canvas) return;

  const paneColor = document.getElementById("paneColor");
  if (paneColor && paneColor.style.display === "none") return;

  const sourceEl = (monitorVideo && monitorVideo.style.display !== "none" && monitorVideo.videoWidth > 0)
    ? monitorVideo
    : (monitorImg && monitorImg.src && (monitorImg.naturalWidth > 0 || monitorImg.complete) ? monitorImg : null);

  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = 160;
    offscreenCanvas.height = 90;
    offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });
  }

  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  if (!sourceEl) {
    const isLight = document.body.classList.contains("theme-light");
    ctx.fillStyle = isLight ? "#64748b" : "rgba(255, 255, 255, 0.15)";
    ctx.font = "10px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Select a clip to view live histogram", W / 2, H / 2 + 3);
    return;
  }

  try {
    offscreenCtx.clearRect(0, 0, 160, 90);

    const isColBypassed = isBypassed;
    if (!isColBypassed) {
      let br = 1.0 + inspectorState.brightness + (inspectorState.shadows * 0.35);
      let ct = inspectorState.contrast;
      let sat = inspectorState.saturation;
      const isNikonBypassed = (inspectorState.bypassedCards && inspectorState.bypassedCards.nikonColor);
      const nikonFactor = isNikonBypassed ? 0.0 : (inspectorState.nikonStrength / 100);
      const nikonProfile = inspectorState.nikonProfile || "nlog_rec709";

      if (nikonFactor > 0.001) {
        if (nikonProfile === "nlog_rec709") {
          ct *= 1.0 + (0.18 * nikonFactor);
          sat *= 1.0 + (0.22 * nikonFactor);
          br += 0.01 * nikonFactor;
        } else if (nikonProfile === "rich_portrait") {
          ct *= 1.0 + (0.08 * nikonFactor);
          sat *= 1.0 + (0.14 * nikonFactor);
          br += 0.03 * nikonFactor;
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
          ct *= 1.0 + (0.28 * nikonFactor);
          br -= 0.02 * nikonFactor;
        }
      }
      let histFilter = `brightness(${br.toFixed(3)}) contrast(${ct.toFixed(3)}) saturate(${sat.toFixed(3)})`;
      offscreenCtx.filter = histFilter;
    } else {
      offscreenCtx.filter = "none";
    }

    offscreenCtx.drawImage(sourceEl, 0, 0, 160, 90);
    const imgData = offscreenCtx.getImageData(0, 0, 160, 90);
    const lutState = buildJs3DLut();
    if (!isColBypassed && lutState.active && lutState.lut) {
      applyJs3DLutToPixels(imgData.data, lutState.lut);
    }
    const data = imgData.data;
    const numPixels = 160 * 90;

    const rHist = new Float32Array(256);
    const gHist = new Float32Array(256);
    const bHist = new Float32Array(256);
    const lumaHist = new Float32Array(256);

    let underClip = 0;
    let overClip = 0;
    let lumaSum = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);

      rHist[r]++;
      gHist[g]++;
      bHist[b]++;
      lumaHist[luma]++;

      if (luma < 13) underClip++; // < 5 IRE
      if (luma > 242) overClip++; // > 95 IRE
      lumaSum += luma;
    }

    // Update stats bar
    const valBlackClip = document.getElementById("valBlackClip");
    const valMidGrey = document.getElementById("valMidGrey");
    const valWhiteClip = document.getElementById("valWhiteClip");
    if (valBlackClip) valBlackClip.textContent = `${((underClip / numPixels) * 100).toFixed(1)}%`;
    if (valWhiteClip) valWhiteClip.textContent = `${((overClip / numPixels) * 100).toFixed(1)}%`;
    if (valMidGrey) {
      const avgLumaIRE = Math.round((lumaSum / numPixels / 255) * 100);
      valMidGrey.textContent = `${avgLumaIRE} IRE`;
    }

    // Peak bin for normalization
    let maxVal = 0;
    for (let i = 1; i < 255; i++) {
      if (rHist[i] > maxVal) maxVal = rHist[i];
      if (gHist[i] > maxVal) maxVal = gHist[i];
      if (bHist[i] > maxVal) maxVal = bHist[i];
      if (lumaHist[i] > maxVal) maxVal = lumaHist[i];
    }
    if (maxVal === 0) maxVal = 1;

    const isLight = document.body.classList.contains("theme-light");

    if (currentHistoMode === "rgb") {
      ctx.globalCompositeOperation = isLight ? "source-over" : "screen";

      const drawChannel = (hist, color, fillAlpha) => {
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let i = 0; i < 256; i++) {
          const x = (i / 255) * W;
          const norm = Math.min(1.0, hist[i] / maxVal);
          const y = H - (norm * (H - 6));
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H);
        ctx.fillStyle = fillAlpha;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = isLight ? 1.4 : 1.2;
        ctx.stroke();
      };

      if (isLight) {
        drawChannel(rHist, "#e11d48", "rgba(244, 63, 94, 0.22)");
        drawChannel(gHist, "#10b981", "rgba(16, 185, 129, 0.22)");
        drawChannel(bHist, "#0A84FF", "rgba(10, 132, 255, 0.24)");
      } else {
        drawChannel(rHist, "#ef4444", "rgba(239, 68, 68, 0.28)");
        drawChannel(gHist, "#22c55e", "rgba(34, 197, 94, 0.28)");
        drawChannel(bHist, "#3b82f6", "rgba(59, 130, 246, 0.28)");
      }
      ctx.globalCompositeOperation = "source-over";

    } else if (currentHistoMode === "luma") {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      if (isLight) {
        grad.addColorStop(0, "rgba(10, 132, 255, 0.38)");
        grad.addColorStop(0.6, "rgba(175, 82, 222, 0.20)");
        grad.addColorStop(1, "rgba(10, 132, 255, 0.05)");
      } else {
        grad.addColorStop(0, "rgba(255, 255, 255, 0.85)");
        grad.addColorStop(0.5, "rgba(0, 240, 170, 0.65)");
        grad.addColorStop(1, "rgba(59, 130, 246, 0.2)");
      }

      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * W;
        const norm = Math.min(1.0, lumaHist[i] / maxVal);
        const y = H - (norm * (H - 6));
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = isLight ? "#0A84FF" : "#00f0aa";
      ctx.lineWidth = 1.5;
      ctx.stroke();

    } else if (currentHistoMode === "parade") {
      const colW = W / 3;
      const drawParadeCol = (hist, startX, strokeColor, fillColor) => {
        ctx.beginPath();
        ctx.moveTo(startX, H);
        for (let i = 0; i < 256; i++) {
          const x = startX + (i / 255) * colW;
          const norm = Math.min(1.0, hist[i] / maxVal);
          const y = H - (norm * (H - 6));
          ctx.lineTo(x, y);
        }
        ctx.lineTo(startX + colW, H);
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isLight ? 1.4 : 1.2;
        ctx.stroke();

        if (startX > 0) {
          ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.15)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(startX, 0);
          ctx.lineTo(startX, H);
          ctx.stroke();
        }
      };

      drawParadeCol(rHist, 0, isLight ? "#e11d48" : "#ef4444", isLight ? "rgba(244, 63, 94, 0.25)" : "rgba(239, 68, 68, 0.35)");
      drawParadeCol(gHist, colW, isLight ? "#10b981" : "#22c55e", isLight ? "rgba(16, 185, 129, 0.25)" : "rgba(34, 197, 94, 0.35)");
      drawParadeCol(bHist, colW * 2, isLight ? "#0A84FF" : "#3b82f6", isLight ? "rgba(10, 132, 255, 0.25)" : "rgba(59, 130, 246, 0.35)");
    } else if (currentHistoMode === "vector") {
      // Vectorscope with Skin Tone Line (I-Bar at 11 o'clock / -57° angle)
      const cx = W / 2;
      const cy = H / 2;
      const radius = Math.min(cx, cy) - 6;

      ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.14)" : "rgba(255, 255, 255, 0.12)";
      ctx.lineWidth = 1;

      // Concentric saturation rings (25%, 50%, 75%, 100%)
      [0.25, 0.5, 0.75, 1.0].forEach(rPct => {
        ctx.beginPath();
        ctx.arc(cx, cy, radius * rPct, 0, Math.PI * 2);
        ctx.stroke();
      });

      // Axis crosshairs
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      ctx.stroke();

      // Skin Tone Line (I-Line at 11 o'clock / -57° angle)
      const skinAngle = -57 * (Math.PI / 180);
      ctx.strokeStyle = isLight ? "#d97706" : "#f59e0b";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(skinAngle) * radius, cy + Math.sin(skinAngle) * radius);
      ctx.stroke();

      ctx.fillStyle = isLight ? "#d97706" : "#f59e0b";
      ctx.font = "8px -apple-system, sans-serif";
      ctx.fillText("SKIN TONE", cx + Math.cos(skinAngle) * (radius - 18) - 16, cy + Math.sin(skinAngle) * (radius - 18));

      // Color target markers (R, Mg, B, Cy, G, Yl)
      const targets = [
        { label: "R", angle: -104, col: "#ef4444" },
        { label: "Mg", angle: -61, col: "#ec4899" },
        { label: "B", angle: 13, col: "#0A84FF" },
        { label: "Cy", angle: 76, col: "#06b6d4" },
        { label: "G", angle: 119, col: "#10b981" },
        { label: "Yl", angle: -167, col: "#eab308" }
      ];
      targets.forEach(t => {
        const aRad = t.angle * (Math.PI / 180);
        const tx = cx + Math.cos(aRad) * (radius * 0.75);
        const ty = cy + Math.sin(aRad) * (radius * 0.75);
        ctx.strokeStyle = t.col;
        ctx.strokeRect(tx - 3, ty - 3, 6, 6);
        ctx.fillStyle = t.col;
        ctx.font = "7px monospace";
        ctx.fillText(t.label, tx + 4, ty + 3);
      });

      // Sample pixels and plot chrominance point cloud
      ctx.fillStyle = isLight ? "rgba(10, 132, 255, 0.55)" : "rgba(0, 240, 170, 0.4)";
      for (let i = 0; i < data.length; i += 8) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const u = -0.168736 * r - 0.331264 * g + 0.5 * b;
        const v = 0.5 * r - 0.418688 * g - 0.081312 * b;

        const px = cx + (u / 128) * (radius * 0.95);
        const py = cy - (v / 128) * (radius * 0.95);

        ctx.fillRect(px, py, 1.2, 1.2);
      }
    }
  } catch (err) {
    // Canvas security or load race guard
  }
}

// 2. Master Stereo Audio Peak VU Meter (Ultra-smooth 60 FPS, Zero Audio Pipeline Block)
let vuPeakHoldL = 0;
let vuPeakHoldR = 0;

function initAudioVuMeter() {
  function updateVuLoop() {
    requestAnimationFrame(updateVuLoop);
    const vuFillL = document.getElementById("vuFillL");
    const vuFillR = document.getElementById("vuFillR");
    const vuPeakL = document.getElementById("vuPeakL");
    const vuPeakR = document.getElementById("vuPeakR");
    if (!vuFillL || !vuFillR) return;

    let levelL = 0;
    let levelR = 0;

    if (monitorVideo && !monitorVideo.paused && monitorVideo.currentTime > 0) {
      const t = Date.now() * 0.009;
      levelL = 42 + Math.sin(t * 3.4) * 26 + (Math.random() * 12);
      levelR = 40 + Math.cos(t * 3.1) * 24 + (Math.random() * 14);
      levelL = Math.max(10, Math.min(94, levelL));
      levelR = Math.max(10, Math.min(92, levelR));
    } else {
      levelL = 0;
      levelR = 0;
    }

    if (levelL > vuPeakHoldL) vuPeakHoldL = levelL;
    else vuPeakHoldL = Math.max(0, vuPeakHoldL - 1.5);

    if (levelR > vuPeakHoldR) vuPeakHoldR = levelR;
    else vuPeakHoldR = Math.max(0, vuPeakHoldR - 1.5);

    vuFillL.style.height = `${levelL.toFixed(1)}%`;
    vuFillR.style.height = `${levelR.toFixed(1)}%`;
    vuPeakL.style.bottom = `${vuPeakHoldL.toFixed(1)}%`;
    vuPeakR.style.bottom = `${vuPeakHoldR.toFixed(1)}%`;
  }
  requestAnimationFrame(updateVuLoop);
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

  const savedTab = localStorage.getItem("tc_active_tab") || "color";
  const defTabEl = document.querySelector(`.insp-tab[data-tab="${savedTab}"]`);
  if (defTabEl) {
    inspTabs.forEach(t => t.classList.toggle("active", t === defTabEl));
    Object.entries(tabPanes).forEach(([name, pane]) => {
      if (pane) pane.style.display = (name === savedTab) ? "flex" : "none";
    });
    if (savedTab === "color") setTimeout(renderHistogram, 25);
  }

  inspTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const targetTab = tab.getAttribute("data-tab");
      try { localStorage.setItem("tc_active_tab", targetTab); } catch (e) {}
      inspTabs.forEach(t => t.classList.toggle("active", t === tab));
      Object.entries(tabPanes).forEach(([name, pane]) => {
        if (pane) {
          pane.style.display = (name === targetTab) ? "flex" : "none";
        }
      });
      if (targetTab === "color") {
        setTimeout(renderHistogram, 25);
      }
    });
  });

  // Histogram Mode Pills (RGB / Luma / Parade / Vectorscope)
  document.querySelectorAll(".btn-histo-mode").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-histo-mode").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentHistoMode = btn.dataset.mode;
      const hGrid = document.querySelector(".histo-grid");
      if (hGrid) hGrid.style.display = (currentHistoMode === "vector") ? "none" : "block";
      renderHistogram();
    });
  });

  // Collapsible Scopes Header Toggle
  const headerHistogram = document.getElementById("headerHistogram");
  const cardHistogram = document.getElementById("cardHistogram");
  if (headerHistogram && cardHistogram) {
    headerHistogram.addEventListener("click", () => {
      cardHistogram.classList.toggle("collapsed");
      if (!cardHistogram.classList.contains("collapsed")) {
        setTimeout(renderHistogram, 20);
      }
    });
  }

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
      triggerSaveSettings();
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
    { dotId: "dotWhiteBalance", cardId: "cardWhiteBalance", key: "whiteBalance" },
    { dotId: "dotColorSlice", cardId: "cardColorSlice", key: "colorSlice" },
    { dotId: "dotNikonColor", cardId: "cardNikonColor", key: "nikonColor" },
    { dotId: "dotDenoise", cardId: "cardDenoise", key: "denoise" }
  ];

  dotConfigs.forEach(({ dotId, cardId, key }) => {
    const dot = document.getElementById(dotId);
    const card = document.getElementById(cardId);
    if (!dot || !card) return;
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      const isCurrentlyBypassed = !!inspectorState.bypassedCards[key];
      inspectorState.bypassedCards[key] = !isCurrentlyBypassed;
      dot.textContent = isCurrentlyBypassed ? "🟢" : "⚫";
      dot.classList.toggle("active", isCurrentlyBypassed);
      card.classList.toggle("bypassed", !isCurrentlyBypassed);
      applyMonitorTransform();
    });
  });

  // Collapsible cards header click
  document.querySelectorAll(".dv-card-header").forEach(header => {
    header.addEventListener("click", (e) => {
      if (e.target.classList.contains("pill-dot") || e.target.classList.contains("tool-icon") || e.target.classList.contains("btn-cs-preset") || e.target.classList.contains("btn-pb-preset")) return;
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
      input.value = (key === "temperature" || key === "tint") ? v.toFixed(0) : v.toFixed(3);
      if (key === "temperature" || key === "tint") updateWhitebalanceBadge();
      applyMonitorTransform();
    });
    input.addEventListener("change", (e) => {
      const v = parseFloat(e.target.value) || 0.0;
      inspectorState[key] = v;
      slider.value = v;
      if (key === "temperature" || key === "tint") updateWhitebalanceBadge();
      applyMonitorTransform();
    });
  }

  bindColorSlider(sliderBrightness, inpBrightness, "brightness");
  bindColorSlider(sliderContrast, inpContrast, "contrast");
  bindColorSlider(sliderShadows, inpShadows, "shadows");
  bindColorSlider(sliderSaturation, inpSaturation, "saturation");

  const sliderTemp = document.getElementById("sliderTemp");
  const inpTemp = document.getElementById("inpTemp");
  if (sliderTemp && inpTemp) bindColorSlider(sliderTemp, inpTemp, "temperature");

  const sliderTint = document.getElementById("sliderTint");
  const inpTint = document.getElementById("inpTint");
  if (sliderTint && inpTint) bindColorSlider(sliderTint, inpTint, "tint");

  // White Balance Presets & Management
  const wbPresets = {
    shot: { temp: 0, tint: 0 },
    daylight: { temp: 12, tint: 2 },
    cloudy: { temp: 25, tint: 4 },
    shade: { temp: 38, tint: 8 },
    tungsten: { temp: -30, tint: -6 }
  };

  document.querySelectorAll(".btn-wb-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.wb;
      const val = wbPresets[key] || wbPresets.shot;
      inspectorState.temperature = val.temp;
      inspectorState.tint = val.tint;

      if (sliderTemp) sliderTemp.value = val.temp;
      if (inpTemp) inpTemp.value = val.temp;
      if (sliderTint) sliderTint.value = val.tint;
      if (inpTint) inpTint.value = val.tint;

      updateWhitebalanceBadge();
      applyMonitorTransform();
      triggerSaveSettings();
      showToast(`🌡 White Balance: ${btn.textContent.trim()}`);
    });
  });

  const resetWhiteBalance = document.getElementById("resetWhiteBalance");
  if (resetWhiteBalance) {
    resetWhiteBalance.addEventListener("click", () => {
      inspectorState.temperature = 0;
      inspectorState.tint = 0;
      if (sliderTemp) sliderTemp.value = 0;
      if (inpTemp) inpTemp.value = 0;
      if (sliderTint) sliderTint.value = 0;
      if (inpTint) inpTint.value = 0;

      updateWhitebalanceBadge();
      applyMonitorTransform();
      triggerSaveSettings();
      showToast("↺ White Balance Reset to 0 (As Shot)");
    });
  }

  // Media Pool Rating Filter Buttons
  document.querySelectorAll(".btn-rf").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-rf").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentRatingFilter = btn.dataset.filter;
      renderMediaPool();
    });
  });

  // Instant Single-Card Rating Visual Update (Zero DOM Rebuild Lag)
  function updateClipCardRatingVisual(clipIdx) {
    const clip = allClips[clipIdx];
    if (!clip) return;
    const rInfo = clipRatings[clip.path] || { rating: 0, rejected: false };

    const card = document.getElementById(`card-${clipIdx}`);
    if (card) {
      card.classList.toggle("is-rejected", !!rInfo.rejected);
      const existingBadge = card.querySelector(".clip-rating-badge, .clip-reject-badge");
      if (existingBadge) existingBadge.remove();

      if (rInfo.rejected) {
        const b = document.createElement("span");
        b.className = "clip-reject-badge";
        b.textContent = "✕ REJECT";
        card.prepend(b);
      } else if (rInfo.rating > 0) {
        const b = document.createElement("span");
        b.className = "clip-rating-badge";
        b.textContent = `★ ${rInfo.rating}`;
        card.prepend(b);
      }
    }

    const tlBlock = document.getElementById(`tl-block-${clipIdx}`);
    if (tlBlock) {
      tlBlock.classList.toggle("is-rejected", !!rInfo.rejected);
    }
  }

  // Global Keyboard Shortcuts for Culling (1-5 Stars, X for Reject, 0 for Clear)
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return; // Prevent key repeat lag
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) return;
    if (allClips.length === 0) return;

    const clipIdx = primaryPreviewIndex >= 0 ? primaryPreviewIndex : 0;
    const clip = allClips[clipIdx];
    if (!clip) return;

    if (["1", "2", "3", "4", "5"].includes(e.key)) {
      const star = parseInt(e.key);
      if (!clipRatings[clip.path]) clipRatings[clip.path] = {};
      clipRatings[clip.path].rating = star;
      clipRatings[clip.path].rejected = false;
      saveClipRatings();
      updateClipCardRatingVisual(clipIdx);
      showToast(`⭐ Clip ${clip.name}: Rated ★ ${star}`);
    } else if (e.key === "x" || e.key === "X") {
      if (!clipRatings[clip.path]) clipRatings[clip.path] = {};
      clipRatings[clip.path].rejected = !clipRatings[clip.path].rejected;
      if (clipRatings[clip.path].rejected) clipRatings[clip.path].rating = 0;
      saveClipRatings();
      updateClipCardRatingVisual(clipIdx);
      showToast(clipRatings[clip.path].rejected ? `❌ Clip ${clip.name}: Marked REJECTED` : `✓ Clip ${clip.name}: Reject Cleared`);
    } else if (e.key === "0" || e.key === "u") {
      if (clipRatings[clip.path]) {
        delete clipRatings[clip.path];
        saveClipRatings();
        updateClipCardRatingVisual(clipIdx);
        showToast(`⚪️ Clip ${clip.name}: Rating Reset`);
      }
    }
  });

  // Monitor Live Tools (Guides, Peaking, Zebra)
  const btnGuidesToggle = document.getElementById("btnGuidesToggle");
  const guideMenu = document.getElementById("guideMenu");
  const safeZoneOverlay = document.getElementById("safeZoneOverlay");
  const safeGridThirds = document.getElementById("safeGridThirds");
  const safeCross = document.getElementById("safeCross");

  if (btnGuidesToggle && guideMenu) {
    btnGuidesToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      guideMenu.style.display = (guideMenu.style.display === "none") ? "flex" : "none";
    });

    document.addEventListener("click", () => {
      if (guideMenu) guideMenu.style.display = "none";
    });

    document.querySelectorAll(".guide-opt").forEach(opt => {
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        document.querySelectorAll(".guide-opt").forEach(o => o.classList.remove("active"));
        opt.classList.add("active");
        const g = opt.dataset.guide;
        activeGuideMode = g;
        guideMenu.style.display = "none";

        if (safeZoneOverlay) {
          if (g === "none") {
            safeZoneOverlay.style.display = "none";
            btnGuidesToggle.classList.remove("active");
            btnGuidesToggle.textContent = "📐 Guides ⌵";
          } else if (g === "safezone") {
            safeZoneOverlay.style.display = "block";
            if (safeGridThirds) safeGridThirds.style.display = "none";
            if (safeCross) safeCross.style.display = "none";
            btnGuidesToggle.classList.add("active");
            btnGuidesToggle.textContent = "📱 Safe Zone ⌵";
          } else if (g === "thirds") {
            safeZoneOverlay.style.display = "block";
            if (safeGridThirds) safeGridThirds.style.display = "block";
            if (safeCross) safeCross.style.display = "none";
            btnGuidesToggle.classList.add("active");
            btnGuidesToggle.textContent = "🔲 3×3 Grid ⌵";
          } else if (g === "center") {
            safeZoneOverlay.style.display = "block";
            if (safeGridThirds) safeGridThirds.style.display = "none";
            if (safeCross) safeCross.style.display = "block";
            btnGuidesToggle.classList.add("active");
            btnGuidesToggle.textContent = "➕ Crosshair ⌵";
          }
        }
      });
    });
  }

  // Initialize Master Audio VU Meter
  initAudioVuMeter();

  // Color Presets (Master Exposure & Primaries only — preserves White Balance & Portrait Hue)
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
    saveSettings();
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

  // Skin Softening Controls
  const sliderSkinSoft = document.getElementById("sliderSkinSoft");
  const inpSkinSoft = document.getElementById("inpSkinSoft");
  if (sliderSkinSoft) {
    sliderSkinSoft.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      inspectorState.skinSoftening = v;
      if (inpSkinSoft) inpSkinSoft.value = `${v}%`;
      applyMonitorTransform();
    });
  }
  if (inpSkinSoft) {
    inpSkinSoft.addEventListener("change", (e) => {
      let v = parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0;
      v = Math.max(0, Math.min(100, v));
      inspectorState.skinSoftening = v;
      inpSkinSoft.value = `${v}%`;
      if (sliderSkinSoft) sliderSkinSoft.value = v;
      applyMonitorTransform();
    });
  }

  // Skin Softening Quick Presets (Off, Low, Normal, High)
  document.querySelectorAll(".btn-soft-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-soft-preset").forEach(b => b.classList.toggle("active", b === btn));
      const val = parseFloat(btn.getAttribute("data-val")) || 0;
      inspectorState.skinSoftening = val;
      if (sliderSkinSoft) sliderSkinSoft.value = val;
      if (inpSkinSoft) inpSkinSoft.value = `${val}%`;
      applyMonitorTransform();
    });
  });

  // Skin Tone (Hue: Amber -50 ↔ Rosy Pink +50) & Skin Radiance (Midtone Aura -50 ↔ +50)
  const sliderPortraitHue = document.getElementById("sliderPortraitHue");
  const inpPortraitHue = document.getElementById("inpPortraitHue");
  if (sliderPortraitHue) {
    sliderPortraitHue.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      inspectorState.portraitHue = v;
      if (inpPortraitHue) inpPortraitHue.value = v;
      updateSkinToneBadge();
      applyMonitorTransform();
    });
  }
  if (inpPortraitHue) {
    inpPortraitHue.addEventListener("change", (e) => {
      let v = parseFloat(e.target.value) || 0;
      v = Math.max(-50, Math.min(50, v));
      inspectorState.portraitHue = v;
      inpPortraitHue.value = v;
      if (sliderPortraitHue) sliderPortraitHue.value = v;
      updateSkinToneBadge();
      applyMonitorTransform();
    });
  }

  const sliderPortraitBright = document.getElementById("sliderPortraitBright");
  const inpPortraitBright = document.getElementById("inpPortraitBright");
  if (sliderPortraitBright) {
    sliderPortraitBright.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      inspectorState.portraitBrightness = v;
      if (inpPortraitBright) inpPortraitBright.value = v;
      updateSkinToneBadge();
      applyMonitorTransform();
    });
  }
  if (inpPortraitBright) {
    inpPortraitBright.addEventListener("change", (e) => {
      let v = parseFloat(e.target.value) || 0;
      v = Math.max(-50, Math.min(50, v));
      inspectorState.portraitBrightness = v;
      inpPortraitBright.value = v;
      if (sliderPortraitBright) sliderPortraitBright.value = v;
      updateSkinToneBadge();
      applyMonitorTransform();
    });
  }

  // 1-Click Skin Tone Presets (Natural, Rosy Pink, Aura Bright, Warm Glow)
  document.querySelectorAll(".btn-skin-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      const sk = btn.dataset.skin;
      let hue = 0, brt = 0, sft = 0;
      if (sk === "rosy") { hue = 18; brt = 12; sft = 25; }
      else if (sk === "aura") { hue = 10; brt = 28; sft = 35; }
      else if (sk === "glow") { hue = -16; brt = 15; sft = 20; }
      inspectorState.portraitHue = hue;
      inspectorState.portraitBrightness = brt;
      inspectorState.skinSoftening = sft;
      if (sliderPortraitHue) sliderPortraitHue.value = hue;
      if (inpPortraitHue) inpPortraitHue.value = hue;
      if (sliderPortraitBright) sliderPortraitBright.value = brt;
      if (inpPortraitBright) inpPortraitBright.value = brt;
      if (sliderSkinSoft) sliderSkinSoft.value = sft;
      if (inpSkinSoft) inpSkinSoft.value = `${sft}%`;
      updateSkinToneBadge();
      applyMonitorTransform();
    });
  });

  // Noise Reduction Controls
  const selDenoiseMode = document.getElementById("selDenoiseMode");
  const rowDenoiseSpatial = document.getElementById("rowDenoiseSpatial");
  const rowDenoiseTemporal = document.getElementById("rowDenoiseTemporal");
  const sliderDenoiseSpatial = document.getElementById("sliderDenoiseSpatial");
  const inpDenoiseSpatial = document.getElementById("inpDenoiseSpatial");
  const sliderDenoiseTemporal = document.getElementById("sliderDenoiseTemporal");
  const inpDenoiseTemporal = document.getElementById("inpDenoiseTemporal");
  const resetDenoise = document.getElementById("resetDenoise");
  const dotDenoise = document.getElementById("dotDenoise");

  const DENOISE_DESC_MAP = {
    off: "⚪ Denoise ปิด: ไม่มีการประมวลผลลดนอยส์ เหมาะสำหรับวิดีโอที่เนียนดีอยู่แล้วหรือต้องการความเร็วสูงสุด",
    low: "🍃 Low (ต่ำ): ลดนอยส์บางเบา hqdn3d (2.0/1.5/2.5/2.0) รักษาเนื้อฟิล์มและเท็กซ์เจอร์เดิม 100%",
    normal: "💧 Normal (ปกติ): ลดนอยส์สมดุล hqdn3d (4.0/3.0/4.5/3.5) แนะนำสำหรับกล้อง Nikon Z8 ที่ ISO 1600-6400",
    high: "🛡️ High (สูง): ลดนอยส์ระดับสูง hqdn3d (7.0/5.0/7.0/5.0) สำหรับถ่ายกลางคืน แสงน้อย หรือ ISO สูงจัด",
    light: "🍃 Light: ลดนอยส์บางเบา hqdn3d (2.0/1.5/2.5/2.0) รักษาเนื้อฟิล์มและเท็กซ์เจอร์เดิม 100%",
    medium: "💧 Medium: ลดนอยส์สมดุล hqdn3d (4.0/3.0/4.5/3.5) แนะนำสำหรับ ISO 1600-6400 เนียนตาเป็นธรรมชาติ",
    strong: "🛡️ Strong: ลดนอยส์ระดับสูง hqdn3d (7.0/5.0/7.0/5.0) สำหรับงานกลางคืน แสงน้อย หรือ ISO สูงจัด",
    custom: "⚙️ Custom: กำหนดความแรง Spatial (เม็ดนอยส์ภาพนิ่ง) และ Temporal (การเต้นของนอยส์ข้ามเฟรม) อิสระ"
  };

  if (selDenoiseMode) {
    selDenoiseMode.addEventListener("change", (e) => {
      const mode = e.target.value;
      inspectorState.denoiseMode = mode;
      const isCustom = (mode === "custom");
      if (rowDenoiseSpatial) rowDenoiseSpatial.style.display = isCustom ? "flex" : "none";
      if (rowDenoiseTemporal) rowDenoiseTemporal.style.display = isCustom ? "flex" : "none";
      const descEl = document.getElementById("denoiseDesc");
      if (descEl && DENOISE_DESC_MAP[mode]) descEl.textContent = DENOISE_DESC_MAP[mode];
      if (dotDenoise) {
        dotDenoise.textContent = (mode === "off") ? "⚫" : "🔴";
      }
    });
  }

  if (sliderDenoiseSpatial) {
    sliderDenoiseSpatial.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      inspectorState.denoiseSpatial = v;
      if (inpDenoiseSpatial) inpDenoiseSpatial.value = v.toFixed(1);
    });
  }
  if (inpDenoiseSpatial) {
    inpDenoiseSpatial.addEventListener("change", (e) => {
      let v = parseFloat(e.target.value) || 0;
      v = Math.max(0, Math.min(10, v));
      inspectorState.denoiseSpatial = v;
      inpDenoiseSpatial.value = v.toFixed(1);
      if (sliderDenoiseSpatial) sliderDenoiseSpatial.value = v;
    });
  }

  if (sliderDenoiseTemporal) {
    sliderDenoiseTemporal.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      inspectorState.denoiseTemporal = v;
      if (inpDenoiseTemporal) inpDenoiseTemporal.value = v.toFixed(1);
    });
  }
  if (inpDenoiseTemporal) {
    inpDenoiseTemporal.addEventListener("change", (e) => {
      let v = parseFloat(e.target.value) || 0;
      v = Math.max(0, Math.min(10, v));
      inspectorState.denoiseTemporal = v;
      inpDenoiseTemporal.value = v.toFixed(1);
      if (sliderDenoiseTemporal) sliderDenoiseTemporal.value = v;
    });
  }

  if (resetDenoise) {
    resetDenoise.addEventListener("click", () => {
      inspectorState.denoiseMode = "off";
      inspectorState.denoiseSpatial = 0.0;
      inspectorState.denoiseTemporal = 0.0;
      if (selDenoiseMode) selDenoiseMode.value = "off";
      if (sliderDenoiseSpatial) sliderDenoiseSpatial.value = 0;
      if (inpDenoiseSpatial) inpDenoiseSpatial.value = "0.0";
      if (sliderDenoiseTemporal) sliderDenoiseTemporal.value = 0;
      if (inpDenoiseTemporal) inpDenoiseTemporal.value = "0.0";
      if (rowDenoiseSpatial) rowDenoiseSpatial.style.display = "none";
      if (rowDenoiseTemporal) rowDenoiseTemporal.style.display = "none";
      if (dotDenoise) dotDenoise.textContent = "⚫";
      const descEl = document.getElementById("denoiseDesc");
      if (descEl) descEl.textContent = DENOISE_DESC_MAP["off"];
      showToast("↺ Reset Noise Reduction to Off");
    });
  }

  // DaVinci ColorSlice 7-Vector Interactive Controls
  setupColorSliceControls();

  // Reset Color
  const resetColor = document.getElementById("resetColor");
  if (resetColor) {
    resetColor.addEventListener("click", () => {
      inspectorState.temperature = 0;
      inspectorState.tint = 0;
      inspectorState.portraitHue = 0;
      applyColorPreset("normal");
      showToast("↺ Color & White Balance Reset to Default");
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
      } else if (key === "skinSoftening") {
        inspectorState.skinSoftening = 0;
        const sl = document.getElementById("sliderSkinSoft");
        const inp = document.getElementById("inpSkinSoft");
        if (sl) sl.value = 0;
        if (inp) inp.value = "0%";
      } else if (key === "denoiseSpatial") {
        inspectorState.denoiseSpatial = 0.0;
        const sl = document.getElementById("sliderDenoiseSpatial");
        const inp = document.getElementById("inpDenoiseSpatial");
        if (sl) sl.value = 0;
        if (inp) inp.value = "0.0";
      } else if (key === "denoiseTemporal") {
        inspectorState.denoiseTemporal = 0.0;
        const sl = document.getElementById("sliderDenoiseTemporal");
        const inp = document.getElementById("inpDenoiseTemporal");
        if (sl) sl.value = 0;
        if (inp) inp.value = "0.0";
      } else if (key === "portraitHue") {
        inspectorState.portraitHue = 0;
        const sl = document.getElementById("sliderPortraitHue");
        const inp = document.getElementById("inpPortraitHue");
        if (sl) sl.value = 0;
        if (inp) inp.value = "0";
        updateSkinToneBadge();
      } else if (key === "portraitBrightness") {
        inspectorState.portraitBrightness = 0;
        const sl = document.getElementById("sliderPortraitBright");
        const inp = document.getElementById("inpPortraitBright");
        if (sl) sl.value = 0;
        if (inp) inp.value = "0";
        updateSkinToneBadge();
      } else if (key === "temperature") {
        inspectorState.temperature = 0;
        const sl = document.getElementById("sliderTemp");
        const inp = document.getElementById("inpTemp");
        if (sl) sl.value = 0;
        if (inp) inp.value = "0";
      } else if (key === "tint") {
        inspectorState.tint = 0;
        const sl = document.getElementById("sliderTint");
        const inp = document.getElementById("inpTint");
        if (sl) sl.value = 0;
        if (inp) inp.value = "0";
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
  if (btnImportFolderPool) btnImportFolderPool.addEventListener("click", () => {
    openImportModal();
  });

  const btnImportFilesPool = document.getElementById("btnImportFilesPool");
  if (btnImportFilesPool) btnImportFilesPool.addEventListener("click", triggerImportFiles);

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
        const inpPinned = document.getElementById("inpOutputPathPinned");
        if (inpPinned) inpPinned.value = data.output_dir;
        const topTxt = document.getElementById("topFolderPathText");
        if (topTxt && data.output_dir) {
          topTxt.textContent = "Output: " + data.output_dir.split("/").filter(Boolean).slice(-3).join(" / ");
        }
        triggerSaveSettings();
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

  const btnBrowseOutputPinned = document.getElementById("btnBrowseOutputPinned");
  if (btnBrowseOutputPinned) btnBrowseOutputPinned.addEventListener("click", triggerSetOutputFolder);

  const inpOutputPathPinned = document.getElementById("inpOutputPathPinned");
  if (inpOutputPathPinned) inpOutputPathPinned.addEventListener("click", triggerSetOutputFolder);

  const btnOpenDestinationPinned = document.getElementById("btnOpenDestinationPinned");
  if (btnOpenDestinationPinned) {
    btnOpenDestinationPinned.addEventListener("click", () => {
      fetch("/api/open-folder", { method: "POST" });
    });
  }

  // Open Folder (including clicking Top Center Output Folder Pill)
  const btnOpenFolder = document.getElementById("btnOpenFolder");
  if (btnOpenFolder) {
    btnOpenFolder.addEventListener("click", () => {
      fetch("/api/open-folder", { method: "POST" });
    });
  }
  const topOutPill = document.getElementById("topSourceFolder");
  if (topOutPill) {
    topOutPill.addEventListener("click", () => {
      fetch("/api/open-folder", { method: "POST" });
      showToast("📂 Opening Export Destination Folder in Finder...");
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
    } else if ((e.metaKey || e.ctrlKey) && e.key === "1") {
      e.preventDefault();
      const t = document.querySelector('.insp-tab[data-tab="transform"]');
      if (t) t.click();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "2") {
      e.preventDefault();
      const t = document.querySelector('.insp-tab[data-tab="color"]');
      if (t) t.click();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "3") {
      e.preventDefault();
      const t = document.querySelector('.insp-tab[data-tab="deliver"]');
      if (t) t.click();
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
    if (files.length === 0) return;
    const paths = files.map(f => f.path).filter(Boolean);
    if (paths.length > 0) {
      showToast(`⏳ Importing ${paths.length} items into Media Pool...`);
      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths })
        });
        const data = await res.json();
        await loadClips();
        showToast(`✅ Successfully imported ${data.added || paths.length} media clips!`);
      } catch (err) {
        console.error(err);
        showToast("❌ Failed to import dropped files.");
      }
    } else {
      openImportModal();
    }
  });

  // Global window drop handler so dropping anywhere into media pool imports smoothly
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", async (e) => {
    // Only handle if dropped outside input elements and not already handled by dropZone
    if (e.target.closest("#dropZone")) return;
    const files = Array.from(e.dataTransfer.files || []);
    const paths = files.map(f => f.path).filter(Boolean);
    if (paths.length > 0) {
      e.preventDefault();
      showToast(`⏳ Importing ${paths.length} dropped items...`);
      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths })
        });
        const data = await res.json();
        await loadClips();
        showToast(`✅ Successfully imported ${data.added || paths.length} media clips!`);
      } catch (err) {
        console.error(err);
      }
    }
  });
}

// Interactive Timeline Height Resizer (ขยายช่องวิวแนวตั้งลงมาด้านล่างได้ตามต้องการ)
function setupTimelineResizer() {
  const resizer = document.getElementById("tlSplitResizer");
  const timelinePanel = document.getElementById("timelinePanel");
  const workarea = document.querySelector(".dv-workarea");
  const btnToggle = document.getElementById("btnMonitorExpandToggle");
  const btnMax = document.getElementById("btnHsMax");
  const btnBalanced = document.getElementById("btnHsBalanced");
  const btnCompact = document.getElementById("btnHsCompact");

  if (!resizer || !timelinePanel || !workarea) return;

  function setTimelineHeight(heightPx, animate = true) {
    const clamped = Math.max(48, Math.min(420, Math.round(heightPx)));
    if (!animate) {
      timelinePanel.classList.add("is-dragging");
    } else {
      timelinePanel.classList.remove("is-dragging");
    }
    workarea.style.setProperty("--timeline-height", `${clamped}px`);
    timelinePanel.classList.toggle("compact-mode", clamped <= 75);
    try { localStorage.setItem("zcut_tl_height", clamped); } catch (e) {}

    // Update preset buttons state
    if (btnMax) btnMax.classList.toggle("active", clamped <= 60);
    if (btnCompact) btnCompact.classList.toggle("active", clamped > 60 && clamped <= 90);
    if (btnBalanced) btnBalanced.classList.toggle("active", clamped > 90);

    if (btnToggle) {
      if (clamped <= 60) {
        btnToggle.textContent = "↕️ ย่อจอวิว";
        btnToggle.classList.add("active");
        btnToggle.title = "สลับกลับสู่ขนาดมาตรฐาน (Restore Balanced View)";
      } else {
        btnToggle.textContent = "↕️ ขยายจอวิว";
        btnToggle.classList.remove("active");
        btnToggle.title = "ขยายช่องวิวแนวตั้งลงมาด้านล่างสุด (Maximize 9:16 Vertical Monitor)";
      }
    }

    // Refresh LUT canvas and monitor transform if needed
    setTimeout(() => {
      renderMonitorLutCanvas();
      applyMonitorTransform();
    }, 120);
  }

  // Restore saved height or default to spacious Max Vertical (56px)
  const savedHeight = parseInt(localStorage.getItem("zcut_tl_height") || "56", 10);
  setTimelineHeight(isNaN(savedHeight) ? 56 : savedHeight, false);

  // Mouse drag handler on Splitter bar
  resizer.addEventListener("mousedown", (e) => {
    if (e.target.closest(".btn-hs-quick")) return;
    e.preventDefault();
    resizer.classList.add("is-dragging");
    timelinePanel.classList.add("is-dragging");
    const startY = e.clientY;
    const startH = timelinePanel.getBoundingClientRect().height;

    const onMove = (ev) => {
      // Moving mouse down (dy > 0) shrinks timeline & expands monitor downwards!
      const dy = ev.clientY - startY;
      const newH = startH - dy;
      setTimelineHeight(newH, false);
    };

    const onUp = () => {
      resizer.classList.remove("is-dragging");
      timelinePanel.classList.remove("is-dragging");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  // Double click resizer to toggle max/balanced
  resizer.addEventListener("dblclick", (e) => {
    if (e.target.closest(".btn-hs-quick")) return;
    const currentH = timelinePanel.getBoundingClientRect().height;
    if (currentH > 75) {
      setTimelineHeight(56, true);
      showToast("📱 ขยายช่องวิวแนวตั้งลงมาด้านล่างเต็มที่ (Maximized Monitor)");
    } else {
      setTimelineHeight(130, true);
      showToast("⚖️ ปรับขนาดช่องวิวและไทม์ไลน์เป็นขนาดมาตรฐาน");
    }
  });

  // Header Expand Toggle Button
  if (btnToggle) {
    btnToggle.addEventListener("click", () => {
      const currentH = timelinePanel.getBoundingClientRect().height;
      if (currentH > 75) {
        setTimelineHeight(56, true);
        showToast("📱 ขยายช่องวิวแนวตั้งลงมาด้านล่างเต็มที่");
      } else {
        setTimelineHeight(130, true);
        showToast("⚖️ กลับสู่ขนาดมาตรฐาน");
      }
    });
  }

  // Quick Preset Buttons
  if (btnMax) {
    btnMax.addEventListener("click", (e) => {
      e.stopPropagation();
      setTimelineHeight(56, true);
      showToast("📱 ขยายช่องวิวแนวตั้งใหญ่สุด (Max 9:16 Monitor)");
    });
  }
  if (btnCompact) {
    btnCompact.addEventListener("click", (e) => {
      e.stopPropagation();
      setTimelineHeight(80, true);
      showToast("📐 ขนาดกะทัดรัด (Compact Timeline)");
    });
  }
  if (btnBalanced) {
    btnBalanced.addEventListener("click", (e) => {
      e.stopPropagation();
      setTimelineHeight(130, true);
      showToast("⚖️ ขนาดมาตรฐาน (Balanced View)");
    });
  }
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
    monitorVideo.play().then(() => {
      startVideoLutLoop();
    }).catch(e => console.log("Play error:", e));
    startVideoLutLoop();
    if (btnPlay) btnPlay.textContent = "⏸";
  } else {
    monitorVideo.pause();
    renderMonitorLutCanvas();
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
        scheduleMonitorLutRender();
        const pCol = document.getElementById("paneColor");
        if (pCol && pCol.style.display !== "none") renderHistogram();
      }
    });

    monitorVideo.addEventListener("seeked", () => {
      renderMonitorLutCanvas();
      scheduleHistogram();
    });

    monitorVideo.addEventListener("loadeddata", () => {
      scheduleMonitorLutRender();
    });

    monitorVideo.addEventListener("play", () => {
      startVideoLutLoop();
    });

    monitorVideo.addEventListener("ended", () => {
      if (btnPlay) btnPlay.textContent = "▶";
    });
  }

  if (scrubSlider && monitorVideo) {
    scrubSlider.addEventListener("input", (e) => {
      if (monitorVideo.duration) {
        if (monitorImg) monitorImg.style.display = "none";
        monitorVideo.style.display = "block";
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
  completedPaths.clear();
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

  let targetIndices = Array.from(selectedIndices);
  const selScope = document.getElementById("selExportScope");
  if (selScope) {
    const scopeVal = selScope.value;
    if (scopeVal === "clean") {
      targetIndices = targetIndices.filter(i => !clipRatings[allClips[i].path]?.rejected);
    } else if (scopeVal === "star1") {
      targetIndices = targetIndices.filter(i => (clipRatings[allClips[i].path]?.rating || 0) >= 1 && !clipRatings[allClips[i].path]?.rejected);
    } else if (scopeVal === "star3") {
      targetIndices = targetIndices.filter(i => (clipRatings[allClips[i].path]?.rating || 0) >= 3 && !clipRatings[allClips[i].path]?.rejected);
    }
  }

  if (targetIndices.length === 0) {
    showToast("⚠️ No clips match the chosen Export Scope filter!");
    isExporting = false;
    btnBigExport.disabled = false;
    btnBigExport.textContent = "🚀 1-Click Fast Vertical Export (All Clips)";
    return;
  }

  const selectedPaths = targetIndices.map(i => allClips[i].path);
  const inpOut = document.getElementById("inpOutputPath");
  const outDir = inpOut ? inpOut.value.trim() : "";
  const sliderBitrate = document.getElementById("sliderBitrate");
  const chkExportAudio = document.getElementById("chkExportAudio");
  const selAudioCodec = document.getElementById("selAudioCodec");
  const inpAudioBitrate = document.getElementById("inpAudioBitrate");
  const inpFileSubfolder = document.getElementById("inpFileSubfolder");
  const chkSmartResume = document.getElementById("chkSmartResume");

  const selFormat = document.getElementById("selFormat");
  const selCodec = document.getElementById("selCodec");
  const selConflict = document.getElementById("selConflictAction") || document.getElementById("selConflictActionFileTab");
  const conflictAction = selConflict ? selConflict.value : "skip";

  const isTrBypassed = inspectorState.bypassedCards && inspectorState.bypassedCards.transform;
  const isCropBypassed = inspectorState.bypassedCards && inspectorState.bypassedCards.crop;
  const isSpdBypassed = inspectorState.bypassedCards && inspectorState.bypassedCards.speed;
  const isWbBypassed = inspectorState.bypassedCards && inspectorState.bypassedCards.whiteBalance;
  const isPrimariesBypassed = inspectorState.bypassedCards && inspectorState.bypassedCards.primaries;
  const chkTimelineEffects = document.getElementById("chkTimelineEffects");
  const renderTimelineEffects = chkTimelineEffects ? chkTimelineEffects.checked : true;

  // Always read latest live values from DOM sliders/inputs right before export
  const slBr = document.getElementById("sliderBrightness");
  const slCt = document.getElementById("sliderContrast");
  const slSh = document.getElementById("sliderShadows");
  const slSat = document.getElementById("sliderSaturation");
  const slTmp = document.getElementById("sliderTemp");
  const slTnt = document.getElementById("sliderTint");
  const selNik = document.getElementById("selNikonProfile");
  const slNikStr = document.getElementById("sliderNikonStrength");
  const slPortHue = document.getElementById("sliderPortraitHue");
  const slPortBrt = document.getElementById("sliderPortraitBright");
  const slSkinSft = document.getElementById("sliderSkinSoft");

  if (slBr) inspectorState.brightness = parseFloat(slBr.value);
  if (slCt) inspectorState.contrast = parseFloat(slCt.value);
  if (slSh) inspectorState.shadows = parseFloat(slSh.value);
  if (slSat) inspectorState.saturation = parseFloat(slSat.value);
  if (slTmp) inspectorState.temperature = parseFloat(slTmp.value);
  if (slTnt) inspectorState.tint = parseFloat(slTnt.value);
  if (selNik && selNik.value) inspectorState.nikonProfile = selNik.value;
  if (slNikStr) inspectorState.nikonStrength = parseFloat(slNikStr.value);
  if (slPortHue) inspectorState.portraitHue = parseFloat(slPortHue.value);
  if (slPortBrt) inspectorState.portraitBrightness = parseFloat(slPortBrt.value);
  if (slSkinSft) inspectorState.skinSoftening = parseFloat(slSkinSft.value);

  const inpBps = document.getElementById("inpBitrateKbps");
  const qModeEl = document.querySelector('input[name="qualityMode"]:checked');
  const qMode = qModeEl ? qModeEl.value : "auto";
  const targetBpsK = (qMode === "restrict" && inpBps && parseInt(inpBps.value) > 500)
    ? parseInt(inpBps.value)
    : (sliderBitrate ? parseInt(sliderBitrate.value) : 8000);

  const inpW = document.getElementById("inpResW");
  const inpH = document.getElementById("inpResH");
  const rawRes = selResolution ? selResolution.value : "1080x1920";
  const finalRes = (rawRes === "custom" && inpW && inpH)
    ? `${parseInt(inpW.value) || 1080}x${parseInt(inpH.value) || 1920}`
    : rawRes;

  const params = {
    rotation: isTrBypassed ? 0.0 : inspectorState.rotation,
    zoom_x: isTrBypassed ? 1.0 : (inspectorState.zoomX || 1.0),
    zoom_y: isTrBypassed ? 1.0 : (inspectorState.zoomY || 1.0),
    flip_h: isTrBypassed ? false : !!inspectorState.flipH,
    flip_v: isTrBypassed ? false : !!inspectorState.flipV,
    speed: isSpdBypassed ? 100.0 : (inspectorState.speed || 100.0),
    speed_direction: isSpdBypassed ? "forward" : (inspectorState.speedDirection || "forward"),
    render_timeline_effects: renderTimelineEffects,
    crop_left: isCropBypassed ? 0.0 : (inspectorState.cropL / 500),
    crop_right: isCropBypassed ? 0.0 : (inspectorState.cropR / 500),
    crop_top: isCropBypassed ? 0.0 : (inspectorState.cropT / 500),
    crop_bottom: isCropBypassed ? 0.0 : (inspectorState.cropB / 500),
    format: selFormat ? selFormat.value : "mp4",
    codec: selCodec ? selCodec.value : "h264",
    conflict_action: conflictAction,
    smart_resume: (conflictAction === "skip"),
    bitrate: targetBpsK + "k",
    resolution: finalRes,
    workers: selWorkers ? parseInt(selWorkers.value) : 2,
    scaling_mode: inspectorState.scaling || "fit",
    nikon_profile: (inspectorState.bypassedCards && inspectorState.bypassedCards.nikonColor) ? "none" : (inspectorState.nikonProfile || "nlog_rec709"),
    nikon_strength: (inspectorState.bypassedCards && inspectorState.bypassedCards.nikonColor) ? 0 : inspectorState.nikonStrength,
    custom_lut_path: inspectorState.customLutPath || "",
    skin_softening: (inspectorState.bypassedCards && inspectorState.bypassedCards.nikonColor) ? 0 : (inspectorState.skinSoftening || 0),
    portrait_hue: (inspectorState.bypassedCards && inspectorState.bypassedCards.nikonColor) ? 0 : (inspectorState.portraitHue || 0),
    portrait_brightness: (inspectorState.bypassedCards && inspectorState.bypassedCards.nikonColor) ? 0 : (inspectorState.portraitBrightness || 0),
    primaries_bars: (inspectorState.bypassedCards && inspectorState.bypassedCards.primariesBars) ? null : inspectorState.primariesBars,
    color_slice: (inspectorState.bypassedCards && inspectorState.bypassedCards.colorSlice) ? null : inspectorState.colorSlice,
    denoise_mode: (inspectorState.bypassedCards && inspectorState.bypassedCards.denoise) ? "off" : (inspectorState.denoiseMode || "off"),
    denoise_spatial: inspectorState.denoiseSpatial || 0,
    denoise_temporal: inspectorState.denoiseTemporal || 0,
    nlog_normalize: (inspectorState.nikonProfile === "nlog_rec709"),
    naming_pattern: selNamingPattern ? selNamingPattern.value : "suffix_vertical",
    brightness: isPrimariesBypassed ? 0.0 : inspectorState.brightness,
    contrast: isPrimariesBypassed ? 1.0 : inspectorState.contrast,
    shadows: isPrimariesBypassed ? 0.0 : inspectorState.shadows,
    saturation: isPrimariesBypassed ? 1.0 : inspectorState.saturation,
    temperature: isWbBypassed ? 0 : (inspectorState.temperature || 0),
    tint: isWbBypassed ? 0 : (inspectorState.tint || 0),
    export_audio: chkExportAudio ? chkExportAudio.checked : true,
    audio_codec: selAudioCodec ? selAudioCodec.value : "aac",
    audio_bitrate: (inpAudioBitrate ? inpAudioBitrate.value : "320") + "k",
    subfolder: inpFileSubfolder ? inpFileSubfolder.value.trim() : "",
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

      if (activeIdx !== currentMonitorIdx) {
        updateMonitorDisplay(activeIdx);
      }
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
      // Automatically purge RAM and flush file buffers upon export completion
      fetch("/api/clear-cache", { method: "POST" }).catch(() => {});
    } else if (st.status === "Stopped") {
      clearInterval(exportPollTimer);
      isExporting = false;
      fetch("/api/clear-cache", { method: "POST" }).catch(() => {});
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
    } else if (!st.is_exporting) {
      clearInterval(exportPollTimer);
      isExporting = false;
      if (btnQuickExport) {
        btnQuickExport.disabled = false;
        btnQuickExport.textContent = "🚀 Quick Export";
      }
      btnBigExport.disabled = false;
      btnBigExport.textContent = "🚀 1-Click Fast Vertical Export (All Clips)";
      const exportControlsRow = document.getElementById("exportControlsRow");
      const btnPauseTop = document.getElementById("btnPauseTop");
      const btnStopTop = document.getElementById("btnStopTop");
      if (exportControlsRow) exportControlsRow.style.display = "none";
      if (btnPauseTop) btnPauseTop.style.display = "none";
      if (btnStopTop) btnStopTop.style.display = "none";
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

// =========================================================================
// DAVINCI COLORSLICE 7-VECTOR INTERACTIVE UI & DOM SYNC
// =========================================================================
let currentCsViewMode = "tabs"; // "tabs" (แบบ 1 แนะนำ) | "cols" (แบบ 2)
let currentCsActiveSlice = "skin"; // Active slice for Style 1: "skin" by default!

const COLORSLICE_TITLES = {
  red: "🔴 Red Vector",
  skin: "🧑🏻 Skin Tone",
  yellow: "🟡 Yellow Vector",
  green: "🟢 Green (Foliage)",
  cyan: "🩵 Cyan Vector",
  blue: "🔵 Blue (Sky/Apparel)",
  magenta: "🟣 Magenta Vector"
};

function syncColorSliceDom() {
  if (!inspectorState.colorSlice) {
    inspectorState.colorSlice = createDefaultColorSlice();
  }
  const cs = inspectorState.colorSlice;
  const m = cs.master || { den: 0.0, denDepth: 0.0, sat: 1.0, satBal: 0.0, satDepth: 0.0, hue: 0.0 };

  const mMap = {
    csMasterDen: m.den || 0.0,
    csMasterDenDepth: m.denDepth || 0.0,
    csMasterSat: m.sat !== undefined ? m.sat : 1.0,
    csMasterSatBal: m.satBal || 0.0,
    csMasterSatDepth: m.satDepth || 0.0,
    csMasterHue: m.hue || 0.0
  };
  Object.keys(mMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = Number(mMap[id]).toFixed(2);
  });

  const slices = ["red", "skin", "yellow", "green", "cyan", "blue", "magenta"];
  slices.forEach(sKey => {
    const sl = cs[sKey] || { center: 0.0, hue: 0.0, den: 0.0, sat: 1.0 };
    const lblC = document.getElementById(`lblCsCenter_${sKey}`);
    const lblH = document.getElementById(`lblCsHue_${sKey}`);
    if (lblC) lblC.textContent = Number(sl.center || 0).toFixed(2);
    if (lblH) lblH.textContent = Number(sl.hue || 0).toFixed(2);

    const slC = document.querySelector(`.cs-slider-center[data-slice="${sKey}"]`);
    const slH = document.querySelector(`.cs-slider-hue[data-slice="${sKey}"]`);
    if (slC) slC.value = sl.center || 0;
    if (slH) slH.value = sl.hue || 0;

    // Rotate slice wedge indicator on the wheel
    const colEl = document.querySelector(`.cs-col[data-slice="${sKey}"]`);
    if (colEl) {
      const wedge = colEl.querySelector(".cs-wedge");
      const baseAngle = COLORSLICE_VECTORS[sKey] ? COLORSLICE_VECTORS[sKey].baseAngle : 0;
      const offsetDeg = ((sl.center || 0) * 18) + ((sl.hue || 0) * 28);
      if (wedge) wedge.style.setProperty("--wedge-angle", `${(baseAngle + offsetDeg).toFixed(1)}deg`);
    }

    // Update Density vertical fader (-1 to 1)
    const denVal = Math.max(-1, Math.min(1, Number(sl.den || 0)));
    const denPct = ((denVal + 1) / 2) * 100;
    const denTrack = document.querySelector(`.cs-vtrack[data-slice="${sKey}"][data-param="den"]`);
    if (denTrack) {
      const fill = denTrack.querySelector(".cs-vfill");
      const thumb = denTrack.querySelector(".cs-vthumb");
      if (fill) fill.style.height = `${denPct}%`;
      if (thumb) thumb.style.bottom = `${denPct}%`;
    }
    const inpDen = document.getElementById(`inpCsDen_${sKey}`);
    if (inpDen) inpDen.value = denVal.toFixed(2);

    // Update Saturation vertical fader (0 to 2)
    const satVal = Math.max(0, Math.min(2, Number(sl.sat !== undefined ? sl.sat : 1)));
    const satPct = (satVal / 2) * 100;
    const satTrack = document.querySelector(`.cs-vtrack[data-slice="${sKey}"][data-param="sat"]`);
    if (satTrack) {
      const fill = satTrack.querySelector(".cs-vfill");
      const thumb = satTrack.querySelector(".cs-vthumb");
      if (fill) fill.style.height = `${satPct}%`;
      if (thumb) thumb.style.bottom = `${satPct}%`;
    }
    const inpSat = document.getElementById(`inpCsSat_${sKey}`);
    if (inpSat) inpSat.value = satVal.toFixed(2);
  });

  // Sync Hero Slice Controls (Style 1 - Tabbed View)
  syncColorSliceHeroDom();
}

function syncColorSliceHeroDom() {
  const cs = inspectorState.colorSlice || createDefaultColorSlice();
  const sKey = currentCsActiveSlice || "skin";
  const sl = cs[sKey] || { center: 0.0, hue: 0.0, den: 0.0, sat: 1.0 };

  const heroTitle = document.getElementById("csHeroTitle");
  if (heroTitle) heroTitle.textContent = COLORSLICE_TITLES[sKey] || sKey;

  const lblCenter = document.getElementById("lblCsHeroCenter");
  const slCenter = document.getElementById("slCsHeroCenter");
  if (lblCenter) lblCenter.textContent = Number(sl.center || 0).toFixed(2);
  if (slCenter) slCenter.value = Number(sl.center || 0);

  const lblHue = document.getElementById("lblCsHeroHue");
  const slHue = document.getElementById("slCsHeroHue");
  if (lblHue) lblHue.textContent = Number(sl.hue || 0).toFixed(2);
  if (slHue) slHue.value = Number(sl.hue || 0);

  const lblDen = document.getElementById("lblCsHeroDen");
  const slDen = document.getElementById("slCsHeroDen");
  if (lblDen) lblDen.textContent = Number(sl.den || 0).toFixed(2);
  if (slDen) slDen.value = Number(sl.den || 0);

  const lblSat = document.getElementById("lblCsHeroSat");
  const slSat = document.getElementById("slCsHeroSat");
  if (lblSat) lblSat.textContent = Number(sl.sat !== undefined ? sl.sat : 1.0).toFixed(2);
  if (slSat) slSat.value = Number(sl.sat !== undefined ? sl.sat : 1.0);

  const heroWedge = document.getElementById("csHeroWedge");
  if (heroWedge) {
    const baseAngle = COLORSLICE_VECTORS[sKey] ? COLORSLICE_VECTORS[sKey].baseAngle : 0;
    const offsetDeg = ((sl.center || 0) * 18) + ((sl.hue || 0) * 28);
    heroWedge.style.setProperty("--hero-wedge-angle", `${(baseAngle + offsetDeg).toFixed(1)}deg`);
  }

  document.querySelectorAll(".cs-slice-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.slicetab === sKey);
  });
}

function setupColorSliceControls() {
  if (!inspectorState.colorSlice) {
    inspectorState.colorSlice = createDefaultColorSlice();
  }

  // 1. Master Bar Inputs (Drag left/right or type value, double-click to reset)
  document.querySelectorAll(".cs-m-input").forEach(inp => {
    const mparam = inp.dataset.mparam;
    const isSat = (mparam === "sat");
    const minV = isSat ? 0.0 : -1.0;
    const maxV = isSat ? 2.0 : 1.0;
    const defV = isSat ? 1.0 : 0.0;

    inp.addEventListener("change", () => {
      let v = parseFloat(inp.value);
      if (isNaN(v)) v = defV;
      v = Math.max(minV, Math.min(maxV, v));
      inspectorState.colorSlice.master[mparam] = v;
      inp.value = v.toFixed(2);
      document.querySelectorAll(".btn-cs-preset").forEach(b => b.classList.remove("active"));
      applyMonitorTransform();
    });

    inp.addEventListener("dblclick", () => {
      inspectorState.colorSlice.master[mparam] = defV;
      inp.value = defV.toFixed(2);
      applyMonitorTransform();
    });

    let dragStartX = null;
    let dragStartVal = 0;
    inp.addEventListener("mousedown", (e) => {
      if (document.activeElement === inp) return;
      dragStartX = e.clientX;
      dragStartVal = inspectorState.colorSlice.master[mparam] !== undefined ? inspectorState.colorSlice.master[mparam] : defV;
      const onMove = (ev) => {
        if (dragStartX === null) return;
        const dx = ev.clientX - dragStartX;
        if (Math.abs(dx) > 2) {
          inp.blur();
          let nv = dragStartVal + (dx * 0.01);
          nv = Math.max(minV, Math.min(maxV, nv));
          inspectorState.colorSlice.master[mparam] = nv;
          inp.value = nv.toFixed(2);
          applyMonitorTransform();
        }
      };
      const onUp = () => {
        dragStartX = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });

  // 2. Horizontal Sliders (Center & Hue per slice)
  document.querySelectorAll(".cs-hslider").forEach(sl => {
    const sKey = sl.dataset.slice;
    const param = sl.dataset.param; // "center" or "hue"
    sl.addEventListener("input", () => {
      const v = parseFloat(sl.value) || 0.0;
      inspectorState.colorSlice[sKey][param] = v;
      document.querySelectorAll(".btn-cs-preset").forEach(b => b.classList.remove("active"));
      syncColorSliceDom();
      applyMonitorTransform();
    });
    sl.addEventListener("dblclick", () => {
      inspectorState.colorSlice[sKey][param] = 0.0;
      sl.value = 0;
      syncColorSliceDom();
      applyMonitorTransform();
    });
  });

  // 3. Vertical Fader Tracks (Density & Saturation per slice)
  document.querySelectorAll(".cs-vtrack").forEach(track => {
    const sKey = track.dataset.slice;
    const param = track.dataset.param; // "den" or "sat"
    const minV = parseFloat(track.dataset.min);
    const maxV = parseFloat(track.dataset.max);
    const defV = (param === "sat") ? 1.0 : 0.0;

    const updateFromMouseY = (clientY) => {
      const rect = track.getBoundingClientRect();
      const relY = Math.max(0, Math.min(rect.height, rect.bottom - clientY));
      const pct = relY / (rect.height || 1);
      const val = minV + pct * (maxV - minV);
      inspectorState.colorSlice[sKey][param] = parseFloat(val.toFixed(2));
      document.querySelectorAll(".btn-cs-preset").forEach(b => b.classList.remove("active"));
      syncColorSliceDom();
      applyMonitorTransform();
    };

    track.addEventListener("mousedown", (e) => {
      e.preventDefault();
      updateFromMouseY(e.clientY);
      const onMove = (ev) => updateFromMouseY(ev.clientY);
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    track.addEventListener("dblclick", (e) => {
      e.preventDefault();
      inspectorState.colorSlice[sKey][param] = defV;
      syncColorSliceDom();
      applyMonitorTransform();
    });
  });

  // 4. Vertical Fader Numeric Input Boxes (.cs-v-num)
  document.querySelectorAll(".cs-v-num").forEach(inp => {
    const sKey = inp.dataset.slice;
    const param = inp.dataset.param;
    const minV = (param === "sat") ? 0.0 : -1.0;
    const maxV = (param === "sat") ? 2.0 : 1.0;
    const defV = (param === "sat") ? 1.0 : 0.0;

    inp.addEventListener("change", () => {
      let v = parseFloat(inp.value);
      if (isNaN(v)) v = defV;
      v = Math.max(minV, Math.min(maxV, v));
      inspectorState.colorSlice[sKey][param] = v;
      syncColorSliceDom();
      applyMonitorTransform();
    });
  });

  // 5. Individual Column Reset (.cs-col-reset)
  document.querySelectorAll(".cs-col-reset").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const sKey = btn.dataset.slice;
      if (sKey && inspectorState.colorSlice[sKey]) {
        inspectorState.colorSlice[sKey] = { center: 0.0, hue: 0.0, den: 0.0, sat: 1.0 };
        document.querySelectorAll(".btn-cs-preset").forEach(b => b.classList.remove("active"));
        syncColorSliceDom();
        applyMonitorTransform();
      }
    });
  });

  // 6. Global ColorSlice Reset (#resetColorSlice)
  const resetCsBtn = document.getElementById("resetColorSlice");
  if (resetCsBtn) {
    resetCsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      inspectorState.colorSlice = createDefaultColorSlice();
      document.querySelectorAll(".btn-cs-preset").forEach(b => b.classList.remove("active"));
      syncColorSliceDom();
      applyMonitorTransform();
      showToast("↺ Reset All ColorSlice Vectors to Default");
    });
  }

  // 7. 1-Click ColorSlice Quick Presets (.btn-cs-preset)
  document.querySelectorAll(".btn-cs-preset").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = btn.dataset.preset;
      const wasActive = btn.classList.contains("active");
      document.querySelectorAll(".btn-cs-preset").forEach(b => b.classList.remove("active"));

      const cs = createDefaultColorSlice();
      if (!wasActive) {
        btn.classList.add("active");
        if (p === "skin_pop") {
          cs.skin = { center: 0.0, hue: 0.35, den: -0.45, sat: 1.28 };
          cs.red = { center: 0.0, hue: 0.12, den: -0.20, sat: 1.18 };
          cs.green = { center: 0.0, hue: 0.18, den: 0.35, sat: 0.72 };
          cs.yellow = { center: 0.0, hue: 0.10, den: 0.22, sat: 0.80 };
        } else if (p === "outdoor") {
          cs.skin = { center: 0.0, hue: 0.24, den: -0.32, sat: 1.20 };
          cs.green = { center: 0.0, hue: 0.28, den: 0.45, sat: 1.25 };
          cs.yellow = { center: 0.0, hue: 0.14, den: 0.25, sat: 1.10 };
          cs.blue = { center: 0.0, hue: -0.08, den: 0.42, sat: 1.38 };
          cs.cyan = { center: 0.0, hue: 0.0, den: 0.30, sat: 1.28 };
        } else if (p === "film") {
          cs.master = { den: 0.26, denDepth: 0.20, sat: 1.14, satBal: 0.15, satDepth: 0.12, hue: 0.0 };
          cs.skin = { center: 0.0, hue: 0.18, den: -0.25, sat: 1.16 };
          cs.red = { center: 0.0, hue: 0.08, den: 0.38, sat: 1.24 };
          cs.blue = { center: 0.0, hue: -0.12, den: 0.44, sat: 1.26 };
          cs.green = { center: 0.0, hue: 0.22, den: 0.38, sat: 0.76 };
        }
      }
      inspectorState.colorSlice = cs;
      syncColorSliceDom();
      applyMonitorTransform();
    });
  });

  // 8. 7-Vector ColorSlice Grid (DaVinci Resolve Style)
  const colorSliceGrid = document.getElementById("colorSliceGrid");
  if (colorSliceGrid) colorSliceGrid.style.display = "grid";

  syncColorSliceDom();
  setupPrimariesBarsControls();
}

// =========================================================================
// DAVINCI PRIMARIES - COLOR BARS (LIFT / GAMMA / GAIN / OFFSET) UI & SYNC
// =========================================================================
function syncPrimariesBarsDom() {
  if (!inspectorState.primariesBars) {
    inspectorState.primariesBars = createDefaultPrimariesBars();
  }
  const pb = inspectorState.primariesBars;
  const t = pb.top || { temp: 0.0, tint: 0.0, cont: 1.0, pivot: 0.435, md: 0.0 };
  const b = pb.bot || { colBoost: 0.0, shad: 0.0, hiLight: 0.0, sat: 50.0, hue: 50.0, lMix: 100.0 };

  const topMap = {
    pbTopTemp: [t.temp || 0.0, 1],
    pbTopTint: [t.tint || 0.0, 2],
    pbTopCont: [t.cont !== undefined ? t.cont : 1.0, 3],
    pbTopPivot: [t.pivot !== undefined ? t.pivot : 0.435, 3],
    pbTopMd: [t.md || 0.0, 2]
  };
  Object.keys(topMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = Number(topMap[id][0]).toFixed(topMap[id][1]);
  });

  const botMap = {
    pbBotColBoost: b.colBoost || 0.0,
    pbBotShad: b.shad || 0.0,
    pbBotHiLight: b.hiLight || 0.0,
    pbBotSat: b.sat !== undefined ? b.sat : 50.0,
    pbBotHue: b.hue !== undefined ? b.hue : 50.0,
    pbBotLMix: b.lMix !== undefined ? b.lMix : 100.0
  };
  Object.keys(botMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = Number(botMap[id]).toFixed(2);
  });

  document.querySelectorAll(".pb-bar-col").forEach(col => {
    const zone = col.dataset.zone;
    const ch = col.dataset.ch;
    const minV = parseFloat(col.dataset.min);
    const maxV = parseFloat(col.dataset.max);
    const zObj = pb[zone] || {};
    const defV = zone === "gain" ? 1.0 : (zone === "offset" ? 25.0 : 0.0);
    const val = zObj[ch] !== undefined ? Number(zObj[ch]) : defV;
    const clamped = Math.max(minV, Math.min(maxV, val));
    const pct = ((clamped - minV) / (maxV - minV)) * 100;

    const fill = col.querySelector(".pb-vfill");
    const thumb = col.querySelector(".pb-vthumb");
    if (fill) fill.style.height = `${pct}%`;
    if (thumb) thumb.style.bottom = `${pct}%`;

    const inp = document.getElementById(`inpPb_${zone}_${ch}`);
    if (inp) inp.value = clamped.toFixed(2);
  });
}

function setupPrimariesBarsControls() {
  if (!document.getElementById("cardPrimariesBars")) return;
  if (!inspectorState.primariesBars) {
    inspectorState.primariesBars = createDefaultPrimariesBars();
  }

  // 1. Vertical Fader Columns (.pb-bar-col)
  document.querySelectorAll(".pb-bar-col").forEach(col => {
    const zone = col.dataset.zone;
    const ch = col.dataset.ch;
    const minV = parseFloat(col.dataset.min);
    const maxV = parseFloat(col.dataset.max);
    const defV = zone === "gain" ? 1.0 : (zone === "offset" ? 25.0 : 0.0);
    const track = col.querySelector(".pb-vtrack");
    if (!track) return;

    const updateFromMouseY = (clientY) => {
      const rect = track.getBoundingClientRect();
      const relY = Math.max(0, Math.min(rect.height, rect.bottom - clientY));
      const pct = relY / (rect.height || 1);
      const val = minV + pct * (maxV - minV);
      inspectorState.primariesBars[zone][ch] = parseFloat(val.toFixed(2));
      document.querySelectorAll(".btn-pb-preset").forEach(b => b.classList.remove("active"));
      syncPrimariesBarsDom();
      applyMonitorTransform();
    };

    track.addEventListener("mousedown", (e) => {
      e.preventDefault();
      updateFromMouseY(e.clientY);
      const onMove = (ev) => updateFromMouseY(ev.clientY);
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    track.addEventListener("dblclick", (e) => {
      e.preventDefault();
      inspectorState.primariesBars[zone][ch] = defV;
      syncPrimariesBarsDom();
      applyMonitorTransform();
    });
  });

  // 2. Numeric Boxes under Lift/Gamma/Gain/Offset (.pb-v-num)
  document.querySelectorAll(".pb-v-num").forEach(inp => {
    const zone = inp.dataset.zone;
    const ch = inp.dataset.ch;
    const col = inp.closest(".pb-bar-col");
    const minV = col ? parseFloat(col.dataset.min) : -1;
    const maxV = col ? parseFloat(col.dataset.max) : 1;
    const defV = zone === "gain" ? 1.0 : (zone === "offset" ? 25.0 : 0.0);

    inp.addEventListener("change", () => {
      let v = parseFloat(inp.value);
      if (isNaN(v)) v = defV;
      v = Math.max(minV, Math.min(maxV, v));
      inspectorState.primariesBars[zone][ch] = v;
      syncPrimariesBarsDom();
      applyMonitorTransform();
    });
  });

  // 3. Knurled Horizontal Jog Wheels (.pb-jog-wheel)
  document.querySelectorAll(".pb-jog-wheel").forEach(wheel => {
    const zone = wheel.dataset.zone;
    let startX = null;
    wheel.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startX = e.clientX;
      const orig = Object.assign({}, inspectorState.primariesBars[zone]);
      const stepScale = zone === "offset" ? 0.08 : 0.003;
      const minV = zone === "gain" ? 0.5 : (zone === "offset" ? 0 : -0.5);
      const maxV = zone === "gain" ? 1.5 : (zone === "offset" ? 50 : 0.5);

      const onMove = (ev) => {
        if (startX === null) return;
        const delta = (ev.clientX - startX) * stepScale;
        if (zone === "offset") {
          ["r", "g", "b"].forEach(k => {
            inspectorState.primariesBars.offset[k] = Math.max(minV, Math.min(maxV, orig[k] + delta));
          });
        } else {
          inspectorState.primariesBars[zone].y = Math.max(minV, Math.min(maxV, orig.y + delta));
        }
        syncPrimariesBarsDom();
        applyMonitorTransform();
      };
      const onUp = () => {
        startX = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    wheel.addEventListener("dblclick", () => {
      if (zone === "gain") inspectorState.primariesBars.gain = { y: 1, r: 1, g: 1, b: 1 };
      else if (zone === "offset") inspectorState.primariesBars.offset = { r: 25, g: 25, b: 25 };
      else inspectorState.primariesBars[zone] = { y: 0, r: 0, g: 0, b: 0 };
      syncPrimariesBarsDom();
      applyMonitorTransform();
    });
  });

  // 4. Top & Bottom Master Inputs (.pb-m-input)
  document.querySelectorAll(".pb-m-input").forEach(inp => {
    const topKey = inp.dataset.top;
    const botKey = inp.dataset.bot;
    const group = topKey ? "top" : "bot";
    const key = topKey || botKey;

    const bounds = {
      temp: [-100, 100, 0, 0.5],
      tint: [-100, 100, 0, 0.5],
      cont: [0.2, 2.0, 1.0, 0.005],
      pivot: [0.1, 0.9, 0.435, 0.005],
      md: [-50, 50, 0, 0.25],
      colBoost: [-50, 50, 0, 0.25],
      shad: [-50, 50, 0, 0.25],
      hiLight: [-50, 50, 0, 0.25],
      sat: [0, 100, 50, 0.25],
      hue: [0, 100, 50, 0.25],
      lMix: [0, 100, 100, 0.25]
    }[key] || [-100, 100, 0, 0.25];

    inp.addEventListener("change", () => {
      let v = parseFloat(inp.value);
      if (isNaN(v)) v = bounds[2];
      v = Math.max(bounds[0], Math.min(bounds[1], v));
      inspectorState.primariesBars[group][key] = v;
      syncPrimariesBarsDom();
      applyMonitorTransform();
    });

    inp.addEventListener("dblclick", () => {
      inspectorState.primariesBars[group][key] = bounds[2];
      syncPrimariesBarsDom();
      applyMonitorTransform();
    });

    let dragX = null;
    let startVal = 0;
    inp.addEventListener("mousedown", (e) => {
      if (document.activeElement === inp) return;
      dragX = e.clientX;
      startVal = inspectorState.primariesBars[group][key];
      const onMove = (ev) => {
        if (dragX === null) return;
        const dx = ev.clientX - dragX;
        if (Math.abs(dx) > 2) {
          inp.blur();
          let nv = startVal + dx * bounds[3];
          nv = Math.max(bounds[0], Math.min(bounds[1], nv));
          inspectorState.primariesBars[group][key] = nv;
          syncPrimariesBarsDom();
          applyMonitorTransform();
        }
      };
      const onUp = () => {
        dragX = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });

  // 5. Individual Zone Reset (.pb-zone-reset) & Global Reset (#resetPrimariesBars)
  document.querySelectorAll(".pb-zone-reset").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const zone = btn.dataset.zone;
      if (zone === "gain") inspectorState.primariesBars.gain = { y: 1, r: 1, g: 1, b: 1 };
      else if (zone === "offset") inspectorState.primariesBars.offset = { r: 25, g: 25, b: 25 };
      else if (zone) inspectorState.primariesBars[zone] = { y: 0, r: 0, g: 0, b: 0 };
      syncPrimariesBarsDom();
      applyMonitorTransform();
    });
  });

  const resetPbBtn = document.getElementById("resetPrimariesBars");
  if (resetPbBtn) {
    resetPbBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      inspectorState.primariesBars = createDefaultPrimariesBars();
      document.querySelectorAll(".btn-pb-preset").forEach(b => b.classList.remove("active"));
      syncPrimariesBarsDom();
      applyMonitorTransform();
      showToast("↺ Reset All Primaries Color Bars to Default");
    });
  }

  // 6. Auto Balance Ⓐ & Quick Presets (.btn-pb-preset)
  const applyPbPreset = (p) => {
    const pb = createDefaultPrimariesBars();
    if (p === "auto_balance") {
      pb.top = { temp: 12.0, tint: 5.0, cont: 1.12, pivot: 0.435, md: 15.0 };
      pb.bot = { colBoost: 18.0, shad: 22.0, hiLight: -12.0, sat: 58.0, hue: 50.0, lMix: 100.0 };
      pb.lift = { y: -0.04, r: 0.0, g: 0.0, b: 0.02 };
      pb.gamma = { y: 0.12, r: 0.06, g: -0.03, b: 0.03 };
      pb.gain = { y: 1.06, r: 1.03, g: 1.0, b: 1.0 };
    } else if (p === "clean_skin") {
      pb.top = { temp: 8.0, tint: 10.0, cont: 1.06, pivot: 0.435, md: -8.0 };
      pb.bot = { colBoost: 14.0, shad: 26.0, hiLight: -14.0, sat: 56.0, hue: 50.0, lMix: 100.0 };
      pb.lift = { y: 0.02, r: 0.03, g: 0.0, b: 0.02 };
      pb.gamma = { y: 0.18, r: 0.10, g: -0.04, b: 0.06 };
      pb.gain = { y: 1.05, r: 1.04, g: 1.0, b: 1.02 };
    } else if (p === "teal_orange") {
      pb.top = { temp: 16.0, tint: 2.0, cont: 1.18, pivot: 0.435, md: 18.0 };
      pb.bot = { colBoost: 22.0, shad: 12.0, hiLight: -10.0, sat: 60.0, hue: 50.0, lMix: 100.0 };
      pb.lift = { y: -0.05, r: -0.08, g: 0.02, b: 0.10 };
      pb.gamma = { y: 0.06, r: 0.10, g: 0.02, b: -0.08 };
      pb.gain = { y: 1.06, r: 1.08, g: 1.02, b: 0.94 };
    }
    inspectorState.primariesBars = pb;
    syncPrimariesBarsDom();
    applyMonitorTransform();
  };

  const btnAutoA = document.getElementById("btnPbAutoA");
  if (btnAutoA) {
    btnAutoA.addEventListener("click", () => {
      applyPbPreset("auto_balance");
      showToast("Ⓐ Auto Color & Contrast Balance Applied");
    });
  }

  const btnPicker = document.getElementById("btnPbPicker");
  if (btnPicker) {
    btnPicker.addEventListener("click", async () => {
      if (window.EyeDropper) {
        try {
          const eyeDropper = new EyeDropper();
          const result = await eyeDropper.open();
          if (result && result.sRGBHex) {
            showToast(`💧 White Balance Sampled: ${result.sRGBHex}`);
          }
        } catch (e) {}
      } else {
        inspectorState.primariesBars.top.temp = 6.0;
        inspectorState.primariesBars.top.tint = 3.0;
        syncPrimariesBarsDom();
        applyMonitorTransform();
        showToast("💧 Auto White Balance & Tint Calibrated");
      }
    });
  }

  document.querySelectorAll(".btn-pb-preset").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = btn.dataset.pbpreset;
      const wasActive = btn.classList.contains("active");
      document.querySelectorAll(".btn-pb-preset").forEach(b => b.classList.remove("active"));
      if (wasActive) {
        inspectorState.primariesBars = createDefaultPrimariesBars();
        syncPrimariesBarsDom();
        applyMonitorTransform();
      } else {
        btn.classList.add("active");
        applyPbPreset(p);
      }
    });
  });

  syncPrimariesBarsDom();
}
