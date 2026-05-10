import { dft, fft, Complex } from "../dsp.js";
import { generateButterflyData } from "../dsp/butterflyData.js";
import { renderButterflySvg } from "../visualization/butterflySvg.js";

const TWO_PI = 2 * Math.PI;

/**
 * @param {number} n
 */
function isPowerOfTwo(n) {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/**
 * @param {number} i
 * @param {number} bits
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
 * Giống `fft.js`: W_m^j = exp(−2πj·j/m) lưu dạng Complex(cos θ, sin θ), θ = −2πj/m.
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
 * @param {string} text
 * @param {number} N
 */
function parseSignal(text, N) {
  const parts = text
    .trim()
    .split(/[\s,;]+/u)
    .filter(Boolean);
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const raw = i < parts.length ? Number(parts[i]) : 0;
    if (!Number.isFinite(raw)) {
      throw new Error(`Giá trị không hợp lệ tại chỉ số ${i}`);
    }
    out[i] = raw;
  }
  return out;
}

/**
 * @param {Complex} c
 * @param {number} d
 */
function fmtC(c, d = 3) {
  const im = c.im;
  const sign = im >= 0 ? "+" : "−";
  return `${c.re.toFixed(d)} ${sign} ${Math.abs(im).toFixed(d)}i`;
}

/**
 * Ma trận F với F[k,n] = exp(−2πj·kn/N).
 * @param {number} N
 */
function buildTwiddleMatrix(N) {
  /** @type {Complex[][]} */
  const rows = [];
  const scale = -TWO_PI / N;
  for (let k = 0; k < N; k++) {
    const row = [];
    for (let n = 0; n < N; n++) {
      const angle = scale * k * n;
      row.push(new Complex(Math.cos(angle), Math.sin(angle)));
    }
    rows.push(row);
  }
  return rows;
}

/**
 * @param {Complex[]} a
 * @param {Complex[]} b
 */
function maxAbsDiff(a, b) {
  let m = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    m = Math.max(m, a[i].sub(b[i]).magnitude());
  }
  return m;
}

/**
 * @param {Complex[]} xs
 */
function cloneSpectrum(xs) {
  return xs.map((c) => new Complex(c.re, c.im));
}

/**
 * @param {Float64Array} signal
 * @param {number} N
 */
function simulateDit(signal, N) {
  const bits = Math.trunc(Math.log2(N));
  const tw = precomputeDitTwiddles(N);
  /** @type {Complex[]} */
  const seq = [];
  for (let i = 0; i < N; i++) seq.push(new Complex(signal[i], 0));

  /** @type {Complex[]} */
  const A = new Array(N);
  for (let i = 0; i < N; i++) {
    A[reverseBits(i, bits)] = seq[i];
  }

  /** @type {{ title: string, values: Complex[] }[]} */
  const stages = [
    {
      title: "Sau hoán vị bit-reverse (đầu vào DIT)",
      values: cloneSpectrum(A),
    },
  ];

  for (let s = 1; s <= bits; s++) {
    const m = 1 << s;
    const half = m >> 1;
    const Wrow = tw.get(m);
    if (!Wrow) throw new Error("Thiếu twiddle cho DIT");
    for (let k = 0; k < N; k += m) {
      for (let j = 0; j < half; j++) {
        const idx = k + j;
        const u = A[idx];
        const v = A[idx + half];
        const w = Wrow[j];
        const t = v.mul(w);
        A[idx] = u.add(t);
        A[idx + half] = u.sub(t);
      }
    }
    stages.push({
      title: `Stage DIT ${s} (kích thước bướm m = ${m})`,
      values: cloneSpectrum(A),
    });
  }
  return stages;
}

/**
 * @param {Float64Array} signal
 * @param {number} N
 */
