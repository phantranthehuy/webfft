import * as dsp from "../dsp.js";
import { hanning } from "../dsp/stft.js";
import {
  ensureMicStream,
  getSharedAudioContext,
  hasLiveMicStream,
  resumeSharedAudioContext,
} from "../audioEngine.js";

const FFT_N = 1024;
const HOP = FFT_N >> 1;
const HALF_BINS = (FFT_N >> 1) + 1;
const SAMPLE_SEC = 1.5;
const ALPHA_MIN = 2;
const ALPHA_MAX = 4;

/** @type {HTMLStyleElement | null} */
let injectedStyle = null;

function injectStyles() {
  if (injectedStyle) return;
  injectedStyle = document.createElement("style");
  injectedStyle.id = "noise-reduction-styles";
  injectedStyle.textContent = `
    .nr-root { display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 100%; min-width: 0; }
    .nr-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      box-sizing: border-box;
    }
    .nr-section-title { margin: 0; font-size: 13px; font-weight: 600; color: var(--text); letter-spacing: 0.02em; }
    .nr-section-body { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; width: 100%; min-width: 0; }
    label.nr-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); flex: 1 1 220px; min-width: 0; }
    .nr-field input[type="range"] { width: 100%; max-width: 100%; accent-color: var(--accent); }
    .nr-section > button.ghost-button { width: 100%; box-sizing: border-box; }
    .nr-readout { font-size: 13px; color: var(--muted); margin: 0; min-height: 2.5em; width: 100%; max-width: 100%; }
  `;
  document.head.appendChild(injectedStyle);
}

/**
 * @param {Float32Array} mono
 * @param {number} sampleRate
 * @returns {Blob}
 */
