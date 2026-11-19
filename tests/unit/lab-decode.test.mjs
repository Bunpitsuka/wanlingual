// tests/lab/decode.mjs（mp3 → WAV を Chromium でやる前の、ヘッダ読みと WAV 書き出し）の純粋関数。ネット・Chromium 不要。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mp3SampleRate, writeWav } from '../lab/decode.mjs';
import { readWav } from '../lab/wav.mjs';

/** 同じヘッダのフレームを n 個並べた偽 mp3。b1 = version/layer、b2 = bitrate/sr/padding、len = フレーム長 */
const frames = (b1, b2, len, n = 3) => Buffer.concat(Array.from({ length: n }, () => Buffer.concat([Buffer.from([0xff, b1, b2, 0xc0]), Buffer.alloc(len - 4, 0x55)])));
/** ID3v2.3 ヘッダ（タグ本体 size byte） */
const id3 = (size) => Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]), Buffer.alloc(size, 0xff)]);

test('mp3 のヘッダ: MPEG-1 Layer III 128kbps の 44.1k / 48k / 32k、MPEG-2 の 16k、ID3v2 を飛ばす', () => {
  assert.equal(mp3SampleRate(frames(0xfb, 0x90, 417)), 44100);  // 144×128000/44100 = 417
  assert.equal(mp3SampleRate(frames(0xfb, 0x94, 384)), 48000);  // 144×128000/48000 = 384
  assert.equal(mp3SampleRate(frames(0xfb, 0x98, 576)), 32000);
  assert.equal(mp3SampleRate(frames(0xf3, 0x98, 360)), 16000);  // MPEG-2 Layer III 80kbps: 72×80000/16000 = 360
  assert.equal(mp3SampleRate(Buffer.concat([id3(300), frames(0xfb, 0x90, 417)])), 44100, 'ID3 の中の 0xff を sync と間違えない');
  assert.equal(mp3SampleRate(frames(0xfb, 0x92, 418)), 44100, 'padding ビットでフレームが 1 byte 長くてもよい');
});

test('mp3 のヘッダ: sync が無い・次のフレームが続かない・予約値なら null', () => {
  assert.equal(mp3SampleRate(Buffer.alloc(5000, 0x55)), null);
  assert.equal(mp3SampleRate(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0xc0]), Buffer.alloc(2000, 0x55)])), null, '偶然の sync 1 つだけ');
  assert.equal(mp3SampleRate(frames(0xfb, 0x9c, 417)), null, 'sr index 3 は予約');
  assert.equal(mp3SampleRate(frames(0xeb, 0x90, 417)), null, 'version 01 は予約');
  assert.equal(mp3SampleRate(Buffer.alloc(0)), null);
});

test('writeWav → readWav で sr と波形（16bit の丸め以内 1e-4）が戻る。クリップしない', () => {
  const sr = 16000, x = Float32Array.from({ length: 1600 }, (_, i) => 0.8 * Math.sin(2 * Math.PI * 440 * i / sr));
  x[10] = 1.5; x[11] = -1.5; // 範囲外は ±1 に丸める
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-wav-')), 'a.wav');
  writeWav(f, x, sr);
  const r = readWav(f);
  assert.equal(r.sr, sr); assert.equal(r.x.length, x.length);
  for (let i = 0; i < x.length; i++) assert.ok(Math.abs(r.x[i] - Math.max(-1, Math.min(1, x[i]))) < 1e-4, `sample ${i}`);
  assert.equal(fs.statSync(f).size, 44 + 1600 * 2);
  fs.rmSync(path.dirname(f), { recursive: true });
});
