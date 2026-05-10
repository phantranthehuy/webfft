import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import { katexHtml } from "../utils/mathTypeset.js";

/**
 * @typedef {{ topWire: number, bottomWire: number, twiddleReal: number, twiddleImag: number }} Butterfly
 * @typedef {{ butterflies: Butterfly[] }} StageBlock
 * @typedef {{ N: number, type: string, stages: StageBlock[] }} ButterflyData
 */

const DEFAULT_STAGE_GAP = 168;
const DEFAULT_WIRE_GAP = 48;
const NODE_R = 4.5;

/**
 * @param {number} i
 * @param {number} bits
 */
function bitReverse(i, bits) {
  let x = i;
  let y = 0;
  for (let k = 0; k < bits; k++) {
    y = (y << 1) | (x & 1);
    x >>= 1;
  }
  return y;
}

/**
 * Số mũ k trong W_N^k cho butterfly (khớp định nghĩa trong `generateButterflyData`).
 *
 * @param {number} N
 * @param {'DIT' | 'DIF'} type
 * @param {number} stageIndex
 * @param {Butterfly} bf
 */
function twiddleExponent(N, type, stageIndex, bf) {
  const bits = Math.round(Math.log2(N));
  if (type === "DIT") {
    const s = stageIndex + 1;
    const m = 1 << s;
    const half = m >> 1;
    const j = bf.topWire % half;
    return (j * N) / m;
  }
  const stage = stageIndex + 1;
  const butterflyStep = 1 << (bits - stage);
  const groupSize = butterflyStep << 1;
  const groupStart = Math.floor(bf.topWire / groupSize) * groupSize;
  const j = bf.topWire - groupStart;
  return j * (N / groupSize);
}

/**
 * Nhãn W_m^k trên sơ đồ: DIT dùng đúng kích thước bướm con m = 2^(stage+1) và mũ j trùng dữ liệu twiddle;
 * DIF giữ W_N^k (theo `twiddleExponent`).
 *
 * @returns {{ base: number, exp: number }}
 */
function twiddleLabelBaseExp(N, type, stageIndex, bf) {
  if (type === "DIT") {
    const m = 1 << (stageIndex + 1);
    const exp = bf.topWire % m;
    return { base: m, exp };
  }
  const exp = Math.round(twiddleExponent(N, type, stageIndex, bf));
  return { base: N, exp };
}

const UNICODE_SUB_DIGITS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
const UNICODE_SUP_DIGITS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

/**
 * @param {string} s
 * @param {string[]} map
 */
function mapAsciiDigits(s, map) {
  let out = "";
  for (const ch of String(s)) {
    const d = ch.charCodeAt(0) - 48;
    out += d >= 0 && d <= 9 ? map[d] : ch;
  }
  return out;
}

/** Chuỗi một khối Wₙᵏ (Unicode) — tránh `<tspan>`/baseline-shift (Safari hay vỡ vị trí). */
function formatTwiddleUnicode(N, kInt) {
  return `W${mapAsciiDigits(String(N), UNICODE_SUB_DIGITS)}${mapAsciiDigits(String(kInt), UNICODE_SUP_DIGITS)}`;
}

/**
 * Nhãn twiddle trên nhánh chéo — `<g translate>` + `<text>` một dòng (ổn định hơn khi có zoom).
 * @param {import("d3").Selection} parentG
 */
function appendTwiddleSvgText(parentG, twiddleBase, twiddleExp, cx, cy) {
  const lg = parentG
    .append("g")
    .attr("class", "bf-twiddle-g")
    .attr("transform", `translate(${cx}, ${cy + 14})`);
  lg.append("text")
    .attr("class", "bf-twiddle")
    .attr("text-anchor", "middle")
    .attr("font-size", 13)
    .attr("font-weight", "600")
    .attr("paint-order", "stroke fill")
    .text(formatTwiddleUnicode(twiddleBase, twiddleExp));
}

/** Twiddle trên nhánh đầu vào dưới (trước nút bướm): đoạn (x0,yb)→(x1,yt), gần nút trái. */
const TWIDDLE_ON_LOWER_INPUT_DIAG_T = 0.3;
/** Nhãn trừ đặt ngay trước nút cộng/trừ phía dưới. */
const MINUS_NEAR_RIGHT_T = 0.9;

