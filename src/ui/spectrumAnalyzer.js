import { initAudio, createAnalyser, resumeSharedAudioContext } from "../audioEngine.js";
import { fft } from "../dsp/fft.js";
import { hanning, hamming, blackman } from "../dsp/stft.js";
import { formatHz } from "../utils/format.js";
import { appendChildren } from "../utils/domHelpers.js";
import {
  drawSpectrumFrame,
  resetSpectrumWaterfall,
  syncSpectrumCanvasSize,
} from "../visualization/spectrumCanvas.js";

/** @typedef {'linear' | 'log'} SpectrumScale */
/** @typedef {'bar' | 'waterfall'} SpectrumMode */
/** @typedef {'none' | 'hanning' | 'hamming' | 'blackman'} SpectrumWindow */

/** @type {AudioContext | null} */
let ctxAudio = null;
/** @type {MediaStreamAudioSourceNode | null} */
let srcNode = null;
/** @type {GainNode | null} */
let muteOut = null;
/** @type {AnalyserNode | null} */
let analyser = null;
/** @type {number} */
let rafId = 0;

/** @type {{ fftSize: number, scale: SpectrumScale, mode: SpectrumMode, window: SpectrumWindow }} */
let params = {
  fftSize: 2048,
  scale: "log",
  mode: "bar",
  window: "none",
};

/** @type {HTMLCanvasElement | null} */
let canvasEl = null;
/** @type {HTMLElement | null} */
let canvasWrap = null;
/** @type {HTMLElement | null} */
let statusEl = null;

function isAnalyzerPanelVisible() {
  const panel = document.getElementById("panel-analyzer");
  return Boolean(panel && !panel.hidden);
}

function stopLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function loop() {
  rafId = requestAnimationFrame(loop);

  if (
    document.visibilityState !== "visible" ||
    !isAnalyzerPanelVisible() ||
    !analyser ||
    !canvasEl ||
    !canvasWrap ||
    !ctxAudio
  ) {
    return;
  }

  syncSpectrumCanvasSize(canvasEl, canvasWrap);
  const overlayNorm =
    params.mode === "bar"
      ? computeDspOverlayNorm(analyser, params.fftSize, params.window)
      : null;
  drawSpectrumFrame(canvasEl, analyser, {
    fftSize: params.fftSize,
    scale: params.scale,
    mode: params.mode,
    sampleRate: ctxAudio.sampleRate,
    overlayNorm,
  });
}

function startLoop() {
  stopLoop();
  rafId = requestAnimationFrame(loop);
}

function teardownAudio() {
  stopLoop();
  for (const n of [srcNode, analyser, muteOut]) {
    try {
      n?.disconnect();
    } catch {
      /* ignore */
    }
  }
  srcNode = null;
  analyser = null;
  muteOut = null;
  ctxAudio = null;
}

/**
 * @param {number} fftSize
 */
function wireAnalyser(fftSize) {
  if (!ctxAudio || !srcNode || !muteOut) return;

  try {
    srcNode.disconnect();
  } catch {
    /* ignore */
  }
  try {
    analyser?.disconnect();
  } catch {
    /* ignore */
  }

  analyser = createAnalyser(fftSize);
  analyser.smoothingTimeConstant = params.mode === "waterfall" ? 0 : 0.35;

  srcNode.connect(analyser);
  analyser.connect(muteOut);
}

async function onStartAudio() {
  teardownAudio();
  statusEl && (statusEl.textContent = "Đang mở micro…");

  try {
    const { context, stream } = await initAudio();
    ctxAudio = context;

    muteOut = context.createGain();
    muteOut.gain.value = 0;

    srcNode = context.createMediaStreamSource(stream);
    muteOut.connect(context.destination);

    wireAnalyser(params.fftSize);
    resetSpectrumWaterfall(/** @type {HTMLCanvasElement} */ (canvasEl));

    if (statusEl) {
      const nyq = context.sampleRate / 2;
      statusEl.textContent = `Nyquist ${formatHz(nyq)} · fftSize ${params.fftSize} · phổ thời gian thực = Analyser; đường cam = dsp + cửa sổ (nếu chọn).`;
    }

    startLoop();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (statusEl) {
      statusEl.textContent = `Lỗi: ${msg}`;
    }
  }
}

function applyControlsFromUi(selFft, selScale, selMode, selWin) {
  params.fftSize = Number(selFft.value);
  params.scale = /** @type {SpectrumScale} */ (selScale.value);
  params.mode = /** @type {SpectrumMode} */ (selMode.value);
  params.window = /** @type {SpectrumWindow} */ (selWin.value);

  if (analyser && ctxAudio && srcNode) {
    wireAnalyser(params.fftSize);
  }
  if (canvasEl) {
    resetSpectrumWaterfall(/** @type {HTMLCanvasElement} */ (canvasEl));
  }

  if (statusEl && ctxAudio) {
    const nyq = ctxAudio.sampleRate / 2;
    statusEl.textContent = `Nyquist ${formatHz(nyq)} · fftSize ${params.fftSize} · phổ thời gian thực = Analyser; đường cam = dsp + cửa sổ (nếu chọn).`;
  }
}

/**
 * Chuẩn hoá biên độ tuyến tính theo khung (0…1) để vẽ overlay.
 * @param {Float64Array} mags
 * @returns {Float32Array}
 */
