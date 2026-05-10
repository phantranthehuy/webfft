/**
 * Ghi PCM mono vào buffer cố định rồi postMessage('captured').
 * Đầu ra nối tới gain = 0 để không phát loa.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = opts.processorOptions || {};
    this.target = Math.max(256, Math.floor(Number(o.targetSamples) || 72000));
    /** @type {Float32Array} */
    this.buf = new Float32Array(this.target);
    this.writeIndex = 0;
    this.finished = false;

    this.port.onmessage = (e) => {
      if (e.data?.type === "reset") {
        this.writeIndex = 0;
        this.finished = false;
      }
    };
  }

  /**
   * @param {Float32Array[][]} inputs
   * @param {Float32Array[][]} outputs
   */
  process(inputs, outputs) {
    const inCh = inputs[0]?.[0];
    const outCh = outputs[0]?.[0];
    if (!inCh || !outCh) return true;

    if (this.finished) {
      outCh.fill(0);
      return true;
    }

    for (let i = 0; i < inCh.length; i++) {
      if (this.writeIndex < this.target) {
        this.buf[this.writeIndex++] = inCh[i];
      }
      outCh[i] = 0;
    }

    if (this.writeIndex >= this.target && !this.finished) {
      this.finished = true;
      const copy = this.buf.slice();
      this.port.postMessage({ type: "captured", buffer: copy }, [copy.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
