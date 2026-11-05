// dogcheck.js（plan #14 の実装 ②）の単体テスト。tf・ネットワーク・ブラウザは使わず、入口を差し替えて確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DogCheck, isEnabled, setEnabled, applyUrlParam, KEY, THRESHOLD } from '../../app/js/dogcheck.js';
import * as lab from '../../app/lab/yamnet.js';
import { DOG_CLASS_INDEXES } from '../../app/lab/yamnet_classes.js';

const fakeStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };

/** 犬系クラス（Bark）に dog 点を出す偽の tf とモデル。呼ばれた回数と入力の長さを覚える */
function fakeTf(dog = 0.9) {
  const seen = { inputs: [], disposed: 0, loads: 0 };
  const row = new Float32Array(lab.N_CLASSES); row[DOG_CLASS_INDEXES[1]] = dog; row[0] = 0.05;
  const model = { execute: input => { seen.inputs.push(input.length); return { shape: [1, lab.N_CLASSES], array: async () => [row], dispose: () => { seen.disposed++; } }; } };
  const tf = {
    tensor1d: x => ({ length: x.length, dispose: () => { seen.disposed++; } }),
    loadGraphModel: async (url, opts) => { seen.loads++; seen.url = url; seen.opts = opts; return model; },
  };
  return { tf, model, seen };
}
const make = (over = {}) => {
  const f = fakeTf(over.dog);
  const states = [], scripts = [];
  const d = new DogCheck({
    importLab: async () => lab,
    loadScript: async url => { scripts.push(url); },
    getTf: () => f.tf,
    onState: s => states.push(s),
    ...over.deps,
  });
  return { d, states, scripts, ...f };
};

test('設定: 既定はオフ。on にしたときだけオン、off で項目ごと消える', () => {
  const s = fakeStorage();
  assert.equal(isEnabled(s), false);
  assert.equal(setEnabled(true, s), true);
  assert.equal(s.getItem(KEY), 'on');
  assert.equal(isEnabled(s), true);
  setEnabled(false, s);
  assert.equal(s.m.has(KEY), false);
  assert.equal(isEnabled(s), false);
  s.setItem(KEY, 'yes'); assert.equal(isEnabled(s), false); // 'on' 以外はオフ
  // localStorage が壊れている・使えない環境でも例外を出さずオフ
  assert.equal(isEnabled({ getItem() { throw new Error('denied'); } }), false);
  assert.equal(setEnabled(true, { setItem() { throw new Error('denied'); } }), false);
});

test('URL の ?dogcheck=on / off だけが設定を変える', () => {
  const s = fakeStorage();
  assert.equal(applyUrlParam('', s), null);
  assert.equal(applyUrlParam('?x=1', s), null);
  assert.equal(isEnabled(s), false);
  assert.equal(applyUrlParam('?dogcheck=on', s), 'on');
  assert.equal(isEnabled(s), true);
  assert.equal(applyUrlParam('?dogcheck=maybe', s), null); // 知らない値は何もしない
  assert.equal(isEnabled(s), true);
  assert.equal(applyUrlParam('?a=b&dogcheck=off', s), 'off');
  assert.equal(isEnabled(s), false);
  assert.equal(applyUrlParam('?dogcheck=1', s), 'on');
  assert.equal(applyUrlParam('?dogcheck=0', s), 'off');
});

test('読み込み: 固定バージョンの tfjs を jsdelivr から、モデルは TF Hub v1。読めたら ready', async () => {
  const { d, states, scripts, seen } = make();
  assert.equal(d.state, 'idle');
  assert.equal(await d.check(new Float32Array(32000), 16000), null); // 読む前は判定しない
  assert.equal(await d.load(), true);
  assert.equal(d.state, 'ready');
  assert.deepEqual(states, ['loading', 'ready']);
  assert.deepEqual(scripts, ['https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js']);
  assert.equal(seen.url, lab.YAMNET_URL);
  assert.deepEqual(seen.opts, { fromTFHub: true });
});

test('読み込みは同時に呼んでも 1 回だけ。読めたあとは何もしない', async () => {
  const { d, scripts, seen } = make();
  const [a, b] = await Promise.all([d.load(), d.load()]);
  assert.equal(a, true); assert.equal(b, true);
  await d.load();
  assert.equal(scripts.length, 1);
  assert.equal(seen.loads, 1);
});

test('読めなかったら failed で、判定は null（本体は従来どおり）。次の load() でやり直せる', async () => {
  let fail = true;
  const { d, states } = make({ deps: { loadScript: async () => { if (fail) throw new Error('オフライン'); } } });
  assert.equal(await d.load(), false);
  assert.equal(d.state, 'failed');
  assert.match(d.error, /オフライン/);
  assert.equal(await d.check(new Float32Array(32000), 16000), null);
  fail = false;
  assert.equal(await d.load(), true);
  assert.equal(d.state, 'ready');
  assert.equal(d.error, null);
  assert.deepEqual(states, ['loading', 'failed', 'loading', 'ready']);
  // tf が無い（<script> は読めたが中身が無い）ときも failed
  const m = make({ deps: { getTf: () => undefined } });
  assert.equal(await m.d.load(), false);
  assert.equal(m.d.state, 'failed');
});

test('判定: 48kHz の 2 秒を 16kHz に落として渡し、しきい値 0.3 で犬かどうか', async () => {
  assert.equal(THRESHOLD, 0.3);
  const { d, seen } = make({ dog: 0.86 });
  await d.load();
  const r = await d.check(new Float32Array(96000), 48000);
  assert.equal(seen.inputs[0], 32000);              // 2 秒 × 16kHz
  assert.equal(r.isDog, true);
  assert.ok(Math.abs(r.dog - 0.86) < 1e-6);
  assert.equal(r.dogTop, 'Bark');
  assert.equal(r.sec, 2);
  assert.equal(typeof r.ms, 'number');
  assert.equal(seen.disposed, 2);                   // 入力と出力のテンソルを片付ける

  const low = make({ dog: 0.29 }); await low.d.load();
  assert.equal((await low.d.check(new Float32Array(32000), 16000)).isDog, false);
  const edge = make({ dog: 0.3 }); await edge.d.load();
  assert.equal((await edge.d.check(new Float32Array(32000), 16000)).isDog, true);
});

test('判定: 空の波形・前の推論が終わっていない・推論の失敗は null（例外を出さない）', async () => {
  const { d, model } = make();
  await d.load();
  assert.equal(await d.check(new Float32Array(0), 16000), null);
  assert.equal(await d.check(null, 16000), null);
  assert.equal(await d.check(new Float32Array(100), 0), null);
  // 2 つ同時: 先の 1 つだけ判定し、あとから来たほうは捨てる
  const [a, b] = await Promise.all([d.check(new Float32Array(32000), 16000), d.check(new Float32Array(32000), 16000)]);
  assert.ok(a); assert.equal(b, null);
  assert.equal(d.busy, false);
  // 推論が落ちても null。次は判定できる
  const orig = model.execute; model.execute = () => { throw new Error('WebGL が落ちた'); };
  assert.equal(await d.check(new Float32Array(32000), 16000), null);
  assert.match(d.error, /WebGL/);
  assert.equal(d.busy, false);
  model.execute = orig;
  assert.ok(await d.check(new Float32Array(32000), 16000));
});
