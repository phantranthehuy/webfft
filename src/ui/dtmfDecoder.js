import {
  ensureAudioContext,
  ensureMicStream,
  getSharedAudioContext,
  getSharedMediaStream,
  hasLiveMicStream,
  resumeSharedAudioContext,
} from "../audioEngine.js";
import { fft } from "../dsp/fft.js";
import { hanning } from "../dsp/stft.js";

/** Tần số hàng / cột ITU-T Q.23 */
const ROW_HZ = Object.freeze([697, 770, 852, 941]);
const COL_HZ = Object.freeze([1209, 1336, 1477, 1633]);

/** @type {readonly string[][]} */
const KEY_MATRIX = Object.freeze([
  ["1", "2", "3", "A"],
  ["4", "5", "6", "B"],
  ["7", "8", "9", "C"],
  ["*", "0", "#", "D"],
]);

const FREQ_TOL = 0.015;
const AMP_DIFF_DB_MAX = 10;
const MIN_DETECT_GAP_MS = 80;
const STABLE_FRAMES = 2;
const TONE_MS = 100;
const FFT_SIZE = 2048;

/** @type {Float64Array | null} */
let cachedHanning = null;

function injectStyles() {
  if (document.getElementById("dtmf-decoder-styles")) return;
  const style = document.createElement("style");
  style.id = "dtmf-decoder-styles";
  style.textContent = `
    .dtmf-root { display: flex; flex-direction: column; gap: 20px; max-width: 520px; }
    .dtmf-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .dtmf-toolbar label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
    .dtmf-toolbar select { background: var(--surface-strong); border: 1px solid var(--border); color: var(--text);
      padding: 8px 12px; border-radius: 10px; font-family: inherit; min-width: 180px; }
    .dtmf-readout { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 16px 20px;
      display: grid; gap: 8px; }
    .dtmf-current { font-family: "Space Grotesk", sans-serif; font-size: 42px; font-weight: 600; letter-spacing: 0.06em;
      color: var(--accent); min-height: 1.2em; }
    .dtmf-meta { font-size: 13px; color: var(--muted); }
    .dtmf-history-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
    .dtmf-history { font-family: ui-monospace, monospace; font-size: 15px; word-break: break-all; color: var(--text); flex: 1; min-height: 1.4em; }
    .dtmf-keypad { display: grid; grid-template-columns: repeat(4, minmax(56px, 1fr)); gap: 10px; max-width: 320px; }
    .dtmf-key {
      aspect-ratio: 1; border-radius: 14px; border: 1px solid var(--border);
      background: linear-gradient(165deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02));
      color: var(--text); font-family: "Space Grotesk", sans-serif; font-size: 18px; font-weight: 600;
      cursor: pointer; transition: transform 0.12s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .dtmf-key:hover { border-color: rgba(47, 210, 168, 0.45); }
    .dtmf-key:active, .dtmf-key.is-pressed { transform: scale(0.96); box-shadow: inset 0 0 0 2px rgba(47, 210, 168, 0.35); }
    .dtmf-key:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .dtmf-status { font-size: 13px; color: var(--muted); margin: 0; }
    .dtmf-help { font-size: 13px; color: var(--muted); line-height: 1.55; margin: 0; max-width: 42rem; }
  `;
  document.head.appendChild(style);
}

/**
 * @param {Float64Array} mags
 * @param {number} k — chỉ số cực đại cục bộ
 * @param {number} sr
 * @param {number} N
 */
function refinedFreqFromPeak(mags, k, sr, N) {
  if (k <= 0 || k >= mags.length - 1) {
    return (k * sr) / N;
  }
  const y0 = mags[k - 1];
  const y1 = mags[k];
  const y2 = mags[k + 1];
  const denom = y0 - 2 * y1 + y2;
  let delta = 0;
  if (Math.abs(denom) > 1e-18) {
    delta = 0.5 * (y0 - y2) / denom;
    delta = Math.max(-0.5, Math.min(0.5, delta));
  }
  return ((k + delta) * sr) / N;
}

/**
 * @param {Float64Array} mags
 * @param {number} fTargetHz
 * @param {number} sr
 * @param {number} N
 */
