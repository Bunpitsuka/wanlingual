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

/**
 * 塊を前後に広げて最低 minSec 秒の実音を渡したときの比較（2026-11-05、plan #14）。
 * rows[].clustersMin = { '2': [{dog, start, end, ...}], '3': [...] }（塊の数・順番は rows[].clusters と同じ）。無ければ空文字。
 * 塊そのまま（clusters）と各 minSec を、しきい値 0.2 / 0.3 / 0.4 で並べる。
 */
export function minSecReport(rows, { thresholds = [0.2, 0.3, 0.4] } = {}) {
  const withC = rows.filter(r => Array.isArray(r.clusters) && r.clustersMin && Object.keys(r.clustersMin).length);
  const dogs = withC.filter(r => r.category.startsWith('dog')), others = withC.filter(r => r.source === 'ESC-50' && !r.category.startsWith('dog'));
  if (!dogs.length || !others.length) return '';
  const keys = Object.keys(dogs[0].clustersMin).sort((a, b) => +a - +b);
  const variants = [['そのまま', r => r.clusters], ...keys.map(k => [`最低 ${k} 秒`, r => r.clustersMin[k] || []])];
  const pct = (a, b) => b ? `${a}/${b}（${Math.round(a / b * 100)}%）` : '—';
  const secs = arr => arr.length ? (arr.reduce((p, c) => p + (c.end - c.start), 0) / arr.length).toFixed(2) : '—';
  const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  let md = `**塊を前後に広げて最低 2〜3 秒の実音を渡したとき（plan #14 の計測。塊の数・区切りは同じで、渡す範囲だけ違う）**\n\n`;
  const msOf = arr => { const v = arr.map(c => c.ms).filter(m => Number.isFinite(m)); return v.length ? `${q(v, 0.5)} ms（10–90%: ${q(v, 0.1)}–${q(v, 0.9)}）` : '—'; };
  md += `| 渡す範囲 | 塊の平均の長さ（犬／犬以外） | 塊 1 つの処理時間 中央値 | 犬の塊の犬らしさ 中央値 | しきい値 | 犬の塊を「犬」と判定 | 犬以外の塊を「犬」と誤判定 | 塊が全部落ちる犬の本 |\n|---|---|---|---|---|---|---|---|\n`;
  for (const [name, get] of variants) {
    const dc = dogs.flatMap(get), oc = others.flatMap(get);
    if (!dc.length) continue;
    for (const t of thresholds) {
      const drop = dogs.filter(r => get(r).length && get(r).every(c => c.dog < t)).map(r => r.file.replace(/\.wav$/, ''));
      md += `| ${name} | ${secs(dc)}／${secs(oc)} 秒 | ${msOf([...dc, ...oc])} | ${(q(dc.map(c => c.dog), 0.5) * 100).toFixed(0)}% | ${t} | ${pct(dc.filter(c => c.dog >= t).length, dc.length)} | ${pct(oc.filter(c => c.dog >= t).length, oc.length)} | ${drop.length}${drop.length ? `（${drop.slice(0, 6).join('、')}${drop.length > 6 ? '…' : ''}）` : ''} |\n`;
    }
  }
  // 塊そのまま → 広げたとき、しきい値 0.3 でどの塊が救われ／落ちたか
  const t = 0.3;
  for (const k of keys) {
    const saved = [], lost = [], newFp = [];
    const tagOf = (r, i, c, m) => `${r.file.replace(/\.wav$/, '')}#${i + 1} ${(c.dog * 100).toFixed(0)}→${(m.dog * 100).toFixed(0)}%`;
    for (const r of dogs) r.clusters.forEach((c, i) => {
      const m = r.clustersMin[k]?.[i]; if (!m) return;
      if (c.dog < t && m.dog >= t) saved.push(tagOf(r, i, c, m)); else if (c.dog >= t && m.dog < t) lost.push(tagOf(r, i, c, m));
    });
    for (const r of others) r.clusters.forEach((c, i) => {
      const m = r.clustersMin[k]?.[i]; if (m && c.dog < t && m.dog >= t) newFp.push(tagOf(r, i, c, m));
    });
    const list = a => a.length ? `（${a.slice(0, 8).join('、')}${a.length > 8 ? '…' : ''}）` : '';
    md += `\n- 最低 ${k} 秒にすると（しきい値 ${t}）: 救われた犬の塊 ${saved.length}${list(saved)}、逆に落ちた犬の塊 ${lost.length}${list(lost)}、新たに誤判定した犬以外の塊 ${newFp.length}${list(newFp)}`;
  }
  return md + '\n\n';
}

