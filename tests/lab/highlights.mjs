// lab-yamnet の「今夜の要点」3 行（2026-11-18）。features-check.mjs と yamnet-check.mjs が out/ に書いた生データから
// (1) 吠え検出率 (2) 塊の犬らしさ (3) くんくん／うなり が吠えから離れたか をまとめて、Summary の最後と
// Actions の注釈（::notice。run のページの上に出る）に出す。どちらかの結果が無くても止まらない（その行が「未実行」になる）。
//
//   node tests/lab/highlights.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { highlightsReport } from './report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = f => { const p = path.join(here, 'out', f); try { return JSON.parse(fs.readFileSync(p, 'utf8')).rows; } catch { return null; } };
const { md, lines } = highlightsReport(load('features-result.json'), load('yamnet-result.json'));
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
// 注釈は 1 行ずつ（改行は %0A に直す必要があるので使わない）。run のページの Annotations に 3 つ並ぶ
if (process.env.GITHUB_ACTIONS) for (const l of lines) console.log(`::notice title=今夜の要点::${l}`);
