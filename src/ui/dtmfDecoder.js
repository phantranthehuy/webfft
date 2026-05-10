import {
  ensureAudioContext,
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

/**
 * @param {string} key — một ký tự (`ev.key` hoặc ký tự trong lịch sử)
 * @returns {[number, number] | null}
 */
function lookupDigitRcFromKey(key) {
  if (key.length !== 1) return null;
  const ch = /[a-d]/i.test(key) ? key.toUpperCase() : key;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (KEY_MATRIX[r][c] === ch) return [r, c];
    }
  }
  return null;
}

const FREQ_TOL = 0.015;
const AMP_DIFF_DB_MAX = 10;
const MIN_DETECT_GAP_MS = 80;
const STABLE_FRAMES = 2;
const TONE_MS = 100;
/** Khoảng nghỉ giữa hai tone khi phát chuỗi (ms) */
const TONE_GAP_MS = 80;
const PENDING_MAX_LEN = 32;
/** Giữ dòng meta sau tone / sau chuỗi (ms) */
const PLAYBACK_STICKY_TAIL_MS = 420;
const FFT_SIZE = 2048;

/** @type {Float64Array | null} */
let cachedHanning = null;

function injectStyles() {
  if (document.getElementById("dtmf-decoder-styles")) return;
  const style = document.createElement("style");
  style.id = "dtmf-decoder-styles";
  style.textContent = `
    .dtmf-root {
      display: flex; flex-direction: column; gap: 20px; align-items: center;
      width: 100%; max-width: 560px; margin-inline: auto;
    }
    .dtmf-icon-btn {
      padding: 10px 14px; display: inline-flex; align-items: center; justify-content: center;
      min-width: 44px; min-height: 44px;
    }
    .dtmf-icon-btn img { display: block; width: 22px; height: 22px; }
    .dtmf-readout {
      background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 16px 20px;
      display: grid; gap: 8px; text-align: center; width: 100%; max-width: 440px;
    }
    .dtmf-current { font-family: "Space Grotesk", sans-serif; font-size: 42px; font-weight: 600; letter-spacing: 0.06em;
      color: var(--accent); min-height: 1.2em; text-align: center; }
    .dtmf-meta { font-size: 13px; color: var(--muted); text-align: center; line-height: 1.45; }
    .dtmf-history-row {
      display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: center;
    }
    .dtmf-history {
      display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: center;
      min-height: 1.4em; min-width: 0; max-width: 100%;
    }
    .dtmf-history-empty { font-family: ui-monospace, monospace; font-size: 15px; color: var(--muted); }
    .dtmf-hist-char {
      font-family: ui-monospace, monospace; font-size: 15px; font-weight: 600;
      min-width: 2em; height: 2em; padding: 0 8px; border-radius: 10px;
      border: 1px solid var(--border); background: rgba(255,255,255,0.05); color: var(--text);
      cursor: pointer; transition: border-color 0.15s ease, transform 0.12s ease;
    }
    .dtmf-hist-char:hover { border-color: rgba(47, 210, 168, 0.45); }
    .dtmf-hist-char:active { transform: scale(0.96); }
    .dtmf-keypad {
      display: grid; grid-template-columns: repeat(4, minmax(60px, 1fr)); gap: 12px;
      max-width: 340px; width: 100%; margin-inline: auto;
    }
    .dtmf-key {
      aspect-ratio: 1; border-radius: 14px; border: 1px solid var(--border);
      background: linear-gradient(165deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02));
      color: var(--text); font-family: "Space Grotesk", sans-serif; font-size: 18px; font-weight: 600;
      cursor: pointer; transition: transform 0.12s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .dtmf-key:hover { border-color: rgba(47, 210, 168, 0.45); }
    .dtmf-key:active, .dtmf-key.is-pressed { transform: scale(0.96); box-shadow: inset 0 0 0 2px rgba(47, 210, 168, 0.35); }
    .dtmf-key:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .dtmf-status { font-size: 13px; color: var(--muted); margin: 0; text-align: center; max-width: 42rem; }
    .dtmf-help { font-size: 13px; color: var(--muted); line-height: 1.55; margin: 0; max-width: 42rem; text-align: center; }
    .dtmf-pending-row {
      display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: center;
      width: 100%; max-width: 440px; margin-inline: auto;
    }
    .dtmf-pending-actions {
      display: inline-flex; flex-wrap: wrap; gap: 8px; align-items: center;
    }
    .dtmf-pending-readout {
      font-family: "Space Grotesk", sans-serif; font-size: 22px; font-weight: 600;
      min-width: 2em; color: var(--accent); letter-spacing: 0.08em;
      word-break: break-all; text-align: center; flex: 1 1 120px;
    }
    .dtmf-key.is-pending-choice { border-color: rgba(47, 210, 168, 0.65);
      box-shadow: 0 0 0 1px rgba(47, 210, 168, 0.35); }
    .dtmf-root--mic-live .dtmf-keypad,
    .dtmf-root--mic-live .dtmf-pending-row {
      opacity: 0.42; pointer-events: none; user-select: none;
    }
    .dtmf-root--mic-live .dtmf-hist-char {
      opacity: 0.5; pointer-events: none; cursor: default;
    }
  `;
  document.head.appendChild(style);
}

