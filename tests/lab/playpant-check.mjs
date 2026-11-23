// Dog play pant（CC BY 4.0）の注釈だけを読んで、声の種類ごとの件数・長さを Summary に出す（2026-11-24。音声はまだ落とさない）。
// データは先に tests/lab/fetch-data.mjs が tests/lab/data/playpant/ に落とす（Zenodo に届かなければ無いので、何も出さずに終わる）。
//
//   node tests/lab/fetch-data.mjs && node tests/lab/playpant-check.mjs
//
// 出力: 標準出力に Markdown、$GITHUB_STEP_SUMMARY があれば追記、tests/lab/out/playpant-annotations.json に生データ（種類・時刻だけ）。
// 2026-11-24 の 2 回目の run（45243790948）で分かったこと: 注釈の Annotation 列は A〜L の記号（30 枚・2,962 回）、zip には macOS の
// `__MACOSX/`・`.DS_Store` が混ざる、Metadata.csv は `;` 区切り。記号の凡例は zip の中の README か Zenodo の説明文にあるはずなので、両方を Summary に出す。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA } from './fetch-data.mjs';
import { PLAYPANT, unzip, isJunk, pickRavenFiles, pickNoteFiles, parseRavenTable, callTypeReport, metadataNote, recordNote } from './playpant.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(DATA, 'playpant');
const zipFile = path.join(dir, PLAYPANT.files.annotations);
if (!fs.existsSync(zipFile)) { console.log('Dog play pant の注釈が無い（Zenodo に届かなかったか、まだ落としていない）。先に node tests/lab/fetch-data.mjs'); process.exit(0); }

const entries = unzip(fs.readFileSync(zipFile)).filter(e => !isJunk(e.name));
const raven = pickRavenFiles(entries);
const tables = raven.map(e => ({ name: e.name, ...parseRavenTable(e.data.toString('utf8')) }));
let md = callTypeReport(tables);
const others = entries.filter(e => !raven.includes(e));
const kinds = {};
for (const e of others) { const k = (e.name.match(/\.([^./]+)$/) || [, '（拡張子なし）'])[1]; kinds[k] = (kinds[k] || 0) + 1; }
md += `- zip の中身（macOS のごみを除く）: ${entries.length} ファイル。Raven の表 ${raven.length}、他: ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join('、') || '—'}。表の名前の例: ${raven.slice(0, 3).map(e => e.name).join('、')}\n`;
const notes = pickNoteFiles(entries);
if (notes.length) {
  md += `- 表でも TextGrid でもないテキスト ${notes.length} 件（記号の凡例を探す）: ${notes.map(e => e.name).join('、')}\n`;
  for (const e of notes.slice(0, 3)) {
    const text = e.data.toString('utf8').replace(/\r\n?/g, '\n');
    md += `\n<details><summary>${e.name}（${text.length} 文字${text.length > 4000 ? '、先頭 4000 文字' : ''}）</summary>\n\n\`\`\`\n${text.slice(0, 4000)}\n\`\`\`\n\n</details>\n`;
  }
} else {
  md += `- zip の中に README・凡例のテキストは無い → 記号の意味は Zenodo の説明文（下）か論文で確かめる\n`;
}
const meta = path.join(dir, PLAYPANT.files.metadata);
if (fs.existsSync(meta)) md += metadataNote(fs.readFileSync(meta, 'utf8'));
const rec = path.join(dir, 'record.json');
if (fs.existsSync(rec)) md += recordNote(fs.readFileSync(rec, 'utf8'));
md += `- 出典: ${PLAYPANT.url}（${PLAYPANT.license}）。音声 zip（約 377 MB）は次の夜（datasets.md 次の一手 4 の (b)）\n`;
console.log(md);
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out/playpant-annotations.json'), JSON.stringify({ at: new Date().toISOString(), files: entries.map(e => e.name), tables: tables.map(t => ({ name: t.name, header: t.header, labelCol: t.labelCol, skipped: t.skipped, rows: t.rows.map(r => ({ b: +r.begin.toFixed(3), e: +r.end.toFixed(3), l: r.label })) })) }, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
