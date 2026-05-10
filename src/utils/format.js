/**
 * @param {number} hz
 * @param {number} [digits=1]
 */
export function formatHz(hz, digits = 1) {
  if (!Number.isFinite(hz)) return "—";
  if (hz >= 1000) return `${(hz / 1000).toFixed(Math.max(0, digits - 1))} kHz`;
  return `${hz.toFixed(digits)} Hz`;
}

/**
 * @param {number} db
 * @param {number} [digits=1]
 */
export function formatDb(db, digits = 1) {
  if (!Number.isFinite(db)) return "— dB";
  return `${db.toFixed(digits)} dB`;
}
