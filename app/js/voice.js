// voice.js — セリフの読み上げ（Web Speech API）の声選びと調子。plan #22「読み上げ声の調整」。
// DOM に触らない純粋関数だけを置き、app.js が SpeechSynthesisUtterance に当てる。
// 方針: (1) 端末にある日本語の声から、オフラインで動く声・既定の声・よく使われる声を優先して 1 つ選ぶ。
//       (2) 気持ちごとに高さ（pitch）と速さ（rate）を少し変える（従来は全部 pitch 1.4 / rate 1.05 の固定）。
//       声そのものは端末に入っているものしか使えない（ネットから声を取りに行かない）。

/** 従来の固定値。気持ちが分からないときはこれ */
export const BASE = { pitch: 1.4, rate: 1.05 };

/**
 * 気持ちごとの調子。小さめの差にとどめる（極端にすると機械音っぽくなる端末がある）。
 * 警戒: 速くきびきび／威嚇: 低くゆっくり／要求: 高めで少し急ぐ／遊ぼう: 高くはしゃぐ／さみしい: ややゆっくり控えめ／うれしい: いちばん高く速い
 */
export const TONES = {
  alarm:   { pitch: 1.3, rate: 1.25 },
  threat:  { pitch: 0.8, rate: 0.9 },
  demand:  { pitch: 1.5, rate: 1.15 },
  play:    { pitch: 1.6, rate: 1.2 },
  lonely:  { pitch: 1.25, rate: 0.85 },
  excited: { pitch: 1.7, rate: 1.25 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 気持ち k の高さ・速さ。Web Speech の範囲（pitch 0〜2、rate 0.1〜10）に収める */
export function tone(k) {
  const t = TONES[k] || BASE;
  return { pitch: clamp(t.pitch, 0, 2), rate: clamp(t.rate, 0.1, 10) };
}

/** 名前にこれが入っている声は、日本語として聞きやすいことが多いので少し優先（iOS: Kyoko / O-ren、Android: Google 日本語、Windows: Nanami / Ayumi / Haruka） */
const PREFERRED_NAMES = ['kyoko', 'o-ren', 'google 日本語', 'nanami', 'ayumi', 'haruka', 'ichiro', 'sayaka'];

const isJa = v => /^ja\b/i.test(String(v?.lang || '').replace('_', '-'));

/**
 * speechSynthesis.getVoices() の配列から日本語の声を 1 つ選ぶ。無ければ null（lang='ja-JP' だけ指定して端末任せにする）。
 * 点数: 日本語 … 必須／端末内（localService）+2＝オフラインでも鳴る／既定（default）+1／よく使われる名前 +1。
 * 同点なら配列の先頭（端末が並べた順）を採る。
 */
export function pickVoice(voices) {
  const ja = (voices || []).filter(isJa);
  if (!ja.length) return null;
  const score = v => (v.localService ? 2 : 0) + (v.default ? 1 : 0) + (PREFERRED_NAMES.some(n => String(v.name || '').toLowerCase().includes(n)) ? 1 : 0);
  let best = ja[0], bs = score(best);
  for (const v of ja.slice(1)) { const s = score(v); if (s > bs) { best = v; bs = s; } }
  return best;
}

/**
 * 読み上げに当てる設定をまとめて返す: { lang, pitch, rate, voice }。
 * voice は pickVoice の結果（null なら当てない）。app.js はこれを SpeechSynthesisUtterance に写す。
 */
export function utteranceOptions(k, voices) {
  return { lang: 'ja-JP', ...tone(k), voice: pickVoice(voices) };
}
