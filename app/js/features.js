// features.js — 吠え検出と特徴量抽出（純粋関数、依存なし）
// 試作 wanlingual-trainer.html の analyze()/pitch()/centroid()/fft() を切り出し、
// ファイル読み込みとマイク常時監視の両方から同じ関数で特徴量を出す。

/** 複素FFT（in-place、長さは2のべき乗） */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** 自己相関による基本周波数の推定（90〜1400Hz）。信頼できなければ 0 */
export function pitch(seg, sr) {
  const N = seg.length;
  let e = 0;
  for (let i = 0; i < N; i++) e += seg[i] * seg[i];
  if (e < 1e-6) return 0;
  const minL = Math.floor(sr / 1400), maxL = Math.floor(sr / 90);
  let best = 0, bl = 0;
  for (let L = minL; L <= maxL; L++) {
    let s = 0;
    for (let i = 0; i < N - L; i++) s += seg[i] * seg[i + L];
    s /= e;
    if (s > best) { best = s; bl = L; }
  }
  return best > 0.3 ? sr / bl : 0;
}

/** スペクトル重心（Hz）。音色の明るさ */
export function centroid(seg, sr) {
  const N = seg.length;
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); re[i] = seg[i] * w; }
  fft(re, im);
  let num = 0, den = 0;
  for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); num += m * k * sr / N; den += m; }
  return den > 0 ? num / den : 0;
}

const mean = a => a.length ? a.reduce((p, q) => p + q, 0) / a.length : 0;

/**
 * モノラル波形 x（Float32Array）と sampleRate から、吠えイベントと特徴量を返す。
 * 戻り値: { feats:{n,dur,gap,f0,cent,gapCv,durCv}, events:[{start,dur,f0,cent,level}], rms, thr, peak, total }
 * opts.thrAbs: 絶対しきい値の下限（マイク監視では少し高めにする）
 */
export function analyzeSamples(x, sr, opts = {}) {
  const n = x.length;
  const frame = 1024, hop = 256;
  const frames = Math.max(1, Math.floor((n - frame) / hop));
  const rms = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    let s = 0; const o = f * hop;
    for (let i = 0; i < frame; i++) { const v = x[o + i] || 0; s += v * v; }
    rms[f] = Math.sqrt(s / frame);
    if (rms[f] > peak) peak = rms[f];
  }
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const floor = sorted[Math.floor(frames * 0.2)] || 0;
  const thr = Math.max(floor * 4, peak * 0.18, opts.thrAbs ?? 0.004);
  const ev = [];
  let inEv = false, st = 0;
  for (let f = 0; f <= frames; f++) {
    const on = f < frames && rms[f] > thr;
    if (on && !inEv) { inEv = true; st = f; }
    else if (!on && inEv) { inEv = false; ev.push({ s: st, e: f }); }
  }
  // 90ms 未満の切れ目は結合、45ms 未満のイベントは捨てる
  const gapF = Math.round(0.09 * sr / hop), minF = Math.round(0.045 * sr / hop);
  const merged = [];
  for (const e of ev) {
    const last = merged[merged.length - 1];
    if (last && e.s - last.e < gapF) last.e = e.e; else merged.push({ ...e });
  }
  const events = merged.filter(e => e.e - e.s >= minF).map(e => {
    let pf = e.s;
    for (let f = e.s; f < e.e; f++) if (rms[f] > rms[pf]) pf = f;
    const o = Math.max(0, Math.min(pf * hop, n - 2048));
    const seg = x.subarray(o, o + 2048);
    return { start: e.s * hop / sr, dur: (e.e - e.s) * hop / sr, f0: pitch(seg, sr), cent: centroid(seg, sr), level: rms[pf] };
  });
  const gaps = events.slice(1).map((e, i) => e.start - (events[i].start + events[i].dur));
  const f0s = events.map(e => e.f0).filter(v => v > 0);
  const gm = mean(gaps);
  const durs = events.map(e => e.dur), dm = mean(durs);
  const feats = {
    n: events.length,
    dur: dm,
    gap: gaps.length ? gm : 0,
    f0: mean(f0s),
    cent: mean(events.map(e => e.cent)),
    gapCv: gaps.length > 1 ? Math.sqrt(mean(gaps.map(g => (g - gm) ** 2))) / Math.max(gm, 1e-6) : 1,
    durCv: events.length > 1 ? Math.sqrt(mean(durs.map(d => (d - dm) ** 2))) / Math.max(dm, 1e-6) : 0,
  };
  return { feats, events, rms, thr, peak, total: n / sr };
}

/** AudioBuffer → モノラル Float32Array */
export function mixdown(buf) {
  const n = buf.length, x = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) x[i] += d[i] / buf.numberOfChannels;
  }
  return x;
}
