// Dog play pant（Readme は CC BY-NC 4.0 → 検証専用）の注釈を読んで、声の種類ごとの件数・長さを Summary に出す（2026-11-24）。
// 2026-11-25: 音声 zip があれば WAV 30 本の一覧（長さ・形式・注釈との対応）も出す（(b) の 1 歩目）。
// 2026-11-26: さらに 2 層目の注釈の時刻で塊を切り出して data/playpant/clips/<種類>/ に置く（(b) の 2 歩目。features-check.mjs が種類ごとの表を出す）。
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
import { PLAYPANT, unzip, zipIndex, zipExtract, isJunk, pickRavenFiles, pickNoteFiles, parseRavenTable, callTypeReport, metadataNote, recordNote, audioListReport, pickClips, clipPlanReport, stemOf } from './playpant.mjs';
import { wavHeader, readWav } from './wav.mjs';
import { writeWav } from './decode.mjs';

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
md += `- zip の中身（macOS のごみを除く）: ${entries.length} ファイル。Raven の表 ${raven.length}、他: ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join('、') || '—'}。表の名前の例: ${raven.slice(0, 3).map(e => e.name).join('、')}${others.length ? `。他の名前の例: ${others.slice(0, 3).map(e => `${e.name}（${e.data.length} B）`).join('、')}` : ''}\n`;
// Zenodo の `06 Readme.txt`（zip の外。記号の凡例はここにあるはず）
const readme = path.join(dir, PLAYPANT.files.readme);
if (fs.existsSync(readme)) {
  const text = fs.readFileSync(readme, 'utf8').replace(/\r\n?/g, '\n');
  md += `\n<details open><summary>${PLAYPANT.files.readme}（Zenodo、${text.length} 文字${text.length > 8000 ? '、先頭 8000 文字' : ''}。記号 A〜L の凡例を探す）</summary>\n\n\`\`\`\n${text.slice(0, 8000)}\n\`\`\`\n\n</details>\n`;
}
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
// 音声 zip（2026-11-25、(b) の 1 歩目）: あれば WAV の一覧（長さ・形式・注釈との対応）だけ出す。1 本ずつ展開してヘッダを読み、捨てる（720 MB を同時に持たない）
const audioZip = path.join(dir, PLAYPANT.files.audio);
let wavs = [];
if (fs.existsSync(audioZip)) {
  const zbuf = fs.readFileSync(audioZip);
  const idx = zipIndex(zbuf).filter(e => !isJunk(e.name));
  const wavEntries = idx.filter(e => /\.wav$/i.test(e.name));
  for (const e of wavEntries) {
    try {
      const { sr, ch, bits, fmt, seconds } = wavHeader(zipExtract(zbuf, e), e.name);
      wavs.push({ name: e.name, csize: e.csize, usize: e.usize, sr, ch, bits, fmt, seconds: +seconds.toFixed(2) });
    } catch (err) { wavs.push({ name: e.name, csize: e.csize, usize: e.usize, sr: 0, ch: 0, bits: 0, fmt: 0, seconds: 0, error: err.message }); }
  }
  md += audioListReport(wavs, tables);
  const otherNames = idx.filter(e => !wavEntries.includes(e)).map(e => e.name);
  md += `- 音声 zip の中身: ${idx.length} ファイル（WAV ${wavEntries.length}${otherNames.length ? `、他 ${otherNames.length}: ${otherNames.slice(0, 5).join('、')}` : ''}）。zip ${(zbuf.length / 1e6).toFixed(1)} MB${wavs.some(w => w.error) ? `。**読めない WAV: ${wavs.filter(w => w.error).map(w => `${w.name.split('/').pop()}（${w.error}）`).join('、')}**` : ''}\n`;
  // (b) の 2 歩目（2026-11-26）: 2 層目の注釈の時刻で塊を切り出し、tests/lab/data/playpant/clips/<種類>/<幹>_<開始 ms>.wav（元の sr のまま 16 bit モノラル）に置く。
  // features-check.mjs が listData({ playpant: true }) で読んで、種類ごとの lvlDrop・MFCC の表を出す。YAMNet にはまだ通さない（本数で時間が伸びる）。
  // sr は落とさない（本体の特徴量 f0・cent は元の sr で取る。CC0 5 本も 48 kHz。MFCC と YAMNet は features-check 側で 16 kHz に落とす）
  md += clipsWritten(zbuf, wavEntries, tables);
} else {
  md += `- 音声 zip（約 377 MB）は無い（PLAYPANT_AUDIO=1 で fetch-data.mjs が落とす）\n`;
}
function clipsWritten(zbuf, wavEntries, tables) {
  const picked = pickClips(tables);
  let s = clipPlanReport(picked);
  const out = path.join(dir, 'clips');
  fs.rmSync(out, { recursive: true, force: true }); // 毎回作り直す（注釈の読み方を直したら中身が変わる）
  const byStem = new Map();
  for (const c of picked.clips) { if (!byStem.has(c.stem)) byStem.set(c.stem, []); byStem.get(c.stem).push(c); }
  let n = 0, missing = 0, clipped = 0;
  const t0 = Date.now();
  for (const e of wavEntries) {
    const cs = byStem.get(stemOf(e.name));
    if (!cs) continue;
    byStem.delete(stemOf(e.name));
    let x, sr;
    try { ({ x, sr } = readWav(zipExtract(zbuf, e))); } catch { missing += cs.length; continue; }
    for (const c of cs) {
      const a = Math.round(c.begin * sr), b = Math.min(x.length, Math.round(c.end * sr));
      if (b - a < sr * 0.05) { missing++; continue; }
      if (c.end * sr > x.length) clipped++;
      const d = path.join(out, c.dir);
      fs.mkdirSync(d, { recursive: true });
      writeWav(path.join(d, `${c.stem}_${String(Math.round(c.begin * 1000)).padStart(7, '0')}.wav`), x.subarray(a, b), sr);
      n++;
    }
  }
  const noWav = [...byStem.values()].reduce((p, v) => p + v.length, 0);
  s += `- 切り出した WAV: **${n}/${picked.clips.length} 本**（${Math.round((Date.now() - t0) / 1000)} 秒）${missing ? `、読めない・短すぎて飛ばした ${missing}` : ''}${noWav ? `、音声が無い幹の分 ${noWav}` : ''}${clipped ? `、ファイル末尾で切れた ${clipped}` : ''}。置き場 \`tests/lab/data/playpant/clips/<種類>/\`（gitignore。NC 扱いなのでリポジトリには入れない）\n`;
  return s;
}
md += `- 出典: ${PLAYPANT.url}（${PLAYPANT.license}: ${PLAYPANT.licenseNote}）\n`;
console.log(md);
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
if (wavs.length) fs.writeFileSync(path.join(here, 'out/playpant-wavs.json'), JSON.stringify({ at: new Date().toISOString(), license: PLAYPANT.license, wavs }, null, 1));
fs.writeFileSync(path.join(here, 'out/playpant-annotations.json'), JSON.stringify({ at: new Date().toISOString(), files: entries.map(e => e.name), tables: tables.map(t => ({ name: t.name, header: t.header, labelCol: t.labelCol, skipped: t.skipped, rows: t.rows.map(r => ({ b: +r.begin.toFixed(3), e: +r.end.toFixed(3), l: r.label })) })) }, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
