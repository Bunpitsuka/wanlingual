// tools/mfcc-bench.mjs（plan #13 の下調べ、自前 MFCC）の純粋関数。本体には入っていない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hzToMel, melToHz, melFilterbank, dctMatrix, mfccFrames, mfccSummary, bench } from '../../tools/mfcc-bench.mjs';

test('メル尺度: 1000Hz ≒ 1000mel、往復で元に戻る', () => {
  assert.ok(Math.abs(hzToMel(1000) - 1000) < 1);
  for (const f of [0, 300, 1000, 4000, 22050]) assert.ok(Math.abs(melToHz(hzToMel(f)) - f) < 1e-6);
});

test('メルフィルタバンク: 26 本、各フィルタの最大は 1、中心は低い方が密、1kHz の純音はその帯域に落ちる', () => {
  const sr = 44100, nFft = 1024;
  const { filters, centers, nBins } = melFilterbank(nFft, sr, 26);
  assert.equal(filters.length, 26); assert.equal(nBins, 513);
  for (const w of filters) { let mx = 0; for (const v of w) mx = Math.max(mx, v); assert.ok(mx > 0.5 && mx <= 1 + 1e-6); }
  assert.ok(centers[1] - centers[0] < centers[25] - centers[24], '低い帯域ほど幅が狭い');
  // 1kHz の純音のパワースペクトル（ビン 23.2 付近）にフィルタを掛けると、1kHz を含むフィルタが最大になる
  const pow = new Float32Array(nBins); pow[Math.round(1000 * nFft / sr)] = 1;
  const e = filters.map(w => w.reduce((a, v, k) => a + v * pow[k], 0));
  const best = e.indexOf(Math.max(...e));
  assert.ok(centers[best - 1] < 1000 && 1000 < centers[best + 1], `1kHz は ${best} 番（中心 ${centers[best].toFixed(0)}Hz）`);
});

test('DCT-II（直交）: 行は互いに直交、定数の入力は c0 だけに乗る', () => {
  const d = dctMatrix(26, 13);
  assert.equal(d.length, 13); assert.equal(d[0].length, 26);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  assert.ok(Math.abs(dot(d[0], d[0]) - 1) < 1e-5); assert.ok(Math.abs(dot(d[3], d[3]) - 1) < 1e-5); assert.ok(Math.abs(dot(d[1], d[2])) < 1e-5);
  const c = d.map(r => dot(r, new Float32Array(26).fill(2)));
  assert.ok(c[0] > 1); for (let i = 1; i < 13; i++) assert.ok(Math.abs(c[i]) < 1e-4);
});

test('mfccFrames: 1 秒で 169 フレーム × 13 係数。無音は c0 が小さく、音があれば大きい。要約は平均と標準偏差', () => {
  const sr = 44100, x = new Float32Array(sr), q = new Float32Array(sr);
  for (let i = 0; i < sr; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
  const fr = mfccFrames(x, sr), fq = mfccFrames(q, sr);
  assert.equal(fr.length, 169); assert.equal(fr[0].length, 13);
  const s = mfccSummary(fr), sq = mfccSummary(fq);
  assert.equal(s.mean.length, 13); assert.equal(s.sd.length, 13);
  assert.ok(s.mean[0] > sq.mean[0] + 10, '音量に近い c0 は、音のある方が大きい');
  assert.ok(s.sd[0] < 1, '一定の音なのでフレーム間のばらつきは小さい');
  assert.ok(Number.isFinite(sq.mean[5]), '無音でも log の床 1e-10 で NaN にならない');
});

test('bench: 1 秒あたりの ms を返す（数値、フレーム数 169/秒）', () => {
  const sr = 44100, x = new Float32Array(sr * 0.5);
  const b = bench(x, sr, 2);
  assert.ok(b.msPerSec > 0 && Number.isFinite(b.msPerSec));
  assert.ok(Math.abs(b.framesPerSec - 169) < 4);
});
