// Dog play pant の注釈読み（zip → Raven の表 → 種類ごとの件数・長さ）の単体テスト（ネット不要。2026-11-24）
// fixtures/playpant-annotations.zip は Python の zipfile で作った合成の表（本物のデータは入れていない。deflate と store の両方、
// 2 層のフォルダ、TextGrid・README・macOS のごみ（__MACOSX/ と .DS_Store）入り。本物の zip の形は run 45243790948 の Summary に合わせた）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAYPANT, playpantUrl, ZENODO_HEADERS, callJa, decodeLabel, CODE_LABEL, unzip, zipIndex, zipExtract, isJunk, pickRavenFiles, pickNoteFiles, parseRavenTable, callTypeReport, metadataNote, htmlToText, recordNote, stemOf, audioListReport } from '../lab/playpant.mjs';
import { wavHeader, readWav } from '../lab/wav.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const zipBuf = fs.readFileSync(path.join(here, '../fixtures/playpant-annotations.zip'));
// fixtures/playpant-audio.zip（2026-11-25）: 合成の WAV 3 本（16 bit mono store・32 bit float EXTENSIBLE deflate・壊れた 40 バイト）＋ macOS のごみ＋ notes.txt。本物の音声は入れていない
const audioBuf = fs.readFileSync(path.join(here, '../fixtures/playpant-audio.zip'));
const T1 = '04 Annotations/FirstLayer/S01_dog1.Table.1.selections.txt', T2 = '04 Annotations/FirstLayer/S02_dog2.Table.1.selections.txt', T3 = '04 Annotations/SecondLayer/S01_dog1.Table';

test('Zenodo の URL: 空白入りのファイル名をエンコードし、既定は API の /content、api:false で記録ページの ?download=1', () => {
  assert.equal(playpantUrl(PLAYPANT.files.annotations), 'https://zenodo.org/api/records/18972388/files/04%20Annotations.zip/content');
  assert.equal(playpantUrl(PLAYPANT.files.annotations, { api: false }), 'https://zenodo.org/records/18972388/files/04%20Annotations.zip?download=1');
  assert.equal(PLAYPANT.license, 'CC BY-NC 4.0 扱い', 'Readme が CC BY-NC（run 45254846743）なので安全側');
  assert.match(PLAYPANT.licenseNote, /検証専用/);
  assert.match(ZENODO_HEADERS['User-Agent'], /wanlingual-lab/);
});

test('unzip: store と deflate の両方を展開し、ディレクトリ項目は含めない。中身が元のテキストと一致する', () => {
  const entries = unzip(zipBuf);
  assert.equal(entries.length, 8, 'ディレクトリ項目 1 つを除いた 8 ファイル');
  const t1 = entries.find(e => e.name === T1).data.toString('utf8');
  assert.match(t1, /^Selection\tView\tChannel\tBegin Time \(s\)\tEnd Time \(s\)/);
  assert.match(t1, /5\tSpectrogram 1\t1\t4\.000\t4\.860\t100\t3000\tPant/);
  assert.equal(entries.find(e => e.name.endsWith('TextGrid')).data.toString('utf8'), 'File type = "ooTextFile"\nObject class = "TextGrid"\n');
  assert.throws(() => unzip(Buffer.from('not a zip')), /終端レコード/);
  // zipIndex + zipExtract（1 件ずつ）は unzip と同じ中身
  const idx = zipIndex(zipBuf);
  assert.deepEqual(idx.map(e => e.name), entries.map(e => e.name));
  assert.ok(idx.every(e => typeof e.csize === 'number' && typeof e.usize === 'number' && typeof e.lh === 'number'));
  assert.ok(idx.some(e => e.method === 0) && idx.some(e => e.method === 8), 'store と deflate の両方');
  assert.equal(zipExtract(zipBuf, idx.find(e => e.name === T1)).toString('utf8'), t1);
});