function normalizeLinearMags(mags) {
  let mx = 1e-12;
  for (let i = 0; i < mags.length; i++) {
    if (mags[i] > mx) mx = mags[i];
  }
  const out = new Float32Array(mags.length);
  const inv = 1 / mx;
  for (let i = 0; i < mags.length; i++) {
    out[i] = Math.min(1, mags[i] * inv);
  }
  return out;
}

/**
 * @param {AnalyserNode} analyser
 * @param {number} fftSize
 * @param {SpectrumWindow} winType
 * @returns {Float32Array | null}
 */
function computeDspOverlayNorm(analyser, fftSize, winType) {
  if (winType === "none") return null;
  const N = analyser.fftSize;
  if (N !== fftSize) return null;
  const td = new Float32Array(N);
  analyser.getFloatTimeDomainData(td);
  const win =
    winType === "hamming"
      ? hamming(N)
      : winType === "blackman"
        ? blackman(N)
        : hanning(N);
  const sig = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    sig[i] = td[i] * win[i];
  }
  const spec = fft(sig);
  const half = N >> 1;
  const mags = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const c = spec[k];
    mags[k] = Math.hypot(c.re, c.im) / N;
  }
  return normalizeLinearMags(mags);
}

/**
 * @param {HTMLElement} root
 * @returns {() => void}
 */
function mountSpectrumUi(root) {
  root.classList.add("spectrum-analyzer");

  const ac = new AbortController();
  const { signal } = ac;

  const toolbar = document.createElement("div");
  toolbar.className = "spectrum-toolbar";

  const mkField = (label, el) => {
    const wrap = document.createElement("label");
    wrap.className = "spectrum-field";
    const span = document.createElement("span");
    span.textContent = label;
    wrap.append(span, el);
    return wrap;
  };

  const selFft = document.createElement("select");
  selFft.setAttribute("aria-label", "FFT size");
  for (const n of [1024, 2048, 4096]) {
    const o = document.createElement("option");
    o.value = String(n);
    o.textContent = String(n);
    if (n === 2048) o.selected = true;
    selFft.appendChild(o);
  }

  const selScale = document.createElement("select");
  selScale.setAttribute("aria-label", "Thang biên độ");
  const scales = [
    { v: "linear", t: "Linear" },
    { v: "log", t: "Log (dB)" },
  ];
  for (const { v, t } of scales) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    selScale.appendChild(o);
  }
  selScale.value = "log";

  const selMode = document.createElement("select");
  selMode.setAttribute("aria-label", "Kiểu hiển thị");
  const modes = [
    { v: "bar", t: "Thanh (bar)" },
    { v: "waterfall", t: "Waterfall" },
  ];
  for (const { v, t } of modes) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    selMode.appendChild(o);
  }

  const selWin = document.createElement("select");
  selWin.setAttribute("aria-label", "Cửa sổ minh họa dsp");
  for (const { v, t } of [
    { v: "none", t: "Không overlay" },
    { v: "hanning", t: "Hann + FFT dsp" },
    { v: "hamming", t: "Hamming + FFT dsp" },
    { v: "blackman", t: "Blackman + FFT dsp" },
  ]) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    selWin.appendChild(o);
  }

  toolbar.append(
    mkField("FFT size", selFft),
    mkField("Thang", selScale),
    mkField("Hiển thị", selMode),
    mkField("Cửa sổ (dsp)", selWin),
  );

  canvasWrap = document.createElement("div");
  canvasWrap.className = "spectrum-canvas-wrap";

  canvasEl = document.createElement("canvas");
  canvasEl.className = "spectrum-canvas";
  canvasEl.setAttribute("aria-label", "Spectrum visualization");
  canvasWrap.appendChild(canvasEl);

  statusEl = document.createElement("p");
  statusEl.className = "spectrum-status";
  statusEl.textContent =
    "Bấm Start Audio trên header, sau đó chọn thông số để xem phổ.";

  appendChildren(root, toolbar, canvasWrap, statusEl);

  const onParamChange = () => {
    applyControlsFromUi(selFft, selScale, selMode, selWin);
  };

  selFft.addEventListener("change", onParamChange, { signal });
  selScale.addEventListener("change", onParamChange, { signal });
  selMode.addEventListener("change", onParamChange, { signal });
  selWin.addEventListener("change", onParamChange, { signal });

  applyControlsFromUi(selFft, selScale, selMode, selWin);

  const ro = new ResizeObserver(() => {
    if (canvasEl && canvasWrap) {
      syncSpectrumCanvasSize(canvasEl, canvasWrap);
    }
  });
  ro.observe(canvasWrap);

  const onStartAudioEv = () => {
    void onStartAudio();
  };
  document.addEventListener("webfft:start-audio", onStartAudioEv, { signal });

  return () => {
    ac.abort();
    ro.disconnect();
    teardownAudio();
    root.innerHTML = "";
    canvasEl = null;
    canvasWrap = null;
    statusEl = null;
  };
}

/**
 * @param {HTMLElement | null} root
 * @returns {{ id: string, isRealtimeAudio: boolean, enter: () => void, exit: () => void }}
 */
export function createSpectrumAnalyzerMode(root) {
  /** @type {(() => void) | null} */
  let teardown = null;

  return {
    id: "analyzer",
    isRealtimeAudio: true,
    enter() {
      if (!root) return;
      void resumeSharedAudioContext();
      if (!teardown) {
        teardown = mountSpectrumUi(root);
      }
      if (isAnalyzerPanelVisible() && analyser && canvasEl) {
        startLoop();
      }
    },
    exit() {
      teardown?.();
      teardown = null;
    },
  };
}
