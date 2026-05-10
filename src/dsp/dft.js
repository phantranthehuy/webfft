import Complex from './complex.js';

/**
 * DFT ngây thơ O(N²): X[k] = Σₙ x[n] · exp(-2πj·kn/N).
 *
 * Tiền tính W[m] = exp(-2πj·m/N), m = 0…N−1, để exp(-2πj·kn/N) = W[(kn) mod N].
 *
 * @param {Float64Array} signal — mẫu thực, độ dài N
 * @returns {Complex[]} — N hệ số phổ X[0]…X[N−1]
 */
export function dft(signal) {
  const N = signal.length;
  if (N === 0) {
    return [];
  }

  /** @type {Complex[]} */
  const W = new Array(N);
  const twoPiOverN = (2 * Math.PI) / N;
  for (let m = 0; m < N; m++) {
    W[m] = Complex.fromPolar(1, -twoPiOverN * m);
  }

  /** @type {Complex[]} */
  const spectrum = new Array(N);

  for (let k = 0; k < N; k++) {
    let acc = new Complex(0, 0);
    for (let n = 0; n < N; n++) {
      const idx = (k * n) % N;
      const term = W[idx].mul(new Complex(signal[n], 0));
      acc = acc.add(term);
    }
    spectrum[k] = acc;
  }

  return spectrum;
}
