// tools/mfcc-bench.mjs — plan #13（MFCC を特徴量に足す）の下調べ用。ライブラリ（meyda 等）を入れずに
// 自前で 13 次元の MFCC を出す手順を書き、1 秒の音に何 ms かかるかを測る。**本体（app/）には入れていない**。
//
//   node tools/mfcc-bench.mjs                 # fixtures の bark4.wav / howl.wav と合成音で計測
//   node tools/mfcc-bench.mjs path/to/x.wav   # 任意の WAV
//
// 手順（教科書どおり。本体の features.js と同じ frame 1024 / hop 256、FFT は features.js の fft() をそのまま使う）:
//   1. フレーム分け（1024 点、256 点ずらし）→ ハン窓 → FFT → パワースペクトル（513 本）
//   2. メルフィルタバンク（26 本、三角、0 Hz〜sr/2。メル尺度 m = 2595·log10(1 + f/700)）を掛けて 26 本に
//   3. log（床 1e-10）
//   4. DCT-II（直交）で 13 係数（c0〜c12。c0 は音量に近いので、判定に使うなら外すか別扱い）
//   5. 塊 1 つ分の要約 = 各係数の平均（と標準偏差）。保存する数字が 13〜26 個増える
//
// 計算量の目安: 1 秒（44.1kHz）で約 169 フレーム。1 フレームにつき FFT 1024（features.js の centroid() が 1 回の声につき
// 最大 6 回やっているものと同じ）＋ 26×513 の内積 ＋ 13×26 の DCT。
import { fft } from '../app/js/features.js';

export const hzToMel = f => 2595 * Math.log10(1 + f / 700);
export const melToHz = m => 700 * (10 ** (m / 2595) - 1);

/**
 * 三角メルフィルタバンク。戻り値: nMel 本 × (nFft/2+1) の Float32Array（各フィルタは最大値 1 の三角）。
 * ついでに各フィルタの中心周波数（Hz）も返す。
 */
export function melFilterbank(nFft, sr, nMel = 26, fmin = 0, fmax = sr / 2) {
  const nBins = nFft / 2 + 1;
  const mels = [], lo = hzToMel(fmin), hi = hzToMel(fmax);
  for (let i = 0; i < nMel + 2; i++) mels.push(melToHz(lo + (hi - lo) * i / (nMel + 1)));
  const bin = f => f * nFft / sr; // Hz → FFT のビン（小数）
  const filters = [], centers = [];
  for (let m = 0; m < nMel; m++) {
    const l = bin(mels[m]), c = bin(mels[m + 1]), r = bin(mels[m + 2]);
    const w = new Float32Array(nBins);
    for (let k = Math.max(0, Math.floor(l)); k <= Math.min(nBins - 1, Math.ceil(r)); k++) {
      if (k >= l && k <= c && c > l) w[k] = (k - l) / (c - l);
      else if (k > c && k <= r && r > c) w[k] = (r - k) / (r - c);
    }
    filters.push(w); centers.push(mels[m + 1]);
  }
  return { filters, centers, nBins };
}

/** DCT-II（直交）の行列。nCoef 行 × nMel 列 */
export function dctMatrix(nMel, nCoef = 13) {
  const rows = [];
  for (let i = 0; i < nCoef; i++) {
    const r = new Float32Array(nMel);
    const s = i === 0 ? Math.sqrt(1 / nMel) : Math.sqrt(2 / nMel);
    for (let j = 0; j < nMel; j++) r[j] = s * Math.cos(Math.PI * i * (j + 0.5) / nMel);
    rows.push(r);
  }
  return rows;
}

/**
 * 波形 x（Float32Array、sr）→ フレームごとの MFCC（Float32Array(nCoef) の配列）。
 * opts: frame=1024, hop=256, nMel=26, nCoef=13。バッファは呼び出しごとに 1 組だけ確保して使い回す。
 */
export function mfccFrames(x, sr, opts = {}) {
  const frame = opts.frame ?? 1024, hop = opts.hop ?? 256, nMel = opts.nMel ?? 26, nCoef = opts.nCoef ?? 13;
  const { filters, nBins } = opts.bank ?? melFilterbank(frame, sr, nMel);
  const dct = opts.dct ?? dctMatrix(nMel, nCoef);
  const win = new Float32Array(frame);
  for (let i = 0; i < frame; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (frame - 1));
  const re = new Float32Array(frame), im = new Float32Array(frame), pow = new Float32Array(nBins), logE = new Float32Array(nMel);
  const frames = Math.max(0, Math.floor((x.length - frame) / hop) + 1);
  const out = [];
  for (let f = 0; f < frames; f++) {
    const o = f * hop;
    for (let i = 0; i < frame; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < nBins; k++) pow[k] = re[k] * re[k] + im[k] * im[k];
    for (let m = 0; m < nMel; m++) {
      const w = filters[m]; let s = 0;
      for (let k = 0; k < nBins; k++) if (w[k] !== 0) s += w[k] * pow[k];
      logE[m] = Math.log(Math.max(s, 1e-10));
    }
    const c = new Float32Array(nCoef);
    for (let i = 0; i < nCoef; i++) { const r = dct[i]; let s = 0; for (let j = 0; j < nMel; j++) s += r[j] * logE[j]; c[i] = s; }
    out.push(c);
  }
  return out;
}

