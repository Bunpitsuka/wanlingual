// 本物の犬の音を、本体アプリの吠え検出（app/js/features.js）と判定ルール（app/js/classify.js）に通して表にする。
// YAMNet は使わないので、この環境でもネット無しで動く（データは先に tests/lab/fetch-data.mjs で取得）。
//
//   node tests/lab/fetch-data.mjs && node tests/lab/features-check.mjs
//
// 出力: 標準出力に Markdown、$GITHUB_STEP_SUMMARY があれば追記、tests/lab/out/features-result.json に生データ。
// 気持ちラベル付きのデータは無いので「的中率」は出せない。見るのは (1) 本物の犬で吠えを拾えるか、
// (2) 犬以外の音を「吠え」として拾ってしまう割合、(3) 本物の犬の特徴量の分布（合成音とのずれ）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSamples } from '../../app/js/features.js';
import { rules, top, CAT } from '../../app/js/classify.js';
import { readWav } from './wav.mjs';
import { listData } from './fetch-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = listData();
if (!data.length) { console.log('データ無し。先に node tests/lab/fetch-data.mjs'); process.exit(0); }

const rows = data.map(d => {
  const { x, sr } = readWav(d.path);
  const a = analyzeSamples(x, sr);
  const f = a.feats;
  const r = f.n ? rules(f) : null;
  return { ...d, path: undefined, sr, seconds: +(x.length / sr).toFixed(2), n: f.n, dur: +f.dur.toFixed(3), gap: +f.gap.toFixed(3), f0: Math.round(f.f0), cent: Math.round(f.cent), gapCv: +f.gapCv.toFixed(2), peak: +a.peak.toFixed(3), top: r ? top(r).k : null, topP: r ? +Math.max(...Object.values(r)).toFixed(2) : null };
});

const pct = (a, b) => b ? `${a}/${b}（${Math.round(a / b * 100)}%）` : '—';
const q = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const fmtDist = arr => arr.length ? `中央値 ${q(arr, 0.5)}（25–75%: ${q(arr, 0.25)}–${q(arr, 0.75)}、n=${arr.length}）` : '—';

const dogs = rows.filter(r => r.category.startsWith('dog'));
const others = rows.filter(r => !r.category.startsWith('dog'));
const detected = r => r.n > 0;
let md = `### 本体の吠え検出・判定ルールに本物の音を通した結果\n\n`;
md += `- 本物の犬（${[...new Set(dogs.map(d => d.source))].join('+')}）: 吠えを 1 回以上拾えた ${pct(dogs.filter(detected).length, dogs.length)}\n`;
md += `- 犬以外（ESC-50 ${[...new Set(others.map(o => o.category))].length} クラス）: 「吠え」として拾ってしまった ${pct(others.filter(detected).length, others.length)}（音量だけの検出なので当然拾う。これが YAMNet で除外したい分）\n`;
const dd = dogs.filter(detected);
md += `- 本物の犬の特徴量: ピッチ f0 ${fmtDist(dd.map(r => r.f0).filter(v => v > 0))} Hz ／ 1 回の長さ ${fmtDist(dd.map(r => Math.round(r.dur * 1000)))} ms ／ 5 秒中の回数 ${fmtDist(dd.map(r => r.n))} ／ 間隔 ${fmtDist(dd.filter(r => r.n >= 2).map(r => Math.round(r.gap * 1000)))} ms ／ 明るさ cent ${fmtDist(dd.map(r => r.cent))} Hz\n`;
md += `- ピッチが取れなかった（f0=0）犬: ${pct(dd.filter(r => r.f0 === 0).length, dd.length)}\n`;
const topCount = {};
for (const r of dd) topCount[r.top] = (topCount[r.top] || 0) + 1;
md += `- ルールだけの判定の内訳（犬、正解ラベル無し）: ${Object.entries(topCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${CAT[k]?.label ?? k} ${v}`).join('、')}\n\n`;
md += `| ファイル | 種類 | 回数 | 長さ(ms) | 間隔(ms) | f0(Hz) | cent(Hz) | gapCv | ルール判定 |\n|---|---|---|---|---|---|---|---|---|\n`;
md += rows.map(r => `| ${r.file} | ${r.category} | ${r.n} | ${Math.round(r.dur * 1000)} | ${r.n >= 2 ? Math.round(r.gap * 1000) : '—'} | ${r.f0 || '—'} | ${r.cent || '—'} | ${r.n >= 3 ? r.gapCv : '—'} | ${r.top ? `${CAT[r.top].label} ${Math.round(r.topP * 100)}%` : '—'} |`).join('\n') + '\n';
console.log(md);
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out/features-result.json'), JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
