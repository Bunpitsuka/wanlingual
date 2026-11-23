// Dog play pant（CC BY 4.0）の注釈だけを読んで、声の種類ごとの件数・長さを Summary に出す（2026-11-24。音声はまだ落とさない）。
// データは先に tests/lab/fetch-data.mjs が tests/lab/data/playpant/ に落とす（Zenodo に届かなければ無いので、何も出さずに終わる）。
//
//   node tests/lab/fetch-data.mjs && node tests/lab/playpant-check.mjs
//
// 出力: 標準出力に Markdown、$GITHUB_STEP_SUMMARY があれば追記、tests/lab/out/playpant-annotations.json に生データ（種類・時刻だけ）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA } from './fetch-data.mjs';
import { PLAYPANT, unzip, pickRavenFiles, parseRavenTable, callTypeReport, metadataNote } from './playpant.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(DATA, 'playpant');
const zipFile = path.join(dir, PLAYPANT.files.annotations);
if (!fs.existsSync(zipFile)) { console.log('Dog play pant の注釈が無い（Zenodo に届かなかったか、まだ落としていない）。先に node tests/lab/fetch-data.mjs'); process.exit(0); }

const entries = unzip(fs.readFileSync(zipFile));
const raven = pickRavenFiles(entries);
const tables = raven.map(e => ({ name: e.name, ...parseRavenTable(e.data.toString('utf8')) }));
let md = callTypeReport(tables);
md += `- zip の中身: ${entries.length} ファイル（Raven の表として読んだのは ${raven.length}。他は TextGrid 等）。先頭: ${entries.slice(0, 6).map(e => e.name).join('、')}${entries.length > 6 ? ' …' : ''}\n`;
const meta = path.join(dir, PLAYPANT.files.metadata);
if (fs.existsSync(meta)) md += metadataNote(fs.readFileSync(meta, 'utf8'));
md += `- 出典: ${PLAYPANT.url}（${PLAYPANT.license}）。音声 zip（約 377 MB）は次の夜（datasets.md 次の一手 4 の (b)）\n`;
console.log(md);
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out/playpant-annotations.json'), JSON.stringify({ at: new Date().toISOString(), files: entries.map(e => e.name), tables: tables.map(t => ({ name: t.name, header: t.header, labelCol: t.labelCol, skipped: t.skipped, rows: t.rows.map(r => ({ b: +r.begin.toFixed(3), e: +r.end.toFixed(3), l: r.label })) })) }, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