/** 1 本ぶんの塊の結果を表のセル用に短く: "3塊: 97/80/45%" */
export function clusterCell(clusters) {
  if (!Array.isArray(clusters)) return '—';
  if (!clusters.length) return '0塊';
  const show = clusters.slice(0, 6).map(c => (c.dog * 100).toFixed(0)).join('/');
  return `${clusters.length}塊: ${show}%${clusters.length > 6 ? '…' : ''}`;
}

/**
 * 本体 dogcheck.js を本物の tfjs・モデルに通した結果（tests/lab/dogcheck-probe.mjs）を 1 段落に。
 * p: probeDogcheck() の戻り値、file: 通した音、labDog: 同じ範囲を実験室（app/lab/yamnet.html）に通したときの犬らしさ（無ければ null）
 */
export function dogcheckReport(p, { file = '', labDog = null } = {}) {
  if (!p) return '';
  const head = '**本体の dogcheck.js（plan #14 ②）を本物の tfjs・モデルで**: ';
  if (p.state !== 'ready' || !p.first) return `${head}読み込めず（state: ${p.state}${p.error ? '、' + p.error : ''}）。本体は従来どおり動く\n\n`;
  const pc = v => (v * 100).toFixed(0) + '%';
  const same = labDog == null ? '' : Math.abs(labDog - p.first.dog) < 0.01 ? `（実験室と同じ ${pc(labDog)}）` : `（実験室は ${pc(labDog)}。**ずれている**）`;
  return `${head}読み込み ${(p.loadMs / 1000).toFixed(1)} 秒で ready。${file} の最初の塊（前を足して ${p.first.sec.toFixed(2)} 秒）→ 犬らしさ ${pc(p.first.dog)}${same}、${p.first.isDog ? '犬' : '犬以外っぽい'}。推論 1 回目 ${p.first.ms} ms、2 回目 ${p.second ? p.second.ms + ' ms' : '—'}\n\n`;
}

/**
 * 「吠え以外の声」（CC0 5 本: くんくん・うなり・息・大型犬・小型犬）の 1 回の長さと間隔の分布（plan #13b の材料。2026-11-12）。
 * features-check.mjs の表は 1 本につき平均 1 行なので、14〜30 秒の長いファイルでは分布が見えない。ここでは声 1 回ごとの
 * 長さと、声と声の間隔を、中央値と 25–75% で出す。いまの「なぜ」の境目（短い ≤590ms／長い ≥710ms、間隔 短い ≤300ms／ゆったり ≥880ms）
 * のどちら側に落ちるかが一目で分かるように、境目を超える割合も添える。
 * rows: [{file, category, source, seconds, events:[{start,dur}]}]（source が CC0 のものだけ使う）。無ければ空文字
 */
