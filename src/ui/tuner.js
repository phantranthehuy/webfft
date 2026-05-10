import { initAudio, createAnalyser, resumeSharedAudioContext } from "../audioEngine.js";
import { yinDetectPitchHz } from "../dsp/yin.js";
import { formatHz } from "../utils/format.js";
import { appendChildren } from "../utils/domHelpers.js";
import { drawTunerFrame, syncTunerCanvasSize } from "../visualization/tunerDisplay.js";

const FFT_SIZE = 4096;
const F_MIN = 60;
const F_MAX = 2000;
const LEVEL_FLOOR_DB = -40;
const A4_HZ = 440;

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/** @type {AudioContext | null} */
let ctxAudio = null;
/** @type {MediaStreamAudioSourceNode | null} */
let srcNode = null;
/** @type {GainNode | null} */
let muteOut = null;
/** @type {AnalyserNode | null} */
let analyser = null;
/** @type {Float32Array | null} */
let freqBuf = null;
/** @type {Float32Array | null} */
let timeBuf = null;
/** @type {'peak' | 'yin'} */
let tunerMethod = "peak";
/** @type {number} */
let rafId = 0;

/** @type {HTMLCanvasElement | null} */
let canvasEl = null;
/** @type {HTMLElement | null} */
let canvasWrap = null;
/** @type {HTMLElement | null} */
let statusEl = null;

function isTunerPanelVisible() {
  const panel = document.getElementById("panel-tuner");
  return Boolean(panel && !panel.hidden);
}

/**
 * @param {number} f
 * @param {number} f0
 */
function centsBetween(f, f0) {
  return 1200 * Math.log2(f / f0);
}

/**
 * @param {number} hz
 */
function hzToNoteLabel(hz) {
  const nFloat = 12 * Math.log2(hz / A4_HZ) + 69;
  const n = Math.round(nFloat);
  const f0 = A4_HZ * 2 ** ((n - 69) / 12);
  const cents = centsBetween(hz, f0);
  const name = NOTE_NAMES[((n % 12) + 12) % 12];
  const octave = Math.floor(n / 12) - 1;
  return { label: `${name}${octave}`, cents };
}

/**
 * @param {number} dbL
 * @param {number} dbC
 * @param {number} dbR
 * @returns {number}
 */
function parabolicBinOffset(dbL, dbC, dbR) {
  const yL = 10 ** (dbL * 0.05);
  const yC = 10 ** (dbC * 0.05);
  const yR = 10 ** (dbR * 0.05);
  const denom = yL - 2 * yC + yR;
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) {
    return 0;
  }
  return 0.5 * (yL - yR) / denom;
}

/**
 * @param {Float32Array} data
 * @param {number} kMin
 * @param {number} kMax
 * @returns {{ k: number, peakDb: number }}
 */
