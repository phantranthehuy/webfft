import {
  createAnalyser,
  ensureMicStream,
  hasLiveMicStream,
  getSharedAudioContext,
  resumeSharedAudioContext,
} from "../audioEngine.js";
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
/** @type {string} */
let micInfoText = "";
/** @type {number} */
let lastStatusAt = 0;

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
  renderAnalyzerStatus();
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
  micInfoText = "";
  lastStatusAt = 0;
}

/**
 * @param {MediaStream} stream
 */
function describeMicStream(stream) {
  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings?.() ?? {};
  const rate =
    typeof settings.sampleRate === "number"
      ? formatHz(settings.sampleRate, 0)
      : "không báo sr";
  const channels =
    typeof settings.channelCount === "number"
      ? `${settings.channelCount}ch`
      : "không báo kênh";
  return `mic ${rate}, ${channels}`;
}

/**
 * @param {AnalyserNode} node
 * @param {number} sampleRate
 * @returns {{ hz: number, db: number } | null}
 */
function findPeakFrequency(node, sampleRate) {
  const buf = new Float32Array(node.frequencyBinCount);
  node.getFloatFrequencyData(buf);

  let k = 1;
  let peakDb = -Infinity;
  for (let i = 1; i < buf.length; i++) {
    if (buf[i] > peakDb) {
      peakDb = buf[i];
      k = i;
    }
  }
  if (!Number.isFinite(peakDb)) return null;

  let delta = 0;
  if (k > 0 && k < buf.length - 1) {
    const a = buf[k - 1];
    const b = buf[k];
    const c = buf[k + 1];
    const denom = a - 2 * b + c;
    if (Number.isFinite(denom) && Math.abs(denom) > 1e-9) {
      delta = Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denom));
    }
  }

  return { hz: ((k + delta) * sampleRate) / node.fftSize, db: peakDb };
}

function renderAnalyzerStatus() {
  if (!statusEl || !ctxAudio || !analyser) return;
  const now = performance.now();
  if (now - lastStatusAt < 250) return;
  lastStatusAt = now;

  const nyq = ctxAudio.sampleRate / 2;
  const peak = findPeakFrequency(analyser, ctxAudio.sampleRate);
  const peakText = peak
    ? `đỉnh ≈ ${formatHz(peak.hz)} (${peak.db.toFixed(1)} dB)`
    : "chưa có đỉnh rõ";
  statusEl.textContent = `Nyquist ${formatHz(nyq)} · ctx ${formatHz(ctxAudio.sampleRate, 0)} · ${micInfoText} · ${peakText} · fftSize ${params.fftSize}.`;
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
  analyser.minDecibels = -120;
  analyser.maxDecibels = -10;

  srcNode.connect(analyser);
  analyser.connect(muteOut);
}

/**
 * Nối Analyser với micro (tái dùng sau Start Audio nếu đã có luồng).
 */
async function connectAnalyzerMic() {
  teardownAudio();
  statusEl && (statusEl.textContent = "Đang mở micro…");

  try {
    const { context, stream } = await ensureMicStream();
    ctxAudio = context;
    micInfoText = describeMicStream(stream);

    muteOut = context.createGain();
    muteOut.gain.value = 0;

    srcNode = context.createMediaStreamSource(stream);
    muteOut.connect(context.destination);

    wireAnalyser(params.fftSize);
    resetSpectrumWaterfall(/** @type {HTMLCanvasElement} */ (canvasEl));

    renderAnalyzerStatus();

    startLoop();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (statusEl) {
      statusEl.textContent = `Lỗi: ${msg}`;
    }
  }
}

/** Khi đã Start Audio trước rồi mới vào tab — sự kiện có thể đã phát trước khi mount. */
async function connectAnalyzerMicIfPrimed() {
  if (!hasLiveMicStream() || !getSharedAudioContext()) return;
  if (ctxAudio && analyser && srcNode) return;
  await connectAnalyzerMic();
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

  renderAnalyzerStatus();
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

  /**
   * @param {HTMLSelectElement} select
   * @param {readonly (readonly [string, string])[]} options
   * @param {string} ariaLabel
   */
  function createChoiceToggle(select, options, ariaLabel) {
    select.hidden = true;
    const wrap = document.createElement("div");
    wrap.className = "spectrum-choice-toggle";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", ariaLabel);

    /** @type {HTMLButtonElement[]} */
    const buttons = [];

    function sync() {
      for (const btn of buttons) {
        const on = btn.dataset.value === select.value;
        btn.classList.toggle("is-selected", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }

    for (const [value, title] of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "spectrum-choice-btn";
      btn.dataset.value = value;
      btn.textContent = title;
      btn.addEventListener(
        "click",
        () => {
          if (select.value === value) return;
          select.value = value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        },
        { signal },
      );
      buttons.push(btn);
      wrap.appendChild(btn);
    }

    select.addEventListener("change", sync, { signal });
    sync();
    return wrap;
  }

  const selFft = document.createElement("select");
  selFft.setAttribute("aria-label", "FFT size");
  for (const n of [1024, 2048, 4096]) {
    const o = document.createElement("option");
    o.value = String(n);
    o.textContent = String(n);
    if (n === 2048) o.selected = true;
    selFft.appendChild(o);
  }
  const fftChoice = createChoiceToggle(
    selFft,
    [
      ["1024", "1024"],
      ["2048", "2048"],
      ["4096", "4096"],
    ],
    "FFT size",
  );

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
  const scaleChoice = createChoiceToggle(
    selScale,
    [
      ["linear", "Linear"],
      ["log", "Log (dB)"],
    ],
    "Thang biên độ",
  );

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
  const modeChoice = createChoiceToggle(
    selMode,
    [
      ["bar", "Thanh"],
      ["waterfall", "Waterfall"],
    ],
    "Kiểu hiển thị",
  );

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
    mkField("FFT size", fftChoice),
    mkField("Thang", scaleChoice),
    mkField("Hiển thị", modeChoice),
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
    "Bật icon micro góc trái dưới, sau đó chọn thông số để xem phổ.";

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
    void connectAnalyzerMic();
  };
  document.addEventListener("webfft:start-audio", onStartAudioEv, { signal });

  const onStopAudioEv = () => {
    teardownAudio();
    if (statusEl) {
      statusEl.textContent =
        "Micro đã dừng. Bật lại icon micro góc trái dưới để lắng nghe, sau đó chọn thông số để xem phổ.";
    }
  };
  document.addEventListener("webfft:stop-audio", onStopAudioEv, { signal });

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
      void connectAnalyzerMicIfPrimed();
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
