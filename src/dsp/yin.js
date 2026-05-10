/**
 * YIN đơn giản (Cheveigne & Kawahara) — ước lượng tần số cơ bản từ PCM mono.
 * @param {Float32Array} buffer
 * @param {number} sampleRate
 * @param {number} fMinHz
 * @param {number} fMaxHz
 * @returns {number | null} Hz hoặc null nếu không đủ tin cậy
 */
export function yinDetectPitchHz(buffer, sampleRate, fMinHz, fMaxHz) {
  const n = buffer.length;
  if (n < 256 || sampleRate <= 0) return null;

  const tauMin = Math.max(2, Math.floor(sampleRate / fMaxHz));
  const tauMax = Math.min(Math.floor(n / 2) - 1, Math.floor(sampleRate / fMinHz));
  if (tauMax <= tauMin + 2) return null;

  /** @type {Float64Array} */
  const d = new Float64Array(tauMax + 1);
  d[0] = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    const lim = n - tau;
    for (let j = 0; j < lim; j++) {
      const delta = buffer[j] - buffer[j + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }

  /** cumulative mean normalized difference function */
  /** @type {Float64Array} */
  const cmd = new Float64Array(tauMax + 1);
  cmd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  const threshold = 0.15;
  let tau = 0;
  for (let t = tauMin; t < tauMax; t++) {
    if (cmd[t] < threshold) {
      while (t + 1 < tauMax && cmd[t + 1] < cmd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === 0) return null;

  let better = tau;
  if (tau > 1 && tau < tauMax - 1) {
    const x0 = cmd[tau - 1];
    const x1 = cmd[tau];
    const x2 = cmd[tau + 1];
    const denom = x0 - 2 * x1 + x2;
    if (Math.abs(denom) > 1e-12) {
      better = tau + (x2 - x0) / (2 * denom);
    }
  }

  const f = sampleRate / better;
  if (!Number.isFinite(f) || f < fMinHz || f > fMaxHz) return null;
  return f;
}