test('wavHeader: fmt・ch・sr・bits・秒を読み、EXTENSIBLE（0xFFFE）は SubFormat から float を見分ける。readWav は Buffer も受ける', () => {
  const idx = zipIndex(audioBuf);
  const w1 = wavHeader(zipExtract(audioBuf, idx.find(e => e.name.endsWith('P-01-S-P_1.wav'))));
  assert.deepEqual([w1.sr, w1.ch, w1.bits, w1.fmt, +w1.seconds.toFixed(3)], [48000, 1, 16, 1, 0.1]);
  const w2 = wavHeader(zipExtract(audioBuf, idx.find(e => e.name.endsWith('P-02-S-P_1.wav'))));
  assert.deepEqual([w2.sr, w2.ch, w2.bits, w2.fmt, +w2.seconds.toFixed(3)], [48000, 2, 32, 3, 0.05], 'EXTENSIBLE の float を 3 に');
  const x2 = readWav(zipExtract(audioBuf, idx.find(e => e.name.endsWith('P-02-S-P_1.wav'))));
  assert.equal(x2.sr, 48000);
  assert.equal(x2.x.length, 2400);
  assert.ok(Math.abs(Math.max(...x2.x) - 0.5) < 0.01, 'float として読めば振幅 0.5（Int32 と読むと 0 近くになる）');
  const fx = readWav(path.join(here, '../fixtures/bark4.wav'));
  assert.ok(fx.x.length > 0 && fx.sr > 0, '従来どおりパスでも読める');
  assert.throws(() => wavHeader(zipExtract(audioBuf, idx.find(e => e.name.endsWith('P-02-S-P_2.wav'))), 'x'), /no data chunk: x/);
  assert.throws(() => wavHeader(Buffer.from('xxxx')), /not RIFF/);
});

