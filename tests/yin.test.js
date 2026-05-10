import test from "node:test";
import assert from "node:assert/strict";
import { yinDetectPitchHz } from "../src/dsp/yin.js";

test("YIN: sine 440 Hz gần đúng", () => {
  const sr = 48000;
  const f0 = 440;
  const n = 16384;
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    buf[i] = 0.4 * Math.sin((2 * Math.PI * f0 * i) / sr);
  }
  const f = yinDetectPitchHz(buf, sr, 80, 2000);
  assert.ok(f !== null, "expected pitch");
  assert.ok(Math.abs(f - f0) < 8, `got ${f} Hz`);
});

test("YIN: im lặng → null", () => {
  const buf = new Float32Array(4096);
  const f = yinDetectPitchHz(buf, 48000, 80, 2000);
  assert.equal(f, null);
});
