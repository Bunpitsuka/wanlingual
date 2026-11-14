// 特徴量抽出と判定の単体テスト（node --test）。合成した吠え声WAVを使う。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSamples } from '../../app/js/features.js';
import { rules, predict, knn, neighbors, growth, tally, explain, terms, WEIGHTS, CATS } from '../../app/js/classify.js';

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

test('ルールの重みは項ごとの合計と一致し、全部の気持ちぶん定義されている（explain と同じ材料を見る）', () => {
  const f = { n: 4, dur: 0.12, gap: 0.3, f0: 620, cent: 2400, gapCv: 0.05, durCv: 0.1 };
  const t = terms(f), r = rules(f);
  assert.deepEqual(Object.keys(WEIGHTS).sort(), CATS.map(c => c.k).sort());
  const raw = {}; for (const k in WEIGHTS) raw[k] = WEIGHTS[k].reduce((a, [n, w]) => a + w * t[n], 0);
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  for (const k in raw) assert.ok(Math.abs(raw[k] / sum - r[k]) < 1e-12, k);
  // 1 回しか吠えていなければ間隔の項は「速い 0／ゆっくり 0.5」、ピッチが取れなければ高い／低いは 0.5
  const one = terms({ ...f, n: 1 }); assert.equal(one.fast, 0); assert.equal(one.slow, 0.5);
  const np = terms({ ...f, f0: 0 }); assert.equal(np.highP, 0.5); assert.equal(np.lowP, 0.5);
});

test('判定の「なぜ」: 効いた特徴を最大 3 つ、数字つきの短い日本語で。取れていない特徴は挙げない', () => {
  const bark = analyzeSamples(wav('../fixtures/bark4.wav').x, 44100).feats;
  const howl = analyzeSamples(wav('../fixtures/howl.wav').x, 44100).feats;
  const topK = s => Object.entries(s).sort((p, q) => q[1] - p[1])[0][0];
  const rb = explain(bark, topK(rules(bark)), []);
  assert.ok(rb.length >= 1 && rb.length <= 3, JSON.stringify(rb));
  assert.ok(rb.some(r => /間隔|短い声|回数/.test(r)), '連吠えの根拠: ' + rb.join('・'));
  assert.ok(rb.every(r => r.length <= 24), '短く: ' + rb.join('・'));
  const rh = explain(howl, topK(rules(howl)), []);
  assert.ok(rh.some(r => r.includes('長い声')), '長声の根拠: ' + rh.join('・'));
  assert.ok(!rh.some(r => /間隔|回数/.test(r)), '1 回だけなら間隔・回数は挙げない: ' + rh.join('・'));
  // ピッチが取れていなければ Hz を挙げない。知らない気持ち・特徴量なしは空
  const noPitch = explain({ ...bark, f0: 0 }, 'excited', []);
  assert.ok(!noPitch.some(r => r.includes('Hz')), noPitch.join('・'));
  assert.deepEqual(explain(bark, 'bogus', []), []);
  assert.deepEqual(explain(null, 'alarm', []), []);
  // どちらとも言えない特徴（当てはまり 0.6 未満）は挙げない → 中くらいの声は決め手なしになりうる
  const mid = explain({ n: 1, dur: 0.35, gap: 0, f0: 500, cent: 1900, gapCv: 0, durCv: 0 }, 'threat', []);
  assert.ok(mid.every(r => !r.includes('高すぎない')), mid.join('・'));
});

test('判定の「なぜ」: 教えた声が 3 件以上あれば、似た声のうち何件がその気持ちだったかを 1 つ足す', () => {
  const f = analyzeSamples(wav('../fixtures/bark4.wav').x, 44100).feats;
  assert.equal(neighbors(f, [{ label: 'demand', f }, { label: 'demand', f }]), null);
  const samples = [
    ...Array.from({ length: 4 }, () => ({ label: 'demand', f: { ...f, n: f.n + 1 } })),
    { label: 'play', f: { ...f, f0: f.f0 + 5 } },
    { label: 'alarm', f: { ...f, n: 12, gap: 2, f0: 1200, cent: 5000 } }, // 遠い
  ];
  const nn = neighbors(f, samples);
  assert.equal(nn.length, 5);
  assert.ok(!nn.some(e => e.l === 'alarm'), '遠いサンプルは 5 件に入らない');
  const r = explain(f, 'demand', samples);
  assert.equal(r.at(-1), '教えてもらった似た声 5件のうち 4件が「要求」');
  assert.ok(r.length <= 4);
  // 似た声にその気持ちが 1 件も無ければ kNN の行は足さない
  assert.ok(!explain(f, 'lonely', samples).some(r => r.includes('似た声')));
});

