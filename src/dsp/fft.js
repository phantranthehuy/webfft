import Complex from './complex.js';

const TWO_PI = 2 * Math.PI;

/**
 * @param {number} n
 * @returns {boolean}
 */
function isPowerOfTwo(n) {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/**
 * Đảo bit của `i` trên `bits` bit (không dấu).
 * @param {number} i
 * @param {number} bits
 * @returns {number}
 */
function reverseBits(i, bits) {
  let r = 0;
  let x = i;
  for (let b = 0; b < bits; b++) {
    r = (r << 1) | (x & 1);
    x >>>= 1;
  }
  return r;
}

/**
 * Tiền tính W_m^t = exp(-2πj·t/m), t = 0…m/2−1, với m = 2, 4, …, N (cos/sin).
 * @param {number} N
 * @returns {Map<number, Complex[]>}
 */
function precomputeDitTwiddles(N) {
  /** @type {Map<number, Complex[]>} */
  const byM = new Map();
  for (let m = 2; m <= N; m <<= 1) {
    const half = m >> 1;
    const row = new Array(half);
    const angleStep = -TWO_PI / m;
    for (let j = 0; j < half; j++) {
      const angle = angleStep * j;
      row[j] = new Complex(Math.cos(angle), Math.sin(angle));
    }
    byM.set(m, row);
  }
  return byM;
}

/**
 * FFT radix-2 DIT: hoán vị bit-reverse rồi bước bướm lặp (không đệ quy).
 *
 * @param {Complex[]} seq — độ dài N (lũy thừa 2), không đổi mảng gốc
 * @param {number} N
 * @param {number} bits — log2(N)
 * @param {Map<number, Complex[]>} twiddlesByM
 * @returns {Complex[]}
 */
function radix2DitFft(seq, N, bits, twiddlesByM) {
  /** @type {Complex[]} */
  const A = new Array(N);
  for (let i = 0; i < N; i++) {
    const r = reverseBits(i, bits);
    A[r] = seq[i];
  }

  for (let s = 1; s <= bits; s++) {
    const m = 1 << s;
    const half = m >> 1;
    const W = twiddlesByM.get(m);
    for (let k = 0; k < N; k += m) {
      for (let j = 0; j < half; j++) {
        const idx = k + j;
        const u = A[idx];
        const v = A[idx + half];
        const w = W[j];
        const t = v.mul(w);
        A[idx] = u.add(t);
        A[idx + half] = u.sub(t);
      }
    }
  }

  return A;
}

/**
 * FFT Cooley–Tukey chia miền thời gian (DIT), độ dài N lũy thừa của 2.
 * Khớp định nghĩa DFT: X[k] = Σₙ x[n] exp(-2πj·kn/N).
 *
 * @param {Float64Array} signal
 * @returns {Complex[]}
 */
export function fft(signal) {
  if (!(signal instanceof Float64Array)) {
    throw new TypeError('fft: expected Float64Array');
  }
  const N = signal.length;
  if (!isPowerOfTwo(N)) {
    throw new RangeError('fft: length must be a positive power of two');
  }

  const bits = Math.trunc(Math.log2(N));
  /** @type {Complex[]} */
  const seq = new Array(N);
  for (let i = 0; i < N; i++) {
    seq[i] = new Complex(signal[i], 0);
  }

  const twiddles = precomputeDitTwiddles(N);
  return radix2DitFft(seq, N, bits, twiddles);
}

/**
 * IFFT: x[n] = (1/N) Σₖ X[k] exp(+2πj·kn/N) = (1/N)·conj(FFT(conj(X)))[n].
 * Trả về phần thực (tín hiệu thực).
 *
 * @param {Complex[]} spectrum
 * @returns {Float64Array}
 */
export function ifft(spectrum) {
  if (!Array.isArray(spectrum)) {
    throw new TypeError('ifft: expected array of Complex');
  }
  const N = spectrum.length;
  if (!isPowerOfTwo(N)) {
    throw new RangeError('ifft: length must be a positive power of two');
  }

  /** @type {Complex[]} */
  const conjSeq = new Array(N);
  for (let i = 0; i < N; i++) {
    const c = spectrum[i];
    if (!(c instanceof Complex)) {
      throw new TypeError('ifft: spectrum elements must be Complex');
    }
    conjSeq[i] = c.conjugate();
  }

  const bits = Math.trunc(Math.log2(N));
  const twiddles = precomputeDitTwiddles(N);
  const F = radix2DitFft(conjSeq, N, bits, twiddles);

  const scale = 1 / N;
  const out = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const scaled = F[n].conjugate().mul(new Complex(scale, 0));
    out[n] = scaled.re;
  }
  return out;
}
