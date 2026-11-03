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

/**
 * 吠えの塊ごとの犬らしさ（本体に入れたとき YAMNet が実際に見る単位）の集計。
 * rows[].clusters = [{ start, end, n, dog, dogSum, dogTop }]。clusters が無い行ばかりなら空文字。
 * 「最大」= 従来の犬らしさ（犬系クラスの最大値）、「合計」= 犬系クラスの合計（dogSum）。
 */
export function clusterReport(rows) {
  const withC = rows.filter(r => Array.isArray(r.clusters));
  const dogs = withC.filter(r => r.category.startsWith('dog')), others = withC.filter(r => r.source === 'ESC-50' && !r.category.startsWith('dog'));
  if (!dogs.length || !others.length) return '';
  const flat = rs => rs.flatMap(r => r.clusters);
  const dc = flat(dogs), oc = flat(others);
  if (!dc.length) return '';
  const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const dist = arr => arr.length ? `中央値 ${(q(arr, 0.5) * 100).toFixed(0)}%（10–90%: ${(q(arr, 0.1) * 100).toFixed(0)}–${(q(arr, 0.9) * 100).toFixed(0)}%、n=${arr.length}）` : '—';
  const pct = (a, b) => b ? `${a}/${b}（${Math.round(a / b * 100)}%）` : '—';
  const secs = arr => arr.length ? (arr.reduce((p, c) => p + (c.end - c.start), 0) / arr.length).toFixed(2) : '—';
  let md = `**吠えの塊ごとの犬らしさ（本体 mic.js と同じ区切り。犬 ${dogs.length} 本 → ${dc.length} 塊、犬以外 ${others.length} 本 → ${oc.length} 塊）**\n\n`;
  md += `- 塊の長さの平均: 犬 ${secs(dc)} 秒 ／ 犬以外 ${secs(oc)} 秒（ファイル全体は 5 秒。短いので YAMNet は 1〜2 フレームしか見ない）\n`;
  md += `- 塊の犬らしさ(最大) 犬: ${dist(dc.map(c => c.dog))} ／ 犬以外: ${dist(oc.map(c => c.dog))}\n`;
  md += `- 塊の犬らしさ(合計) 犬: ${dist(dc.map(c => c.dogSum))} ／ 犬以外: ${dist(oc.map(c => c.dogSum))}\n`;
  md += `- 塊が 1 つも出なかった本: 犬 ${dogs.filter(r => !r.clusters.length).length}/${dogs.length}、犬以外 ${others.filter(r => !r.clusters.length).length}/${others.length}\n\n`;
  md += `| しきい値 | 犬の塊を「犬」と判定（最大） | 犬以外の塊を「犬」と誤判定（最大） | 犬の塊（合計） | 犬以外の塊（合計） | 塊が全部落ちる犬の本（最大／合計） |\n|---|---|---|---|---|---|\n`;
  for (const t of [0.1, 0.2, 0.3, 0.4, 0.5]) {
    const allDrop = key => dogs.filter(r => r.clusters.length && r.clusters.every(c => c[key] < t)).length;
    md += `| ${t} | ${pct(dc.filter(c => c.dog >= t).length, dc.length)} | ${pct(oc.filter(c => c.dog >= t).length, oc.length)} | ${pct(dc.filter(c => c.dogSum >= t).length, dc.length)} | ${pct(oc.filter(c => c.dogSum >= t).length, oc.length)} | ${allDrop('dog')}／${allDrop('dogSum')} |\n`;
  }
  const topCount = {};
  for (const c of dc) if (c.dogTop) topCount[c.dogTop] = (topCount[c.dogTop] || 0) + 1;
  md += `\n- 犬の塊で最大だった犬系クラス: ${Object.entries(topCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('、') || '—'}\n`;
  return md + '\n';
}

/** 1 本ぶんの塊の結果を表のセル用に短く: "3塊: 97/80/45%" */
export function clusterCell(clusters) {
  if (!Array.isArray(clusters)) return '—';
  if (!clusters.length) return '0塊';
  const show = clusters.slice(0, 6).map(c => (c.dog * 100).toFixed(0)).join('/');
  return `${clusters.length}塊: ${show}%${clusters.length > 6 ? '…' : ''}`;
}