function simulateDif(signal, N) {
  const bits = Math.trunc(Math.log2(N));
  /** @type {Complex[]} */
  const A = [];
  for (let i = 0; i < N; i++) A.push(new Complex(signal[i], 0));

  /** @type {{ title: string, values: Complex[] }[]} */
  const stages = [
    { title: "Đầu vào DIF (thứ tự thời gian tự nhiên)", values: cloneSpectrum(A) },
  ];

  for (let stage = 1; stage <= bits; stage++) {
    const butterflyStep = 1 << (bits - stage);
    const groupSize = butterflyStep << 1;
    for (let groupStart = 0; groupStart < N; groupStart += groupSize) {
      for (let j = 0; j < butterflyStep; j++) {
        const top = groupStart + j;
        const bottom = groupStart + j + butterflyStep;
        const kTw = j * (N / groupSize);
        const angle = (-TWO_PI * kTw) / N;
        const Wkn = new Complex(Math.cos(angle), Math.sin(angle));
        const u = A[top];
        const v = A[bottom];
        const sum = u.add(v);
        const diffW = u.sub(v).mul(Wkn);
        A[top] = sum;
        A[bottom] = diffW;
      }
    }
    stages.push({
      title: `Stage DIF ${stage}`,
      values: cloneSpectrum(A),
    });
  }

  /** @type {Complex[]} */
  const natural = new Array(N);
  for (let i = 0; i < N; i++) {
    natural[reverseBits(i, bits)] = A[i];
  }
  stages.push({
    title: "Sau hoán vị bit-reverse (phổ X[k] theo thứ tự k)",
    values: natural,
  });
  return stages;
}

/**
 * @param {Float64Array} signal
 */
function dftSteps(signal) {
  const N = signal.length;
  const W = new Array(N);
  const inv = TWO_PI / N;
  for (let m = 0; m < N; m++) {
    W[m] = Complex.fromPolar(1, -inv * m);
  }

  /** @type {{ k: number, partials: { n: number, term: Complex, acc: Complex }[], Xk: Complex }[]} */
  const out = [];
  for (let k = 0; k < N; k++) {
    let acc = new Complex(0, 0);
    const partials = [];
    for (let n = 0; n < N; n++) {
      const idx = (k * n) % N;
      const term = W[idx].mul(new Complex(signal[n], 0));
      acc = acc.add(term);
      partials.push({ n, term, acc: new Complex(acc.re, acc.im) });
    }
    out.push({ k, partials, Xk: acc });
  }
  return out;
}

/**
 * @param {Complex[][]} matrix
 */
