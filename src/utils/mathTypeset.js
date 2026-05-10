/** @typedef {{ left: string, right: string, display: boolean }} KatexDelimiter */

/**
 * Tuỳ chọn KaTeX auto-render (delimiter `\(` `\)` và `\[` `\]`).
 * @returns {{
 *   delimiters: KatexDelimiter[],
 *   ignoredTags: string[],
 *   strict: "ignore",
 * }}
 */
export function getMathTypesetOptions() {
  return {
    delimiters: [
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true },
    ],
    ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
    strict: "ignore",
  };
}

/**
 * Quét `el` và render các đoạn bọc delimiter (cdn auto-render).
 * @param {HTMLElement | null | undefined} el
 */
export function typesetMath(el) {
  if (!el) return;
  const render = globalThis.renderMathInElement;
  const katex = globalThis.katex;
  if (typeof render !== "function" || !katex) return;
  try {
    render(el, getMathTypesetOptions());
  } catch {
    /* ignore */
  }
}

/**
 * KaTeX → HTML an toàn cho `innerHTML` (chuỗi LaTeX tin cậy từ code).
 * @param {string} tex
 * @param {boolean} [displayMode]
 */
export function katexHtml(tex, displayMode = false) {
  const k = globalThis.katex;
  if (!k?.renderToString) return escapeHtml(tex);
  try {
    return k.renderToString(tex, { throwOnError: false, displayMode });
  } catch {
    return escapeHtml(tex);
  }
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
