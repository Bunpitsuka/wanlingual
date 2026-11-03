// 特徴量抽出と判定の単体テスト（node --test）。合成した吠え声WAVを使う。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSamples } from '../../app/js/features.js';
import { rules, predict, knn, growth, tally, CATS } from '../../app/js/classify.js';

function wav(path) {
  const b = readFileSync(new URL(path, import.meta.url));
  const sr = b.readUInt32LE(24), ch = b.readUInt16LE(22);
  let off = 12; while (b.toString('ascii', off, off + 4) !== 'data') off += 8 + b.readUInt32LE(off + 4);
  const len = b.readUInt32LE(off + 4) / 2 / ch, x = new Float32Array(len);
  for (let i = 0; i < len; i++) x[i] = b.readInt16LE(off + 8 + i * 2 * ch) / 32768;
  return { x, sr };
}

test('4連吠え: 回数・間隔・ピッチが合成値に近い', () => {
  const { x, sr } = wav('../fixtures/bark4.wav');
  const a = analyzeSamples(x, sr);
  assert.equal(a.feats.n, 4);
  assert.ok(Math.abs(a.feats.gap - 0.30) < 0.06, 'gap≈300ms: ' + a.feats.gap);
  assert.ok(a.feats.f0 > 520 && a.feats.f0 < 760, 'f0≈620Hz: ' + a.feats.f0);
  assert.ok(a.feats.dur > 0.07 && a.feats.dur < 0.2, 'dur: ' + a.feats.dur);
});

test('長い1声: 1回・長い', () => {
  const { x, sr } = wav('../fixtures/howl.wav');
  const a = analyzeSamples(x, sr);
  assert.equal(a.feats.n, 1);
  assert.ok(a.feats.dur > 0.5, 'dur: ' + a.feats.dur);
});

test('無音: 吠え0回', () => {
  const { x, sr } = wav('../fixtures/silence.wav');
  assert.equal(analyzeSamples(x, sr).feats.n, 0);
});

test('ルール: 規則的な連吠えは「要求/警戒/うれしい」寄り、長い1声は「さみしい/威嚇」寄り', () => {
  const a = analyzeSamples(wav('../fixtures/bark4.wav').x, 44100).feats;
  const h = analyzeSamples(wav('../fixtures/howl.wav').x, 44100).feats;
  const topK = s => Object.entries(s).sort((p, q) => q[1] - p[1])[0][0];
  assert.ok(['demand', 'alarm', 'excited'].includes(topK(rules(a))), 'bark4 → ' + topK(rules(a)));
  assert.ok(['lonely', 'threat'].includes(topK(rules(h))), 'howl → ' + topK(rules(h)));
  const sum = Object.values(rules(a)).reduce((p, q) => p + q, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('個体学習: 飼い主ラベルが増えると kNN の重みが効く', () => {
  const f = analyzeSamples(wav('../fixtures/bark4.wav').x, 44100).feats;
  assert.equal(knn(f, []), null);
  const samples = Array.from({ length: 12 }, () => ({ label: 'demand', f: { ...f, n: f.n + (Math.random() - .5) } }));
  const s = predict(f, samples);
  const topK = Object.entries(s).sort((p, q) => q[1] - p[1])[0][0];
  assert.equal(topK, 'demand');
});

test('育成度: 段階と的中率', () => {
  const s0 = growth([]); assert.equal(s0.stage, 'たまご'); assert.equal(s0.accuracy, null);
  const five = Array.from({ length: 5 }, (_, i) => ({ label: 'play', pred: i % 2 ? 'play' : 'alarm', f: {} }));
  const g = growth(five); assert.equal(g.stage, '子犬'); assert.equal(g.toNext, 10); assert.equal(g.accuracy, 2 / 5);
  assert.equal(CATS.length, 6);
});

test('気持ち別の集計: 正解ラベルごとの件数と当たり数、多い順。0 件は出さない', () => {
  const t = tally([
    { label: 'play', pred: 'play' }, { label: 'play', pred: 'alarm' }, { label: 'play', pred: null },
    { label: 'alarm', pred: 'alarm' }, { label: 'bogus', pred: 'alarm' },
  ]);
  assert.deepEqual(t.map(c => [c.label, c.n, c.hits]), [['遊ぼう', 3, 1], ['警戒', 1, 1]]);
  assert.deepEqual(tally([]), []);
  assert.deepEqual(tally(undefined), []);
});
