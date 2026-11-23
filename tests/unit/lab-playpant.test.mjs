// Dog play pant の注釈読み（zip → Raven の表 → 種類ごとの件数・長さ）の単体テスト（ネット不要。2026-11-24）
// fixtures/playpant-annotations.zip は Python の zipfile で作った合成の表（本物のデータは入れていない。deflate と store の両方、TextGrid・README 入り）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAYPANT, playpantUrl, callJa, unzip, pickRavenFiles, parseRavenTable, callTypeReport, metadataNote } from '../lab/playpant.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const zipBuf = fs.readFileSync(path.join(here, '../fixtures/playpant-annotations.zip'));

test('Zenodo の URL: 空白入りのファイル名をエンコードし、ログイン不要の ?download=1', () => {
  assert.equal(playpantUrl(PLAYPANT.files.annotations), 'https://zenodo.org/records/18972388/files/04%20Annotations.zip?download=1');
  assert.equal(PLAYPANT.license, 'CC BY 4.0');
});

test('unzip: store と deflate の両方を展開し、ディレクトリ項目は含めない。中身が元のテキストと一致する', () => {
  const entries = unzip(zipBuf);
  assert.deepEqual(entries.map(e => e.name).sort(), ['README.txt', 'Round1/S01_dog1.Table.1.selections.txt', 'Round2_expert/S01_dog1.Table.1.selections.txt', 'Round2_expert/S01_dog1.TextGrid']);
  const t1 = entries.find(e => e.name.startsWith('Round1')).data.toString('utf8');
  assert.match(t1, /^Selection\tView\tChannel\tBegin Time \(s\)\tEnd Time \(s\)/);
  assert.match(t1, /5\tSpectrogram 1\t1\t4\.000\t4\.860\t100\t3000\tPant/);
  assert.equal(entries.find(e => e.name.endsWith('TextGrid')).data.toString('utf8'), 'File type = "ooTextFile"\nObject class = "TextGrid"\n');
  assert.throws(() => unzip(Buffer.from('not a zip')), /終端レコード/);
});

test('pickRavenFiles: .txt の表だけ（TextGrid と README は外す）、名前順', () => {
  const picked = pickRavenFiles(unzip(zipBuf)).map(e => e.name);
  assert.deepEqual(picked, ['Round1/S01_dog1.Table.1.selections.txt', 'Round2_expert/S01_dog1.Table.1.selections.txt']);
});

test('parseRavenTable: Begin/End Time と種類の列を名前で見つけ、CRLF・BOM・数字でない行も扱う', () => {
  const entries = unzip(zipBuf);
  const a = parseRavenTable(entries.find(e => e.name.startsWith('Round1')).data.toString('utf8'));
  assert.equal(a.header[a.labelCol], 'Call type');
  assert.equal(a.rows.length, 5, '時刻が x の行は飛ばす');
  assert.equal(a.skipped, 1);
  assert.deepEqual(a.rows.map(r => r.label), ['Bark', 'Whine', 'Growl', 'Whine', 'Pant']);
  assert.ok(Math.abs(a.rows[0].dur - 0.12) < 1e-9);
  const b = parseRavenTable(entries.find(e => e.name.startsWith('Round2_expert') && e.name.endsWith('.txt')).data.toString('utf8'));
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

test('callJa: 論文の表記ゆれ（Bark/yelp、Whine、Human speech）を日本語にし、知らないものは原文のまま', () => {
  assert.equal(callJa('Bark/yelp'), '吠え／キャン');
  assert.equal(callJa('whine'), 'くんくん');
  assert.equal(callJa('Growl'), 'うなり');
  assert.equal(callJa('Pant'), '息');
  assert.equal(callJa('Human speech'), '人の声');
  assert.equal(callJa('Zzz'), 'Zzz');
  assert.equal(callJa(''), '（空）');
});

test('callTypeReport: 層（最上位フォルダ）ごとに種類別の件数・中央値・25–75%・最長・合計、本体の境目との比較、読めない表のヘッダ', () => {
  const entries = unzip(zipBuf);
  const tables = pickRavenFiles(entries).map(e => ({ name: e.name, ...parseRavenTable(e.data.toString('utf8')) }));
  const md = callTypeReport(tables);
  assert.match(md, /表 2 枚、層: Round1・Round2_expert/);
  assert.match(md, /### Round1（1 枚、5 回。種類の列: Call type）/);
  assert.match(md, /\| Whine \| くんくん \| 2 \| 90 ms \| 85–90 ms \| 90 ms \| 0\.2 秒 \|/);
  assert.match(md, /\| Pant \| 息 \| 1 \| 860 ms \|/);
  assert.match(md, /「長い ≥710ms」に入る回 1\/5、「短い ≤590ms」 4\/5。時刻が読めず飛ばした行 1/);
  assert.match(md, /### Round2_expert（1 枚、3 回。種類の列: Annotation）/);
  assert.match(md, /\| Human speech \| 人の声 \| 1 \|/);
  assert.doesNotMatch(md, /見つからなかった表/);
  // 時刻の列が読めない表が混ざれば、そのヘッダを出す
  const md2 = callTypeReport([...tables, { name: 'Round3/x.txt', ...parseRavenTable('tmin\ttmax\ttext\n0\t1\tBark\n') }]);
  assert.match(md2, /見つからなかった表 1 枚\*\*。ヘッダ行（先頭 1 枚）: `tmin \| tmax \| text`/);
  assert.equal(callTypeReport([]), '');
});

test('metadataNote: Metadata.csv は列名と行数だけ（中身は決め打ちしない）', () => {
  assert.equal(metadataNote('﻿Session,Dog,Breed,Age\nS01,dog1,mix,12\nS02,dog2,poodle,20\n'), '- Metadata.csv: 2 行、列: Session、Dog、Breed、Age\n');
  assert.equal(metadataNote(''), '');
});