function peakInBand(mags, fTargetHz, sr, N) {
  const half = mags.length;
  const kCenter = (fTargetHz * N) / sr;
  const halfBins = Math.ceil((fTargetHz * FREQ_TOL * N) / sr) + 2;
  let k0 = Math.round(kCenter);
  let kStart = Math.max(1, k0 - halfBins);
  let kEnd = Math.min(half - 2, k0 + halfBins);
  if (kStart > kEnd) {
    return { mag: 0, freq: fTargetHz, ok: false };
  }
  let bestK = kStart;
  let bestMag = mags[kStart];
  for (let k = kStart; k <= kEnd; k++) {
    if (mags[k] > bestMag) {
      bestMag = mags[k];
      bestK = k;
    }
  }
  const freq = refinedFreqFromPeak(mags, bestK, sr, N);
  const ok = Math.abs(freq - fTargetHz) / fTargetHz <= FREQ_TOL;
  return { mag: bestMag, freq, ok };
}

/**
 * @param {Float64Array} mags
 * @param {number} sr
 * @param {number} N
 */
function medianMag(mags, kLo, kHi) {
  const slice = [];
  for (let k = kLo; k <= kHi; k++) {
    slice.push(mags[k]);
  }
  slice.sort((a, b) => a - b);
  return slice[Math.floor(slice.length / 2)] ?? 0;
}

/**
 * @param {AnalyserNode} analyser
 * @param {AudioContext} context
 * @returns {{ digit: string | null, detail: string }}
 */
function decodeFrame(analyser, context) {
  const N = analyser.fftSize;
  const sr = context.sampleRate;
  const td = new Float32Array(N);
  analyser.getFloatTimeDomainData(td);

  if (!cachedHanning || cachedHanning.length !== N) {
    cachedHanning = hanning(N);
  }
  const sig = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    sig[i] = td[i] * cachedHanning[i];
  }

  const spectrum = fft(sig);
  const half = N >> 1;
  const mags = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const c = spectrum[k];
    mags[k] = Math.hypot(c.re, c.im);
  }

  const kLo = Math.max(1, Math.floor((650 * N) / sr));
  const kHi = Math.min(half - 2, Math.ceil((1700 * N) / sr));
  const noiseFloor = medianMag(mags, kLo, kHi);

  /** @type {{ hz: number, mag: number, freq: number } | null} */
  let bestRow = null;
  for (const hz of ROW_HZ) {
    const { mag, freq, ok } = peakInBand(mags, hz, sr, N);
    if (!ok || mag < noiseFloor * 8) continue;
    if (!bestRow || mag > bestRow.mag) {
      bestRow = { hz, mag, freq };
    }
  }

  /** @type {{ hz: number, mag: number, freq: number } | null} */
  let bestCol = null;
  for (const hz of COL_HZ) {
    const { mag, freq, ok } = peakInBand(mags, hz, sr, N);
    if (!ok || mag < noiseFloor * 8) continue;
    if (!bestCol || mag > bestCol.mag) {
      bestCol = { hz, mag, freq };
    }
  }

  if (!bestRow || !bestCol) {
    return { digit: null, detail: "Không đủ hai đỉnh trong dung sai ±1.5%" };
  }

  const ratio =
    bestRow.mag >= bestCol.mag
      ? bestRow.mag / bestCol.mag
      : bestCol.mag / bestRow.mag;
  const dbDiff = 20 * Math.log10(ratio);
  if (dbDiff >= AMP_DIFF_DB_MAX) {
    return {
      digit: null,
      detail: `Lệch biên độ ${dbDiff.toFixed(1)} dB (cần < ${AMP_DIFF_DB_MAX} dB)`,
    };
  }

  const rowIdx = ROW_HZ.indexOf(bestRow.hz);
  const colIdx = COL_HZ.indexOf(bestCol.hz);
  const digit = KEY_MATRIX[rowIdx][colIdx];
  const detail = `${digit}: ${bestRow.freq.toFixed(1)} Hz + ${bestCol.freq.toFixed(1)} Hz (Δ ${dbDiff.toFixed(1)} dB)`;
  return { digit, detail };
}

/**
 * @param {string} label
 * @param {string} ariaLabel
 */
function makeSelect(label, ariaLabel) {
  const wrap = document.createElement("label");
  const span = document.createElement("span");
  span.textContent = label;
  const sel = document.createElement("select");
  sel.setAttribute("aria-label", ariaLabel);
  wrap.append(span, sel);
  return { wrap, sel };
}

/**
 * @param {HTMLElement} root
 * @returns {() => void}
 */
