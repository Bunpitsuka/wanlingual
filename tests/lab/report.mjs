// YAMNet 実測結果の集計（純粋関数。単体テストあり）
/** 本物の犬と犬以外があれば、しきい値ごとの「犬を拾う率」「犬以外を通す率」の表と分布を返す。無ければ空文字 */
export function thresholdReport(rows) {
  const dogs = rows.filter(r => r.category.startsWith('dog')), others = rows.filter(r => r.source === 'ESC-50' && !r.category.startsWith('dog'));
  if (!dogs.length || !others.length) return '';
  const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const dist = arr => `中央値 ${(q(arr, 0.5) * 100).toFixed(0)}%（10–90%: ${(q(arr, 0.1) * 100).toFixed(0)}–${(q(arr, 0.9) * 100).toFixed(0)}%、n=${arr.length}）`;
  let md = `**本物の犬 ${dogs.length} 本 vs 犬以外 ${others.length} 本（ESC-50 ${[...new Set(others.map(o => o.category))].length} クラス）**\n\n`;
  md += `- 犬らしさ(最大) 犬: ${dist(dogs.map(r => r.dog))} ／ 犬以外: ${dist(others.map(r => r.dog))}\n`;
  md += `- 犬らしさ(平均) 犬: ${dist(dogs.map(r => r.dogMean))} ／ 犬以外: ${dist(others.map(r => r.dogMean))}\n\n`;
  md += `| しきい値（最大） | 犬を「犬」と判定 | 犬以外を「犬」と誤判定 | 犬以外のうち誤判定したクラス |\n|---|---|---|---|\n`;
  for (const t of [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) {
    const tp = dogs.filter(r => r.dog >= t).length, fp = others.filter(r => r.dog >= t);
    const cats = {}; for (const r of fp) cats[r.category] = (cats[r.category] || 0) + 1;
    md += `| ${t} | ${tp}/${dogs.length}（${Math.round(tp / dogs.length * 100)}%） | ${fp.length}/${others.length}（${Math.round(fp.length / others.length * 100)}%） | ${Object.entries(cats).map(([k, v]) => `${k} ${v}`).join('、') || '—'} |\n`;
  }
  return md + '\n';
}
