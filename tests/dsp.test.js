/**
 * Chạy: `npm test` hoặc `node --test tests/dsp.test.js`
 * (cần `package.json` với `"type": "module"` ở thư mục gốc).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { dft } from "../src/dsp/dft.js";
import { fft, ifft } from "../src/dsp/fft.js";
import { stft, hanning } from "../src/dsp/stft.js";
import Complex from "../src/dsp/complex.js";

/** Sai số tối đa cho phép (float64 / FFT tích lũy). */
const EPS_C = 1e-9;

function assertApprox(a, b, eps, msg) {
  const d = Math.abs(a - b);
  assert.ok(d <= eps, `${msg}: |${a} - ${b}| = ${d} > ${eps}`);
}

function maxAbsDiffComplex(a, b) {
  let m = 0;
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    m = Math.max(m, Math.abs(a[i].re - b[i].re), Math.abs(a[i].im - b[i].im));
  }
  return m;
}

function maxAbsDiffReal(a, b) {
  let m = 0;
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    m = Math.max(m, Math.abs(a[i] - b[i]));
  }
  return m;
}

test("DFT: xung tại n=0 → X[k] = 1 (N=8)", () => {
  const N = 8;
  const x = new Float64Array(N);
  x[0] = 1;
  const X = dft(x);
  assert.equal(X.length, N);
  for (let k = 0; k < N; k++) {
    assertApprox(X[k].re, 1, EPS_C, `X[${k}].re`);
    assertApprox(X[k].im, 0, EPS_C, `X[${k}].im`);
  }
});

test("DFT: cos(2π·3·n/8) — năng lượng tại k=3 và k=5 (đối xứng liên hợp)", () => {
  const N = 8;
  const x = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    x[n] = Math.cos((2 * Math.PI * 3 * n) / N);
  }
  const X = dft(x);
  const mags = X.map((c) => c.magnitude());
  const sumOther = mags.reduce((s, mag, k) => {
    if (k === 3 || k === 5) return s;
    return s + mag * mag;
  }, 0);
  const e3 = mags[3] * mags[3];
  const e5 = mags[5] * mags[5];
  assert.ok(e3 > 1e-6 && e5 > 1e-6, "đỉnh tại 3 và 5");
  assert.ok(e3 + e5 > 100 * sumOther, "tập trung năng lượng tại hai bin đối xứng");
});

test("FFT khớp DFT (N=16, tín hiệu ngẫu nhiên nhỏ)", () => {
  const N = 16;
  const x = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    x[n] = 0.1 * Math.sin(n * 1.7) + 0.05 * Math.cos(n * 0.3);
  }
  const Xdft = dft(x);
  const Xfft = fft(x);
  const err = maxAbsDiffComplex(Xdft, Xfft);
  assert.ok(err < 1e-10, `max |DFT−FFT| = ${err}`);
});

test("IFFT(FFT(x)) = x (N=32)", () => {
  const N = 32;
  const x = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    x[n] = (n % 5) - 2 + 0.1 * n;
  }
  const X = fft(x);
  const xr = ifft(X);
  const err = maxAbsDiffReal(x, xr);
  assert.ok(err < 1e-11, `max |x − IFFT(FFT(x))| = ${err}`);
});

test("IFFT: phổ thuần thực (đối xứng) → tín hiệu thực", () => {
  const N = 8;
  /** @type {Complex[]} */
  const X = new Array(N);
  for (let k = 0; k < N; k++) X[k] = new Complex(0, 0);
  X[0] = new Complex(4, 0);
  X[1] = new Complex(1, 0.5);
  X[7] = X[1].conjugate();
  X[2] = new Complex(-0.25, 0);
  X[6] = new Complex(-0.25, 0);
  const x = ifft(X);
  for (let n = 0; n < N; n++) {
    assert.ok(Number.isFinite(x[n]), "IFFT output finite");
  }
  const X2 = fft(x);
  const err = maxAbsDiffComplex(X, X2);
  assert.ok(err < 1e-10, `round-trip spectrum err ${err}`);
});

test("STFT: số khung và cửa sổ Hann (fftSize=64, hop=32)", () => {
  const fftSize = 64;
  const hop = 32;
  const L = 200;
  const x = new Float64Array(L);
  for (let n = 0; n < L; n++) x[n] = Math.sin((2 * Math.PI * 7 * n) / fftSize);
  const frames = stft(x, fftSize, hop, "hanning");
  let expected = 0;
  for (let start = 0; start < L; start += hop) expected++;
  assert.equal(frames.length, expected);
  assert.equal(frames[0].length, fftSize);
  const win = hanning(fftSize);
  const buf = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) buf[i] = x[i] * win[i];
  const ref0 = fft(buf);
  const e0 = maxAbsDiffComplex(frames[0], ref0);
  assert.ok(e0 < 1e-10, `khung 0 khớp FFT(Hann·x): err=${e0}`);
});

test("STFT: một khung tone — đỉnh phổ gần bin mong đợi", () => {
  const fftSize = 128;
  const sr = 8000;
  const f0 = 1000;
  const hop = fftSize;
  const dur = fftSize / sr;
  const L = fftSize;
  const x = new Float64Array(L);
  for (let n = 0; n < L; n++) {
    const t = n / sr;
    x[n] = Math.cos(2 * Math.PI * f0 * t);
  }
  const frames = stft(x, fftSize, hop, "hanning");
  assert.equal(frames.length, 1);
  const mags = frames[0].map((c) => Math.hypot(c.re, c.im));
  let kMax = 0;
  let vMax = 0;
  for (let k = 1; k < fftSize / 2; k++) {
    if (mags[k] > vMax) {
      vMax = mags[k];
      kMax = k;
    }
  }
  const fPeak = (kMax * sr) / fftSize;
  assert.ok(Math.abs(fPeak - f0) < 2.5 * (sr / fftSize), `fPeak≈${f0}, got ${fPeak}`);
});