test('stemOf / audioListReport: 注釈と音声を幹で結び、WAV ごとの長さ・形式・層ごとの声の数、形式の内訳、結べない WAV を出す', () => {
  assert.equal(stemOf('04 Annotations/FirstLayer/P-01-S-P_1.Table.1.selections.txt'), 'P-01-S-P_1');
  assert.equal(stemOf('04 Annotations/SecondLayer/P-04-S-P_1.Table'), 'P-04-S-P_1');
  assert.equal(stemOf('03 Play session recordings/P-01/P-01-S-P_1.wav'), 'P-01-S-P_1');
  assert.equal(stemOf('P-13-S-P_3.TextGrid'), 'P-13-S-P_3');
  const wavs = [
    { name: '03 Play session recordings/P-02/P-02-S-P_1.wav', csize: 1e6, usize: 2e6, sr: 48000, ch: 2, bits: 32, fmt: 3, seconds: 90 },
    { name: '03 Play session recordings/P-01/P-01-S-P_1.wav', csize: 3e6, usize: 4e6, sr: 48000, ch: 1, bits: 16, fmt: 1, seconds: 30 },
  ];
  const tables = [
    { name: '04 Annotations/FirstLayer/P-01-S-P_1.Table.1.selections.txt', rows: [{ dur: 0.1, label: 'A' }, { dur: 0.2, label: 'C' }] },
    { name: '04 Annotations/SecondLayer/P-01-S-P_1.Table', rows: [{ dur: 0.1, label: 'Growl', tier: 'calls' }, { dur: 0.5, label: 'talk', tier: 'noise' }] },
  ];
  const md = audioListReport(wavs, tables);
  assert.match(md, /^### 音声 zip（03 Play session recordings\.zip）の WAV 2 本、合計 2\.0 分（zip 4\.0 MB → 展開 6\.0 MB）/);
  assert.match(md, /形式の内訳: 48000 Hz・2 ch・32 bit float 1／48000 Hz・1 ch・16 bit 1/);
  assert.match(md, /結べた WAV: 1\/2（結べない: P-02-S-P_1\.wav）/);
  assert.match(md, /\| WAV \| 長さ \| 形式 \| 展開後 MB \| FirstLayer の声 \| SecondLayer の声 \|/);
  assert.match(md, /\| P-01-S-P_1\.wav \| 0\.5 分 \| 48000 Hz・1 ch・16 bit \| 4\.0 \| 2 \| 1 \|/, '2 層目は calls の tier だけ数える');
  assert.match(md, /\| P-02-S-P_1\.wav \| 1\.5 分 \| 48000 Hz・2 ch・32 bit \| 2\.0 \| 0 \| 0 \|/);
  assert.ok(md.lastIndexOf('| P-01-S-P_1.wav') < md.lastIndexOf('| P-02-S-P_1.wav'), '表は名前順');
  assert.equal(audioListReport([]), '');
  assert.doesNotMatch(audioListReport(wavs), /結べた WAV/, '注釈が無ければ対応の行は出さない');
});

test('isJunk / pickRavenFiles / pickNoteFiles: macOS のごみを外し、表は .txt と .Table（TextGrid・README は外す）、README は凡例の候補として拾う', () => {
  const entries = unzip(zipBuf);
  assert.deepEqual(entries.filter(e => isJunk(e.name)).map(e => e.name).sort(), ['04 Annotations/.DS_Store', '__MACOSX/04 Annotations/._.DS_Store', '__MACOSX/04 Annotations/FirstLayer/._S01_dog1.Table.1.selections.txt']);
  assert.deepEqual(pickRavenFiles(entries).map(e => e.name), [T1, T2, T3]);
  assert.deepEqual(pickNoteFiles(entries).map(e => e.name), ['04 Annotations/README.txt']);
  assert.deepEqual(pickNoteFiles(entries, { maxBytes: 10 }), [], '大きいものは読まない');
});

test('parseRavenTable: Begin/End Time（Raven）と tmin/tmax（Praat）と種類の列を名前で見つけ、CRLF・BOM・数字でない行も扱う', () => {
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
  assert.deepEqual(b.rows.map(r => r.label), ['C', 'B', 'L'], '記号はそのまま持つ（表示で直す）');
  // 2 層目（Praat から書き出した表）: tmin / tier / text / tmax
  const p = parseRavenTable(entries.find(e => e.name === T3).data.toString('utf8'));
  assert.equal(p.header[p.labelCol], 'text');
  assert.deepEqual(p.rows.map(r => [r.label, r.tier]), [['C', 'calls'], ['B', 'calls'], ['A', 'calls'], ['play starts', 'comments']]);
  assert.ok(Math.abs(p.rows[2].dur - 0.4) < 1e-9);
  // 標準列以外で文字が入っている列を種類として拾う（名前にヒントが無い場合）
  const c = parseRavenTable('Selection\tBegin Time (s)\tEnd Time (s)\tNotes\n1\t0\t0.1\tGrowl\n2\t1\t1.2\tWhine\n');
  assert.equal(c.header[c.labelCol], 'Notes');
  assert.deepEqual(c.rows.map(r => r.label), ['Growl', 'Whine']);
  // 時刻の列が無ければ rows は空、header は残る（Summary にヘッダを出して次の夜に直す）
  const d = parseRavenTable('onset\toffset\tlabel\n0\t1\tBark\n');
  assert.equal(d.rows.length, 0);
  assert.equal(d.beginCol, -1);
  assert.deepEqual(d.header, ['onset', 'offset', 'label']);
  assert.deepEqual(parseRavenTable('').rows, []);
});

test('decodeLabel / callJa: 記号 A〜L は Readme の凡例で種類に直し、表記ゆれ（Bark/yelp、Whine、Human speech）を日本語にし、知らないものは原文のまま', () => {
  assert.equal(Object.keys(CODE_LABEL).join(''), 'ABCDEFGHIJKL');
  assert.equal(decodeLabel('A'), 'Growl');
  assert.equal(decodeLabel('e'), 'Pant');
  assert.equal(decodeLabel('Growl'), 'Growl');
  assert.equal(decodeLabel('AB'), 'AB', '2 文字は記号ではない');
  assert.equal(callJa('A'), 'うなり');
  assert.equal(callJa('B'), 'くんくん');
  assert.equal(callJa('C'), '吠え／キャン');
  assert.equal(callJa('E'), '息');
  assert.equal(callJa('H'), 'ぶつぶつ');
  assert.equal(callJa('L'), '人の声');
  assert.equal(callJa('Bark/yelp'), '吠え／キャン');
  assert.equal(callJa('whine'), 'くんくん');
  assert.equal(callJa('Growl'), 'うなり');
  assert.equal(callJa('Pant'), '息');
  assert.equal(callJa('Human speech'), '人の声');
  assert.equal(callJa(''), '（空）');
});

test('callTypeReport: 層（表の親フォルダ）ごとに種類別の件数・中央値・25–75%・最長・合計、本体の境目との比較、読めない表のヘッダ', () => {
  const entries = unzip(zipBuf);
  const tables = pickRavenFiles(entries).map(e => ({ name: e.name, ...parseRavenTable(e.data.toString('utf8')) }));
  const md = callTypeReport(tables);
  assert.match(md, /表 3 枚、層: 04 Annotations\/FirstLayer・04 Annotations\/SecondLayer/);
  assert.match(md, /### 04 Annotations\/FirstLayer（2 枚、8 回。種類の列: Call type・Annotation）/);
  assert.match(md, /\| Whine \| Whine \| くんくん \| 2 \| 90 ms \| 85–90 ms \| 90 ms \| 0\.2 秒 \|/);
  assert.match(md, /\| Pant \| Pant \| 息 \| 1 \| 860 ms \|/);
  assert.match(md, /\| L \| Human vocalizations \| 人の声 \| 1 \| 300 ms \|/, '記号は種類に直して並べる');
  assert.match(md, /「長い ≥710ms」に入る回 1\/8、「短い ≤590ms」 7\/8。時刻が読めず飛ばした行 1/);
  // 2 層目: tier が calls の行だけ数え、comments は件数だけ添える
  assert.match(md, /### 04 Annotations\/SecondLayer（1 枚、3 回。種類の列: text。tier: calls 3・comments 1（数えたのは calls））/);
  assert.match(md, /\| A \| Growl \| うなり \| 1 \| 400 ms \|/);
  assert.doesNotMatch(md, /play starts/);
  assert.doesNotMatch(md, /見つからなかった表/);
  // 時刻の列が読めない表が混ざれば、そのヘッダを出す
  const md2 = callTypeReport([...tables, { name: 'Round3/x.txt', ...parseRavenTable('onset\toffset\tlabel\n0\t1\tBark\n') }]);
  assert.match(md2, /見つからなかった表 1 枚\*\*。ヘッダ行（先頭 1 枚）: `onset \| offset \| label`/);
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
  assert.doesNotMatch(s, /ライセンス欄/, 'ライセンスの項目が無ければ出さない');
  assert.match(s, /ファイル一覧: 04 Annotations\.zip（123 KB）、03 Play session recordings\.zip（377 MB）/);
  // ライセンス欄（旧 API の metadata.license.id と InvenioRDM の metadata.rights[]）は Readme の CC BY-NC と食い違うので出す
  const s2 = recordNote({ metadata: { license: { id: 'cc-by-4.0' }, rights: [{ id: 'cc-by-4.0', title: { en: 'Creative Commons Attribution 4.0 International' } }] } });
  assert.match(s2, /^- Zenodo の記録のライセンス欄: cc-by-4\.0（Zenodo の記録ページの表記は CC BY 4\.0、データ内の 06 Readme\.txt は CC BY-NC 4\.0/);
  assert.match(s, /<details><summary>Zenodo の説明文（記号の凡例を探す。\d+ 文字）<\/summary>\n\n```\nVocalization codes: A = Growl\n```/);
  assert.equal(recordNote('{not json'), '');
  assert.equal(recordNote(JSON.stringify(rec)).length, s.length, '文字列の JSON も同じ');
});