function renderTwiddleTable(matrix) {
  const table = document.createElement("table");
  table.className = "dft-matrix-table";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  const corner = document.createElement("th");
  corner.textContent = "k \\ n";
  hr.appendChild(corner);
  for (let n = 0; n < matrix[0].length; n++) {
    const th = document.createElement("th");
    th.textContent = String(n);
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  matrix.forEach((row, k) => {
    const tr = document.createElement("tr");
    const rh = document.createElement("th");
    rh.textContent = String(k);
    rh.scope = "row";
    tr.appendChild(rh);
    for (const cell of row) {
      const td = document.createElement("td");
      td.textContent = fmtC(cell, 2);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

/**
 * @param {Complex[]} values
 */
function renderSpectrumRow(values) {
  const wrap = document.createElement("div");
  wrap.className = "dft-spectrum-row";
  values.forEach((c, i) => {
    const span = document.createElement("span");
    span.className = "dft-chip";
    span.textContent = `X[${i}] = ${fmtC(c)}`;
    wrap.appendChild(span);
  });
  return wrap;
}

/**
 * @param {HTMLElement} host
 */
function clearHost(host) {
  while (host.firstChild) host.removeChild(host.firstChild);
}

function initDftSimulator() {
  const root = document.getElementById("dft-simulator");
  if (!root) return;

  root.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "dft-grid";

  const controls = document.createElement("div");
  controls.className = "dft-controls";

  const labIn = document.createElement("label");
  labIn.className = "dft-field";
  labIn.innerHTML = `<span>Dãy mẫu (phân tách bằng dấu phẩy hoặc khoảng trắng)</span>`;
  const ta = document.createElement("textarea");
  ta.id = "dft-input";
  ta.rows = 4;
  ta.placeholder = "Ví dụ: 1, 0, -1, 0";
  ta.value = "1, 0, 0, 0";
  labIn.appendChild(ta);

  const labN = document.createElement("label");
  labN.className = "dft-field";
  labN.innerHTML = `<span>Độ dài N (≤ 16)</span>`;
  const selN = document.createElement("select");
  selN.id = "dft-n";
  labN.appendChild(selN);

  const labAlgo = document.createElement("label");
  labAlgo.className = "dft-field";
  labAlgo.innerHTML = `<span>Thuật toán</span>`;
  const selAlgo = document.createElement("select");
  selAlgo.id = "dft-algo";
  [["DFT", "DFT"], ["FFT", "FFT"]].forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    selAlgo.appendChild(o);
  });
  labAlgo.appendChild(selAlgo);

  const labFft = document.createElement("label");
  labFft.className = "dft-field";
  labFft.innerHTML = `<span>Kiểu FFT (radix‑2)</span>`;
  const selFft = document.createElement("select");
  selFft.id = "dft-fft-kind";
  [["DIT", "DIT"], ["DIF", "DIF"]].forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    selFft.appendChild(o);
  });
  selFft.disabled = true;
  labFft.appendChild(selFft);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ghost-button";
  btn.id = "dft-compute";
  btn.textContent = "Compute";

  controls.append(labIn, labN, labAlgo, labFft, btn);

  const errBox = document.createElement("div");
  errBox.className = "dft-error";
  errBox.hidden = true;

  const secTw = document.createElement("section");
  secTw.className = "dft-section";
  secTw.innerHTML = `<h3 class="dft-section-title">Ma trận twiddle W<sub>N</sub><sup>kn</sup></h3>`;
  const twHost = document.createElement("div");
  twHost.className = "dft-scroll";
  secTw.appendChild(twHost);

  const secSteps = document.createElement("section");
  secSteps.className = "dft-section";
  secSteps.innerHTML = `<h3 class="dft-section-title">Từng bước</h3>`;
  const stepsHost = document.createElement("div");
  stepsHost.className = "dft-steps";
  secSteps.appendChild(stepsHost);

  const secRes = document.createElement("section");
  secRes.className = "dft-section";
  secRes.innerHTML = `<h3 class="dft-section-title">Kết quả cuối</h3>`;
  const resHost = document.createElement("div");
  resHost.id = "dft-final";
  secRes.appendChild(resHost);

  const secCmp = document.createElement("section");
  secCmp.className = "dft-section";
  secCmp.innerHTML = `<h3 class="dft-section-title">So với fft.js (tham khảo)</h3>`;
  const cmpHost = document.createElement("div");
  cmpHost.id = "dft-compare";
  secCmp.appendChild(cmpHost);

  const secBf = document.createElement("section");
  secBf.className = "dft-section";
  secBf.innerHTML = `<h3 class="dft-section-title">Sơ đồ bướm (SVG)</h3>`;
  const bfHost = document.createElement("div");
  bfHost.className = "dft-butterfly-host";
  secBf.appendChild(bfHost);

  grid.append(
    controls,
    errBox,
    secTw,
    secSteps,
    secRes,
    secCmp,
    secBf,
  );
  root.appendChild(grid);

  function fillNOptions() {
    const algo = selAlgo.value;
    const prev = Number(selN.value);
    clearHost(selN);
    const opts =
      algo === "FFT" ? [2, 4, 8, 16] : Array.from({ length: 16 }, (_, i) => i + 1);
    for (const n of opts) {
      const o = document.createElement("option");
      o.value = String(n);
      o.textContent = String(n);
      selN.appendChild(o);
    }
    const pick = opts.includes(prev) ? prev : opts[0];
    selN.value = String(pick);
  }

  fillNOptions();

  selAlgo.addEventListener("change", () => {
    fillNOptions();
    selFft.disabled = selAlgo.value !== "FFT";
  });

  btn.addEventListener("click", () => {
    errBox.hidden = true;
    errBox.textContent = "";
    clearHost(twHost);
    clearHost(stepsHost);
    clearHost(resHost);
    clearHost(cmpHost);
    clearHost(bfHost);

    try {
      const N = Number(selN.value);
      const algo = selAlgo.value;
      const fftKind = selFft.value;
      const signal = parseSignal(ta.value, N);

      const matrix = buildTwiddleMatrix(N);
      twHost.appendChild(renderTwiddleTable(matrix));

      /** @type {Complex[]} */
      let finalSpectrum;

      if (algo === "DFT") {
        const detail = dftSteps(signal);
        for (const block of detail) {
          const blockEl = document.createElement("div");
          blockEl.className = "dft-step-block";
          const h = document.createElement("h4");
          h.className = "dft-step-heading";
          h.textContent = `k = ${block.k}`;
          blockEl.appendChild(h);
          const ol = document.createElement("ol");
          ol.className = "dft-mini-steps";
          for (const p of block.partials) {
            const li = document.createElement("li");
            li.textContent = `n = ${p.n}: đóng góp ${fmtC(p.term)} → tích lũy ${fmtC(p.acc)}`;
            ol.appendChild(li);
          }
          blockEl.appendChild(ol);
          stepsHost.appendChild(blockEl);
        }
        finalSpectrum = dft(signal);
        resHost.appendChild(renderSpectrumRow(finalSpectrum));

        if (isPowerOfTwo(N)) {
          refSpectrum = fft(signal);
          const err = maxAbsDiff(finalSpectrum, refSpectrum);
          cmpHost.appendChild(
            document.createTextNode(
              `Sai số cực đại so với fft(signal): ${err.toExponential(4)} (DFT vs FFT thư viện).`,
            ),
          );
        } else {
          cmpHost.appendChild(
            document.createTextNode(
              "fft.js chỉ hỗ trợ N lũy thừa của 2 — không so sánh được.",
            ),
          );
        }

        if (isPowerOfTwo(N)) {
          const data = generateButterflyData(N, "DIT");
          bfHost.appendChild(
            document.createTextNode(
              "Gợi ý: với DFT bạn vẫn có thể xem cấu trúc bướm DIT màn hình dưới.",
            ),
          );
          bfHost.appendChild(document.createElement("br"));
          bfHost.appendChild(renderButterflySvg(data));
        }
      } else {
        if (!isPowerOfTwo(N)) {
          throw new Error("FFT radix-2 yêu cầu N là lũy thừa của 2.");
        }
        const stages =
          fftKind === "DIT" ? simulateDit(signal, N) : simulateDif(signal, N);
        for (const st of stages) {
          const box = document.createElement("div");
          box.className = "dft-step-block";
          const h = document.createElement("h4");
          h.className = "dft-step-heading";
          h.textContent = st.title;
          box.appendChild(h);
          box.appendChild(renderSpectrumRow(st.values));
          stepsHost.appendChild(box);
        }
        finalSpectrum = stages[stages.length - 1].values;
        resHost.appendChild(renderSpectrumRow(finalSpectrum));

        refSpectrum = fft(signal);
        const err = maxAbsDiff(finalSpectrum, refSpectrum);
        cmpHost.appendChild(
          document.createTextNode(
            `Sai số cực đại so với fft(signal): ${err.toExponential(4)} (${fftKind} mô phỏng vs fft.js DIT).`,
          ),
        );

        const data = generateButterflyData(N, fftKind);
        bfHost.appendChild(renderButterflySvg(data));
      }
    } catch (e) {
      errBox.hidden = false;
      errBox.textContent =
        e instanceof Error ? e.message : "Đã xảy ra lỗi không xác định.";
    }
  });
}

initDftSimulator();