/**
 * @param {AudioContext} ctx
 * @param {GainNode} tapGainNode
 */
function scheduleDtmfToneAt(ctx, tapGainNode, lowHz, highHz, t0) {
  const dur = TONE_MS / 1000;
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, t0);
  envelope.gain.linearRampToValueAtTime(0.2, t0 + 0.02);
  envelope.gain.setValueAtTime(0.2, t0 + Math.max(0, dur - 0.02));
  envelope.gain.linearRampToValueAtTime(0, t0 + dur);

  const oscL = ctx.createOscillator();
  const oscH = ctx.createOscillator();
  oscL.type = "sine";
  oscH.type = "sine";
  oscL.frequency.setValueAtTime(lowHz, t0);
  oscH.frequency.setValueAtTime(highHz, t0);

  oscL.connect(envelope);
  oscH.connect(envelope);
  envelope.connect(tapGainNode);

  oscL.start(t0);
  oscH.start(t0);
  oscL.stop(t0 + dur + 0.02);
  oscH.stop(t0 + dur + 0.02);
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
  const detail = `DTMF · phím «${digit}»: ${bestRow.freq.toFixed(1)} Hz + ${bestCol.freq.toFixed(1)} Hz (Δ ${dbDiff.toFixed(1)} dB)`;
  return { digit, detail };
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

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "ghost-button dtmf-icon-btn";
  clearBtn.setAttribute("aria-label", "Xóa chuỗi đã nhận dạng");
  const clearImg = document.createElement("img");
  clearImg.src = "assets/icons/delete.svg";
  clearImg.alt = "";
  clearImg.width = 22;
  clearImg.height = 22;
  clearBtn.append(clearImg);

  const backspaceBtn = document.createElement("button");
  backspaceBtn.type = "button";
  backspaceBtn.className = "ghost-button dtmf-icon-btn";
  backspaceBtn.setAttribute(
    "aria-label",
    "Xóa một ký tự cuối trong Chờ phát",
  );
  const backspaceImg = document.createElement("img");
  backspaceImg.src = "assets/icons/backspace.svg";
  backspaceImg.alt = "";
  backspaceImg.width = 22;
  backspaceImg.height = 22;
  backspaceBtn.append(backspaceImg);

  const helpEl = document.createElement("p");
  helpEl.className = "dtmf-help";
  helpEl.textContent =
    "Tắt micro (icon góc trái dưới): gõ hoặc bấm phím vào «Chờ phát», rồi «Phát tone» hoặc Enter để phát chuỗi nội bộ; FFT đọc nhánh synthesizer. Bật micro: chỉ nhận DTMF từ bên ngoài — bàn phím vật lý và bàn phím ảo bị khóa; không phát tone nội bộ để tránh trộn nguồn. Lịch sử: khi micro tắt, bấm ký tự để phát lại một tone. Mỗi khung: FFT + Hann, tám tần ITU Q.23.";

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

  const pendingRow = document.createElement("div");
  pendingRow.className = "dtmf-pending-row";
  const pendingLabel = document.createElement("span");
  pendingLabel.className = "dtmf-meta";
  pendingLabel.textContent = "Chờ phát:";
  const pendingEl = document.createElement("span");
  pendingEl.className = "dtmf-pending-readout";
  pendingEl.setAttribute("aria-live", "polite");
  pendingEl.textContent = "—";
  const playPendingBtn = document.createElement("button");
  playPendingBtn.type = "button";
  playPendingBtn.className = "ghost-button";
  playPendingBtn.textContent = "Phát tone";
  playPendingBtn.setAttribute(
    "aria-label",
    "Phát tone cho toàn bộ chuỗi trong Chờ phát (oscillator nội bộ)",
  );
  const pendingActions = document.createElement("div");
  pendingActions.className = "dtmf-pending-actions";
  pendingActions.append(backspaceBtn, clearBtn, playPendingBtn);
  pendingRow.append(pendingLabel, pendingEl, pendingActions);

  const statusEl = document.createElement("p");
  statusEl.className = "dtmf-status";

  root.append(helpEl, readout, keypad, pendingRow, statusEl);

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

  /** Chuỗi phím chờ phát nội bộ */
  let pendingKeys = "";

  let playbackStickyUntilMs = 0;
  let playbackStickyMetaLine = "";

  function syncMicDriveUi() {
    const live = hasLiveMicStream();
    root.classList.toggle("dtmf-root--mic-live", live);
    playPendingBtn.disabled = live;
    clearBtn.disabled = live;
    backspaceBtn.disabled = live || pendingKeys.length === 0;
  }

  function refreshPendingKeyHighlight() {
    for (const el of keypad.querySelectorAll(".dtmf-key")) {
      el.classList.remove("is-pending-choice");
    }
    const last = pendingKeys.slice(-1);
    if (!last) return;
    const rc = lookupDigitRcFromKey(last);
    if (!rc) return;
    const [pr, pc] = rc;
    const idx = pr * 4 + pc;
    const btn = keypad.querySelectorAll(".dtmf-key")[idx];
    if (btn instanceof HTMLElement) {
      btn.classList.add("is-pending-choice");
    }
  }

  /**
   * @param {number} r
   * @param {number} c
   */
  function appendPendingKey(r, c) {
    if (pendingKeys.length >= PENDING_MAX_LEN) return;
    pendingKeys += KEY_MATRIX[r][c];
    pendingEl.textContent = pendingKeys;
    refreshPendingKeyHighlight();
    syncMicDriveUi();
  }

  function popPendingKey() {
    if (!pendingKeys) return;
    pendingKeys = pendingKeys.slice(0, -1);
    pendingEl.textContent = pendingKeys || "—";
    refreshPendingKeyHighlight();
    syncMicDriveUi();
  }

  function clearPendingKeys() {
    pendingKeys = "";
    pendingEl.textContent = "—";
    refreshPendingKeyHighlight();
    syncMicDriveUi();
  }

  /**
   * @param {string} str
   */
  function scheduleSequenceStickyUi(str, chars) {
    const segmentWallMs = TONE_MS + TONE_GAP_MS;
    const alignMs = 28;
    const startWall = performance.now() + alignMs;

    chars.forEach((ch, i) => {
      const rc = lookupDigitRcFromKey(ch);
      if (!rc) return;
      const [r, c] = rc;
      const low = ROW_HZ[r];
      const high = COL_HZ[c];
      const fireAt = startWall + i * segmentWallMs;
      const delayMs = Math.max(0, fireAt - performance.now());
      setTimeout(() => {
        if (signal.aborted) return;
        playbackStickyMetaLine = `Phát nội bộ — phím DTMF «${ch}»: ${low} Hz + ${high} Hz`;
        playbackStickyUntilMs = Math.max(
          playbackStickyUntilMs,
          performance.now() + TONE_MS + 300,
        );
      }, delayMs);
    });

    const totalWallMs =
      alignMs +
      chars.length * TONE_MS +
      Math.max(0, chars.length - 1) * TONE_GAP_MS;
    setTimeout(() => {
      if (signal.aborted) return;
      playbackStickyMetaLine = `Đã phát chuỗi DTMF «${str}» (${chars.length} tone, ${TONE_MS} ms/tone)`;
      playbackStickyUntilMs = Math.max(
        playbackStickyUntilMs,
        performance.now() + PLAYBACK_STICKY_TAIL_MS,
      );
    }, Math.max(0, totalWallMs + 40));
  }

  /**
   * @param {string} str
   */
  function scheduleDtmfSequence(str) {
    if (hasLiveMicStream()) {
      statusEl.textContent =
        "Đang bật micro: không phát tone nội bộ. Tắt micro để phát chuỗi.";
      return;
    }
    wireInternalTapOnly();
    const ctx = /** @type {AudioContext} */ (audioCtx);
    const tap = /** @type {GainNode} */ (tapGain);
    const chars = [...str].filter((ch) => lookupDigitRcFromKey(ch));
    if (!chars.length) {
      statusEl.textContent = "Chuỗi chờ không có phím DTMF hợp lệ.";
      return;
    }
    const toneSec = TONE_MS / 1000;
    const gapSec = TONE_GAP_MS / 1000;
    let tAudio = ctx.currentTime + 0.02;
    for (const ch of chars) {
      const rc = lookupDigitRcFromKey(ch);
      if (!rc) continue;
      const [r, c] = rc;
      scheduleDtmfToneAt(ctx, tap, ROW_HZ[r], COL_HZ[c], tAudio);
      tAudio += toneSec + gapSec;
    }
    scheduleSequenceStickyUi(str, chars);
    statusEl.textContent = `Đang phát chuỗi «${str}» (${chars.length} tone)`;
  }

  /** Một tone ngay lập tức (vd. từ lịch sử) */
  function playDtmfSingle(lowHz, highHz, labelCh) {
    if (hasLiveMicStream()) {
      statusEl.textContent =
        "Đang bật micro: không phát tone nội bộ. Tắt micro để phát lại.";
      return;
    }
    wireInternalTapOnly();
    const ctx = /** @type {AudioContext} */ (audioCtx);
    scheduleDtmfToneAt(
      ctx,
      /** @type {GainNode} */ (tapGain),
      lowHz,
      highHz,
      ctx.currentTime + 0.02,
    );
    playbackStickyMetaLine = `Phát nội bộ — phím DTMF «${labelCh}»: ${lowHz} Hz + ${highHz} Hz`;
    playbackStickyUntilMs = performance.now() + TONE_MS + PLAYBACK_STICKY_TAIL_MS;
    statusEl.textContent = `Phát ${lowHz} Hz + ${highHz} Hz (${TONE_MS} ms)`;
  }

  function commitPlayPending() {
    if (!pendingKeys) {
      statusEl.textContent =
        "Thêm phím vào «Chờ phát», rồi bấm «Phát tone» hoặc Enter.";
      return;
    }
    const snapshot = pendingKeys;
    clearPendingKeys();
    scheduleDtmfSequence(snapshot);
  }

  function refreshHistoryUi() {
    histEl.replaceChildren();
    if (!history) {
      const span = document.createElement("span");
      span.className = "dtmf-history-empty";
      span.textContent = "(trống)";
      histEl.append(span);
      return;
    }
    for (const ch of history) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dtmf-hist-char";
      btn.textContent = ch;
      btn.setAttribute("aria-label", `Phát lại phím DTMF ${ch}`);
      btn.addEventListener(
        "click",
        () => {
          if (hasLiveMicStream()) return;
          const rc = lookupDigitRcFromKey(ch);
          if (!rc) return;
          const [rk, ck] = rc;
          playDtmfSingle(ROW_HZ[rk], COL_HZ[ck], ch);
        },
        { signal },
      );
      histEl.append(btn);
    }
  }

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
    syncMicDriveUi();
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

    const wallNow = performance.now();
    const { digit, detail } = decodeFrame(analyser, audioCtx);
    currentEl.textContent = digit ?? "—";
    if (wallNow < playbackStickyUntilMs) {
      metaEl.textContent = playbackStickyMetaLine;
    } else {
      metaEl.textContent = digit ? detail : `FFT dsp · ${detail}`;
    }

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
      stableCount === STABLE_FRAMES &&
      now - lastEmitAt >= MIN_DETECT_GAP_MS
    ) {
      lastEmitAt = now;
      history += digit;
      refreshHistoryUi();
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
          if (hasLiveMicStream()) return;
          appendPendingKey(r, c);
          statusEl.textContent =
            "Đã thêm phím vào «Chờ phát» — «Phát tone» hoặc Enter để phát cả chuỗi.";
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
      if (hasLiveMicStream()) return;
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
      if (ev.code === "Enter" || ev.code === "NumpadEnter") {
        ev.preventDefault();
        commitPlayPending();
        return;
      }
      if (ev.code === "Backspace") {
        if (!pendingKeys) return;
        ev.preventDefault();
        popPendingKey();
        return;
      }

      const numpadMap = /** @type {const} */ ({
        Numpad1: [0, 0],
        Numpad2: [0, 1],
        Numpad3: [0, 2],
        Numpad4: [1, 0],
        Numpad5: [1, 1],
        Numpad6: [1, 2],
        Numpad7: [2, 0],
        Numpad8: [2, 1],
        Numpad9: [2, 2],
        Numpad0: [3, 1],
      });

      let idx =
        map[/** @type {keyof typeof map} */ (ev.code)] ??
        numpadMap[/** @type {keyof typeof numpadMap} */ (ev.code)];
      if (!idx && ev.code === "NumpadMultiply") {
        idx = [3, 0];
      }
      if (!idx && ev.key && ev.key.length === 1) {
        idx = lookupDigitRcFromKey(ev.key);
      }
      if (!idx) return;
      ev.preventDefault();
      const [rk, ck] = idx;
      appendPendingKey(rk, ck);
      statusEl.textContent =
        "Đã thêm phím vào «Chờ phát» — «Phát tone» hoặc Enter để phát cả chuỗi.";
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

  async function connectMicGraphFromSharedStream() {
    statusEl.textContent = "Đang nối micro…";
    try {
      const stream = getSharedMediaStream();
      const ctx = getSharedAudioContext();
      if (!stream || !ctx) {
        statusEl.textContent =
          "Chưa có luồng micro — bật icon micro góc trái dưới.";
        return;
      }
      audioCtx = ctx;
      ensureGraph({ monitorSpeakers: false });
      wireMicFromSharedStream(stream);
      statusEl.textContent = `Micro · ${Math.round(ctx.sampleRate)} Hz`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      statusEl.textContent = `Micro lỗi: ${msg}`;
    } finally {
      syncMicDriveUi();
    }
  }

  async function syncMicFromPrimedStartAudio() {
    if (!hasLiveMicStream() || !getSharedAudioContext()) return;
    await connectMicGraphFromSharedStream();
  }

  playPendingBtn.addEventListener(
    "click",
    () => {
      commitPlayPending();
    },
    { signal },
  );

  clearBtn.addEventListener(
    "click",
    () => {
      history = "";
      refreshHistoryUi();
      lastEmitAt = 0;
      stableDigit = null;
      stableCount = 0;
    },
    { signal },
  );

  backspaceBtn.addEventListener(
    "click",
    () => {
      popPendingKey();
    },
    { signal },
  );

  if (
    hasLiveMicStream() &&
    getSharedAudioContext() &&
    getSharedMediaStream()
  ) {
    void connectMicGraphFromSharedStream();
  } else {
    wireInternalTapOnly();
  }
  refreshHistoryUi();
  statusEl.textContent =
    "Tắt micro: gõ phím vào «Chờ phát», «Phát tone» hoặc Enter. Bật micro: nhận DTMF từ bên ngoài.";
  startLoop();

  document.addEventListener(
    "webfft:start-audio",
    () => {
      void connectMicGraphFromSharedStream();
    },
    { signal },
  );

  document.addEventListener(
    "webfft:stop-audio",
    () => {
      disconnectMic();
      wireInternalTapOnly();
      statusEl.textContent =
        "Micro đã dừng — nhánh nội bộ đã bật lại. Thêm phím vào «Chờ phát» hoặc bật micro để thu.";
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
