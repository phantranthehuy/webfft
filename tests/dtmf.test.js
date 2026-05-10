/**
 * Giải mã DTMF thuần số — logic khớp `decodeFrame` trong `src/ui/dtmfDecoder.js`
 * (cùng ROW/COL, Hann, FFT, ngưỡng).
 *
 * Chạy: `npm test` hoặc `node --test tests/dtmf.test.js`
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fft } from "../src/dsp/fft.js";
import { hanning } from "../src/dsp/stft.js";

const ROW_HZ = Object.freeze([697, 770, 852, 941]);
const COL_HZ = Object.freeze([1209, 1336, 1477, 1633]);
const KEY_MATRIX = Object.freeze([
  ["1", "2", "3", "A"],
  ["4", "5", "6", "B"],
  ["7", "8", "9", "C"],
  ["*", "0", "#", "D"],
]);
const FREQ_TOL = 0.015;
const AMP_DIFF_DB_MAX = 10;

/**
 * @param {Float64Array} mags
 * @param {number} k
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

function medianMag(mags, kLo, kHi) {
  const slice = [];
  for (let k = kLo; k <= kHi; k++) {
    slice.push(mags[k]);
  }
  slice.sort((a, b) => a - b);
  return slice[Math.floor(slice.length / 2)] ?? 0;
}

/**
 * @param {Float64Array} timeDomain — mẫu thực (giống getFloatTimeDomainData), độ dài N
 * @param {number} sr
 * @returns {{ digit: string | null, detail: string }}
 */
function decodeDtmfFromTimeDomain(timeDomain, sr) {
  const N = timeDomain.length;
  if ((N & (N - 1)) !== 0 || N < 2) {
    throw new RangeError("N phải là lũy thừa của 2");
  }
  const win = hanning(N);
  const sig = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    sig[i] = timeDomain[i] * win[i];
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
    return {
      digit: null,
      detail: "Chưa nhận đủ hai tone DTMF (một hàng + một cột).",
    };
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
 * Tín hiệu DTMF: tổng hai sin với biên độ gần bằng (điều kiện decoder).
 * @param {number} sr
 * @param {number} N
 * @param {number} lowHz
 * @param {number} highHz
 */
function syntheticDtmfTone(sr, N, lowHz, highHz) {
  const x = new Float64Array(N);
  const a = 0.45;
  for (let n = 0; n < N; n++) {
    const t = n / sr;
    x[n] =
      a * Math.sin(2 * Math.PI * lowHz * t) +
      a * Math.sin(2 * Math.PI * highHz * t);
  }
  return x;
}

test("DTMF: phím '5' (770 + 1336 Hz), sr=48000, N=2048", () => {
  const sr = 48000;
  const N = 2048;
  const x = syntheticDtmfTone(sr, N, 770, 1336);
  const { digit, detail } = decodeDtmfFromTimeDomain(x, sr);
  assert.equal(digit, "5", detail);
});

test("DTMF: phím '0' (941 + 1336 Hz)", () => {
  const sr = 48000;
  const N = 2048;
  const x = syntheticDtmfTone(sr, N, 941, 1336);
  const { digit } = decodeDtmfFromTimeDomain(x, sr);
  assert.equal(digit, "0");
});

test("DTMF: phím '#' (941 + 1477 Hz)", () => {
  const sr = 48000;
  const N = 2048;
  const x = syntheticDtmfTone(sr, N, 941, 1477);
  const { digit } = decodeDtmfFromTimeDomain(x, sr);
  assert.equal(digit, "#");
});

test("DTMF: phím 'D' (941 + 1633 Hz)", () => {
  const sr = 48000;
  const N = 2048;
  const x = syntheticDtmfTone(sr, N, 941, 1633);
  const { digit } = decodeDtmfFromTimeDomain(x, sr);
  assert.equal(digit, "D");
});

test("DTMF: chỉ một tone → không giải mã", () => {
  const sr = 48000;
  const N = 2048;
  const x = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    x[n] = 0.5 * Math.sin((2 * Math.PI * 770 * n) / sr);
  }
  const { digit } = decodeDtmfFromTimeDomain(x, sr);
  assert.equal(digit, null);
});
