// mic.js の塊の切り出し（_emitCluster）の単体テスト。マイクや AudioContext は使わず、リングバッファを手で埋めて確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Listener } from '../../app/js/mic.js';

/** sr=1000 の Listener を作り、絶対位置 i の値が i になるよう total サンプルぶん流し込む */
function make(total, { ringSec = 6, sr = 1000 } = {}) {
  const calls = [];
  const l = new Listener({ onCluster: (x, s, ctx) => calls.push({ x, sr: s, ctx }) });
  l.sr = sr; l.ringSec = ringSec;
  const L = Math.ceil(ringSec * sr);
  l.ring = new Float32Array(L); l.ringPos = 0; l.total = 0;
  for (let i = 0; i < total; i++) { l.ring[l.ringPos] = i; l.ringPos = (l.ringPos + 1) % L; l.total++; }
  l.running = true;
  return { l, calls };
}

test('塊そのもの x は前 0.25 秒・後 0.12 秒付き、wide は前を足して最低 contextSec 秒', () => {
  const { l, calls } = make(5000); // 5 秒ぶん流した
  l.clusterStart = 4000; l.lastEventEnd = 4300; l.events = 2; // 4.0〜4.3 秒に吠え
  l._emitCluster(5000);
  assert.equal(calls.length, 1);
  const { x, sr, ctx } = calls[0];
  assert.equal(sr, 1000);
  assert.equal(x.length, 4420 - 3750);           // 3.75〜4.42 秒
  assert.equal(x[0], 3750); assert.equal(x[x.length - 1], 4419);
  assert.equal(ctx.wide.length, 2000);           // 2.42〜4.42 秒（終わりは同じ、前を足す）
  assert.equal(ctx.wide[0], 2420); assert.equal(ctx.wide[ctx.wide.length - 1], 4419);
  // wide の末尾は x と一致する（同じ音）
  assert.deepEqual(Array.from(ctx.wide.subarray(ctx.wide.length - x.length)), Array.from(x));
  // 確定後は状態が戻る
  assert.equal(l.clusterStart, -1); assert.equal(l.events, 0); assert.equal(l.lastEventEnd, -1);
});

test('もともと contextSec より長い塊は wide = x。contextSec は変えられる', () => {
  const { l, calls } = make(6000);
  l.clusterStart = 2000; l.lastEventEnd = 5000; l.events = 8;
  l._emitCluster(6000);
  assert.deepEqual(Array.from(calls[0].ctx.wide), Array.from(calls[0].x));
  const m = make(6000); m.l.contextSec = 3; m.l.clusterStart = 5000; m.l.lastEventEnd = 5200; m.l.events = 1;
  m.l._emitCluster(6000);
  assert.equal(m.calls[0].ctx.wide.length, 3000);
});

test('監視を始めた直後（過去が無い）はあるぶんだけ。リングバッファより前も取れない', () => {
  const { l, calls } = make(800); // 0.8 秒しか流していない
  l.clusterStart = 300; l.lastEventEnd = 600; l.events = 1;
  l._emitCluster(800);
  assert.equal(calls[0].x.length, 720 - 50);
  assert.equal(calls[0].ctx.wide.length, 720);   // 0〜0.72 秒（2 秒には足りない）
  assert.equal(calls[0].ctx.wide[0], 0);
  const r = make(20000, { ringSec: 1 }); r.l.contextSec = 5; r.l.clusterStart = 19900; r.l.lastEventEnd = 19950; r.l.events = 1;
  r.l._emitCluster(20000);
  assert.equal(r.calls[0].ctx.wide.length, 1000); // リングは 1 秒ぶんしか無い
  assert.equal(r.calls[0].ctx.wide[0], 19000);
});

test('吠えが 0 回、または 0.1 秒未満の塊は出さない', () => {
  const a = make(5000); a.l.clusterStart = 4000; a.l.lastEventEnd = 4300; a.l.events = 0; a.l._emitCluster(5000);
  assert.equal(a.calls.length, 0);
  const b = make(5000); b.l.clusterStart = 4990; b.l.lastEventEnd = -1; b.l.events = 1; b.l.preRollSec = 0; b.l.postRollSec = 0; b.l._emitCluster(5000);
  assert.equal(b.calls.length, 0);
});