function encodeWavMono16(mono, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample >> 3;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const numSamples = mono.length;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buffer);
  let o = 0;
  const wStr = (s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o++, s.charCodeAt(i));
  };
  wStr("RIFF");
  v.setUint32(o, 36 + dataSize, true);
  o += 4;
  wStr("WAVE");
  wStr("fmt ");
  v.setUint32(o, 16, true);
  o += 4;
  v.setUint16(o, 1, true);
  o += 2;
  v.setUint16(o, numChannels, true);
  o += 2;
  v.setUint32(o, sampleRate, true);
  o += 4;
  v.setUint32(o, byteRate, true);
  o += 4;
  v.setUint16(o, blockAlign, true);
  o += 2;
  v.setUint16(o, bitsPerSample, true);
  o += 2;
  wStr("data");
  v.setUint32(o, dataSize, true);
  o += 4;
  for (let i = 0; i < numSamples; i++) {
    let s = mono[i];
    s = Math.max(-1, Math.min(1, s));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Gộp Float32Array từ các chunk ScriptProcessor.
 * @param {Float32Array[]} parts
 * @param {number} maxLen
 * @returns {Float32Array}
 */
function concatFloat32(parts, maxLen) {
  let total = 0;
  for (const p of parts) {
    total += p.length;
  }
  const n = Math.min(total, maxLen);
  const out = new Float32Array(n);
  let w = 0;
  for (const p of parts) {
    const take = Math.min(p.length, n - w);
    out.set(p.subarray(0, take), w);
    w += take;
    if (w >= n) break;
  }
  return out;
}

/**
 * Trung bình biên độ phổ nhiễu (Hann, hop 50%, dsp.fft).
 * @param {Float32Array} mono
 * @param {number} sampleRate
 * @returns {Float32Array | null}
 */
function averageNoiseSpectrum(mono, sampleRate) {
  if (mono.length < FFT_N) return null;
  const win = hanning(FFT_N);
  /** @type {Float64Array} */
  const sumMag = new Float64Array(HALF_BINS);
  let frames = 0;
  for (let start = 0; start + FFT_N <= mono.length; start += HOP) {
    const sig = new Float64Array(FFT_N);
    for (let i = 0; i < FFT_N; i++) {
      sig[i] = mono[start + i] * win[i];
    }
    const spec = dsp.fft(sig);
    for (let k = 0; k < HALF_BINS; k++) {
      const c = spec[k];
      sumMag[k] += Math.hypot(c.re, c.im);
    }
    frames++;
  }
  if (frames === 0) return null;
  const avg = new Float32Array(HALF_BINS);
  for (let k = 0; k < HALF_BINS; k++) {
    avg[k] = sumMag[k] / frames;
  }
  void sampleRate;
  return avg;
}

/**
 * @param {AudioContext} ctx
 * @param {MediaStreamAudioSourceNode} micSrc
 * @param {number} targetSamples
 * @returns {Promise<Float32Array>}
 */
function captureMonoPcmWorklet(ctx, micSrc, targetSamples) {
  const url = new URL("../audioWorklet/pcmCapture.js", import.meta.url);
  return ctx.audioWorklet.addModule(url).then(
    () =>
      new Promise((resolve, reject) => {
        /** @type {AudioWorkletNode | undefined} */
        let node;
        /** @type {GainNode | undefined} */
        let mute;
        const timeoutMs = Math.ceil((targetSamples / ctx.sampleRate) * 1000) + 4000;
        const to = setTimeout(() => {
          cleanup();
          reject(new Error("Timeout khi ghi PCM (worklet)."));
        }, timeoutMs);

        function cleanup() {
          clearTimeout(to);
          try {
            if (node) micSrc.disconnect(node);
          } catch {
            /* ignore */
          }
          try {
            node?.disconnect();
          } catch {
            /* ignore */
          }
          try {
            mute?.disconnect();
          } catch {
            /* ignore */
          }
        }

        try {
          node = new AudioWorkletNode(ctx, "pcm-capture", {
            processorOptions: { targetSamples },
            numberOfInputs: 1,
            numberOfOutputs: 1,
            channelCount: 1,
            outputChannelCount: [1],
          });
          mute = ctx.createGain();
          mute.gain.value = 0;
          node.port.onmessage = (ev) => {
            if (
              ev.data?.type === "captured" &&
              ev.data.buffer instanceof Float32Array
            ) {
              cleanup();
              resolve(ev.data.buffer);
            }
          };
          micSrc.connect(node);
          node.connect(mute);
          mute.connect(ctx.destination);
        } catch (e) {
          clearTimeout(to);
          cleanup();
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }),
  );
}

/**
 * Fallback: ScriptProcessor (deprecated).
 * @param {AudioContext} ctx
 * @param {MediaStreamAudioSourceNode} micSrc
 * @param {number} durationSec
 * @returns {Promise<Float32Array>}
 */
function captureMonoPcmScript(ctx, micSrc, durationSec) {
  return new Promise((resolve, reject) => {
    const bufSize = 4096;
    if (typeof ctx.createScriptProcessor !== "function") {
      reject(new Error("Trình duyệt không hỗ trợ capture PCM (ScriptProcessor)."));
      return;
    }

    /** @type {Float32Array[]} */
    const chunks = [];
    const maxSamp = Math.floor(ctx.sampleRate * durationSec);
    const proc = ctx.createScriptProcessor(bufSize, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    let total = 0;

    proc.onaudioprocess = (ev) => {
      const ch0 = ev.inputBuffer.getChannelData(0);
      const copy = new Float32Array(ch0.length);
      copy.set(ch0);
      chunks.push(copy);
      total += ch0.length;
      if (total >= maxSamp) {
        proc.onaudioprocess = null;
        try {
          micSrc.disconnect(proc);
        } catch {
          /* ignore */
        }
        try {
          proc.disconnect();
        } catch {
          /* ignore */
        }
        try {
          mute.disconnect();
        } catch {
          /* ignore */
        }
        resolve(concatFloat32(chunks, maxSamp));
      }
    };

    try {
      micSrc.connect(proc);
      proc.connect(mute);
      mute.connect(ctx.destination);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * Ghi PCM tại sampleRate của AudioContext (ưu tiên AudioWorklet).
 * @param {AudioContext} ctx
 * @param {MediaStreamAudioSourceNode} micSrc
 * @param {number} durationSec
 * @returns {Promise<Float32Array>}
 */
async function captureMonoPcm(ctx, micSrc, durationSec) {
  const maxSamp = Math.floor(ctx.sampleRate * durationSec);
  if (typeof AudioWorkletNode === "function" && ctx.audioWorklet) {
    try {
      return await captureMonoPcmWorklet(ctx, micSrc, maxSamp);
    } catch {
      /* fallback */
    }
  }
  if (typeof ctx.createScriptProcessor === "function") {
    return captureMonoPcmScript(ctx, micSrc, durationSec);
  }
  throw new Error(
    "Không hỗ trợ AudioWorklet hoặc ScriptProcessor để ghi PCM.",
  );
}

/**
 * @param {HTMLElement} root
 * @returns {() => void}
 */
function mountNoiseReduction(root) {
  injectStyles();
  const ac = new AbortController();
  const { signal } = ac;

  root.classList.add("nr-root");
  root.innerHTML = "";

  const secNoise = document.createElement("section");
  secNoise.className = "nr-section";
  const titleNoise = document.createElement("h3");
  titleNoise.className = "nr-section-title";
  titleNoise.textContent = "Bước 1 — Ghi mẫu nhiễu";
  const sampleBtn = document.createElement("button");
  sampleBtn.type = "button";
  sampleBtn.className = "ghost-button";
  sampleBtn.textContent = "Ghi mẫu nhiễu (~1.5 s)";
  sampleBtn.setAttribute(
    "aria-label",
    "Ghi khoảng 1,5 giây chỉ có nhiễu để ước lượng phổ trung bình",
  );
  secNoise.append(titleNoise, sampleBtn);

  const secNr = document.createElement("section");
  secNr.className = "nr-section";
  const titleNr = document.createElement("h3");
  titleNr.className = "nr-section-title";
  titleNr.textContent = "Bước 2 — Khử nhiễu (trừ phổ)";
  const bodyNr = document.createElement("div");
  bodyNr.className = "nr-section-body";

  const alphaWrap = document.createElement("label");
  alphaWrap.className = "nr-field";
  const alphaLabel = document.createElement("span");
  alphaLabel.id = "nr-alpha-label";
  alphaLabel.textContent = "Hệ số α (trừ phổ): 2.5";
  const alphaRange = document.createElement("input");
  alphaRange.type = "range";
  alphaRange.min = String(ALPHA_MIN);
  alphaRange.max = String(ALPHA_MAX);
  alphaRange.step = "0.05";
  alphaRange.value = "2.5";
  alphaRange.setAttribute("aria-labelledby", "nr-alpha-label");
  alphaWrap.append(alphaLabel, alphaRange);

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "ghost-button";
  toggleBtn.textContent = "Khử nhiễu: bật";
  toggleBtn.setAttribute("aria-pressed", "false");

  bodyNr.append(alphaWrap, toggleBtn);
  secNr.append(titleNr, bodyNr);

  const secOut = document.createElement("section");
  secOut.className = "nr-section";
  const titleOut = document.createElement("h3");
  titleOut.className = "nr-section-title";
  titleOut.textContent = "Bước 3 — Xuất âm thanh";
  const recBtn = document.createElement("button");
  recBtn.type = "button";
  recBtn.className = "ghost-button";
  recBtn.textContent = "Ghi đầu ra 5 s → tải WAV";
  recBtn.disabled = true;
  secOut.append(titleOut, recBtn);

  const statusEl = document.createElement("p");
  statusEl.className = "nr-readout";
  statusEl.textContent =
    "Cần icon micro góc trái dưới hoặc «Ghi mẫu nhiễu» để có micro. Phổ nhiễu: dsp.fft + Hann; xử lý 1024 mẫu/khung trong worklet.";

  root.append(secNoise, secNr, secOut, statusEl);

  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {MediaStreamAudioSourceNode | null} */
  let micSrc = null;
  /** @type {GainNode | null} */
  let monitorGain = null;
  /** @type {AudioWorkletNode | null} */
  let reducerNode = null;
  /** @type {Float32Array | null} */
  let noiseProfile = null;
  /** @type {MediaRecorder | null} */
  let mediaRecorder = null;
  /** @type {Blob[]} */
  let recChunks = [];
  /** @type {MediaStreamAudioDestinationNode | null} */
  let recDest = null;

  let nrEnabled = false;
  let isSampling = false;
  let isRecording = false;

  function isNoisePanelVisible() {
    const panel = document.getElementById("panel-noise");
    return Boolean(panel && !panel.hidden);
  }

  function disconnectReducer() {
    if (reducerNode) {
      try {
        reducerNode.port.postMessage({ type: "reset" });
      } catch {
        /* ignore */
      }
      try {
        reducerNode.disconnect();
      } catch {
        /* ignore */
      }
      reducerNode = null;
    }
    if (micSrc && monitorGain) {
      try {
        micSrc.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  function wireBypassMonitoring() {
    if (!ctx || !micSrc || !monitorGain) return;
    disconnectReducer();
    try {
      micSrc.disconnect();
    } catch {
      /* ignore */
    }
    micSrc.connect(monitorGain);
  }

  async function ensureReducerNode() {
    if (!ctx) return null;
    if (reducerNode) return reducerNode;
    const url = new URL("../audioWorklet/noiseReducer.js", import.meta.url);
    await ctx.audioWorklet.addModule(url);
    reducerNode = new AudioWorkletNode(ctx, "noise-reducer", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      outputChannelCount: [1],
    });
    if (noiseProfile) {
      const send = noiseProfile.slice();
      reducerNode.port.postMessage(
        { type: "noiseProfile", mags: send },
        [send.buffer],
      );
    }
    const a = Number(alphaRange.value);
    reducerNode.port.postMessage({
      type: "alpha",
      value: Math.max(ALPHA_MIN, Math.min(ALPHA_MAX, a)),
    });
    return reducerNode;
  }

  async function wireNoiseReduction() {
    if (!ctx || !micSrc || !monitorGain) return;
    const node = await ensureReducerNode();
    if (!node) return;
    try {
      micSrc.disconnect();
    } catch {
      /* ignore */
    }
    micSrc.connect(node);
    node.connect(monitorGain);
  }

  function teardownAll() {
    disconnectReducer();
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try {
        mediaRecorder.stop();
      } catch {
        /* ignore */
      }
    }
    mediaRecorder = null;
    recChunks = [];
    if (recDest) {
      try {
        recDest.disconnect();
      } catch {
        /* ignore */
      }
      recDest = null;
    }
    if (micSrc) {
      try {
        micSrc.disconnect();
      } catch {
        /* ignore */
      }
      micSrc = null;
    }
    if (monitorGain) {
      try {
        monitorGain.disconnect();
      } catch {
        /* ignore */
      }
      monitorGain = null;
    }
    ctx = null;
    nrEnabled = false;
    toggleBtn.textContent = "Khử nhiễu: bật";
    toggleBtn.setAttribute("aria-pressed", "false");
    recBtn.disabled = true;
  }

  alphaRange.addEventListener(
    "input",
    () => {
    const v = Number(alphaRange.value);
    alphaLabel.textContent = `Hệ số α (trừ phổ): ${v.toFixed(2)}`;
    reducerNode?.port.postMessage({
      type: "alpha",
      value: Math.max(ALPHA_MIN, Math.min(ALPHA_MAX, v)),
    });
    },
    { signal },
  );

  sampleBtn.addEventListener(
    "click",
    async () => {
    if (isSampling) return;
    isSampling = true;
    sampleBtn.disabled = true;
    statusEl.textContent = "Đang ghi nhiễu… giữ yên môi trường ~1.5 s.";
    try {
      disconnectReducer();
      if (micSrc) {
        try {
          micSrc.disconnect();
        } catch {
          /* ignore */
        }
        micSrc = null;
      }
      if (monitorGain) {
        try {
          monitorGain.disconnect();
        } catch {
          /* ignore */
        }
        monitorGain = null;
      }
      const { context, stream } = await ensureMicStream();
      ctx = context;
      monitorGain = ctx.createGain();
      monitorGain.gain.value = 0.85;
      monitorGain.connect(ctx.destination);
      micSrc = ctx.createMediaStreamSource(stream);
      micSrc.connect(monitorGain);

      const pcm = await captureMonoPcm(ctx, micSrc, SAMPLE_SEC);
      const avg = averageNoiseSpectrum(pcm, ctx.sampleRate);
      if (!avg) {
        statusEl.textContent = "Không đủ mẫu để chạy FFT — thử lại.";
        return;
      }
      noiseProfile = new Float32Array(avg);
      statusEl.textContent = `Đã lưu phổ nhiễu (${HALF_BINS} bin), ${ctx.sampleRate} Hz · Hann · hop 50%.`;
      if (reducerNode) {
        const send = noiseProfile.slice();
        reducerNode.port.postMessage(
          { type: "noiseProfile", mags: send },
          [send.buffer],
        );
      }
      recBtn.disabled = false;
      if (nrEnabled) {
        await wireNoiseReduction();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      statusEl.textContent = `Lỗi ghi mẫu nhiễu: ${msg}`;
    } finally {
      isSampling = false;
      sampleBtn.disabled = false;
    }
    },
    { signal },
  );

  toggleBtn.addEventListener(
    "click",
    async () => {
    if (!ctx || !micSrc || !monitorGain) {
      statusEl.textContent =
        "Chưa có luồng âm thanh: bấm «Ghi mẫu nhiễu» hoặc icon micro góc trái dưới.";
      return;
    }
    if (!noiseProfile) {
      statusEl.textContent = "Cần «Ghi mẫu nhiễu» trước khi bật khử nhiễu.";
      return;
    }
    nrEnabled = !nrEnabled;
    toggleBtn.setAttribute("aria-pressed", String(nrEnabled));
    try {
      if (nrEnabled) {
        toggleBtn.textContent = "Khử nhiễu: tắt";
        await wireNoiseReduction();
        statusEl.textContent =
          "Khử nhiễu BẬT (khung 1024 mẫu trong AudioWorklet, chồng khung 50%).";
      } else {
        toggleBtn.textContent = "Khử nhiễu: bật";
        wireBypassMonitoring();
        statusEl.textContent = "Khử nhiễu TẮT — micro nối thẳng ra loa (monitor).";
      }
    } catch (e) {
      nrEnabled = false;
      toggleBtn.textContent = "Khử nhiễu: bật";
      toggleBtn.setAttribute("aria-pressed", "false");
      const msg = e instanceof Error ? e.message : String(e);
      statusEl.textContent = `Không khởi tạo AudioWorklet: ${msg}`;
      wireBypassMonitoring();
    }
    },
    { signal },
  );

  recBtn.addEventListener(
    "click",
    async () => {
    if (!ctx || !monitorGain || isRecording) return;
    isRecording = true;
    recBtn.disabled = true;
    statusEl.textContent = "Đang ghi đầu ra (MediaRecorder API)…";

    recDest = ctx.createMediaStreamDestination();
    try {
      monitorGain.disconnect();
    } catch {
      /* ignore */
    }
    monitorGain.connect(ctx.destination);
    monitorGain.connect(recDest);

    recChunks = [];
    const mimeCandidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ];
    let mime = "";
    for (const m of mimeCandidates) {
      if (MediaRecorder.isTypeSupported(m)) {
        mime = m;
        break;
      }
    }
    mediaRecorder = mime
      ? new MediaRecorder(recDest.stream, { mimeType: mime })
      : new MediaRecorder(recDest.stream);

    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) recChunks.push(ev.data);
    };

    mediaRecorder.onstop = async () => {
      isRecording = false;
      recBtn.disabled = false;
      try {
        monitorGain.disconnect(recDest);
      } catch {
        /* ignore */
      }
      recDest = null;

      try {
        monitorGain.connect(ctx.destination);
      } catch {
        /* ignore */
      }

      const blob = new Blob(recChunks, { type: mediaRecorder?.mimeType });
      recChunks = [];
      mediaRecorder = null;
      if (!blob.size) {
        statusEl.textContent = "Ghi rỗng — thử lại.";
        return;
      }
      try {
        const ab = await blob.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(ab.slice(0));
        const ch = audioBuf.getChannelData(0);
        const wav = encodeWavMono16(ch, audioBuf.sampleRate);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(wav);
        a.download = `webfft-noise-reduced-${Date.now()}.wav`;
        a.click();
        URL.revokeObjectURL(a.href);
        statusEl.textContent = `Đã lưu WAV (${audioBuf.sampleRate} Hz, PCM16).`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        statusEl.textContent = `Giải mã/ghi WAV lỗi: ${msg}`;
      }
    };

    mediaRecorder.start(200);
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }
    }, 5000);
  },
  { signal },
);

  async function attachNoisePipelineFromMic() {
    try {
      const { context, stream } = await ensureMicStream();
      disconnectReducer();
      if (micSrc) {
        try {
          micSrc.disconnect();
        } catch {
          /* ignore */
        }
        micSrc = null;
      }
      if (monitorGain) {
        try {
          monitorGain.disconnect();
        } catch {
          /* ignore */
        }
        monitorGain = null;
      }
      ctx = context;
      monitorGain = ctx.createGain();
      monitorGain.gain.value = 0.85;
      monitorGain.connect(ctx.destination);
      micSrc = ctx.createMediaStreamSource(stream);
      micSrc.connect(monitorGain);
      statusEl.textContent = `Audio sẵn sàng (${Math.round(ctx.sampleRate)} Hz). Sample nhiễu rồi bật khử nhiễu.`;
      recBtn.disabled = !noiseProfile;
      if (nrEnabled && noiseProfile) {
        await wireNoiseReduction();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      statusEl.textContent = `Lỗi mở âm thanh: ${msg}`;
    }
  }

  async function attachNoiseMicIfPrimed() {
    if (!hasLiveMicStream() || !getSharedAudioContext()) return;
    if (ctx && micSrc && monitorGain) return;
    await attachNoisePipelineFromMic();
  }

  document.addEventListener(
    "webfft:start-audio",
    () => {
      if (!isNoisePanelVisible()) return;
      void attachNoisePipelineFromMic();
    },
    { signal },
  );

  document.addEventListener(
    "webfft:stop-audio",
    () => {
      if (!isNoisePanelVisible()) return;
      teardownAll();
      statusEl.textContent =
        "Micro đã dừng. Bật icon micro hoặc «Ghi mẫu nhiễu» để có luồng micro lại.";
    },
    { signal },
  );

  return {
    dispose() {
      teardownAll();
      ac.abort();
      root.innerHTML = "";
    },
    attachNoiseMicIfPrimed,
  };
}

/**
 * @param {HTMLElement | null} root
 * @returns {{ id: string, isRealtimeAudio: boolean, enter: () => void, exit: () => void }}
 */
export function createNoiseReductionMode(root) {
  /** @type {{ dispose: () => void; attachNoiseMicIfPrimed: () => Promise<void> } | null} */
  let nrApi = null;

  return {
    id: "noise",
    isRealtimeAudio: true,
    enter() {
      if (!root) return;
      void resumeSharedAudioContext();
      if (!nrApi) {
        nrApi = mountNoiseReduction(root);
      }
      void nrApi.attachNoiseMicIfPrimed();
    },
    exit() {
      nrApi?.dispose();
      nrApi = null;
    },
  };
}