function mountDtmfDecoder(root) {
  injectStyles();
  const ac = new AbortController();
  const { signal } = ac;

  root.classList.add("dtmf-root");
  root.innerHTML = "";

  const toolbar = document.createElement("div");
  toolbar.className = "dtmf-toolbar";

  const { wrap: srcWrap, sel: srcSel } = makeSelect("Nguồn phân tích", "Nguồn tín hiệu DTMF");
  const optInt = document.createElement("option");
  optInt.value = "internal";
  optInt.textContent = "Oscillator nội bộ (sau khi bấm phím)";
  const optMic = document.createElement("option");
  optMic.value = "mic";
  optMic.textContent = "Micro (cần quyền)";
  srcSel.append(optInt, optMic);

  const micBtn = document.createElement("button");
  micBtn.type = "button";
  micBtn.className = "ghost-button";
  micBtn.textContent = "Bật micro";
  micBtn.setAttribute("aria-label", "Yêu cầu quyền micro để giải mã DTMF");

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "ghost-button";
  clearBtn.textContent = "Xóa lịch sử";
  clearBtn.setAttribute("aria-label", "Xóa chuỗi đã nhận dạng");

  toolbar.append(srcWrap, micBtn, clearBtn);

  const helpEl = document.createElement("p");
  helpEl.className = "dtmf-help";
  helpEl.textContent =
    "Hai chế độ «Nguồn phân tích» dùng chung một đồ thị Web Audio: Oscillator nội bộ — tín hiệu phân tích chính là tone do app phát (hai Oscillator → Gain → tap), bạn bấm phím ảo hoặc phím số trên bàn phím; Analyser lấy mẫu từ nhánh đó. Micro — đầu vào là luồng micro (MediaStreamSource → cùng tap); app không phát tone nội bộ khi đang chọn micro để tránh trộn hai nguồn. Trong cả hai trường hợp, mỗi khung hình vẽ lại: đọc miền thời gian từ Analyser, nhân cửa sổ Hann, gọi FFT trong dsp, rồi tìm cặp tần hàng/cột DTMF.";

  const readout = document.createElement("div");
  readout.className = "dtmf-readout";
  const currentEl = document.createElement("div");
  currentEl.className = "dtmf-current";
  currentEl.setAttribute("aria-live", "polite");
  currentEl.textContent = "—";
  const metaEl = document.createElement("div");
  metaEl.className = "dtmf-meta";
  metaEl.textContent = "FFT dsp · cửa sổ Hann · fftSize " + FFT_SIZE;

  const histRow = document.createElement("div");
  histRow.className = "dtmf-history-row";
  const histLabel = document.createElement("span");
  histLabel.className = "dtmf-meta";
  histLabel.textContent = "Lịch sử:";
  const histEl = document.createElement("div");
  histEl.className = "dtmf-history";
  histEl.setAttribute("aria-label", "Chuỗi DTMF đã nhận dạng");
  histRow.append(histLabel, histEl);

  readout.append(currentEl, metaEl, histRow);

  const keypad = document.createElement("div");
  keypad.className = "dtmf-keypad";
  keypad.setAttribute("role", "group");
  keypad.setAttribute("aria-label", "Bàn phím DTMF");

  const statusEl = document.createElement("p");
  statusEl.className = "dtmf-status";

  root.append(toolbar, helpEl, readout, keypad, statusEl);

  /** @type {AudioContext | null} */
  let audioCtx = null;
  /** @type {AnalyserNode | null} */
  let analyser = null;
  /** @type {GainNode | null} */
  let tapGain = null;
  /** @type {GainNode | null} */
  let outGain = null;
  /** @type {MediaStreamAudioSourceNode | null} */
  let micNode = null;
  /** @type {MediaStream | null} */
  let micStream = null;

  let rafId = 0;
  let history = "";
  let lastEmitAt = 0;
  let stableDigit = /** @type {string | null} */ (null);
  let stableCount = 0;

  /**
   * @param {{ monitorSpeakers: boolean }} opts
   */
  function ensureGraph(opts = { monitorSpeakers: true }) {
    audioCtx = ensureAudioContext();
    if (!analyser || analyser.context !== audioCtx) {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
    }
    if (!tapGain || tapGain.context !== audioCtx) {
      tapGain = audioCtx.createGain();
      tapGain.gain.value = 1;
    }
    if (!outGain || outGain.context !== audioCtx) {
      outGain = audioCtx.createGain();
      outGain.gain.value = 0.25;
    }
    try {
      tapGain.disconnect();
    } catch {
      /* ignore */
    }
    try {
      analyser.disconnect();
    } catch {
      /* ignore */
    }
    try {
      outGain.disconnect();
    } catch {
      /* ignore */
    }
    tapGain.connect(analyser);
    tapGain.connect(outGain);
    if (opts.monitorSpeakers) {
      outGain.connect(audioCtx.destination);
    }
  }

  function disconnectMic() {
    try {
      micNode?.disconnect();
    } catch {
      /* ignore */
    }
    micNode = null;
    micStream = null;
  }

  function isMicSource() {
    return srcSel.value === "mic";
  }

  function wireMicFromSharedStream(stream) {
    if (!audioCtx || !tapGain) return;
    disconnectMic();
    micStream = stream;
    micNode = audioCtx.createMediaStreamSource(stream);
    micNode.connect(tapGain);
  }

  function wireInternalTapOnly() {
    ensureGraph({ monitorSpeakers: true });
    disconnectMic();
  }

  /** Phím ảo: hai oscillator → tapGain (100ms) — chỉ khi nguồn nội bộ (không trộn với micro). */
  function playDtmf(lowHz, highHz) {
    if (isMicSource()) {
      statusEl.textContent =
        "Nguồn đang là micro: không phát tone nội bộ. Chọn «Oscillator nội bộ» để thử phím ảo.";
      return;
    }
    wireInternalTapOnly();
    const ctx = /** @type {AudioContext} */ (audioCtx);
    const t0 = ctx.currentTime;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, t0);
    envelope.gain.linearRampToValueAtTime(0.2, t0 + 0.02);
    envelope.gain.setValueAtTime(0.2, t0 + Math.max(0, TONE_MS / 1000 - 0.02));
    envelope.gain.linearRampToValueAtTime(0, t0 + TONE_MS / 1000);

    const oscL = ctx.createOscillator();
    const oscH = ctx.createOscillator();
    oscL.type = "sine";
    oscH.type = "sine";
    oscL.frequency.setValueAtTime(lowHz, t0);
    oscH.frequency.setValueAtTime(highHz, t0);

    oscL.connect(envelope);
    oscH.connect(envelope);
    envelope.connect(/** @type {GainNode} */ (tapGain));

    oscL.start(t0);
    oscH.start(t0);
    oscL.stop(t0 + TONE_MS / 1000 + 0.02);
    oscH.stop(t0 + TONE_MS / 1000 + 0.02);

    statusEl.textContent = `Phát ${lowHz} Hz + ${highHz} Hz (${TONE_MS} ms)`;
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function isDtmfPanelVisible() {
    const panel = document.getElementById("panel-dtmf");
    return Boolean(panel && !panel.hidden);
  }

  function loop() {
    rafId = requestAnimationFrame(loop);
    if (
      document.visibilityState !== "visible" ||
      !isDtmfPanelVisible() ||
      !analyser ||
      !audioCtx
    ) {
      return;
    }

    const { digit, detail } = decodeFrame(analyser, audioCtx);
    currentEl.textContent = digit ?? "—";
    metaEl.textContent = digit ? detail : `FFT dsp · ${detail}`;

    if (!digit) {
      stableDigit = null;
      stableCount = 0;
      return;
    }

    if (digit === stableDigit) {
      stableCount++;
    } else {
      stableDigit = digit;
      stableCount = 1;
    }

    const now = performance.now();
    if (
      stableCount >= STABLE_FRAMES &&
      now - lastEmitAt >= MIN_DETECT_GAP_MS
    ) {
      lastEmitAt = now;
      history += digit;
      histEl.textContent = history || "(trống)";
    }
  }

  function startLoop() {
    stopLoop();
    rafId = requestAnimationFrame(loop);
  }

  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const digit = KEY_MATRIX[r][c];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dtmf-key";
      btn.textContent = digit;
      btn.dataset.low = String(ROW_HZ[r]);
      btn.dataset.high = String(COL_HZ[c]);
      btn.setAttribute(
        "aria-label",
        `Phím DTMF ${digit}, ${ROW_HZ[r]} Hz và ${COL_HZ[c]} Hz`,
      );
      btn.addEventListener(
        "pointerdown",
        () => btn.classList.add("is-pressed"),
        { signal },
      );
      btn.addEventListener(
        "pointerup",
        () => btn.classList.remove("is-pressed"),
        { signal },
      );
      btn.addEventListener(
        "pointerleave",
        () => btn.classList.remove("is-pressed"),
        { signal },
      );
      btn.addEventListener(
        "click",
        () => {
          playDtmf(ROW_HZ[r], COL_HZ[c]);
        },
        { signal },
      );
      keypad.appendChild(btn);
    }
  }

  root.tabIndex = 0;
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "DTMF Decoder");

  document.addEventListener(
    "keydown",
    (ev) => {
      if (!isDtmfPanelVisible()) return;
      const ae = document.activeElement;
      if (
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        ae instanceof HTMLSelectElement
      ) {
        return;
      }
      const map = {
        Digit1: [0, 0],
        Digit2: [0, 1],
        Digit3: [0, 2],
        KeyA: [0, 3],
        Digit4: [1, 0],
        Digit5: [1, 1],
        Digit6: [1, 2],
        KeyB: [1, 3],
        Digit7: [2, 0],
        Digit8: [2, 1],
        Digit9: [2, 2],
        KeyC: [2, 3],
        Asterisk: [3, 0],
        Digit0: [3, 1],
        Minus: [3, 0],
        Slash: [3, 2],
        KeyD: [3, 3],
      };
      const idx = map[/** @type {keyof typeof map} */ (ev.code)];
      if (!idx || isMicSource()) return;
      ev.preventDefault();
      const [rk, ck] = idx;
      playDtmf(ROW_HZ[rk], COL_HZ[ck]);
      const b = keypad.querySelectorAll(".dtmf-key")[rk * 4 + ck];
      if (b instanceof HTMLElement) {
        b.classList.add("is-pressed");
        setTimeout(() => {
          if (signal.aborted) return;
          b.classList.remove("is-pressed");
        }, 120);
      }
    },
    { signal },
  );

  async function onMicClick() {
    micBtn.disabled = true;
    statusEl.textContent = "Đang mở micro…";
    try {
      const { context, stream } = await ensureMicStream();
      audioCtx = context;
      ensureGraph({ monitorSpeakers: false });
      wireMicFromSharedStream(stream);
      srcSel.value = "mic";
      statusEl.textContent = `Micro · ${Math.round(context.sampleRate)} Hz`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      statusEl.textContent = `Micro lỗi: ${msg}`;
    } finally {
      micBtn.disabled = false;
    }
  }

  async function syncMicFromPrimedStartAudio() {
    if (srcSel.value !== "mic") return;
    if (!hasLiveMicStream() || !getSharedAudioContext()) return;
    try {
      const stream = getSharedMediaStream();
      const ctx = getSharedAudioContext();
      if (!stream || !ctx) return;
      audioCtx = ctx;
      ensureGraph({ monitorSpeakers: false });
      wireMicFromSharedStream(stream);
      statusEl.textContent = `Micro · ${Math.round(ctx.sampleRate)} Hz`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      statusEl.textContent = `Micro (đồng bộ): ${msg}`;
    }
  }

  micBtn.addEventListener(
    "click",
    () => {
      void onMicClick();
    },
    { signal },
  );

  srcSel.addEventListener(
    "change",
    () => {
      lastEmitAt = 0;
      stableDigit = null;
      stableCount = 0;
      if (srcSel.value === "internal") {
        wireInternalTapOnly();
        statusEl.textContent =
          "Nội bộ: bấm phím để phát tone và đọc FFT trên luồng synthesizer.";
      } else {
        statusEl.textContent =
          "Đang mở micro… (hoặc bấm «Bật micro» / Start Audio trên header)";
        void onMicClick();
      }
    },
    { signal },
  );

  clearBtn.addEventListener(
    "click",
    () => {
      history = "";
      histEl.textContent = "(trống)";
      lastEmitAt = 0;
      stableDigit = null;
      stableCount = 0;
    },
    { signal },
  );

  wireInternalTapOnly();
  statusEl.textContent =
    "Nội bộ: bấm phím để phát tone; FFT (dsp) trên AnalyserNode. Hoặc bật micro.";
  startLoop();

  document.addEventListener(
    "webfft:start-audio",
    () => {
      if (srcSel.value !== "mic") return;
      void onMicClick();
    },
    { signal },
  );

  return {
    dispose() {
      stopLoop();
      disconnectMic();
      for (const n of [analyser, tapGain, outGain]) {
        try {
          n?.disconnect();
        } catch {
          /* ignore */
        }
      }
      analyser = null;
      tapGain = null;
      outGain = null;
      ac.abort();
      root.innerHTML = "";
    },
    syncMicFromPrimedStartAudio,
  };
}

/**
 * @param {HTMLElement | null} root
 * @returns {{ id: string, isRealtimeAudio: boolean, enter: () => void, exit: () => void }}
 */
export function createDtmfDecoderMode(root) {
  /** @type {{ dispose: () => void; syncMicFromPrimedStartAudio: () => Promise<void> } | null} */
  let dtmfApi = null;

  return {
    id: "dtmf",
    isRealtimeAudio: true,
    enter() {
      if (!root) return;
      void resumeSharedAudioContext();
      if (!dtmfApi) {
        dtmfApi = mountDtmfDecoder(root);
      }
      void dtmfApi.syncMicFromPrimedStartAudio();
    },
    exit() {
      dtmfApi?.dispose();
      dtmfApi = null;
    },
  };
}
