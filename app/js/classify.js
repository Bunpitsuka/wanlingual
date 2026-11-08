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

/**
 * ルールの材料（0〜1 の「どれくらい当てはまるか」）。rules() と explain() が同じものを見る。
 * ピッチが取れない（f0=0）ときは高い／低いを 0.5（どちらとも言えない）、1 回しか吠えていないときは間隔の項を使わない。
 */
export function terms(f) {
  const lowP = f.f0 > 0 ? clamp((500 - f.f0) / 300, 0, 1) : 0.5;
  const highP = f.f0 > 0 ? clamp((f.f0 - 350) / 400, 0, 1) : 0.5;
  const fast = f.n >= 2 ? clamp((0.6 - f.gap) / 0.5, 0, 1) : 0;
  const slow = f.n >= 2 ? clamp((f.gap - 0.4) / 0.8, 0, 1) : 0.5;
  const longD = clamp((f.dur - 0.35) / 0.6, 0, 1), shortD = 1 - longD;
  const dark = clamp((2200 - f.cent) / 1500, 0, 1);
  const regular = 1 - clamp(f.gapCv, 0, 1), many = clamp((f.n - 2) / 5, 0, 1);
  return { lowP, highP, notHigh: 1 - highP, fast, slow, longD, shortD, dark, bright: 1 - dark, regular, many };
}

/** 気持ちごとの重み（Pongrácz 2005 の単純化）。項の順番は合計の丸めが変わらないよう固定 */
export const WEIGHTS = {
  alarm:   [['fast', 0.45], ['shortD', 0.25], ['many', 0.2], ['notHigh', 0.1]],
  threat:  [['lowP', 0.45], ['longD', 0.3], ['dark', 0.25]],
  demand:  [['regular', 0.4], ['highP', 0.3], ['slow', 0.2], ['shortD', 0.1]],
  play:    [['highP', 0.4], ['slow', 0.3], ['shortD', 0.3]],
  lonely:  [['longD', 0.5], ['highP', 0.3], ['bright', 0.2]],
  excited: [['fast', 0.4], ['highP', 0.4], ['many', 0.2]],
};

/** ルールベースのスコア（合計1） */
export function rules(f) {
  const t = terms(f), s = {};
  for (const c of CATS) s[c.k] = WEIGHTS[c.k].reduce((a, [name, w]) => a + w * t[name], 0);
  return norm(s);
}

/** 各項を飼い主向けの言葉に。数字は特徴量から埋める */
const ms = v => Math.round(v * 1000) + 'ms', hz = v => Math.round(v) + 'Hz';
const TERM_TEXT = {
  fast:    f => `間隔が短い連吠え（${ms(f.gap)}）`,
  slow:    f => `間隔がゆったり（${ms(f.gap)}）`,
  regular: f => '間隔がそろっている',
  many:    f => `回数が多い（${f.n}回）`,
  longD:   f => `1回が長い声（${ms(f.dur)}）`,
  shortD:  f => `1回が短い声（${ms(f.dur)}）`,
  lowP:    f => `声が低い（${hz(f.f0)}）`,
  highP:   f => `声が高い（${hz(f.f0)}）`,
  notHigh: f => `声が高すぎない（${hz(f.f0)}）`,
  dark:    f => `こもった音色（明るさ ${hz(f.cent)}）`,
  bright:  f => `明るい音色（明るさ ${hz(f.cent)}）`,
};
/** ピッチが取れていない・1 回しか吠えていないときは、その項を理由に挙げない */
function termUsable(name, f) {
  if (['lowP', 'highP', 'notHigh'].includes(name)) return f.f0 > 0;
  if (['fast', 'slow', 'regular'].includes(name)) return f.n >= 2;
  if (name === 'many') return f.n >= 3;
  return true;
}

/**
 * 判定の「なぜ」（plan #22）。1 位の気持ち k に効いた特徴を、効いた順に最大 max 個の短い日本語で返す。
 * ルールの項は「重み×当てはまり」が大きいものから（当てはまり 0.6 未満＝どちらとも言えないものは挙げない）。
 * 飼い主が教えたサンプルが 3 件以上あれば、似た声のうち何件を k と教えていたかも 1 つ足す（kNN の根拠）。
 * 戻り値: string[]（空なら「決め手なし」）。本物の翻訳ではなく推測なので、UI では「理由」ではなく「こう見ました」の調子で出す。
 */
export function explain(f, k, samples, max = 3) {
  if (!f || !WEIGHTS[k]) return [];
  const t = terms(f);
  const out = WEIGHTS[k]
    .filter(([name]) => termUsable(name, f) && t[name] >= 0.6)
    .map(([name, w]) => ({ name, c: w * t[name] }))
    .sort((a, b) => b.c - a.c)
    .slice(0, max)
    .map(e => TERM_TEXT[e.name](f));
  const nn = neighbors(f, samples);
  if (nn) {
    const m = nn.filter(e => e.l === k).length;
    if (m > 0) out.push(`教えてもらった似た声 ${nn.length}件のうち ${m}件が「${CAT[k].label}」`);
  }
  return out;
}

/** 特徴量 → 正規化ベクトル（kNN 用） */
export function vec(f) {
  return [
    clamp(f.n, 0, 12) / 12, clamp(f.dur, 0, 1.5) / 1.5, clamp(f.gap, 0, 2) / 2,
    clamp(f.f0, 0, 1200) / 1200, clamp(f.cent, 0, 5000) / 5000,
    clamp(f.gapCv, 0, 1.5) / 1.5, clamp(f.durCv, 0, 1.5) / 1.5,
  ];
}

/** f に近い順の飼い主サンプル k 件 [{l, d}]。3件未満なら null（knn と explain が共用） */
export function neighbors(f, samples, k = 5) {
  if (!samples || samples.length < 3) return null;
  const v = vec(f);
  return samples
    .map(s => ({ l: s.label, d: Math.sqrt(vec(s.f).reduce((a, x, i) => a + (x - v[i]) ** 2, 0)) }))
    .sort((a, b) => a.d - b.d).slice(0, k);
}

/** 飼い主ラベル付きサンプル samples=[{label,f}] による距離重み kNN（k=5）。3件未満なら null */
export function knn(f, samples, k = 5) {
  const d = neighbors(f, samples, k);
  if (!d) return null;
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
