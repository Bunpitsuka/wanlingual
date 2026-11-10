// 読み上げ声の単体テスト（plan #22「読み上げ声の調整」）。声の選び方と、気持ちごとの高さ・速さ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickVoice, tone, utteranceOptions, TONES, BASE } from '../../app/js/voice.js';
import { CATS } from '../../app/js/classify.js';

const V = (name, lang, extra = {}) => ({ name, lang, localService: false, default: false, ...extra });

test('6 つの気持ち全部に調子があり、Web Speech の範囲（pitch 0〜2、rate 0.1〜10）に収まる', () => {
  for (const c of CATS) {
    assert.ok(TONES[c.k], c.k);
    const t = tone(c.k);
    assert.ok(t.pitch >= 0 && t.pitch <= 2, `${c.k} pitch ${t.pitch}`);
    assert.ok(t.rate >= 0.1 && t.rate <= 10, `${c.k} rate ${t.rate}`);
  }
  // 威嚇は低くゆっくり、うれしい・遊ぼうは高く速い、さみしいはゆっくり（文言の調子に合わせる）
  assert.ok(tone('threat').pitch < BASE.pitch && tone('threat').rate < 1);
  assert.ok(tone('excited').pitch > BASE.pitch && tone('excited').rate > 1);
  assert.ok(tone('play').pitch > BASE.pitch);
  assert.ok(tone('lonely').rate < 1);
});

test('気持ちが分からないときは従来の固定値（pitch 1.4 / rate 1.05）', () => {
  assert.deepEqual(tone(undefined), BASE);
  assert.deepEqual(tone('nope'), BASE);
});

test('日本語の声だけを選ぶ。無ければ null（lang だけ指定して端末任せ）', () => {
  assert.equal(pickVoice([]), null);
  assert.equal(pickVoice(undefined), null);
  assert.equal(pickVoice([V('Samantha', 'en-US'), V('Thomas', 'fr-FR')]), null);
  const ja = V('Kyoko', 'ja-JP');
  assert.equal(pickVoice([V('Samantha', 'en-US'), ja]), ja);
  // Android は 'ja_JP' のようにアンダースコアで来ることがある
  const jaUnderscore = V('Google 日本語', 'ja_JP');
  assert.equal(pickVoice([V('English', 'en_US'), jaUnderscore]), jaUnderscore);
});

test('端末内の声（オフラインで鳴る）を優先し、次に既定の声、よく使われる名前。同点なら端末の並び順', () => {
  const net = V('Google 日本語', 'ja-JP', { localService: false });
  const local = V('Hattori', 'ja-JP', { localService: true });
  assert.equal(pickVoice([net, local]), local, '端末内の声が勝つ');
  const dflt = V('Kyoko', 'ja-JP', { localService: true, default: true });
  assert.equal(pickVoice([local, dflt]), dflt, '既定の声が勝つ');
  const plain = V('Voice A', 'ja-JP', { localService: true });
  const known = V('O-ren', 'ja-JP', { localService: true });
  assert.equal(pickVoice([plain, known]), known, 'よく使われる名前が勝つ');
  const first = V('Voice A', 'ja-JP', { localService: true }), second = V('Voice B', 'ja-JP', { localService: true });
  assert.equal(pickVoice([first, second]), first, '同点なら先頭');
});

test('utteranceOptions は lang・pitch・rate・voice をまとめて返す', () => {
  const kyoko = V('Kyoko', 'ja-JP', { localService: true });
  const o = utteranceOptions('excited', [V('Samantha', 'en-US'), kyoko]);
  assert.equal(o.lang, 'ja-JP');
  assert.deepEqual({ pitch: o.pitch, rate: o.rate }, tone('excited'));
  assert.equal(o.voice, kyoko);
  assert.equal(utteranceOptions('alarm', []).voice, null);
});
