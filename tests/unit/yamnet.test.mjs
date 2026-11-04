// フェーズ2試作（app/lab/yamnet.js）の純粋関数の単体テスト。tf は使わない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YAMNET_CLASSES, DOG_CLASS_INDEXES } from '../../app/lab/yamnet_classes.js';
import { resampleTo16k, padMin, dogScore, topK, decideDog, pickScores, clustersFromEvents, MIN_SAMPLES, N_CLASSES } from '../../app/lab/yamnet.js';

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
  assert.equal(s.dogTop, 'Bark');
  assert.deepEqual(dogScore([]), { dog: 0, dogMean: 0, dogSum: 0, dogTop: null, frames: 0 });
});

test('犬系の合計 dogSum: くんくんのように点が割れた声でも合計なら伸びる。上限は 1', () => {
  // Dog 0.25 + Whimper (dog) 0.2 + Yip 0.1 → 最大値は 0.25 だが合計は 0.55
  const whimper = [row([[69, 0.25], [75, 0.2], [71, 0.1], [21, 0.3]])];
  const s = dogScore(whimper);
  assert.ok(Math.abs(s.dog - 0.25) < 1e-6);
  assert.ok(Math.abs(s.dogSum - 0.55) < 1e-6);
  assert.equal(s.dogTop, 'Dog');
  const loud = [row([[69, 0.9], [70, 0.9]])];
  assert.equal(dogScore(loud).dogSum, 1);
  const r = decideDog(whimper);
  assert.equal(r.label, '判断つかず'); // 最大値 0.25 なので従来の判定では通らない
  assert.ok(Math.abs(r.dogSum - 0.55) < 1e-6);
});

test('吠えイベントを本体 mic.js と同じ区切り（0.7 秒空いたら別の塊）で塊にまとめる', () => {
  const ev = [
    { start: 1.0, dur: 0.15 }, { start: 1.5, dur: 0.15 }, { start: 2.0, dur: 0.15 }, // 間隔 0.35 秒 → 同じ塊
    { start: 4.0, dur: 0.2 },                                                       // 1.85 秒空く → 別の塊
  ];
  const c = clustersFromEvents(ev, 5);
  assert.equal(c.length, 2);
  assert.deepEqual(c.map(x => x.n), [3, 1]);
  assert.ok(Math.abs(c[0].start - 0.75) < 1e-9 && Math.abs(c[0].end - 2.27) < 1e-9); // 前 0.25 秒・後 0.12 秒
  assert.ok(Math.abs(c[1].start - 3.75) < 1e-9 && Math.abs(c[1].end - 4.32) < 1e-9);
  // 先頭と末尾はファイルの範囲に収める
  const edge = clustersFromEvents([{ start: 0.1, dur: 0.1 }, { start: 4.9, dur: 0.1 }], 5);
  assert.equal(edge[0].start, 0); assert.equal(edge[1].end, 5);
  // 6 秒を超える塊は強制的に区切る
  const long = clustersFromEvents(Array.from({ length: 20 }, (_, i) => ({ start: i * 0.5, dur: 0.1 })), 10);
  assert.ok(long.length >= 2 && long.every(x => x.end - x.start <= 6.4));
  assert.deepEqual(clustersFromEvents([], 5), []);
});

test('minSec: 短い塊は前の実音を足して最低 2〜3 秒にする。先頭で足りなければ後ろへ。長い塊はそのまま', () => {
  const ev = [{ start: 3.0, dur: 0.15 }, { start: 3.4, dur: 0.15 }]; // 塊は 2.75〜3.67 秒（0.92 秒）
  const c2 = clustersFromEvents(ev, 5, { minSec: 2 })[0];
  assert.ok(Math.abs(c2.end - 3.67) < 1e-9, '終わりは変えない（未来の音は無い）');
  assert.ok(Math.abs(c2.start - 1.67) < 1e-9, '前へ広げて 2 秒');
  const c3 = clustersFromEvents(ev, 5, { minSec: 3 })[0];
  assert.ok(Math.abs(c3.end - c3.start - 3) < 1e-9);
  // ファイルの先頭: 前に 0.3 秒しか無いので後ろへ広げる
  const head = clustersFromEvents([{ start: 0.3, dur: 0.2 }], 5, { minSec: 2 })[0];
  assert.equal(head.start, 0); assert.ok(Math.abs(head.end - 2) < 1e-9);
  // ファイルが minSec より短ければ全体
  const tiny = clustersFromEvents([{ start: 0.5, dur: 0.2 }], 1.5, { minSec: 3 })[0];
  assert.equal(tiny.start, 0); assert.equal(tiny.end, 1.5);
  // もともと長い塊は変わらない。minSec 0（既定）は従来どおり
  const longEv = Array.from({ length: 8 }, (_, i) => ({ start: 1 + i * 0.4, dur: 0.15 })); // 0.75〜3.95 秒
  assert.deepEqual(clustersFromEvents(longEv, 5, { minSec: 2 }), clustersFromEvents(longEv, 5));
  assert.ok(Math.abs(clustersFromEvents(ev, 5)[0].start - 2.75) < 1e-9);
  // 塊の数と吠え回数は minSec で変わらない
  const many = [{ start: 1, dur: 0.1 }, { start: 3, dur: 0.1 }, { start: 4.5, dur: 0.1 }];
  assert.deepEqual(clustersFromEvents(many, 5, { minSec: 3 }).map(c => c.n), clustersFromEvents(many, 5).map(c => c.n));
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