/** 合成の連吠え: 620Hz の 120ms の声を 300ms 間隔で、声ごとの大きさ amps（0〜1）で並べる */
function synthBarks(amps, sr = 44100) {
  const dur = 0.12, gap = 0.30, x = new Float32Array(Math.round(sr * (0.3 + amps.length * (dur + gap))));
  amps.forEach((a, k) => {
    const o = Math.round(sr * (0.15 + k * (dur + gap))), n = Math.round(sr * dur);
    for (let i = 0; i < n; i++) x[o + i] = a * Math.sin(2 * Math.PI * 620 * i / sr) * Math.sin(Math.PI * i / n);
  });
  return x;
}

test('lvlDrop（#13b (i)）: 同じ大きさの 4 連吠えは ≒ 0 dB、4 回のうち 2 回を 1/4 の大きさ（-12 dB）にすると中央値が上がる。1 回だけなら 0', () => {
  const even = analyzeSamples(synthBarks([0.5, 0.5, 0.5, 0.5]), 44100);
  assert.equal(even.feats.n, 4);
  assert.ok(even.feats.lvlDrop >= 0 && even.feats.lvlDrop < 1, 'そろった連吠え: ' + even.feats.lvlDrop);
  // 4 回のうち 2 回を 1/4 の大きさに → 中央値は 0 と 12 の間（median(0,0,12,12) = 6）
  const mixed = analyzeSamples(synthBarks([0.5, 0.125, 0.5, 0.125]), 44100);
  assert.equal(mixed.feats.n, 4);
  assert.ok(mixed.feats.lvlDrop > 3 && mixed.feats.lvlDrop < 9, '小さい声が混ざる: ' + mixed.feats.lvlDrop);
  // bark4.wav（合成の 4 連、同じ大きさ）も 0 寄り。howl.wav（1 回）は 0。無音は 0
  assert.ok(analyzeSamples(wav('../fixtures/bark4.wav').x, 44100).feats.lvlDrop < 1);
  assert.equal(analyzeSamples(wav('../fixtures/howl.wav').x, 44100).feats.lvlDrop, 0);
  assert.equal(analyzeSamples(wav('../fixtures/silence.wav').x, 44100).feats.lvlDrop, 0);
});

test('levelDrop（純粋関数）: 最大の声からの dB 差の中央値。2 回未満・0 は 0。判定の数字（rules）は lvlDrop があっても無くても同じ', async () => {
  const { levelDrop } = await import('../../app/js/features.js');
  assert.equal(levelDrop([0.1, 0.1, 0.1]), 0);
  assert.ok(Math.abs(levelDrop([0.1, 0.05]) - 3) < 0.05, '0.1 と 0.05 → 0 と 6.02 の中央値 3.01');
  assert.ok(Math.abs(levelDrop([0.2, 0.02, 0.02]) - 20) < 0.01, '20 dB 下が 2 回 → 中央値 20');
  assert.equal(levelDrop([0.3]), 0); assert.equal(levelDrop([]), 0); assert.equal(levelDrop([0, 0.1]), 0, '0 は数えない → 1 回扱い');
  const f = analyzeSamples(wav('../fixtures/bark4.wav').x, 44100).feats;
  const { lvlDrop, ...without } = f;
  assert.ok(typeof lvlDrop === 'number');
  assert.deepEqual(rules(f), rules(without), 'ルールは lvlDrop を見ない（(i) では判定を変えない）');
  assert.deepEqual(predict(f, []), predict(without, []));
});
