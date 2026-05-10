/**
 * Chạy: `npm test` hoặc `node --test tests/butterflyData.test.js`
 */
import test from "node:test";
import assert from "node:assert/strict";
import { generateButterflyData } from "../src/dsp/butterflyData.js";

const TWO_PI = 2 * Math.PI;

function expectTwiddle(j, m) {
  const angle = (-TWO_PI * j) / m;
  return { twiddleReal: Math.cos(angle), twiddleImag: Math.sin(angle) };
}

test("generateButterflyData N=4 DIT: 2 tầng, mỗi tầng N/2 bướm, twiddle khớp công thức", () => {
  const N = 4;
  const data = generateButterflyData(N, "DIT");
  assert.equal(data.N, N);
  assert.equal(data.type, "DIT");
  assert.equal(data.stages.length, 2);

  assert.equal(data.stages[0].butterflies.length, N / 2);
  assert.equal(data.stages[1].butterflies.length, N / 2);

  const s0 = data.stages[0].butterflies;
  assert.deepEqual(
    s0.map((b) => [b.topWire, b.bottomWire]),
    [
      [0, 1],
      [2, 3],
    ],
  );
  const t0 = expectTwiddle(0, 2);
  for (const b of s0) {
    assertApprox(b.twiddleReal, t0.twiddleReal, 1e-15);
    assertApprox(b.twiddleImag, t0.twiddleImag, 1e-15);
  }

  const s1 = data.stages[1].butterflies;
  const wantPairs = [
    [0, 2],
    [1, 3],
  ];
  for (let i = 0; i < 2; i++) {
    assert.equal(s1[i].topWire, wantPairs[i][0]);
    assert.equal(s1[i].bottomWire, wantPairs[i][1]);
    const tw = expectTwiddle(i, 4);
    assertApprox(s1[i].twiddleReal, tw.twiddleReal, 1e-15);
    assertApprox(s1[i].twiddleImag, tw.twiddleImag, 1e-15);
  }
});

test("generateButterflyData N=8 DIT: 3 tầng, mỗi tầng 4 bướm, tổng 12 bướm", () => {
  const N = 8;
  const data = generateButterflyData(N, "DIT");
  assert.equal(data.stages.length, 3);
  let total = 0;
  for (const st of data.stages) {
    assert.equal(st.butterflies.length, N / 2);
    total += st.butterflies.length;
  }
  assert.equal(total, (N / 2) * 3);

  const s0 = data.stages[0].butterflies;
  assert.equal(s0.length, 4);
  const twM2 = expectTwiddle(0, 2);
  for (const b of s0) {
    assertApprox(b.twiddleReal, twM2.twiddleReal, 1e-15);
    assertApprox(b.twiddleImag, twM2.twiddleImag, 1e-15);
  }

  const s2 = data.stages[2].butterflies;
  assert.equal(s2.length, 4);
  for (let j = 0; j < 4; j++) {
    const b = s2[j];
    assert.equal(b.topWire, j);
    assert.equal(b.bottomWire, j + 4);
    const tw = expectTwiddle(j, 8);
    assertApprox(b.twiddleReal, tw.twiddleReal, 1e-14);
    assertApprox(b.twiddleImag, tw.twiddleImag, 1e-14);
  }
});

test("generateButterflyData N=4 DIF: số tầng và cấu trúc dây", () => {
  const N = 4;
  const data = generateButterflyData(N, "DIF");
  assert.equal(data.type, "DIF");
  assert.equal(data.stages.length, 2);
  assert.equal(data.stages[0].butterflies.length, N / 2);
  assert.equal(data.stages[1].butterflies.length, N / 2);
});

test("generateButterflyData từ chối N không phải lũy thừa 2", () => {
  assert.throws(() => generateButterflyData(6, "DIT"), RangeError);
});

test("generateButterflyData từ chối type sai", () => {
  assert.throws(() => generateButterflyData(4, "DIT2"), RangeError);
});

function assertApprox(a, b, eps, msg = "") {
  const d = Math.abs(a - b);
  assert.ok(d <= eps, `${msg}|${a} - ${b}| = ${d}`);
}
