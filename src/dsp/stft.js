import { fft } from './fft.js';

const TWO_PI = 2 * Math.PI;

/**
 * @param {number} n
 * @returns {boolean}
 */
function isPowerOfTwo(n) {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/**
 * Cửa sổ Hann (Hanning): w[n] = 0.5·(1 − cos(2πn/(N−1))).
 * @param {number} N
 * @returns {Float64Array}
 */
export function hanning(N) {
  if (!Number.isInteger(N) || N < 1) {
    throw new RangeError('hanning: N must be a positive integer');
  }
  const w = new Float64Array(N);
  if (N === 1) {
    w[0] = 1;
    return w;
  }
  const denom = N - 1;
  for (let n = 0; n < N; n++) {
    w[n] = 0.5 * (1 - Math.cos((TWO_PI * n) / denom));
  }
  return w;
}

/**
 * Cửa sổ Hamming: w[n] = 0.54 − 0.46·cos(2πn/(N−1)).
 * @param {number} N
 * @returns {Float64Array}
 */
export function hamming(N) {
  if (!Number.isInteger(N) || N < 1) {
    throw new RangeError('hamming: N must be a positive integer');
  }
  const w = new Float64Array(N);
  if (N === 1) {
    w[0] = 1;
    return w;
  }
  const denom = N - 1;
  for (let n = 0; n < N; n++) {
    w[n] = 0.54 - 0.46 * Math.cos((TWO_PI * n) / denom);
  }
  return w;
}

/**
 * Cửa sổ Blackman: w[n] = 0.42 − 0.5·cos(2πn/(N−1)) + 0.08·cos(4πn/(N−1)).
 * @param {number} N
 * @returns {Float64Array}
 */
export function blackman(N) {
  if (!Number.isInteger(N) || N < 1) {
    throw new RangeError('blackman: N must be a positive integer');
  }
  const w = new Float64Array(N);
  if (N === 1) {
    w[0] = 1;
    return w;
  }
  const denom = N - 1;
  for (let n = 0; n < N; n++) {
    const a = (TWO_PI * n) / denom;
    w[n] = 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a);
  }
  return w;
}

/** Các hàm cửa sổ theo độ dài N (Float64Array). */
export const windowFunctions = {
  hanning,
  hamming,
  blackman,
};

/** @typedef {import('./complex.js').default} Complex */

/**
 * STFT: chia tín hiệu thành các khung độ dài `fftSize`, nhân cửa sổ rồi FFT.
 * Khung cuối được zero-pad nếu còn thiếu mẫu.
 *
 * @param {Float64Array} signal
 * @param {number} fftSize — độ dài FFT (lũy thừa của 2)
 * @param {number} [hopSize] — bước nhảy; mặc định `fftSize / 2` (chồng 50%)
 * @param {'hanning'|'hamming'|'blackman'} [windowType='hanning']
 * @returns {Complex[][]} — mỗi phần tử là một phổ phức (một khung)
 */
export function stft(signal, fftSize, hopSize, windowType = 'hanning') {
  if (!(signal instanceof Float64Array)) {
    throw new TypeError('stft: expected Float64Array');
  }
  if (!Number.isInteger(fftSize) || fftSize < 1) {
    throw new RangeError('stft: fftSize must be a positive integer');
  }
  if (!isPowerOfTwo(fftSize)) {
    throw new RangeError('stft: fftSize must be a power of two');
  }

  const hop = hopSize === undefined ? fftSize >> 1 : hopSize;
  if (!Number.isInteger(hop) || hop < 1) {
    throw new RangeError('stft: hopSize must be a positive integer');
  }

  /** @type {(n: number) => Float64Array} */
  let makeWin;
  switch (windowType) {
    case 'hanning':
      makeWin = hanning;
      break;
    case 'hamming':
      makeWin = hamming;
      break;
    case 'blackman':
      makeWin = blackman;
      break;
    default:
      throw new RangeError(
        "stft: windowType must be 'hanning', 'hamming', or 'blackman'",
      );
  }

  const win = makeWin(fftSize);
  /** @type {Complex[][]} */
  const frames = [];

  for (let start = 0; start < signal.length; start += hop) {
    const buf = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      const x = idx < signal.length ? signal[idx] : 0;
      buf[i] = x * win[i];
    }
    frames.push(fft(buf));
  }

  return frames;
}
