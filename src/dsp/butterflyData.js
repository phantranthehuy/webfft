const TWO_PI = 2 * Math.PI;

/**
 * @param {number} n
 * @returns {boolean}
 */
function isPowerOfTwo(n) {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/**
 * @typedef {{ topWire: number, bottomWire: number, twiddleReal: number, twiddleImag: number }} Butterfly
 */

/**
 * Dữ liệu bướm Cooley–Tukey radix-2 để vẽ luồng FFT (SVG).
 * Định nghĩa DFT: W_N^k = exp(−2πj·k/N) → twiddleReal = cos(θ), twiddleImag = sin(θ), θ = −2πk/N.
 *
 * - **DIT**: đầu vào theo thứ tự bit-reversed, đầu ra thứ tự tự nhiên (khớp `fft.js`).
 * - **DIF**: đầu vào thứ tự tự nhiên, đầu ra bit-reversed.
 *
 * @param {number} N — độ dài FFT, lũy thừa của 2
 * @param {'DIT' | 'DIF'} type
 * @returns {{ N: number, type: string, stages: { butterflies: Butterfly[] }[] }}
 */
export function generateButterflyData(N, type) {
  if (!Number.isInteger(N) || N < 1) {
    throw new RangeError('generateButterflyData: N must be a positive integer');
  }
  if (!isPowerOfTwo(N)) {
    throw new RangeError('generateButterflyData: N must be a power of two');
  }
  if (type !== 'DIT' && type !== 'DIF') {
    throw new RangeError("generateButterflyData: type must be 'DIT' or 'DIF'");
  }

  const bits = Math.trunc(Math.log2(N));

  /** @type {{ butterflies: Butterfly[] }[]} */
  const stages = [];

  if (type === 'DIT') {
    for (let s = 1; s <= bits; s++) {
      const m = 1 << s;
      const half = m >> 1;
      /** @type {Butterfly[]} */
      const butterflies = [];
      for (let k = 0; k < N; k += m) {
        for (let j = 0; j < half; j++) {
          const topWire = k + j;
          const bottomWire = k + j + half;
          const angle = (-TWO_PI * j) / m;
          butterflies.push({
            topWire,
            bottomWire,
            twiddleReal: Math.cos(angle),
            twiddleImag: Math.sin(angle),
          });
        }
      }
      stages.push({ butterflies });
    }
  } else {
    for (let stage = 1; stage <= bits; stage++) {
      const butterflyStep = 1 << (bits - stage);
      const groupSize = butterflyStep << 1;
      /** @type {Butterfly[]} */
      const butterflies = [];
      for (let groupStart = 0; groupStart < N; groupStart += groupSize) {
        for (let j = 0; j < butterflyStep; j++) {
          const topWire = groupStart + j;
          const bottomWire = groupStart + j + butterflyStep;
          const kTw = j * (N / groupSize);
          const angle = (-TWO_PI * kTw) / N;
          butterflies.push({
            topWire,
            bottomWire,
            twiddleReal: Math.cos(angle),
            twiddleImag: Math.sin(angle),
          });
        }
      }
      stages.push({ butterflies });
    }
  }

  return { N, type, stages };
}
