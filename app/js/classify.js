// classify.js — ルール（事前知識）＋飼い主ラベルの kNN（個体学習）
// ルールは Pongrácz ら 2005 の知見の単純化。「本物の翻訳ではなく吠え方の特徴からの推測」。

export const CATS = [
  { k: 'alarm',   label: '警戒',   hint: '来客・物音',   glyph: '!!',  line: (d, o) => `${o}、誰か来た！${d}が見てるからね！` },
  { k: 'threat',  label: '威嚇',   hint: '唸り・低い声', glyph: '>:(', line: (d, o) => `それ以上近づくなよ…${o}は${d}が守る。` },
  { k: 'demand',  label: '要求',   hint: 'ごはん・散歩', glyph: '><',  line: (d, o) => `${o}！こっち！ねえ、ごはん！さんぽ！` },
  { k: 'play',    label: '遊ぼう', hint: '誘い・はしゃぎ', glyph: '^^', line: (d, o) => `${o}、あそぼ！ボール投げて！もう一回！` },
  { k: 'lonely',  label: 'さみしい', hint: '留守番・クーン', glyph: '…', line: (d, o) => `${o}、どこ…？${d}はここでずっと待ってるよ。` },
  { k: 'excited', label: 'うれしい', hint: 'お出迎え', glyph: '!!!', line: (d, o) => `${o}が帰ってきた！${d}うれしい！うれしい！` },
];
export const CAT = Object.fromEntries(CATS.map(c => [c.k, c]));

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function norm(s) { const t = Object.values(s).reduce((a, b) => a + b, 0) || 1; for (const k in s) s[k] /= t; return s; }

/** ルールベースのスコア（合計1） */
export function rules(f) {
  const s = {};
  const lowP = f.f0 > 0 ? clamp((500 - f.f0) / 300, 0, 1) : 0.5;
  const highP = f.f0 > 0 ? clamp((f.f0 - 350) / 400, 0, 1) : 0.5;
  const fast = f.n >= 2 ? clamp((0.6 - f.gap) / 0.5, 0, 1) : 0;
  const slow = f.n >= 2 ? clamp((f.gap - 0.4) / 0.8, 0, 1) : 0.5;
  const longD = clamp((f.dur - 0.35) / 0.6, 0, 1), shortD = 1 - longD;
  const dark = clamp((2200 - f.cent) / 1500, 0, 1);
  const regular = 1 - clamp(f.gapCv, 0, 1), many = clamp((f.n - 2) / 5, 0, 1);
  s.alarm   = 0.45 * fast + 0.25 * shortD + 0.2 * many + 0.1 * (1 - highP);
  s.threat  = 0.45 * lowP + 0.3 * longD + 0.25 * dark;
  s.demand  = 0.4 * regular + 0.3 * highP + 0.2 * slow + 0.1 * shortD;
  s.play    = 0.4 * highP + 0.3 * slow + 0.3 * shortD;
  s.lonely  = 0.5 * longD + 0.3 * highP + 0.2 * (1 - dark);
  s.excited = 0.4 * fast + 0.4 * highP + 0.2 * many;
  return norm(s);
}

/** 特徴量 → 正規化ベクトル（kNN 用） */
export function vec(f) {
  return [
    clamp(f.n, 0, 12) / 12, clamp(f.dur, 0, 1.5) / 1.5, clamp(f.gap, 0, 2) / 2,
    clamp(f.f0, 0, 1200) / 1200, clamp(f.cent, 0, 5000) / 5000,
    clamp(f.gapCv, 0, 1.5) / 1.5, clamp(f.durCv, 0, 1.5) / 1.5,
  ];
}

/** 飼い主ラベル付きサンプル samples=[{label,f}] による距離重み kNN（k=5）。3件未満なら null */
export function knn(f, samples, k = 5) {
  if (!samples || samples.length < 3) return null;
  const v = vec(f);
  const d = samples
    .map(s => ({ l: s.label, d: Math.sqrt(vec(s.f).reduce((a, x, i) => a + (x - v[i]) ** 2, 0)) }))
    .sort((a, b) => a.d - b.d).slice(0, k);
  const s = {}; for (const c of CATS) s[c.k] = 0;
  for (const e of d) if (e.l in s) s[e.l] += 1 / (0.05 + e.d);
  return norm(s);
}

/** ルールと kNN をサンプル数 n に応じて n/(n+8) でブレンド */
export function predict(f, samples) {
  const r = rules(f), kk = knn(f, samples);
  if (!kk) return r;
  const n = samples.length, w = n / (n + 8);
  const s = {}; for (const c of CATS) s[c.k] = (1 - w) * r[c.k] + w * kk[c.k];
  return s;
}

export const top = s => CATS.reduce((p, c) => (s[c.k] > s[p.k] ? c : p));

/**
 * 気持ち別の集計（育成ログの上に出す）。正解ラベルごとの件数と、判定が当たった件数。
 * 戻り値: [{ k, label, n, hits }]（件数の多い順。0 件の気持ちは含めない）
 */
export function tally(samples) {
  const m = {};
  for (const s of samples || []) {
    if (!CAT[s.label]) continue;
    const t = (m[s.label] ||= { k: s.label, label: CAT[s.label].label, n: 0, hits: 0 });
    t.n++; if (s.pred && s.pred === s.label) t.hits++;
  }
  return CATS.map(c => m[c.k]).filter(Boolean).sort((a, b) => b.n - a.n);
}

/** 育成度（ラベル数で段階） */
export const STAGES = [[0, 'たまご'], [5, '子犬'], [15, '若犬'], [40, '成犬'], [100, '名犬'], [250, 'ポポ級']];
export function growth(samples) {
  const n = samples.length;
  let si = 0; for (let i = 0; i < STAGES.length; i++) if (n >= STAGES[i][0]) si = i;
  const nxt = STAGES[si + 1], base = STAGES[si][0];
  const recent = samples.slice(-20).filter(s => s.pred);
  const hits = recent.filter(s => s.pred === s.label).length;
  return {
    n, stage: STAGES[si][1], stageIndex: si,
    progress: nxt ? clamp((n - base) / (nxt[0] - base), 0, 1) : 1,
    nextStage: nxt ? nxt[1] : null, toNext: nxt ? nxt[0] - n : 0,
    accuracy: recent.length ? hits / recent.length : null, recentCount: recent.length,
  };
}
