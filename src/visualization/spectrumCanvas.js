/**
 * Vẽ phổ tần số thời gian thực (bar / waterfall) lên canvas.
 * Giảm số cột hiển thị khi fftSize lớn để giữ FPS.
 */

import { formatHz } from "../utils/format.js";

/** @typedef {'linear' | 'log'} SpectrumScale */
/** @typedef {'bar' | 'waterfall'} SpectrumMode */

/** @type {WeakMap<HTMLCanvasElement, boolean>} */
const wfInitialized = new WeakMap();

const MIN_DB = -100;
const MAX_DB = -12;

/**
 * @param {number} cssWidth
 * @param {number} binCount
 */
function displayColumnCount(cssWidth, binCount) {
  const byWidth = Math.max(80, Math.min(640, Math.floor(cssWidth * 1.5)));
  return Math.min(binCount, byWidth);
}

/**
 * @param {Uint8Array} bytes
 * @param {Float32Array} floats
 * @param {number} start
 * @param {number} end
 * @param {SpectrumScale} scale
 */
function aggregateBins(bytes, floats, start, end, scale) {
  let v = 0;
  for (let i = start; i < end; i++) {
    if (scale === "log") {
      const db = floats[i];
      const n =
        !Number.isFinite(db) || db <= MIN_DB ? 0 : (db - MIN_DB) / (MAX_DB - MIN_DB);
      v = Math.max(v, Math.min(1, n));
    } else {
      v = Math.max(v, bytes[i] / 255);
    }
  }
  return v;
}

/**
 * @param {SpectrumScale} scale
 * @param {Uint8Array} bytes
 * @param {Float32Array} floats
 * @param {number} i
 */
function binNorm(scale, bytes, floats, i) {
  if (scale === "log") {
    const db = floats[i];
    if (!Number.isFinite(db) || db <= MIN_DB) return 0;
    return Math.min(1, Math.max(0, (db - MIN_DB) / (MAX_DB - MIN_DB)));
  }
  return bytes[i] / 255;
}

/**
 * @param {number} t
 */
function intensityColor(t) {
  const r = Math.round(11 + (47 - 11) * t);
  const g = Math.round(15 + (210 - 15) * t);
  const b = Math.round(19 + (168 - 19) * t * t);
  return `rgb(${r},${g},${b})`;
}

/**
 * Mốc Hz đều cho trục ngang (0 … Nyquist).
 * @param {number} nyquistHz
 * @returns {number[]}
 */
