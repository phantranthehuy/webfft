import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

/**
 * @typedef {{ topWire: number, bottomWire: number, twiddleReal: number, twiddleImag: number }} Butterfly
 * @typedef {{ butterflies: Butterfly[] }} StageBlock
 * @typedef {{ N: number, type: string, stages: StageBlock[] }} ButterflyData
 */

const DEFAULT_STAGE_GAP = 120;
const DEFAULT_WIRE_GAP = 40;
const NODE_R = 4;

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
 * @param {number} N
 * @param {number} k
 */
function twiddleTex(N, k) {
  return `W_{${N}}^{${k}}`;
}

/**
 * @param {string} tex
 * @param {number} fontPx
 */
function twiddleMarkup(tex, fontPx) {
  const katex = globalThis.katex;
  if (katex?.renderToString) {
    return katex.renderToString(tex, {
      throwOnError: false,
      displayMode: false,
    });
  }
  return `<span style="font-size:${fontPx}px;font-family:Georgia,serif;">W<sub>${N}</sub><sup>${tex.match(/\^\{(\d+)\}/)?.[1] ?? ""}</sup></span>`.replace(
    "<span",
    "<span",
  );
}

/** Fix up plain fallback — use simple W_N^k text without broken regex */
function twiddlePlainHtml(N, k, fontPx) {
  return `<span style="font-size:${fontPx}px;font-family:IBM Plex Sans,system-ui,sans-serif;">W<sub>${N}</sub><sup>${k}</sup></span>`;
}

/**
 * @param {string} tex
 * @param {number} N
 * @param {number} k
 * @param {number} fontPx
 */
function twiddleLabelInner(tex, N, k, fontPx) {
  const katex = globalThis.katex;
  if (katex?.renderToString) {
    return katex.renderToString(tex, {
      throwOnError: false,
      displayMode: false,
    });
  }
  return twiddlePlainHtml(N, k, fontPx);
}

/**
 * Vẽ sơ đồ cánh bướm FFT với D3 + SVG: lưới stage/wire, nút tròn, đường chéo có mũi tên,
 * nhãn −1 / twiddle, zoom–pan, tooltip khi hover.
 *
 * @param {string} containerId — `id` của phần tử chứa (thường là một `<div>`).
 * @param {ButterflyData} data — kết quả `generateButterflyData(N, type)`.
 * @param {{
 *   stageGap?: number,
 *   wireGap?: number,
 *   margin?: { top?: number, right?: number, bottom?: number, left?: number },
 * }} [opts]
 */
