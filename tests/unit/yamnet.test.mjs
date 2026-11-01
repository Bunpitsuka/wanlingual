// フェーズ2試作（app/lab/yamnet.js）の純粋関数の単体テスト。tf は使わない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YAMNET_CLASSES, DOG_CLASS_INDEXES } from '../../app/lab/yamnet_classes.js';
import { resampleTo16k, padMin, dogScore, topK, decideDog, pickScores, MIN_SAMPLES, N_CLASSES } from '../../app/lab/yamnet.js';

const row = (pairs) => { const r = new Float32Array(N_CLASSES); for (const [i, v] of pairs) r[i] = v; return r; };

test('クラス表は 521 個で、犬系クラスの名前が合っている', () => {
  assert.equal(YAMNET_CLASSES.length, 521);
  assert.deepEqual(DOG_CLASS_INDEXES.map(i => YAMNET_CLASSES[i]), ['Dog', 'Bark', 'Yip', 'Howl', 'Bow-wow', 'Growling', 'Whimper (dog)']);
  assert.equal(YAMNET_CLASSES[0], 'Speech');
  assert.equal(YAMNET_CLASSES[494], 'Silence');
});

test('48kHz → 16kHz で長さが 1/3 になり、音の大きさが保たれる', () => {
  const sr = 48000, x = new Float32Array(sr);
  for (let i = 0; i < sr; i++) x[i] = Math.sin(2 * Math.PI * 440 * i / sr);
  const y = resampleTo16k(x, sr);
  assert.equal(y.length, 16000);
  const rms = a => Math.sqrt(a.reduce((p, q) => p + q * q, 0) / a.length);
  assert.ok(Math.abs(rms(y) - rms(x)) < 0.05, `rms ${rms(y)} vs ${rms(x)}`);
});

test('44.1kHz と 8kHz（アップサンプル）も 16kHz に揃う。16kHz はコピー', () => {
  assert.equal(resampleTo16k(new Float32Array(44100), 44100).length, 16000);
  assert.equal(resampleTo16k(new Float32Array(8000), 8000).length, 16000);
  const x = Float32Array.from([0.1, 0.2]); const y = resampleTo16k(x, 16000);
  assert.deepEqual(Array.from(y), Array.from(x)); assert.notEqual(x, y);
});

test('短い音はゼロ埋めで 0.975 秒ぶんになる', () => {
  assert.equal(padMin(new Float32Array(100)).length, MIN_SAMPLES);
  const long = new Float32Array(MIN_SAMPLES + 5); assert.equal(padMin(long), long);
});

test('犬らしさ: 犬系クラスの最大値をフレーム間で最大／平均', () => {
  const scores = [row([[70, 0.8], [0, 0.1]]), row([[0, 0.9]]), row([[74, 0.4]])];
  const s = dogScore(scores);
  assert.equal(s.frames, 3);
  assert.ok(Math.abs(s.dog - 0.8) < 1e-6);
  assert.ok(Math.abs(s.dogMean - 0.4) < 1e-6);
  assert.deepEqual(dogScore([]), { dog: 0, dogMean: 0, frames: 0 });
});

test('上位クラスは平均スコア順で名前が付く', () => {
  const scores = [row([[0, 0.9], [70, 0.5]]), row([[0, 0.7], [70, 0.9]])];
  const t = topK(scores, 2);
  assert.deepEqual(t.map(v => v.name), ['Speech', 'Bark']);
  assert.ok(Math.abs(t[0].score - 0.8) < 1e-6);
});

test('判定: 0.3 以上は犬の声、0.1 未満は犬ではなさそう、間は判断つかず', () => {
  assert.equal(decideDog([row([[69, 0.35]])]).label, '犬の声');
  assert.equal(decideDog([row([[69, 0.35]])]).isDog, true);
  assert.equal(decideDog([row([[0, 0.9], [69, 0.05]])]).label, '犬ではなさそう');
  assert.equal(decideDog([row([[72, 0.2]])]).label, '判断つかず');
  assert.equal(decideDog([row([[69, 0.2]])], { hi: 0.15 }).isDog, true);
});

test('モデル出力の中から scores（×521）を shape で見つける', () => {
  const emb = { shape: [3, 1024] }, sc = { shape: [3, 521] }, mel = { shape: [96, 64] };
  assert.equal(pickScores([emb, sc, mel]), sc);
  assert.equal(pickScores(sc), sc);
  assert.equal(pickScores([emb, mel]), null);
});
