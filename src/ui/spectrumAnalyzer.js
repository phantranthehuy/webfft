import { initAudio, createAnalyser } from "../audioEngine.js";
import {
  drawSpectrumFrame,
  resetSpectrumWaterfall,
  syncSpectrumCanvasSize,
} from "../visualization/spectrumCanvas.js";

/** @typedef {'linear' | 'log'} SpectrumScale */
/** @typedef {'bar' | 'waterfall'} SpectrumMode */

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

/** @type {{ fftSize: number, scale: SpectrumScale, mode: SpectrumMode }} */
let params = {
  fftSize: 2048,
  scale: "log",
  mode: "bar",
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
  drawSpectrumFrame(canvasEl, analyser, {
    fftSize: params.fftSize,
    scale: params.scale,
    mode: params.mode,
    sampleRate: ctxAudio.sampleRate,
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
      statusEl.textContent = `Nyquist ≈ ${Math.round(context.sampleRate / 2)} Hz · fftSize ${params.fftSize}`;
    }

    startLoop();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (statusEl) {
      statusEl.textContent = `Lỗi: ${msg}`;
    }
  }
}

function applyControlsFromUi(selFft, selScale, selMode) {
  params.fftSize = Number(selFft.value);
  params.scale = /** @type {SpectrumScale} */ (selScale.value);
  params.mode = /** @type {SpectrumMode} */ (selMode.value);

  if (analyser && ctxAudio && srcNode) {
    wireAnalyser(params.fftSize);
  }
  if (canvasEl) {
    resetSpectrumWaterfall(/** @type {HTMLCanvasElement} */ (canvasEl));
  }

  if (statusEl && ctxAudio) {
    statusEl.textContent = `Nyquist ≈ ${Math.round(ctxAudio.sampleRate / 2)} Hz · fftSize ${params.fftSize}`;
  }
}

/**
 * @param {HTMLElement} root
 */
function mountUi(root) {
  root.classList.add("spectrum-analyzer");

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

  toolbar.append(
    mkField("FFT size", selFft),
    mkField("Thang", selScale),
    mkField("Hiển thị", selMode),
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

  root.append(toolbar, canvasWrap, statusEl);

  const onParamChange = () => {
    applyControlsFromUi(selFft, selScale, selMode);
  };

  selFft.addEventListener("change", onParamChange);
  selScale.addEventListener("change", onParamChange);
  selMode.addEventListener("change", onParamChange);

  applyControlsFromUi(selFft, selScale, selMode);

  const ro = new ResizeObserver(() => {
    if (canvasEl && canvasWrap) {
      syncSpectrumCanvasSize(canvasEl, canvasWrap);
    }
  });
  ro.observe(canvasWrap);

  document.addEventListener("webfft:start-audio", () => {
    void onStartAudio();
  });
}

function mount() {
  const host = document.getElementById("spectrum-analyzer");
  if (!host) return;
  mountUi(host);
}

mount();