function niceFreqTicks(nyquistHz) {
  const nyq = Math.max(1, nyquistHz);
  const rawStep = nyq / 5;
  const pow10 = 10 ** Math.floor(Math.log10(rawStep));
  const err = rawStep / pow10;
  let niceUnit =
    err <= 1
      ? pow10
      : err <= 2
        ? 2 * pow10
        : err <= 5
          ? 5 * pow10
          : 10 * pow10;

  /** @type {number[]} */
  const out = [0];
  const seen = new Set([0]);
  for (let f = niceUnit; f < nyq - niceUnit * 0.25; f += niceUnit) {
    const r = Math.round(f);
    if (r > 0 && r < nyq && !seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  const last = Math.round(nyq);
  if (!seen.has(last)) {
    out.push(last);
  }
  return out.sort((a, b) => a - b);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} container
 */
export function syncSpectrumCanvasSize(canvas, container) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, container.clientWidth);
  const h = Math.max(1, container.clientHeight);
  const bw = Math.floor(w * dpr);
  const bh = Math.floor(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}

/**
 * @param {Float32Array | null} overlayNorm
 * @param {number} i0
 * @param {number} end
 */
function aggregateOverlayMax(overlayNorm, i0, end) {
  if (!overlayNorm) return 0;
  let v = 0;
  const hi = Math.min(end, overlayNorm.length);
  for (let i = i0; i < hi; i++) {
    if (overlayNorm[i] > v) v = overlayNorm[i];
  }
  return v;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {AnalyserNode} analyser
 * @param {{
 *   fftSize: number,
 *   scale: SpectrumScale,
 *   mode: SpectrumMode,
 *   sampleRate: number,
 *   overlayNorm?: Float32Array | null,
 * }} opts
 */
export function drawSpectrumFrame(canvas, analyser, opts) {
  const { scale, mode, sampleRate, overlayNorm } = opts;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const cssW = canvas.clientWidth || 1;
  const cssH = canvas.clientHeight || 1;
  const W = canvas.width;
  const H = canvas.height;
  const sx = W / cssW;
  const sy = H / cssH;

  const binCount = analyser.frequencyBinCount;
  const byteBuf = new Uint8Array(binCount);
  const floatBuf = new Float32Array(binCount);

  analyser.getByteFrequencyData(byteBuf);
  analyser.getFloatFrequencyData(floatBuf);

  const cols = displayColumnCount(cssW, binCount);

  if (mode === "bar") {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0b0f13";
    ctx.fillRect(0, 0, W, H);

    const pad = { left: 44, right: 12, top: 10, bottom: 28 };
    const pL = pad.left * sx;
    const pR = pad.right * sx;
    const pT = pad.top * sy;
    const pB = pad.bottom * sy;
    const plotW = Math.max(1, W - pL - pR);
    const plotH = Math.max(1, H - pT - pB);
    const barGap = Math.max(1, sx);
    const barW = Math.max(sx, (plotW - barGap * (cols - 1)) / cols);

    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = pT + (plotH * g) / 4;
      ctx.beginPath();
      ctx.moveTo(pL, y);
      ctx.lineTo(W - pR, y);
      ctx.stroke();
    }

    for (let j = 0; j < cols; j++) {
      const i0 = Math.floor((j * binCount) / cols);
      const i1 = Math.floor(((j + 1) * binCount) / cols);
      const end = Math.max(i0 + 1, i1);
      const mag = aggregateBins(byteBuf, floatBuf, i0, end, scale);
      const bh = mag * plotH;
      const x = pL + j * (barW + barGap);
      const y0 = pT + plotH - bh;

      ctx.fillStyle = intensityColor(Math.pow(mag, 0.85));
      ctx.fillRect(x, y0, barW, bh);
    }

    if (
      overlayNorm &&
      overlayNorm.length === binCount &&
      overlayNorm.length > 0
    ) {
      ctx.strokeStyle = "rgba(255, 172, 90, 0.92)";
      ctx.lineWidth = Math.max(1.5, 2 * sx);
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let j = 0; j < cols; j++) {
        const i0 = Math.floor((j * binCount) / cols);
        const i1 = Math.floor(((j + 1) * binCount) / cols);
        const end = Math.max(i0 + 1, i1);
        const v = aggregateOverlayMax(overlayNorm, i0, end);
        const bh = v * plotH;
        const cx = pL + j * (barW + barGap) + barW / 2;
        const cy = pT + plotH - bh;
        if (j === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(159,176,191,0.85)";
    ctx.font = `${Math.round(11 * sx)}px "IBM Plex Sans",system-ui,sans-serif`;
    ctx.textBaseline = "top";

    const nyquist = sampleRate / 2;
    const axisY = pT + plotH;
    const tickH = Math.max(3 * sy, 4);
    const labelY = H - pB + 5 * sy;

    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;

    const ticks = niceFreqTicks(nyquist);

    for (const f of ticks) {
      const fx = pL + (f / nyquist) * plotW;
      ctx.beginPath();
      ctx.moveTo(fx, axisY);
      ctx.lineTo(fx, axisY + tickH);
      ctx.stroke();
    }

    for (let ti = 0; ti < ticks.length; ti++) {
      const f = ticks[ti];
      const fx = pL + (f / nyquist) * plotW;
      const label =
        ti === ticks.length - 1
          ? formatHz(nyquist, nyquist >= 1000 ? 1 : 0)
          : formatHz(f, f >= 1000 ? 1 : 0);
      if (ti === 0) {
        ctx.textAlign = "left";
        ctx.fillText(label, pL, labelY);
      } else if (ti === ticks.length - 1) {
        ctx.textAlign = "right";
        ctx.fillText(label, W - pR, labelY);
      } else {
        ctx.textAlign = "center";
        ctx.fillText(label, fx, labelY);
      }
    }

    ctx.save();
    ctx.translate(14 * sx, pT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText(scale === "log" ? "dB (chuẩn hoá)" : "Biên độ (linear)", 0, 0);
    ctx.restore();

    return;
  }

  /* Waterfall — cuộn theo đúng pixel thiết bị */
  if (!wfInitialized.get(canvas)) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0b0f13";
    ctx.fillRect(0, 0, W, H);
    wfInitialized.set(canvas, true);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  try {
    ctx.drawImage(canvas, 0, sy, W, H - sy, 0, 0, W, H - sy);
  } catch {
    ctx.fillStyle = "#0b0f13";
    ctx.fillRect(0, 0, W, H);
  }

  const padL = 44 * sx;
  const plotW = Math.max(sx, W - padL - 12 * sx);
  const barGap = Math.max(0, sx * 0.25);
  const barW = Math.max(sx, (plotW - barGap * (cols - 1)) / cols);

  const rowTop = H - sy;

  for (let j = 0; j < cols; j++) {
    const i0 = Math.floor((j * binCount) / cols);
    const i1 = Math.floor(((j + 1) * binCount) / cols);
    const end = Math.max(i0 + 1, i1);
    let mag = 0;
    for (let i = i0; i < end; i++) {
      mag = Math.max(mag, binNorm(scale, byteBuf, floatBuf, i));
    }
    ctx.fillStyle = intensityColor(Math.pow(mag, 0.9));
    ctx.fillRect(padL + j * (barW + barGap), rowTop, Math.ceil(barW), sy);
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 */
export function resetSpectrumWaterfall(canvas) {
  wfInitialized.delete(canvas);
}
