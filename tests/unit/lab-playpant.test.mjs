// Dog play pant の注釈読み（zip → Raven の表 → 種類ごとの件数・長さ）の単体テスト（ネット不要。2026-11-24）
// fixtures/playpant-annotations.zip は Python の zipfile で作った合成の表（本物のデータは入れていない。deflate と store の両方、
// 2 層のフォルダ、TextGrid・README・macOS のごみ（__MACOSX/ と .DS_Store）入り。本物の zip の形は run 45243790948 の Summary に合わせた）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAYPANT, playpantUrl, ZENODO_HEADERS, callJa, unzip, isJunk, pickRavenFiles, pickNoteFiles, parseRavenTable, callTypeReport, metadataNote, htmlToText, recordNote } from '../lab/playpant.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const zipBuf = fs.readFileSync(path.join(here, '../fixtures/playpant-annotations.zip'));
const T1 = '04 Annotations/FirstLayer/S01_dog1.Table.1.selections.txt', T2 = '04 Annotations/SecondLayer/S01_dog1.Table.1.selections.txt';

test('Zenodo の URL: 空白入りのファイル名をエンコードし、既定は API の /content、api:false で記録ページの ?download=1', () => {
  assert.equal(playpantUrl(PLAYPANT.files.annotations), 'https://zenodo.org/api/records/18972388/files/04%20Annotations.zip/content');
  assert.equal(playpantUrl(PLAYPANT.files.annotations, { api: false }), 'https://zenodo.org/records/18972388/files/04%20Annotations.zip?download=1');
  assert.equal(PLAYPANT.license, 'CC BY 4.0');
  assert.match(ZENODO_HEADERS['User-Agent'], /wanlingual-lab/);
});

test('unzip: store と deflate の両方を展開し、ディレクトリ項目は含めない。中身が元のテキストと一致する', () => {
  const entries = unzip(zipBuf);
  assert.equal(entries.length, 7, 'ディレクトリ項目 1 つを除いた 7 ファイル');
  const t1 = entries.find(e => e.name === T1).data.toString('utf8');
  assert.match(t1, /^Selection\tView\tChannel\tBegin Time \(s\)\tEnd Time \(s\)/);
  assert.match(t1, /5\tSpectrogram 1\t1\t4\.000\t4\.860\t100\t3000\tPant/);
  assert.equal(entries.find(e => e.name.endsWith('TextGrid')).data.toString('utf8'), 'File type = "ooTextFile"\nObject class = "TextGrid"\n');
  assert.throws(() => unzip(Buffer.from('not a zip')), /終端レコード/);
});

test('isJunk / pickRavenFiles / pickNoteFiles: macOS のごみを外し、表は .txt だけ（TextGrid・README は外す）、README は凡例の候補として拾う', () => {
  const entries = unzip(zipBuf);
  assert.deepEqual(entries.filter(e => isJunk(e.name)).map(e => e.name).sort(), ['04 Annotations/.DS_Store', '__MACOSX/04 Annotations/._.DS_Store', '__MACOSX/04 Annotations/FirstLayer/._S01_dog1.Table.1.selections.txt']);
  assert.deepEqual(pickRavenFiles(entries).map(e => e.name), [T1, T2]);
  assert.deepEqual(pickNoteFiles(entries).map(e => e.name), ['04 Annotations/README.txt']);
  assert.deepEqual(pickNoteFiles(entries, { maxBytes: 10 }), [], '大きいものは読まない');
});

test('parseRavenTable: Begin/End Time と種類の列を名前で見つけ、CRLF・BOM・数字でない行も扱う', () => {
  const entries = unzip(zipBuf);
  const a = parseRavenTable(entries.find(e => e.name === T1).data.toString('utf8'));
  assert.equal(a.header[a.labelCol], 'Call type');
  assert.equal(a.rows.length, 5, '時刻が x の行は飛ばす');
  assert.equal(a.skipped, 1);
  assert.deepEqual(a.rows.map(r => r.label), ['Bark', 'Whine', 'Growl', 'Whine', 'Pant']);
  assert.ok(Math.abs(a.rows[0].dur - 0.12) < 1e-9);
  const b = parseRavenTable(entries.find(e => e.name === T2).data.toString('utf8'));
  assert.equal(b.header[0], 'Selection', 'BOM を外す');
  assert.equal(b.header[b.labelCol], 'Annotation');
  assert.equal(b.rows.length, 3);
  // 標準列以外で文字が入っている列を種類として拾う（名前にヒントが無い場合）
  const c = parseRavenTable('Selection\tBegin Time (s)\tEnd Time (s)\tNotes\n1\t0\t0.1\tGrowl\n2\t1\t1.2\tWhine\n');
  assert.equal(c.header[c.labelCol], 'Notes');
  assert.deepEqual(c.rows.map(r => r.label), ['Growl', 'Whine']);
  // 時刻の列が無ければ rows は空、header は残る（Summary にヘッダを出して次の夜に直す）
  const d = parseRavenTable('tmin\ttmax\ttext\n0\t1\tBark\n');
  assert.equal(d.rows.length, 0);
  assert.equal(d.beginCol, -1);
  assert.deepEqual(d.header, ['tmin', 'tmax', 'text']);
  assert.deepEqual(parseRavenTable('').rows, []);
});

