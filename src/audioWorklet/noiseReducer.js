/**
 * Spectral subtraction với STFT N=1024, hop 50%, sqrt-Hann (COLA).
 * Phổ nhiễu trung bình |N[k]| nhận qua MessagePort (Float32Array, độ dài N/2+1).
 */

const N = 1024;
const HOP = N >> 1;
const HALF_BINS = (N >> 1) + 1;
const TWO_PI = 2 * Math.PI;
const NOISE_FLOOR_DB = -60;
const NOISE_FLOOR_LIN = Math.pow(10, NOISE_FLOOR_DB / 20);
const CLIP_TARGET = 0.92;
const LIMITER_RELEASE = 0.992;

/**
 * @param {number} n
 * @param {number} bits
 */
function reverseBits(n, bits) {
  let r = 0;
  let x = n;
  for (let b = 0; b < bits; b++) {
    r = (r << 1) | (x & 1);
    x >>>= 1;
  }
  return r;
}

/**
 * Tiền tính twiddle W_m^j = exp(-2πi·j/m), j = 0…m/2−1.
 * @param {number} fftN
 */
function precomputeTwiddles(fftN) {
  /** @type {Float32Array[]} */
  const cosByStage = [];
  /** @type {Float32Array[]} */
  const sinByStage = [];
  const bits = 31 - Math.clz32(fftN);
  for (let s = 1; s <= bits; s++) {
    const m = 1 << s;
    const half = m >> 1;
    const cosRow = new Float32Array(half);
    const sinRow = new Float32Array(half);
    const angleStep = -TWO_PI / m;
    for (let j = 0; j < half; j++) {
      const angle = angleStep * j;
      cosRow[j] = Math.cos(angle);
      sinRow[j] = Math.sin(angle);
    }
    cosByStage.push(cosRow);
    sinByStage.push(sinRow);
  }
  return { cosByStage, sinByStage, bits };
}

/**
 * FFT radix-2 DIT in-place, DFT convention exp(-2πijk/N).
 * @param {Float32Array} re
 * @param {Float32Array} im
 * @param {{ cosByStage: Float32Array[], sinByStage: Float32Array[], bits: number }} tw
 */
function fftForward(re, im, tw) {
  const bits = tw.bits;
  for (let i = 0; i < N; i++) {
    const r = reverseBits(i, bits);
    if (r > i) {
      let t = re[i];
      re[i] = re[r];
      re[r] = t;
      t = im[i];
      im[i] = im[r];
      im[r] = t;
    }
  }

  for (let s = 1; s <= bits; s++) {
    const m = 1 << s;
    const half = m >> 1;
    const Wc = tw.cosByStage[s - 1];
    const Ws = tw.sinByStage[s - 1];
    for (let k = 0; k < N; k += m) {
      for (let j = 0; j < half; j++) {
        const idx = k + j;
        const uR = re[idx];
        const uI = im[idx];
        const vR = re[idx + half];
        const vI = im[idx + half];
        const wr = Wc[j];
        const wi = Ws[j];
        const tR = vR * wr - vI * wi;
        const tI = vR * wi + vI * wr;
        re[idx] = uR + tR;
        im[idx] = uI + tI;
        re[idx + half] = uR - tR;
        im[idx + half] = uI - tI;
      }
    }
  }
}

/**
 * IFFT: conj(FFT(conj(X))) / N.
 * @param {Float32Array} re
 * @param {Float32Array} im
 * @param {{ cosByStage: Float32Array[], sinByStage: Float32Array[], bits: number }} tw
 */
function fftInverse(re, im, tw) {
  for (let i = 0; i < N; i++) {
    im[i] = -im[i];
  }
  fftForward(re, im, tw);
  const scale = 1 / N;
  for (let i = 0; i < N; i++) {
    re[i] = re[i] * scale;
    im[i] = -im[i] * scale;
  }
}

/**
 * Cửa sổ sqrt-Hann (COLA với hop 50%).
 * @returns {Float32Array}
 */
function makeSqrtHann() {
  const w = new Float32Array(N);
  if (N === 1) {
    w[0] = 1;
    return w;
  }
  const denom = N - 1;
  for (let n = 0; n < N; n++) {
    const h = 0.5 * (1 - Math.cos((TWO_PI * n) / denom));
    w[n] = Math.sqrt(Math.max(0, h));
  }
  return w;
}

class NoiseReducerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tw = precomputeTwiddles(N);
    this.win = makeSqrtHann();
    /** @type {Float32Array} */
    this.noiseMag = new Float32Array(HALF_BINS);
    this.alpha = 2.5;
    this.inQueue = new Float32Array(65536);
    this.qLen = 0;
    this.ola = new Float32Array(N);
    this.outFifo = new Float32Array(16384);
    this.fifoR = 0;
    this.fifoW = 0;
    this.fifoCount = 0;
    this.re = new Float32Array(N);
    this.im = new Float32Array(N);
    this.limiterEnv = 0;

    this.port.onmessage = (ev) => {
      const d = ev.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "noiseProfile" && d.mags instanceof Float32Array) {
        const m = d.mags;
        const n = Math.min(HALF_BINS, m.length);
        for (let i = 0; i < n; i++) {
          this.noiseMag[i] = m[i];
        }
        for (let i = n; i < HALF_BINS; i++) {
          this.noiseMag[i] = 0;
        }
      } else if (d.type === "alpha" && typeof d.value === "number") {
        this.alpha = Math.max(2, Math.min(4, d.value));
      } else if (d.type === "reset") {
        this.qLen = 0;
        this.ola.fill(0);
        this.fifoR = 0;
        this.fifoW = 0;
        this.fifoCount = 0;
        this.limiterEnv = 0;
      }
    };
  }

  /**
   * @param {number} x
   */
  pushFifo(x) {
    if (this.fifoCount >= this.outFifo.length) {
      this.fifoR = (this.fifoR + 1) % this.outFifo.length;
      this.fifoCount--;
    }
    this.outFifo[this.fifoW] = x;
    this.fifoW = (this.fifoW + 1) % this.outFifo.length;
    this.fifoCount++;
  }

  /**
   * @returns {number}
   */
  popFifo() {
    if (this.fifoCount === 0) return 0;
    const v = this.outFifo[this.fifoR];
    this.fifoR = (this.fifoR + 1) % this.outFifo.length;
    this.fifoCount--;
    return v;
  }

  processFrame() {
    for (let i = 0; i < N; i++) {
      const x = this.inQueue[i] * this.win[i];
      this.re[i] = x;
      this.im[i] = 0;
    }

    fftForward(this.re, this.im, this.tw);

    let maxBin = 1e-12;
    for (let k = 0; k < HALF_BINS; k++) {
      const m = Math.hypot(this.re[k], this.im[k]);
      if (m > maxBin) maxBin = m;
    }
    const floorLin = Math.max(1e-10, NOISE_FLOOR_LIN * maxBin);

    for (let k = 0; k < HALF_BINS; k++) {
      const xr = this.re[k];
      const xi = this.im[k];
      const magX = Math.hypot(xr, xi);
      const phase = Math.atan2(xi, xr);
      const nk = this.noiseMag[k] || 0;
      let magS = magX - this.alpha * nk;
      if (magS < floorLin) magS = floorLin;
      this.re[k] = magS * Math.cos(phase);
      this.im[k] = magS * Math.sin(phase);
    }

    const ny = N >> 1;
    for (let k = ny + 1; k < N; k++) {
      const km = N - k;
      this.re[k] = this.re[km];
      this.im[k] = -this.im[km];
    }

    fftInverse(this.re, this.im, this.tw);

    for (let n = 0; n < N; n++) {
      const yn = this.re[n] * this.win[n];
      this.ola[n] += yn;
    }

    for (let h = 0; h < HOP; h++) {
      let y = this.ola[h];
      const a = Math.abs(y);
      this.limiterEnv = Math.max(a, this.limiterEnv * LIMITER_RELEASE);
      if (this.limiterEnv > CLIP_TARGET) {
        y *= CLIP_TARGET / this.limiterEnv;
      }
      this.pushFifo(y);
    }

    for (let n = 0; n < N - HOP; n++) {
      this.ola[n] = this.ola[n + HOP];
    }
    for (let n = N - HOP; n < N; n++) {
      this.ola[n] = 0;
    }
  }

  /**
   * @param {Float32Array[][]} inputs
   * @param {Float32Array[][]} outputs
   */
  process(inputs, outputs) {
    const inCh = inputs[0]?.[0];
    const outCh = outputs[0]?.[0];
    if (!inCh || !outCh) {
      outCh?.fill(0);
      return true;
    }

    const block = inCh.length;
    for (let i = 0; i < block; i++) {
      if (this.qLen >= this.inQueue.length - N) {
        this.qLen = 0;
      }
      this.inQueue[this.qLen++] = inCh[i];
      while (this.qLen >= N) {
        this.processFrame();
        for (let j = 0; j < this.qLen - HOP; j++) {
          this.inQueue[j] = this.inQueue[j + HOP];
        }
        this.qLen -= HOP;
      }
    }

    for (let i = 0; i < block; i++) {
      outCh[i] = this.popFifo();
    }

    return true;
  }
}

registerProcessor("noise-reducer", NoiseReducerProcessor);