export function eventDistReport(rows, { longMs = 710, shortMs = 590, gapShortMs = 300, gapLongMs = 880 } = {}) {
  const cc0 = rows.filter(r => r.source === 'CC0' && Array.isArray(r.events));
  if (!cc0.length) return '';
  const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const ms = v => Math.round(v * 1000);
  const dist = arr => arr.length ? `${ms(q(arr, 0.5))}（${ms(q(arr, 0.25))}–${ms(q(arr, 0.75))}）` : '—';
  const share = (arr, pred) => arr.length ? `${Math.round(arr.filter(pred).length / arr.length * 100)}%` : '—';
  let md = `### CC0 5 本（吠え以外の声を含む）の声 1 回の長さ・間隔（#13b の材料）\n\n`;
  md += `声 1 回ごとの長さと、声と声の間隔（ms、中央値と 25–75%）。「長い」= ${longMs}ms 以上（いまの「1回が長い声→さみしい／威嚇」の境目）、「短い」= ${shortMs}ms 以下、間隔「短い」= ${gapShortMs}ms 以下、「ゆったり」= ${gapLongMs}ms 以上。\n\n`;
  md += `| ファイル | 秒 | 回数 | 長さ ms | 長い ≥${longMs} | 短い ≤${shortMs} | 最長 ms | 間隔 ms | 間隔 短い ≤${gapShortMs} | ゆったり ≥${gapLongMs} |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of cc0) {
    const durs = r.events.map(e => e.dur);
    const gaps = r.events.slice(1).map((e, i) => e.start - (r.events[i].start + r.events[i].dur));
    md += `| ${r.file} | ${r.seconds ?? '—'} | ${r.events.length} | ${dist(durs)} | ${share(durs, d => ms(d) >= longMs)} | ${share(durs, d => ms(d) <= shortMs)} | ${durs.length ? ms(Math.max(...durs)) : '—'} | ${dist(gaps)} | ${share(gaps, g => ms(g) <= gapShortMs)} | ${share(gaps, g => ms(g) >= gapLongMs)} |\n`;
  }
  return md + '\n';
}

/**
 * CC0 5 本の声 1 回ごとのピッチ f0・明るさ cent・音量 level の分布（plan #13b の材料。2026-11-13）。
 * 2026-11-12 の長さ・間隔の表で「1 回の長さでは さみしい・威嚇 を出せない」と分かったので、代わりに
 * 「さみしい＝ピッチの動き or 音量の小ささ」「威嚇＝ピッチの低さ」が数字で見えるかを確かめる表。
 * いまの「なぜ」の境目（声が低い ≤320Hz／高い ≥590Hz、こもった ≤1300Hz／明るい ≥1600Hz）を超える割合も添える。
 * level は検出器が見た RMS（0〜1）を dBFS にしたもの。録音ごとに音量の基準が違うので、ファイル間の比較ではなく
 * 「同じファイルの中で、いちばん大きい声から何 dB 下か（25–75%）」も並べる（声の大小のばらつき）。
 * rows: [{file, source, events:[{start,dur,f0,cent,level}]}]（source が CC0 のものだけ使う）。events に f0 が無ければ空文字
 */
export function eventToneReport(rows, { lowHz = 320, highHz = 590, darkHz = 1300, brightHz = 1600 } = {}) {
  const cc0 = rows.filter(r => r.source === 'CC0' && Array.isArray(r.events));
  if (!cc0.length || !cc0.some(r => r.events.some(e => 'f0' in e))) return '';
  const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const rnd = v => Math.round(v);
  const dist = (arr, f = rnd) => arr.length ? `${f(q(arr, 0.5))}（${f(q(arr, 0.25))}–${f(q(arr, 0.75))}）` : '—';
  const share = (arr, pred) => arr.length ? `${Math.round(arr.filter(pred).length / arr.length * 100)}%` : '—';
  const db = v => v > 0 ? 20 * Math.log10(v) : -Infinity;
  const db1 = v => Number.isFinite(v) ? v.toFixed(1) : '—';
  let md = `### CC0 5 本の声 1 回ごとのピッチ・明るさ・音量（#13b の材料）\n\n`;
  md += `声 1 回ごとの f0（Hz。取れた声だけ）、明るさ cent（Hz）、音量 level（dBFS。検出器が見た RMS のピーク）。中央値と 25–75%。「低い」= ${lowHz}Hz 以下（いまの「声が低い→威嚇」の境目）、「高い」= ${highHz}Hz 以上、「こもった」= ${darkHz}Hz 以下、「明るい」= ${brightHz}Hz 以上。音量は録音ごとに基準が違うので、ファイル間で比べるのではなく、同じファイルのいちばん大きい声から何 dB 下か（声の大小のばらつき）を見る。\n\n`;
  md += `| ファイル | 回数 | f0 が取れた | f0 Hz | 低い ≤${lowHz} | 高い ≥${highHz} | f0 の幅 25–75%（Hz） | cent Hz | こもった ≤${darkHz} | 明るい ≥${brightHz} | level dBFS | 最大の声から（dB 下） |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of cc0) {
    const ev = r.events;
    const f0s = ev.map(e => e.f0).filter(v => v > 0);
    const cents = ev.map(e => e.cent).filter(v => Number.isFinite(v));
    const lv = ev.map(e => e.level).filter(v => v > 0);
    const lvDb = lv.map(db);
    const maxDb = lvDb.length ? Math.max(...lvDb) : 0;
    const below = lvDb.map(d => maxDb - d);
    const spread = f0s.length ? rnd(q(f0s, 0.75) - q(f0s, 0.25)) : '—';
    md += `| ${r.file} | ${ev.length} | ${share(ev, e => e.f0 > 0)} | ${dist(f0s)} | ${share(f0s, v => v <= lowHz)} | ${share(f0s, v => v >= highHz)} | ${spread} | ${dist(cents)} | ${share(cents, v => v <= darkHz)} | ${share(cents, v => v >= brightHz)} | ${dist(lvDb, db1)} | ${dist(below, db1)} |\n`;
  }
  return md + '\n';
}

/**
 * MFCC（c1〜c12 の平均）が くんくん／うなり／吠え で分かれるかの表（plan #13 の材料。2026-11-15）。
 * rows[].mfcc = { frames, mean: [c0..c12] }（声 1 回ごとのフレームだけの平均。tools/mfcc-bench.mjs の mfccOfEvents）。
 * 基準は ESC-50 dog（吠え）: ファイルごとの平均の、40 本の平均 μ と標準偏差 σ。CC0 5 本と犬以外の各クラスについて
 * 係数ごとの z = (値 − μ) / σ を出し、|z| ≥ zMin の係数を「吠えから離れた係数」として挙げる。
 * 1 本も離れた係数が無ければ、MFCC を足してもルール・kNN の助けにならない見込み。c0 は音量に近いので表から外す。
 * ESC-50 dog に mfcc が 2 本以上無ければ空文字。
 */
export function mfccReport(rows, { zMin = 2, nCoef = 12 } = {}) {
  const has = r => r.mfcc && r.mfcc.frames > 0 && Array.isArray(r.mfcc.mean) && r.mfcc.mean.length > nCoef;
  const dogs = rows.filter(r => r.source === 'ESC-50' && r.category === 'dog' && has(r));
  if (dogs.length < 2) return '';
  const coefs = Array.from({ length: nCoef }, (_, i) => i + 1); // c1..c12
  const stats = list => coefs.map(i => {
    const v = list.map(r => r.mfcc.mean[i]); const mu = v.reduce((a, b) => a + b, 0) / v.length;
    return { mu, sd: Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length) };
  });
  const ref = stats(dogs);
  const z = (v, i) => ref[i].sd > 1e-9 ? (v - ref[i].mu) / ref[i].sd : 0;
  const far = means => coefs.map((c, i) => [c, z(means[c], i)]).filter(([, zz]) => Math.abs(zz) >= zMin)
    .map(([c, zz]) => `c${c}(${zz > 0 ? '+' : '−'}${Math.abs(zz).toFixed(1)}σ)`).join(' ') || '—';
  const f1 = v => v.toFixed(1);
  const frames = list => list.reduce((a, r) => a + r.mfcc.frames, 0);
  const byCat = cat => rows.filter(r => r.source === 'ESC-50' && r.category === cat && has(r));
  const catMeans = list => [0, ...stats(list).map(s => s.mu)];
  let md = `### MFCC（c1〜c12 の平均）は くんくん／うなり／吠え で分かれるか（#13 の材料）\n\n`;
  md += `声 1 回ごとのフレームだけ（声と声の間は入れない）の MFCC（自前 13 次元、\`tools/mfcc-bench.mjs\`。frame 1024 / hop 256 / メル 26）の平均。c0 は音量に近いので外した。基準は ESC-50 の吠え ${dogs.length} 本（ファイルごとの平均の 平均 ± 標準偏差）。「吠えから離れた係数」= 吠え ${dogs.length} 本の散らばりに対して |z| ≥ ${zMin}（標準偏差の ${zMin} 倍）離れている係数。1 つも無ければ、MFCC を足しても いまのルール・kNN の助けにならない見込み。\n\n`;
  md += `| 音 | 本 | 声のフレーム | ${coefs.map(c => `c${c}`).join(' | ')} | 吠えから離れた係数（\\|z\\| ≥ ${zMin}） |\n|---|---|---|${coefs.map(() => '---').join('|')}|---|\n`;
  md += `| ESC-50 吠え（基準） | ${dogs.length} | ${frames(dogs)} | ${ref.map(s => `${f1(s.mu)}±${f1(s.sd)}`).join(' | ')} | — |\n`;
  const cc0 = rows.filter(r => r.source === 'CC0' && has(r)).sort((a, b) => a.file.localeCompare(b.file));
  for (const r of cc0) md += `| ${r.file} | 1 | ${r.mfcc.frames} | ${coefs.map(i => f1(r.mfcc.mean[i])).join(' | ')} | ${far(r.mfcc.mean)} |\n`;
  const otherCats = [...new Set(rows.filter(r => r.source === 'ESC-50' && r.category !== 'dog' && has(r)).map(r => r.category))].sort();
  for (const cat of otherCats) {
    const list = byCat(cat), means = catMeans(list);
    md += `| 犬以外: ${cat} | ${list.length} | ${frames(list)} | ${coefs.map(i => f1(means[i])).join(' | ')} | ${far(means)} |\n`;
  }
  const cc0Far = cc0.filter(r => far(r.mfcc.mean) !== '—').length;
  md += cc0.length ? `\n- CC0 ${cc0.length} 本のうち、吠えから |z| ≥ ${zMin} 離れた係数が 1 つ以上ある本: **${cc0Far}/${cc0.length}**` : `\n- CC0 の 5 本（くんくん・うなり・息・大型犬・小型犬）はこの実行では取れていない（Hugging Face に届かない環境。Actions の lab-yamnet では届く）`;
  if (otherCats.length) md += `。犬以外 ${otherCats.length} クラスのうち同じく離れた係数があるクラス: ${otherCats.filter(cat => far(catMeans(byCat(cat))) !== '—').length}/${otherCats.length}`;
  md += `\n- 注意: CC0 は 1 種類 1 本（1 頭）なので、犬の個体差・録音条件の違いと見分けがつかない。離れていても「本物の犬で効く」とは言い切れず、離れていなければ「この 5 本では効かない」とは言える（片方向の確認）。\n`;
  return md + '\n';
}