test('callJa: 論文の表記ゆれ（Bark/yelp、Whine、Human speech）を日本語にし、知らないもの（記号 A〜L も）は原文のまま', () => {
  assert.equal(callJa('Bark/yelp'), '吠え／キャン');
  assert.equal(callJa('whine'), 'くんくん');
  assert.equal(callJa('Growl'), 'うなり');
  assert.equal(callJa('Pant'), '息');
  assert.equal(callJa('Human speech'), '人の声');
  assert.equal(callJa('E'), 'E', '記号は凡例が分かるまで決め打ちしない');
  assert.equal(callJa(''), '（空）');
});

test('callTypeReport: 層（表の親フォルダ）ごとに種類別の件数・中央値・25–75%・最長・合計、本体の境目との比較、読めない表のヘッダ', () => {
  const entries = unzip(zipBuf);
  const tables = pickRavenFiles(entries).map(e => ({ name: e.name, ...parseRavenTable(e.data.toString('utf8')) }));
  const md = callTypeReport(tables);
  assert.match(md, /表 2 枚、層: 04 Annotations\/FirstLayer・04 Annotations\/SecondLayer/);
  assert.match(md, /### 04 Annotations\/FirstLayer（1 枚、5 回。種類の列: Call type）/);
  assert.match(md, /\| Whine \| くんくん \| 2 \| 90 ms \| 85–90 ms \| 90 ms \| 0\.2 秒 \|/);
  assert.match(md, /\| Pant \| 息 \| 1 \| 860 ms \|/);
  assert.match(md, /「長い ≥710ms」に入る回 1\/5、「短い ≤590ms」 4\/5。時刻が読めず飛ばした行 1/);
  assert.match(md, /### 04 Annotations\/SecondLayer（1 枚、3 回。種類の列: Annotation）/);
  assert.match(md, /\| Human speech \| 人の声 \| 1 \|/);
  assert.doesNotMatch(md, /見つからなかった表/);
  // 時刻の列が読めない表が混ざれば、そのヘッダを出す
  const md2 = callTypeReport([...tables, { name: 'Round3/x.txt', ...parseRavenTable('tmin\ttmax\ttext\n0\t1\tBark\n') }]);
  assert.match(md2, /見つからなかった表 1 枚\*\*。ヘッダ行（先頭 1 枚）: `tmin \| tmax \| text`/);
  assert.equal(callTypeReport([]), '');
});

test('metadataNote: `;` 区切りも読み、列名・行数と「値の種類が少ない列」の内訳、犬の数、合計の長さ。人の名前になり得る列は出さない', () => {
  const csv = '﻿Audio_file;ID_dog;Dog_name;Sample_rate-hz;Channels;Context;Total_duration-s;Annotator\n'
    + 'a.wav;D1;Rex;48000;1;play;120;AB\nb.wav;D1;Rex;48000;1;play;60;AB\nc.wav;D2;Max;48000;2;play;60;CD\n';
  const s = metadataNote(csv);
  assert.match(s, /^- Metadata\.csv: 3 行（区切り `;`）、列: Audio_file、ID_dog、Dog_name、Sample_rate-hz、Channels、Context、Total_duration-s、Annotator\n/);
  assert.match(s, /Sample_rate-hz: 48000 3／Channels: 1 2・2 1／Context: play 3/);
  assert.doesNotMatch(s, /Rex|AB|CD/, '犬の名前・注釈者は出さない');
  assert.match(s, /犬の数: 2/);
  assert.match(s, /合計の長さ: 4\.0 分/);
  assert.equal(metadataNote('Session,Dog,Breed\nS01,d1,mix\n'), '- Metadata.csv: 1 行（区切り `,`）、列: Session、Dog、Breed\n  - 値の種類が少ない列: Dog: d1 1／Breed: mix 1\n');
  assert.equal(metadataNote(''), '');
});

test('htmlToText / recordNote: Zenodo の説明文のタグを外し、ファイル一覧と説明文を折りたたみで出す。壊れた JSON なら空', () => {
  assert.equal(htmlToText('<p>Codes:</p><ul><li>A &amp; B = <b>Bark</b></li><li>C = Whine</li></ul>'), 'Codes:\n- A & B = Bark\n- C = Whine');
  const rec = { files: [{ key: '04 Annotations.zip', size: 123456 }, { key: '03 Play session recordings.zip', size: 377e6 }], metadata: { description: '<p>Vocalization codes: A = Growl</p>' } };
  const s = recordNote(rec);
  assert.match(s, /ファイル一覧: 04 Annotations\.zip（123 KB）、03 Play session recordings\.zip（377 MB）/);
  assert.match(s, /<details><summary>Zenodo の説明文（記号の凡例を探す。\d+ 文字）<\/summary>\n\n```\nVocalization codes: A = Growl\n```/);
  assert.equal(recordNote('{not json'), '');
  assert.equal(recordNote(JSON.stringify(rec)).length, s.length, '文字列の JSON も同じ');
});
