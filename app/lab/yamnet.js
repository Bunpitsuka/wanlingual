// yamnet.js — フェーズ2の試作: YAMNet（Google の 521 クラス音声分類）で「犬の声か、それ以外か」を見分ける。
// 本体アプリ（app/js/）からはまだ呼ばない。ここで試して、使えると分かったら mic.js の前段に入れる。
//
// 依存: TensorFlow.js を CDN の固定バージョンで読む（yamnet.html 側の <script>）。
//   https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js
// モデル: TF Hub の YAMNet TF.js 版 v1（固定）。tfhub.dev は Kaggle Models に転送される。
//   tf.loadGraphModel(YAMNET_URL, { fromTFHub: true })
// 入力: 16kHz モノラルの波形（-1〜1）。出力: 0.48 秒ごとの 521 クラスのスコア（0〜1）。
//
// 純粋関数（resampleTo16k, dogScore, topK, decideDog）は Node の単体テストで検証する。tf を使う部分は end-to-end でしか試せない。

import { YAMNET_CLASSES, DOG_CLASS_INDEXES } from './yamnet_classes.js';

export const TFJS_VERSION = '4.22.0';
export const YAMNET_URL = 'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1';
export const YAMNET_SR = 16000;
export const N_CLASSES = 521;
/** YAMNet が1フレーム出すのに必要な最短の長さ（0.975 秒）。短い音はゼロ埋めする */
export const MIN_SAMPLES = 15600;

/** 任意のサンプルレートのモノラル波形を 16kHz に線形補間で落とす（ダウンサンプル前に簡単な平均で帯域を落とす） */
export function resampleTo16k(x, sr) {
  if (sr === YAMNET_SR) return Float32Array.from(x);
  const ratio = sr / YAMNET_SR;
  const outLen = Math.max(1, Math.floor(x.length / ratio));
  const out = new Float32Array(outLen);
  if (ratio > 1) {
    // 粗いアンチエイリアス: 入力側で ratio 個ぶんを平均
    const w = Math.max(1, Math.round(ratio));
    for (let i = 0; i < outLen; i++) {
      const c = i * ratio; const s = Math.max(0, Math.floor(c - w / 2)); const e = Math.min(x.length, s + w);
      let sum = 0; for (let j = s; j < e; j++) sum += x[j];
      out[i] = e > s ? sum / (e - s) : 0;
    }
  } else {
    for (let i = 0; i < outLen; i++) {
      const c = i * ratio, i0 = Math.floor(c), i1 = Math.min(x.length - 1, i0 + 1), t = c - i0;
      out[i] = x[i0] * (1 - t) + x[i1] * t;
    }
  }
  return out;
}

/** 短すぎる入力をゼロ埋めして最低 MIN_SAMPLES にする */
export function padMin(x, min = MIN_SAMPLES) {
  if (x.length >= min) return x;
  const out = new Float32Array(min); out.set(x); return out;
}

/**
 * scores: フレーム数 × 521 の配列（Array<Float32Array|number[]>）。
 * 戻り値: { dog: フレーム内の犬系クラス最大値をフレーム間で最大にしたもの, dogMean: 同じものの平均, frames }
 * 「犬系クラス」= Dog, Bark, Yip, Howl, Bow-wow, Growling, Whimper (dog)。
 */
export function dogScore(scores, idx = DOG_CLASS_INDEXES) {
  let best = 0, sum = 0;
  for (const row of scores) {
    let m = 0; for (const i of idx) if (row[i] > m) m = row[i];
    if (m > best) best = m; sum += m;
  }
  return { dog: best, dogMean: scores.length ? sum / scores.length : 0, frames: scores.length };
}

/** 全フレーム平均で上位 k クラス。[{index, name, score}] */
export function topK(scores, k = 5, names = YAMNET_CLASSES) {
  const n = scores[0]?.length || 0; const mean = new Float64Array(n);
  for (const row of scores) for (let i = 0; i < n; i++) mean[i] += row[i] / scores.length;
  return Array.from(mean, (score, index) => ({ index, name: names[index] || String(index), score }))
    .sort((a, b) => b.score - a.score).slice(0, k);
}

/**
 * 犬か犬以外かの判定。しきい値は仮（本物の犬と生活音で測ってから決める）。
 * 戻り値: { isDog, label: '犬の声' | '犬ではなさそう' | '判断つかず', dog, top }
 */
export function decideDog(scores, { hi = 0.3, lo = 0.1 } = {}) {
  const { dog, dogMean, frames } = dogScore(scores);
  const top = topK(scores, 5);
  const isDog = dog >= hi;
  const label = isDog ? '犬の声' : dog < lo ? '犬ではなさそう' : '判断つかず';
  return { isDog, label, dog, dogMean, frames, top };
}

/** モデルの出力（Tensor の配列か単体）から scores（frames × 521）を取り出す。順番は shape で見分ける */
export function pickScores(outputs) {
  const arr = Array.isArray(outputs) ? outputs : [outputs];
  return arr.find(t => t.shape?.length === 2 && t.shape[1] === N_CLASSES) || null;
}

/** 読み込み（tf はグローバル）。失敗は日本語のメッセージで投げる */
export async function loadYamnet(tf, url = YAMNET_URL) {
  if (!tf) throw new Error('TensorFlow.js が読み込めていません（CDN に届かないか、オフライン）');
  try {
    return await tf.loadGraphModel(url, { fromTFHub: true });
  } catch (e) {
    throw new Error('YAMNet のモデルが読み込めません（tfhub.dev / kaggle.com に届かないか、オフライン）: ' + (e?.message || e));
  }
}

/** 推論。x16k: 16kHz の Float32Array。戻り値は decideDog() の結果 + 処理時間 ms */
export async function classify(tf, model, x16k) {
  const t0 = performance.now();
  const input = tf.tensor1d(padMin(x16k), 'float32');
  let outs;
  try {
    outs = model.execute(input);
    const st = pickScores(outs);
    if (!st) throw new Error('scores の出力が見つかりません');
    const scores = await st.array();
    const r = decideDog(scores);
    r.ms = Math.round(performance.now() - t0);
    return r;
  } finally {
    input.dispose();
    (Array.isArray(outs) ? outs : [outs]).forEach(t => t?.dispose?.());
  }
}
