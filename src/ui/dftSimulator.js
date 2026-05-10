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
 * Giống `fft.js` (dsp): W_m^j = exp(−2πj·j/m) lưu dạng Complex(cos θ, sin θ), θ = −2πj/m.
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
 * Phức: N cặp `re,im` tách nhau bằng `;` hoặc xuống dòng (phần thập phân dùng dấu chấm).
 * @param {string} text
 * @param {number} N
 * @returns {Complex[]}
 */
function parseComplexDelimited(text, N) {
  const chunks = text
    .split(/[;\n]+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  if (chunks.length !== N) {
    throw new Error(
      `Chế độ phức: cần đúng ${N} cặp re,im (tách bằng «;» hoặc xuống dòng), hiện có ${chunks.length}.`,
    );
  }
  /** @type {Complex[]} */
  const out = [];
  for (let i = 0; i < N; i++) {
    const parts = chunks[i].split(/[, ]+/u).filter(Boolean);
    if (parts.length !== 2) {
      throw new Error(
        `Cặp ${i + 1}: cần đúng hai số re,im (ví dụ «1, 0» hoặc «0.5 -0.25»).`,
      );
    }
    const re = Number(parts[0]);
    const im = Number(parts[1]);
    if (!Number.isFinite(re) || !Number.isFinite(im)) {
      throw new Error(`Cặp ${i + 1}: re hoặc im không hợp lệ.`);
    }
    out.push(new Complex(re, im));
  }
  return out;
}

/**
 * @param {Float64Array} signal
 * @returns {Complex[]}
 */
function toComplexFromReal(signal) {
  return Array.from(signal, (v) => new Complex(v, 0));
}

/**
 * @param {Complex[]} x
 * @returns {boolean}
 */
function isEffectivelyReal(x) {
  return x.every((c) => Math.abs(c.im) < 1e-12);
}

/**
 * DFT O(N²) cho tín hiệu phức (cùng định nghĩa với `dsp/dft.js` nhưng x[n] phức).
 * @param {Complex[]} x
 * @returns {Complex[]}
 */
function dftFromComplex(x) {
  const N = x.length;
  if (N === 0) return [];

  /** @type {Complex[]} */
  const W = new Array(N);
  const twoPiOverN = TWO_PI / N;
  for (let m = 0; m < N; m++) {
    W[m] = Complex.fromPolar(1, -twoPiOverN * m);
  }

  /** @type {Complex[]} */
  const spectrum = new Array(N);
  for (let k = 0; k < N; k++) {
    let acc = new Complex(0, 0);
    for (let n = 0; n < N; n++) {
      const idx = (k * n) % N;
      acc = acc.add(W[idx].mul(x[n]));
    }
    spectrum[k] = acc;
  }
  return spectrum;
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
 * @param {Complex[]} seqIn — x[0]…x[N−1] miền thời gian
 * @param {number} N
 */
function simulateDit(seqIn, N) {
  const bits = Math.trunc(Math.log2(N));
  const tw = precomputeDitTwiddles(N);
  /** @type {Complex[]} */
  const seq = [];
  for (let i = 0; i < N; i++) seq.push(new Complex(seqIn[i].re, seqIn[i].im));

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
 * @param {Complex[]} seqIn — x[0]…x[N−1] miền thời gian
 * @param {number} N
 */
function simulateDif(seqIn, N) {
  const bits = Math.trunc(Math.log2(N));
  /** @type {Complex[]} */
  const A = [];
  for (let i = 0; i < N; i++) A.push(new Complex(seqIn[i].re, seqIn[i].im));

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
 * @param {Complex[]} x — mẫu miền thời gian (thực hoặc phức)
 */
function dftStepsFromSequence(x) {
  const N = x.length;
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
      const term = W[idx].mul(x[n]);
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

/**
 * @param {HTMLElement} root
 * @returns {() => void}
 */
function mountDftSimulator(root) {
  root.innerHTML = "";

  const ac = new AbortController();
  const { signal } = ac;

  const grid = document.createElement("div");
  grid.className = "dft-grid";

  const controlsStack = document.createElement("div");
  controlsStack.className = "dft-controls-stack";

  const controlsTop = document.createElement("div");
  controlsTop.className = "dft-controls dft-controls-top";

  const controlsStepWrap = document.createElement("div");
  controlsStepWrap.className = "dft-controls-full-width";

  const controlsInputWrap = document.createElement("div");
  controlsInputWrap.className = "dft-controls-full-width";

  const computeRow = document.createElement("div");
  computeRow.className = "dft-compute-row";

  /**
   * @param {HTMLSelectElement} select
   * @param {readonly (readonly [string, string])[]} options
   * @param {string} ariaLabel
   */
  function createChoiceToggle(select, options, ariaLabel) {
    select.hidden = true;
    const wrap = document.createElement("div");
    wrap.className = "dft-choice-toggle";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", ariaLabel);

    /** @type {HTMLButtonElement[]} */
    const buttons = [];

    function sync() {
      for (const btn of buttons) {
        const on = btn.dataset.value === select.value;
        btn.classList.toggle("is-selected", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        btn.disabled = select.disabled;
      }
    }

    for (const [value, title] of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dft-choice-btn";
      btn.dataset.value = value;
      btn.textContent = title;
      btn.addEventListener(
        "click",
        () => {
          if (select.disabled || select.value === value) return;
          select.value = value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        },
        { signal },
      );
      buttons.push(btn);
      wrap.appendChild(btn);
    }

    select.addEventListener("change", sync, { signal });
    sync();
    return { wrap, sync };
  }

  const labMode = document.createElement("label");
  labMode.className = "dft-field";
  labMode.innerHTML = `<span>Kiểu nhập tín hiệu</span>`;
  const selInputMode = document.createElement("select");
  selInputMode.id = "dft-input-mode";
  selInputMode.setAttribute("aria-label", "Kiểu nhập tín hiệu DFT");
  const optReal = document.createElement("option");
  optReal.value = "real";
  optReal.textContent = "Thực: N giá trị (phẩy / khoảng trắng)";
  const optComplex = document.createElement("option");
  optComplex.value = "complex";
  optComplex.textContent = "Phức: N cặp re,im (tách cặp bằng «;» hoặc xuống dòng)";
  selInputMode.append(optReal, optComplex);
  const inputModeChoice = createChoiceToggle(
    selInputMode,
    [
      ["real", "Thực"],
      ["complex", "Phức"],
    ],
    "Kiểu nhập tín hiệu DFT",
  );
  labMode.append(selInputMode, inputModeChoice.wrap);

  const labIn = document.createElement("label");
  labIn.className = "dft-field";
  const spanIn = document.createElement("span");
  spanIn.id = "dft-input-hint";
  spanIn.textContent =
    "Dãy mẫu thực (phân tách bằng dấu phẩy hoặc khoảng trắng)";
  labIn.appendChild(spanIn);
  const ta = document.createElement("textarea");
  ta.id = "dft-input";
  ta.rows = 4;
  ta.placeholder = "Ví dụ: 1, 0, -1, 0";
  ta.value = "1, 0, 0, 0";
  labIn.appendChild(ta);

  function syncInputHint() {
    const complex = selInputMode.value === "complex";
    spanIn.textContent = complex
      ? "N cặp re,im — mỗi cặp một dòng hoặc cách nhau bằng «;» (phần thập phân dùng dấu chấm)"
      : "Dãy mẫu thực (phân tách bằng dấu phẩy hoặc khoảng trắng)";
    ta.placeholder = complex
      ? "Ví dụ N=4: 1,0; 0,1; -1,0; 0,-1"
      : "Ví dụ: 1, 0, -1, 0";
  }
  syncInputHint();

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
  const algoChoice = createChoiceToggle(
    selAlgo,
    [
      ["DFT", "DFT"],
      ["FFT", "FFT"],
    ],
    "Thuật toán",
  );
  labAlgo.append(selAlgo, algoChoice.wrap);

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
  const fftChoice = createChoiceToggle(
    selFft,
    [
      ["DIT", "DIT"],
      ["DIF", "DIF"],
    ],
    "Kiểu FFT radix-2",
  );
  labFft.append(selFft, fftChoice.wrap);

  const labStep = document.createElement("label");
  labStep.className = "dft-field dft-field-row";
  const chkStepK = document.createElement("input");
  chkStepK.type = "checkbox";
  chkStepK.id = "dft-step-k";
  const spanStep = document.createElement("span");
  spanStep.textContent = "DFT: xem từng bước theo k";
  labStep.append(chkStepK, spanStep);

  const stepBar = document.createElement("div");
  stepBar.className = "dft-step-nav";
  stepBar.hidden = true;
  const btnStepPrev = document.createElement("button");
  btnStepPrev.type = "button";
  btnStepPrev.className = "ghost-button";
  btnStepPrev.textContent = "← k trước";
  const stepReadout = document.createElement("span");
  stepReadout.className = "dft-step-readout";
  const btnStepNext = document.createElement("button");
  btnStepNext.type = "button";
  btnStepNext.className = "ghost-button";
  btnStepNext.textContent = "k sau →";
  stepBar.append(btnStepPrev, stepReadout, btnStepNext);

  /** @type {{ detail: ReturnType<typeof dftStepsFromSequence>, seq0: Complex[], N: number } | null} */
  let dftStepSession = null;
  /** @type {number} */
  let dftStepIdx = 0;

  function renderOneDftBlock(block) {
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
    return blockEl;
  }

  function refreshDftStepUi() {
    if (!dftStepSession) return;
    const { detail, N } = dftStepSession;
    clearHost(stepsHost);
    stepsHost.appendChild(renderOneDftBlock(detail[dftStepIdx]));
    stepReadout.textContent = `k = ${dftStepIdx} / ${N - 1}`;
    btnStepPrev.disabled = dftStepIdx <= 0;
    btnStepNext.disabled = dftStepIdx >= N - 1;
  }

  /**
   * @param {Complex[]} finalSpectrum
   * @param {Complex[]} seq0
   * @param {Float64Array} reals — phần thực của seq0 (dùng cho fft() khi tín hiệu thuần thực)
   * @param {boolean} allReal
   */
  function appendDftCompareAndButterfly(
    finalSpectrum,
    seq0,
    reals,
    allReal,
    N,
    algo,
    fftKind,
  ) {
    if (isPowerOfTwo(N)) {
      const refSpectrum = allReal ? fft(reals) : dftFromComplex(seq0);
      const err = maxAbsDiff(finalSpectrum, refSpectrum);
      const refLabel = allReal
        ? "fft(samples) trong dsp (N thực)"
        : "DFT O(N²) tín hiệu phức (tham chiếu)";
      cmpHost.appendChild(
        document.createTextNode(
          algo === "DFT"
            ? `Sai số cực đại so với ${refLabel}: ${err.toExponential(4)} (DFT vs tham chiếu).`
            : `Sai số cực đại so với ${refLabel}: ${err.toExponential(4)} (${fftKind} mô phỏng vs tham chiếu).`,
        ),
      );
    } else {
      cmpHost.appendChild(
        document.createTextNode(
          "FFT radix-2 trong dsp chỉ hỗ trợ N lũy thừa của 2 — không so sánh được.",
        ),
      );
    }

    if (isPowerOfTwo(N)) {
      if (algo === "DFT") {
        const data = generateButterflyData(N, "DIT");
        bfHost.appendChild(renderButterflySvg(data));
      } else {
        const data = generateButterflyData(N, fftKind);
        bfHost.appendChild(renderButterflySvg(data));
      }
    }
  }

  function finishDftStepSession() {
    if (!dftStepSession) return;
    const { detail, seq0, N } = dftStepSession;
    const specFromBlocks = detail.map((b) => b.Xk);
    const reals = Float64Array.from(seq0.map((c) => c.re));
    const allReal = isEffectivelyReal(seq0);
    resHost.appendChild(renderSpectrumRow(specFromBlocks));
    appendDftCompareAndButterfly(
      specFromBlocks,
      seq0,
      reals,
      allReal,
      N,
      "DFT",
      "DIT",
    );
    dftStepSession = null;
    stepBar.hidden = true;
  }

  btnStepPrev.addEventListener(
    "click",
    () => {
      if (!dftStepSession || dftStepIdx <= 0) return;
      dftStepIdx--;
      refreshDftStepUi();
    },
    { signal },
  );

  btnStepNext.addEventListener(
    "click",
    () => {
      if (!dftStepSession) return;
      const { N } = dftStepSession;
      if (dftStepIdx >= N - 1) return;
      dftStepIdx++;
      refreshDftStepUi();
      if (dftStepIdx === N - 1) {
        finishDftStepSession();
      }
    },
    { signal },
  );

  chkStepK.addEventListener(
    "change",
    () => {
      if (!chkStepK.checked) {
        dftStepSession = null;
        stepBar.hidden = true;
      }
    },
    { signal },
  );

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ghost-button dft-compute-primary";
  btn.id = "dft-compute";
  btn.textContent = "Compute";

  controlsTop.append(labMode, labN, labAlgo, labFft);
  controlsStepWrap.append(labStep, stepBar);
  controlsInputWrap.append(labIn);
  computeRow.append(btn);
  controlsStack.append(
    controlsTop,
    controlsStepWrap,
    controlsInputWrap,
    computeRow,
  );

  selInputMode.addEventListener(
    "change",
    () => {
      syncInputHint();
    },
    { signal },
  );

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
  secCmp.innerHTML = `<h3 class="dft-section-title">So với FFT radix-2 (dsp)</h3>`;
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
    controlsStack,
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

  selAlgo.addEventListener(
    "change",
    () => {
      fillNOptions();
      selFft.disabled = selAlgo.value !== "FFT";
      fftChoice.sync();
      chkStepK.disabled = selAlgo.value !== "DFT";
      if (chkStepK.disabled) {
        chkStepK.checked = false;
        dftStepSession = null;
        stepBar.hidden = true;
      }
      algoChoice.sync();
    },
    { signal },
  );

  btn.addEventListener(
    "click",
    () => {
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
      const useComplex = selInputMode.value === "complex";
      /** @type {Complex[]} */
      const seq0 = useComplex
        ? parseComplexDelimited(ta.value, N)
        : toComplexFromReal(parseSignal(ta.value, N));
      const reals = Float64Array.from(seq0.map((c) => c.re));
      const allReal = isEffectivelyReal(seq0);

      const matrix = buildTwiddleMatrix(N);
      twHost.appendChild(renderTwiddleTable(matrix));

      /** @type {Complex[]} */
      let finalSpectrum;

      if (algo === "DFT") {
        const detail = dftStepsFromSequence(seq0);
        finalSpectrum = allReal ? dft(reals) : dftFromComplex(seq0);

        if (chkStepK.checked) {
          dftStepSession = { detail, seq0, N };
          dftStepIdx = 0;
          stepBar.hidden = false;
          refreshDftStepUi();
          if (N === 1) {
            finishDftStepSession();
          }
        } else {
          dftStepSession = null;
          stepBar.hidden = true;
          for (const block of detail) {
            stepsHost.appendChild(renderOneDftBlock(block));
          }
          resHost.appendChild(renderSpectrumRow(finalSpectrum));
          appendDftCompareAndButterfly(
            finalSpectrum,
            seq0,
            reals,
            allReal,
            N,
            "DFT",
            "DIT",
          );
        }
      } else {
        if (!isPowerOfTwo(N)) {
          throw new Error("FFT radix-2 yêu cầu N là lũy thừa của 2.");
        }
        const stages =
          fftKind === "DIT" ? simulateDit(seq0, N) : simulateDif(seq0, N);
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

        appendDftCompareAndButterfly(
          finalSpectrum,
          seq0,
          reals,
          allReal,
          N,
          "FFT",
          fftKind,
        );
      }
    } catch (e) {
      errBox.hidden = false;
      errBox.textContent =
        e instanceof Error ? e.message : "Đã xảy ra lỗi không xác định.";
    }
    },
    { signal },
  );

  return () => {
    ac.abort();
    root.innerHTML = "";
  };
}

/**
 * Chế độ DFT/FFT: không dùng AudioContext real-time.
 * @returns {{ id: string, isRealtimeAudio: boolean, enter: () => void, exit: () => void }}
 */
export function createDftSimulatorMode() {
  /** @type {(() => void) | null} */
  let teardown = null;

  return {
    id: "simulator",
    isRealtimeAudio: false,
    enter() {
      const root = document.getElementById("dft-simulator");
      if (!root) return;
      if (!teardown) {
        teardown = mountDftSimulator(root);
      }
    },
    exit() {
      teardown?.();
      teardown = null;
    },
  };
}