function findStrongestBin(data, kMin, kMax) {
  let k = kMin;
  let peakDb = -Infinity;
  for (let i = kMin; i <= kMax; i++) {
    const v = data[i];
    if (Number.isFinite(v) && v > peakDb) {
      peakDb = v;
      k = i;
    }
  }
  return { k, peakDb };
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
    !isTunerPanelVisible() ||
    !analyser ||
    !freqBuf ||
    !canvasEl ||
    !canvasWrap ||
    !ctxAudio
  ) {
    return;
  }

  syncTunerCanvasSize(canvasEl, canvasWrap);

  const sr = ctxAudio.sampleRate;
  const kMin = Math.max(1, Math.ceil((F_MIN * FFT_SIZE) / sr));
  const kMax = Math.min(
    (freqBuf?.length ?? 2) - 2,
    Math.floor((F_MAX * FFT_SIZE) / sr),
  );

  if (!freqBuf || !timeBuf || kMax <= kMin) {
    drawTunerFrame(canvasEl, { active: false, peakDb: -Infinity });
    return;
  }

  analyser.getFloatFrequencyData(freqBuf);
  const { peakDb } = findStrongestBin(freqBuf, kMin, kMax);

  /** @type {number | null} */
  let hz = null;

  if (tunerMethod === "yin") {
    analyser.getFloatTimeDomainData(timeBuf);
    hz = yinDetectPitchHz(timeBuf, sr, F_MIN, F_MAX);
    if (hz === null) {
      drawTunerFrame(canvasEl, {
        active: false,
        peakDb,
        idleHint: "YIN: chưa ổn định — thử âm to, rõ nốt đơn.",
        methodLabel: "YIN",
      });
      return;
    }
  } else {
    if (!Number.isFinite(peakDb) || peakDb < LEVEL_FLOOR_DB) {
      drawTunerFrame(canvasEl, { active: false, peakDb });
      return;
    }

    const { k } = findStrongestBin(freqBuf, kMin, kMax);
    const delta = parabolicBinOffset(freqBuf[k - 1], freqBuf[k], freqBuf[k + 1]);
    const binRefined = k + Math.max(-0.75, Math.min(0.75, delta));
    hz = (binRefined * sr) / FFT_SIZE;

    if (!Number.isFinite(hz) || hz < F_MIN || hz > F_MAX) {
      drawTunerFrame(canvasEl, { active: false, peakDb });
      return;
    }
  }

  if (hz === null || !Number.isFinite(hz) || hz < F_MIN || hz > F_MAX) {
    drawTunerFrame(canvasEl, { active: false, peakDb });
    return;
  }

  const { label, cents } = hzToNoteLabel(hz);

  drawTunerFrame(canvasEl, {
    active: true,
    hz,
    note: label,
    cents,
    peakDb,
    methodLabel: tunerMethod === "yin" ? "YIN" : "đỉnh phổ",
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
  freqBuf = null;
  timeBuf = null;
}

async function onStartAudio() {
  teardownAudio();
  if (statusEl) {
    statusEl.textContent = "Đang mở micro…";
  }

  try {
    const { context, stream } = await initAudio();
    ctxAudio = context;
    const sr = context.sampleRate;

    muteOut = context.createGain();
    muteOut.gain.value = 0;

    srcNode = context.createMediaStreamSource(stream);
    muteOut.connect(context.destination);

    analyser = createAnalyser(FFT_SIZE);
    analyser.smoothingTimeConstant = 0.2;

    srcNode.connect(analyser);
    analyser.connect(muteOut);

    freqBuf = new Float32Array(analyser.frequencyBinCount);
    timeBuf = new Float32Array(analyser.fftSize);

    if (statusEl) {
      statusEl.textContent = `Tuner · ${formatHz(sr, 0)} · fftSize ${FFT_SIZE} · A4 = ${formatHz(A4_HZ)} · chọn Peak hoặc YIN`;
    }

    startLoop();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (statusEl) {
      statusEl.textContent = `Lỗi: ${msg}`;
    }
  }
}

/**
 * @param {HTMLElement} root
 * @returns {() => void}
 */
function mountTunerUi(root) {
  root.classList.add("tuner-root");

  const ac = new AbortController();
  const { signal } = ac;

  const toolbar = document.createElement("div");
  toolbar.className = "tuner-toolbar";
  const lab = document.createElement("label");
  lab.className = "tuner-field";
  const labSpan = document.createElement("span");
  labSpan.textContent = "Phát hiện cao độ";
  const methodSel = document.createElement("select");
  methodSel.setAttribute("aria-label", "Phương pháp phát hiện cao độ");
  for (const [v, t] of [
    ["peak", "Đỉnh phổ (FFT)"],
    ["yin", "YIN (miền thời gian)"],
  ]) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    methodSel.appendChild(o);
  }
  methodSel.value = tunerMethod;
  methodSel.addEventListener(
    "change",
    () => {
      tunerMethod = /** @type {'peak' | 'yin'} */ (methodSel.value);
    },
    { signal },
  );
  lab.append(labSpan, methodSel);
  toolbar.append(lab);

  canvasWrap = document.createElement("div");
  canvasWrap.className = "tuner-canvas-wrap";

  canvasEl = document.createElement("canvas");
  canvasEl.className = "tuner-canvas";
  canvasEl.setAttribute("aria-label", "Tuner cents và tên nốt");
  canvasWrap.appendChild(canvasEl);

  statusEl = document.createElement("p");
  statusEl.className = "tuner-status";
  statusEl.textContent =
    "Bấm Start Audio trên header để bật micro và hiển thị cao độ.";

  appendChildren(root, toolbar, canvasWrap, statusEl);

  const ro = new ResizeObserver(() => {
    if (canvasEl && canvasWrap) {
      syncTunerCanvasSize(canvasEl, canvasWrap);
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
export function createTunerMode(root) {
  /** @type {(() => void) | null} */
  let teardown = null;

  return {
    id: "tuner",
    isRealtimeAudio: true,
    enter() {
      if (!root) return;
      void resumeSharedAudioContext();
      if (!teardown) {
        teardown = mountTunerUi(root);
      }
      if (isTunerPanelVisible() && analyser && freqBuf && canvasEl) {
        startLoop();
      }
    },
    exit() {
      teardown?.();
      teardown = null;
    },
  };
}