/**
 * @param {string | HTMLElement} containerId
 * @returns {HTMLElement}
 */
function resolveContainer(containerId) {
  if (typeof containerId === "string") {
    const el = document.getElementById(containerId);
    if (!el) {
      throw new Error(`drawButterfly: không tìm thấy phần tử #${containerId}`);
    }
    return el;
  }
  if (containerId instanceof HTMLElement) {
    return containerId;
  }
  throw new Error("drawButterfly: container phải là id (string) hoặc HTMLElement");
}

/**
 * Hậu tố duy nhất cho marker SVG (tránh trùng khi nhiều biểu đồ).
 * @param {HTMLElement} root
 */
function uniqueSuffix(root) {
  if (!root.id) {
    root.id = `bf-d3-${Math.random().toString(36).slice(2, 11)}`;
  }
  return root.id.replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * Vẽ sơ đồ cánh bướm FFT với D3 + SVG: lưới stage/wire (120px / 40px), nút tròn,
 * đường chéo có mũi tên, nhãn −1 / twiddle (KaTeX nếu có), zoom–pan, tooltip khi hover.
 *
 * @param {string | HTMLElement} containerId — `id` của phần tử chứa, hoặc chính phần tử `<div>`.
 * @param {ButterflyData} data — kết quả `generateButterflyData(N, type)`.
 * @param {{
 *   stageGap?: number,
 *   wireGap?: number,
 *   margin?: { top?: number, right?: number, bottom?: number, left?: number },
 *   initialZoomScale?: number,
 * }} [opts]
 * @returns {SVGSVGElement}
 */
export function drawButterfly(containerId, data, opts = {}) {
  const root = resolveContainer(containerId);

  const stageGap = opts.stageGap ?? DEFAULT_STAGE_GAP;
  const wireGap = opts.wireGap ?? DEFAULT_WIRE_GAP;
  const margin = {
    top: opts.margin?.top ?? 132,
    right: opts.margin?.right ?? 116,
    bottom: opts.margin?.bottom ?? 52,
    left: opts.margin?.left ?? 260,
  };

  const { N, type, stages } = data;
  const bits = Math.round(Math.log2(N));
  const numStages = stages.length;

  const stageX = (col) => margin.left + col * stageGap;
  const wireY = (w) => margin.top + w * wireGap;

  const plotWidth = margin.left + numStages * stageGap + margin.right;
  const plotHeight = margin.top + Math.max(1, N - 1) * wireGap + margin.bottom;

  root.replaceChildren();
  root.style.position = "relative";
  root.style.width = "100%";
  root.style.maxWidth = "100%";
  root.style.boxSizing = "border-box";
  root.style.minHeight = N >= 8 ? "min(560px, 72vh)" : "min(320px, 60vh)";

  const suffix = uniqueSuffix(root);
  const arrowMarkerId = `bf-arrow-${suffix}`;
  const outputArrowMarkerId = `bf-output-arrow-${suffix}`;

  const tooltip = document.createElement("div");
  tooltip.className = "bf-d3-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.style.cssText = [
    "position:absolute",
    "display:none",
    "pointer-events:none",
    "z-index:20",
    "max-width:min(360px,92vw)",
    "padding:10px 12px",
    "border-radius:10px",
    "border:1px solid rgba(255,255,255,0.18)",
    "background:rgba(15,22,32,0.96)",
    "color:#e8eef5",
    "font-size:13px",
    "line-height:1.45",
    "box-shadow:0 8px 28px rgba(0,0,0,0.35)",
    "font-family:'Helvetica Neue',Helvetica,Arial,system-ui,sans-serif",
  ].join(";");
  root.appendChild(tooltip);

  const svg = d3
    .create("svg")
    .attr("role", "img")
    .attr(
      "aria-label",
      `Sơ đồ bướm FFT ${type}, N=${N}, ${numStages} giai đoạn`,
    )
    .attr("class", "bf-d3-svg butterfly-svg")
    .attr("viewBox", `0 0 ${plotWidth} ${plotHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("width", "100%")
    .style("display", "block")
    .style("width", "100%")
    .style("height", "auto")
    .style("max-width", "100%");

  const defs = svg.append("defs");

  defs
    .append("marker")
    .attr("id", arrowMarkerId)
    .attr("viewBox", "0 0 10 10")
    .attr("refX", 9)
    .attr("refY", 5)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto-start-reverse")
    .append("path")
    .attr("d", "M 0 0 L 10 5 L 0 10 z")
    .attr("fill", "var(--bf-arrow, #2fd2a8)");

  defs
    .append("marker")
    .attr("id", outputArrowMarkerId)
    .attr("viewBox", "0 0 10 10")
    .attr("refX", 9)
    .attr("refY", 5)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M 0 0 L 10 5 L 0 10 z")
    .attr("fill", "#e6eef5");

  const arrowUrl = `url(#${arrowMarkerId})`;
  const outputArrowUrl = `url(#${outputArrowMarkerId})`;

  const inner = svg.append("g").attr("class", "bf-zoom-layer");

  inner
    .append("style")
    .text(`
      .bf-d3-svg text { font-family: "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif; }
      .bf-bg { fill: #11171d; }
      .bf-title { fill: #eef7ff; font-size: 18px; font-weight: 700; letter-spacing: 0.08em; }
      .bf-stage-label { fill: #d7e7f4; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; }
      .bf-stage-separator { stroke: rgba(255,255,255,0.13); stroke-width: 1; stroke-dasharray: 5 8; }
      .bf-note-box { fill: rgba(20,29,36,0.94); stroke: rgba(47,210,168,0.32); stroke-width: 1; }
      .bf-note-text { fill: #b8c8d6; font-size: 10.5px; font-style: italic; }
      .bf-wire { stroke: rgba(47,210,168,0.58); stroke-width: 1.25; fill: none; }
      .bf-output-arrow { stroke: #e6eef5; stroke-width: 1.2; fill: none; }
      .bf-node { fill: #f4f8fb; stroke: rgba(17,23,29,0.65); stroke-width: 0.7; }
      .bf-cap { fill: #d9e5ee; font-size: 12px; font-weight: 600; }
      .bf-twiddle-g { pointer-events: none; }
      .bf-twiddle { fill: #e8f7ff; stroke: rgba(17,23,29,0.92); stroke-width: 3px; font-family: "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif; }
      .bf-minus { fill: #f1f7fb; font-size: 12px; font-weight: 700; }
      .bf-x-diag { stroke: #35d6df; stroke-width: 1.45; fill: none; opacity: 0.96; }
      .bf-x-diag.is-dim { stroke: rgba(47,210,168,0.35); }
      .bf-butterfly:hover .bf-x-diag { stroke: #ff9f43; stroke-width: 2; }
      .bf-butterfly:hover .bf-node-hit { fill: rgba(255,159,67,0.35); }
    `);

  inner
    .append("rect")
    .attr("class", "bf-bg")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", plotWidth)
    .attr("height", plotHeight)
    .attr("rx", 18);

  inner
    .append("text")
    .attr("class", "bf-title")
    .attr("x", plotWidth / 2)
    .attr("y", 34)
    .attr("text-anchor", "middle")
    .text(`FFT radix‑2 ${type} · N = ${N}`);

  const wireX0 = Math.max(18, margin.left - 34);
  const wireX1 = stageX(numStages) + 34;
  const outputLabelX = wireX1 + 48;
  const separatorTop = margin.top - 44;
  const separatorBottom = wireY(N - 1) + 28;

  for (let s = 0; s < numStages; s++) {
    const x0 = stageX(s);
    const x1 = stageX(s + 1);
    inner
      .append("text")
      .attr("class", "bf-stage-label")
      .attr("x", (x0 + x1) / 2)
      .attr("y", margin.top - 54)
      .attr("text-anchor", "middle")
      .text(`Giai đoạn ${s + 1}`);
  }

  for (let s = 1; s < numStages; s++) {
    const x = stageX(s) - stageGap / 2;
    inner
      .append("line")
      .attr("class", "bf-stage-separator")
      .attr("x1", x)
      .attr("y1", separatorTop)
      .attr("x2", x)
      .attr("y2", separatorBottom);
  }

  const noteX = 18;
  const noteY = 64;
  inner
    .append("rect")
    .attr("class", "bf-note-box")
    .attr("x", noteX)
    .attr("y", noteY)
    .attr("width", Math.min(238, margin.left - 24))
    .attr("height", 48)
    .attr("rx", 10);
  const note = inner
    .append("text")
    .attr("class", "bf-note-text")
    .attr("x", noteX + 12)
    .attr("y", noteY + 18);
  note.append("tspan").attr("x", noteX + 12).text("*Đầu vào DIT: hoán vị bit-reverse");
  note
    .append("tspan")
    .attr("x", noteX + 12)
    .attr("dy", 15)
    .text("(vd: 000→000, 001→100)*");

  for (let w = 0; w < N; w++) {
    const y = wireY(w);
    if (numStages === 0) {
      inner
        .append("line")
        .attr("class", "bf-wire")
        .attr("x1", wireX0)
        .attr("y1", y)
        .attr("x2", wireX1)
        .attr("y2", y)
        .attr("marker-end", arrowUrl);
      continue;
    }
    inner
      .append("line")
      .attr("class", "bf-wire")
      .attr("x1", wireX0)
      .attr("y1", y)
      .attr("x2", stageX(0))
      .attr("y2", y);
    for (let c = 0; c < numStages; c++) {
      inner
        .append("line")
        .attr("class", "bf-wire")
        .attr("x1", stageX(c))
        .attr("y1", y)
        .attr("x2", stageX(c + 1))
        .attr("y2", y);
    }
    inner
      .append("line")
      .attr("class", "bf-output-arrow")
      .attr("x1", stageX(numStages))
      .attr("y1", y)
      .attr("x2", wireX1)
      .attr("y2", y)
      .attr("marker-end", outputArrowUrl);
  }

  for (let col = 0; col <= numStages; col++) {
    const x = stageX(col);
    for (let w = 0; w < N; w++) {
      inner
        .append("circle")
        .attr("class", "bf-node")
        .attr("cx", x)
        .attr("cy", wireY(w))
        .attr("r", NODE_R);
    }
  }

  /** @type {string[]} */
  const leftLabels = [];
  /** @type {string[]} */
  const rightLabels = [];
  for (let i = 0; i < N; i++) {
    if (type === "DIT") {
      leftLabels.push(`x(${bitReverse(i, bits)})`);
      rightLabels.push(`X(${i})`);
    } else {
      leftLabels.push(`x(${i})`);
      rightLabels.push(`X(${bitReverse(i, bits)})`);
    }
  }

  for (let i = 0; i < N; i++) {
    const y = wireY(i);
    inner
      .append("text")
      .attr("class", "bf-cap")
      .attr("x", wireX0 - 8)
      .attr("y", y + 4)
      .attr("text-anchor", "end")
      .text(leftLabels[i]);

    inner
      .append("text")
      .attr("class", "bf-cap")
      .attr("x", outputLabelX)
      .attr("y", y + 4)
      .attr("text-anchor", "start")
      .text(rightLabels[i]);
  }

  stages.forEach((stageBlock, sIdx) => {
    const x0 = stageX(sIdx);
    const x1 = stageX(sIdx + 1);

    for (const bf of stageBlock.butterflies) {
      const yt = wireY(bf.topWire);
      const yb = wireY(bf.bottomWire);
      const { base: twBase, exp: twExp } = twiddleLabelBaseExp(N, type, sIdx, bf);

      const tTw = TWIDDLE_ON_LOWER_INPUT_DIAG_T;
      const twx = x0 + tTw * (x1 - x0);
      const twy = yb + tTw * (yt - yb);

      const mx = x0 + MINUS_NEAR_RIGHT_T * (x1 - x0);
      const my = yb;

      const g = inner.append("g").attr("class", "bf-butterfly");

      g.append("path")
        .attr("class", "bf-x-diag")
        .attr("d", `M ${x0} ${yt} L ${x1} ${yb}`);

      g.append("path")
        .attr("class", "bf-x-diag")
        .attr("d", `M ${x0} ${yb} L ${x1} ${yt}`);

      g.append("text")
        .attr("class", "bf-minus")
        .attr("x", mx - 6)
        .attr("y", my - 7)
        .attr("text-anchor", "middle")
        .text("−1");

      appendTwiddleSvgText(g, twBase, twExp, twx, twy);

      const fmt = (z) => z.toFixed(4).replace(/\.?0+$/, "") || "0";
      const twStr = `${fmt(bf.twiddleReal)} ${bf.twiddleImag >= 0 ? "+" : "−"} ${fmt(Math.abs(bf.twiddleImag))}i`;

      g.append("circle")
        .attr("class", "bf-node-hit")
        .attr("cx", twx)
        .attr("cy", twy)
        .attr("r", 14)
        .attr("fill", "transparent")
        .style("cursor", "pointer");

      g.on("mouseenter", (event) => {
        inner.selectAll(".bf-x-diag").classed("is-dim", true);
        g.selectAll(".bf-x-diag").classed("is-dim", false);

        tooltip.style.display = "block";
        const wTex = `W_{${twBase}}^{${twExp}}`;
        const eqTop = katexHtml(`A^{\\prime} = A + ${wTex} \\cdot B`);
        const eqBot = katexHtml(`B^{\\prime} = A - ${wTex} \\cdot B`);
        const wApprox = katexHtml(wTex);
        tooltip.innerHTML = [
          `<div style="font-weight:600;margin-bottom:6px;color:#b8fce9;">Phép bướm · giai đoạn ${sIdx + 1}/${numStages}</div>`,
          `<div>Dây trên chỉ số <code>${bf.topWire}</code>, dây dưới <code>${bf.bottomWire}</code></div>`,
          `<div style="margin-top:8px;">${eqTop}</div>`,
          `<div>${eqBot}</div>`,
          `<div style="margin-top:8px;color:#9fb0bf;font-size:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span>${wApprox}</span><span>≈</span><span style="font-family:ui-monospace,monospace">${twStr}</span></div>`,
        ].join("");

        const pad = 12;
        const rect = root.getBoundingClientRect();
        tooltip.style.left = `${event.clientX - rect.left + pad}px`;
        tooltip.style.top = `${event.clientY - rect.top + pad}px`;
      });

      g.on("mousemove", (event) => {
        const pad = 12;
        const rect = root.getBoundingClientRect();
        tooltip.style.left = `${event.clientX - rect.left + pad}px`;
        tooltip.style.top = `${event.clientY - rect.top + pad}px`;
      });

      g.on("mouseleave", () => {
        tooltip.style.display = "none";
        inner.selectAll(".bf-x-diag").classed("is-dim", false);
      });
    }
  });

  for (let col = 0; col <= numStages; col++) {
    const x = stageX(col);
    for (let w = 0; w < N; w++) {
      inner
        .append("circle")
        .attr("class", "bf-node")
        .attr("cx", x)
        .attr("cy", wireY(w))
        .attr("r", NODE_R);
    }
  }

  const zoom = d3
    .zoom()
    .scaleExtent([0.25, 5])
    .on("zoom", (event) => {
      inner.attr("transform", event.transform);
    });

  svg.call(zoom);

  const rawZoom =
    opts.initialZoomScale !== undefined ? opts.initialZoomScale : 1;
  const k = Math.min(
    5,
    Math.max(0.25, typeof rawZoom === "number" && Number.isFinite(rawZoom)
      ? rawZoom
      : 1),
  );
  const cx = plotWidth / 2;
  const cy = plotHeight / 2;
  svg.call(
    zoom.transform,
    d3.zoomIdentity.translate(cx, cy).scale(k).translate(-cx, -cy),
  );

  root.append(svg.node());

  return /** @type {SVGSVGElement} */ (svg.node());
}

/**
 * Tạo một `<div>` chứa sơ đồ — tiện khi chưa có id trong DOM (vd. `appendChild` sau).
 *
 * @param {ButterflyData} data
 * @param {Parameters<typeof drawButterfly>[2]} [opts]
 * @returns {HTMLDivElement}
 */
export function renderButterflySvg(data, opts) {
  const wrap = document.createElement("div");
  wrap.className = "bf-d3-root";
  drawButterfly(wrap, data, opts);
  return wrap;
}