export function drawButterfly(containerId, data, opts = {}) {
  const root = document.getElementById(containerId);
  if (!root) {
    throw new Error(`drawButterfly: không tìm thấy phần tử #${containerId}`);
  }

  const stageGap = opts.stageGap ?? DEFAULT_STAGE_GAP;
  const wireGap = opts.wireGap ?? DEFAULT_WIRE_GAP;
  const margin = {
    top: opts.margin?.top ?? 40,
    right: opts.margin?.right ?? 56,
    bottom: opts.margin?.bottom ?? 28,
    left: opts.margin?.left ?? 56,
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
  root.style.minHeight = "240px";

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
    "font-family:IBM Plex Sans,system-ui,sans-serif",
  ].join(";");
  root.appendChild(tooltip);

  const svg = d3
    .createSvg()
    .attr("role", "img")
    .attr(
      "aria-label",
      `FFT butterfly diagram, ${type}, N=${N}, ${numStages} stages`,
    )
    .attr("class", "bf-d3-svg butterfly-svg")
    .attr("width", plotWidth)
    .attr("height", plotHeight)
    .style("display", "block")
    .style("max-width", "100%");

  const defs = svg.append("defs");

  defs
    .append("marker")
    .attr("id", `bf-arrow-${containerId.replace(/[^a-zA-Z0-9]/g, "")}`)
    .attr("viewBox", "0 0 10 10")
    .attr("refX", 9)
    .attr("refY", 5)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto-start-reverse")
    .append("path")
    .attr("d", "M 0 0 L 10 5 L 0 10 z")
    .attr("fill", "var(--bf-arrow, #2fd2a8)");

  const arrowId = `url(#bf-arrow-${containerId.replace(/[^a-zA-Z0-9]/g, "")})`;

  const inner = svg.append("g").attr("class", "bf-zoom-layer");

  inner
    .append("style")
    .text(`
      .bf-d3-svg text { font-family: "IBM Plex Sans", system-ui, sans-serif; }
      .bf-wire { stroke: rgba(255,255,255,0.14); stroke-width: 1.2; fill: none; }
      .bf-node { fill: #e6eef5; stroke: rgba(0,0,0,0.12); stroke-width: 0.5; }
      .bf-cap { fill: #9fb0bf; font-size: 12px; }
      .bf-minus { fill: #a8e6ff; font-size: 12px; font-weight: 600; }
      .bf-x-diag { stroke: #2fd2a8; stroke-width: 1.35; fill: none; opacity: 0.95; }
      .bf-x-diag.is-dim { stroke: rgba(47,210,168,0.35); }
      .bf-butterfly:hover .bf-x-diag { stroke: #ff9f43; stroke-width: 2; }
      .bf-butterfly:hover .bf-node-hit { fill: rgba(255,159,67,0.35); }
    `);

  inner
    .append("text")
    .attr("class", "bf-cap")
    .attr("x", margin.left)
    .attr("y", 18)
    .text(`Radix-2 ${type} · N = ${N}`);

  const wireX0 = Math.max(8, margin.left - 24);
  const wireX1 = stageX(numStages) + 24;

  for (let w = 0; w < N; w++) {
    const y = wireY(w);
    inner
      .append("line")
      .attr("class", "bf-wire")
      .attr("x1", wireX0)
      .attr("y1", y)
      .attr("x2", wireX1)
      .attr("y2", y);
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

  /** @type {{ left: string, right: string }[]} */
  const leftLabels = [];
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
      .attr("x", wireX1 + 8)
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
      const xm = (x0 + x1) / 2;
      const ym = (yt + yb) / 2;
      const kExp = twiddleExponent(N, type, sIdx, bf);
      const kInt = Math.round(kExp);
      const tex = twiddleTex(N, kInt);

      const g = inner.append("g").attr("class", "bf-butterfly");

      const pathMinus = g
        .append("path")
        .attr("class", "bf-x-diag")
        .attr("d", `M ${x0} ${yt} L ${x1} ${yb}`)
        .attr("marker-end", arrowId);

      const pathTw = g
        .append("path")
        .attr("class", "bf-x-diag")
        .attr("d", `M ${x0} ${yb} L ${x1} ${yt}`)
        .attr("marker-end", arrowId);

      pathMinus.attr("data-role", "minus-branch");
      pathTw.attr("data-role", "twiddle-branch");

      const tMinus = 0.72;
      const lx = x0 + tMinus * (x1 - x0);
      const ly = yt + tMinus * (yb - yt);
      g.append("text")
        .attr("class", "bf-minus")
        .attr("x", lx + 6)
        .attr("y", ly + 4)
        .text("−1");

      const fo = g
        .append("foreignObject")
        .attr("x", xm - 44)
        .attr("y", ym - 22)
        .attr("width", 88)
        .attr("height", 36);

      fo.append("xhtml:div")
        .attr("xmlns", "http://www.w3.org/1999/xhtml")
        .style("display", "flex")
        .style("justify-content", "center")
        .style("align-items", "center")
        .style("height", "100%")
        .style("font-size", "12px")
        .html(twiddleLabelInner(tex, N, kInt, 12));

      const fmt = (z) => z.toFixed(4).replace(/\.?0+$/, "") || "0";
      const twStr = `${fmt(bf.twiddleReal)} ${bf.twiddleImag >= 0 ? "+" : "−"} ${fmt(Math.abs(bf.twiddleImag))}i`;

      g.append("circle")
        .attr("class", "bf-node-hit")
        .attr("cx", xm)
        .attr("cy", ym)
        .attr("r", 14)
        .attr("fill", "transparent")
        .style("cursor", "pointer");

      g.on("mouseenter", (event) => {
        inner.selectAll(".bf-x-diag").classed("is-dim", true);
        g.selectAll(".bf-x-diag").classed("is-dim", false);

        tooltip.style.display = "block";
        tooltip.innerHTML = [
          `<div style="font-weight:600;margin-bottom:6px;color:#b8fce9;">Butterfly · stage ${sIdx + 1}/${numStages}</div>`,
          `<div>Wires: top <code>${bf.topWire}</code>, bottom <code>${bf.bottomWire}</code></div>`,
          `<div style="margin-top:8px;"><code>A′ = A + ${tex.replace(/_/g, "")} · B</code></div>`,
          `<div><code>B′ = A − ${tex.replace(/_/g, "")} · B</code></div>`,
          `<div style="margin-top:8px;color:#9fb0bf;font-size:12px;">${tex} ≈ ${twStr}</div>`,
        ].join("");

        const pad = 12;
        const rect = root.getBoundingClientRect();
        let px = event.clientX - rect.left + pad;
        let py = event.clientY - rect.top + pad;
        tooltip.style.left = `${px}px`;
        tooltip.style.top = `${py}px`;
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

  const zoom = d3
    .zoom()
    .scaleExtent([0.25, 5])
    .on("zoom", (event) => {
      inner.attr("transform", event.transform);
    });

  svg.call(zoom);

  root.append(svg.node());

  return /** @type {SVGSVGElement} */ (svg.node());
}