/** フレームごとの MFCC → 塊 1 つの要約 { mean: Float32Array(nCoef), sd: Float32Array(nCoef) } */
export function mfccSummary(frames) {
  if (!frames.length) return { mean: new Float32Array(0), sd: new Float32Array(0) };
  const n = frames[0].length, mean = new Float32Array(n), sd = new Float32Array(n);
  for (const c of frames) for (let i = 0; i < n; i++) mean[i] += c[i] / frames.length;
  for (const c of frames) for (let i = 0; i < n; i++) sd[i] += (c[i] - mean[i]) ** 2 / frames.length;
  for (let i = 0; i < n; i++) sd[i] = Math.sqrt(sd[i]);
  return { mean, sd };
}

/**
 * 声 1 回ごと（events: [{start, dur}] 秒。features.js の analyzeSamples().events）の中にあるフレームだけの MFCC の要約
 * { frames, mean, sd }。声と声の間（無音・環境音）のフレームは入れない。フレームの中心（f·hop + frame/2）がどれかの声の中に
 * あるものを使う。本体に入れるときは塊 1 つが 1 回の呼び出しになる想定（2026-11-15、lab-yamnet の表のため）。
 */
export function mfccOfEvents(x, sr, events, opts = {}) {
  const frame = opts.frame ?? 1024, hop = opts.hop ?? 256;
  const inVoice = t => events.some(e => t >= e.start && t < e.start + e.dur);
  const picked = mfccFrames(x, sr, opts).filter((_, f) => inVoice((f * hop + frame / 2) / sr));
  return { frames: picked.length, ...mfccSummary(picked) };
}

/** 1 秒あたりの処理時間（ms）を reps 回測って中央値・最小・最大を返す */
export function bench(x, sr, reps = 20, opts = {}) {
  const bank = melFilterbank(opts.frame ?? 1024, sr, opts.nMel ?? 26), dct = dctMatrix(opts.nMel ?? 26, opts.nCoef ?? 13);
  const times = [];
  let frames = 0;
  for (let r = 0; r < reps; r++) {
    const t0 = performance.now();
    frames = mfccFrames(x, sr, { ...opts, bank, dct }).length;
    times.push((performance.now() - t0) * sr / x.length); // 1 秒あたりに換算
  }
  const s = times.slice().sort((a, b) => a - b);
  return { msPerSec: s[s.length >> 1], min: s[0], max: s[s.length - 1], frames, framesPerSec: frames * sr / x.length };
}

// ここから下はコマンドラインで実行したときだけ（ブラウザから import しても純粋関数だけが読める）
const isMain = typeof process !== 'undefined' && process.argv?.[1] && import.meta.url.endsWith('/tools/mfcc-bench.mjs')
  && (await import('node:path')).resolve(process.argv[1]) === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  const fs = await import('node:fs'), path = await import('node:path'), { fileURLToPath } = await import('node:url');
  const { readWav } = await import('../tests/lab/wav.mjs');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const files = process.argv.slice(2);
  if (!files.length) for (const f of ['bark4.wav', 'howl.wav']) { const p = path.join(here, '../tests/fixtures', f); if (fs.existsSync(p)) files.push(p); }
  const inputs = files.map(f => ({ name: path.basename(f), ...readWav(f) }));
  const sr = 44100, x = new Float32Array(sr);
  for (let i = 0; i < sr; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr) + 0.05 * (Math.random() * 2 - 1);
  inputs.push({ name: '合成 1 秒（440Hz ＋ ノイズ）', x, sr });
  console.log(`node ${process.version}  frame 1024 / hop 256 / mel 26 / coef 13`);
  console.log('| 音 | 秒 | sr | フレーム/秒 | 1 秒あたり ms（中央値） | 最小 | 最大 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const inp of inputs) {
    const b = bench(inp.x, inp.sr);
    console.log(`| ${inp.name} | ${(inp.x.length / inp.sr).toFixed(2)} | ${inp.sr} | ${b.framesPerSec.toFixed(0)} | ${b.msPerSec.toFixed(1)} | ${b.min.toFixed(1)} | ${b.max.toFixed(1)} |`);
  }
  const fr = mfccFrames(inputs[inputs.length - 1].x, sr), s = mfccSummary(fr);
  console.log('\n合成音の MFCC 平均（c0〜c12）:', Array.from(s.mean).map(v => v.toFixed(2)).join(' '));
}
