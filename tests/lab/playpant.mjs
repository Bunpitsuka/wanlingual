// Dog play pant（Zenodo 18972388、CC BY 4.0）の注釈を読む純粋関数（2026-11-24。datasets.md「次の一手」4 の (a)）。
// 音声はまだ落とさない。落とすのは注釈 zip（Raven のタブ区切り選択表 ＋ Praat TextGrid、約 123 KB）と Metadata.csv だけで、
// 声の種類（Growl / Whine / Bark …）ごとの件数と 1 回の長さの分布を Summary に出す。
// 注釈の列名はこの作業環境から Zenodo に届かず未確認なので、列は名前で探し（Begin Time (s) / End Time (s) と、種類らしい列）、
// 見つからなければヘッダ行をそのまま Summary に出して次の夜に直せるようにしてある。
import zlib from 'node:zlib';

export const PLAYPANT = {
  record: 18972388,
  license: 'CC BY 4.0',
  url: 'https://zenodo.org/records/18972388',
  files: { annotations: '04 Annotations.zip', metadata: '05 Metadata.csv', audio: '03 Play session recordings.zip' },
};
/**
 * Zenodo の直接ダウンロード URL（ログイン不要）。
 * 2026-11-24 の run 45239972718 で、記録ページの `?download=1` は Actions のランナーからだと HTTP 403 だったので、
 * 既定はプログラム向けの API（`/api/records/<id>/files/<name>/content`）にし、`{ api: false }` で従来の URL も出せるようにした（片方ずつ試す）。
 */
export function playpantUrl(name, { api = true } = {}) {
  const f = encodeURIComponent(name);
  return api ? `https://zenodo.org/api/records/${PLAYPANT.record}/files/${f}/content` : `https://zenodo.org/records/${PLAYPANT.record}/files/${f}?download=1`;
}
/** Zenodo は User-Agent の無い／素の取得を 403 で返すことがあるので、ブラウザ風の UA と Accept を付けて取る */
export const ZENODO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) wanlingual-lab/1.0 (+https://github.com/Bunpitsuka/wanlingual)', Accept: '*/*' };

/** 声の種類の英語（論文の表記ゆれも拾う）→ 日本語。合わなければ英語のまま */
export const CALL_JA = [
  [/growl/i, 'うなり'], [/whin/i, 'くんくん'], [/bark|yelp/i, '吠え／キャン'], [/moan/i, 'うめき'], [/pant/i, '息'],
  [/cough|woof/i, '咳／ウーフ'], [/howl/i, '遠吠え'], [/grunt/i, 'ぶつぶつ'], [/sneez/i, 'くしゃみ'], [/shak/i, '身震い'],
  [/human|speech|voice|person/i, '人の声'], [/other|unk/i, 'その他'],
];
export function callJa(label) {
  const s = String(label ?? '').trim();
  for (const [re, ja] of CALL_JA) if (re.test(s)) return ja;
  return s || '（空）';
}

/**
 * 最小の zip 読み（store と deflate だけ。Node に zip が無く、Actions のランナーの unzip に頼らないため）。
 * 中央ディレクトリを後ろから読んで [{ name, data: Buffer }] を返す。ディレクトリ項目は含めない。
 */
export function unzip(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip: 終端レコードが無い');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = [];
  for (let k = 0; k < count; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: 中央ディレクトリが壊れている');
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), usize = b.readUInt32LE(p + 24);
    const nlen = b.readUInt16LE(p + 28), xlen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32), lh = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (b.readUInt32LE(lh) !== 0x04034b50) throw new Error('zip: ローカルヘッダが壊れている: ' + name);
    const start = lh + 30 + b.readUInt16LE(lh + 26) + b.readUInt16LE(lh + 28);
    const raw = b.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`zip: 未対応の圧縮 ${method}: ${name}`);
    if (data.length !== usize) throw new Error(`zip: 展開後の大きさが合わない: ${name}`);
    out.push({ name, data });
  }
  return out;
}

const norm = s => String(s ?? '').replace(/^﻿/, '').trim().toLowerCase();
const STD_RAVEN = /^(selection|view|channel|begin time|end time|low freq|high freq|delta time|delta freq|begin path|end path|file offset|begin file|end file|begin date|begin hour|begin clock|end clock|avg power|peak power|peak freq|center freq|bw |dur |inband|max |min |agg|energy|occupancy|q[13] |iqr|cum)/;

/**
 * Raven の選択表（タブ区切り、1 行目がヘッダ）→ { header, beginCol, endCol, labelCol, rows: [{ begin, end, dur, label }], skipped }。
 * 時刻列は「Begin Time (s)」「End Time (s)」（大文字小文字・空白ゆれ可）。種類の列は、名前に annotation / call / type / vocal / label /
 * category / class / sound / behav が入る列を優先し、無ければ Raven の標準列以外で最初に文字が入っている列。
 * 時刻列が見つからなければ rows は空で、header だけ返す（Summary にヘッダを出して次の夜に直す）。
 */
export function parseRavenTable(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (!lines.length) return { header: [], beginCol: -1, endCol: -1, labelCol: -1, rows: [], skipped: 0 };
  const header = lines[0].replace(/^﻿/, '').split('\t').map(h => h.trim());
  const hn = header.map(norm);
  const find = re => hn.findIndex(h => re.test(h));
  const beginCol = find(/^begin ?time/), endCol = find(/^end ?time/);
  let labelCol = hn.findIndex(h => /annotation|call|type|vocal|label|category|class|sound|behav/.test(h) && !/^(begin|end|delta|file|low|high|peak|avg|center)/.test(h));
  const body = lines.slice(1).map(l => l.split('\t'));
  if (labelCol < 0) labelCol = hn.findIndex((h, i) => !STD_RAVEN.test(h) && body.some(c => (c[i] ?? '').trim() && Number.isNaN(Number(c[i]))));
  const rows = [];
  let skipped = 0;
  if (beginCol >= 0 && endCol >= 0) {
    for (const c of body) {
      const begin = Number(c[beginCol]), end = Number(c[endCol]);
      if (!Number.isFinite(begin) || !Number.isFinite(end) || end < begin) { skipped++; continue; }
      rows.push({ begin, end, dur: end - begin, label: labelCol >= 0 ? (c[labelCol] ?? '').trim() : '' });
    }
  }
  return { header, beginCol, endCol, labelCol, rows, skipped };
}

/** zip の中身から Raven の表（.txt / .tsv / .csv の名前に selection か table、または拡張子 .txt）だけ選ぶ。TextGrid は読まない */
export function pickRavenFiles(entries) {
  return entries.filter(e => /\.(txt|tsv|csv)$/i.test(e.name) && !/readme|license|metadata/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
}

const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const ms = v => Math.round(v * 1000);

/**
 * 注釈の表（複数ファイル）→ Markdown。
 * tables = [{ name, header, labelCol, rows: [{dur, label}], skipped }]（parseRavenTable の結果に name を添えたもの）。
 * zip の中の最上位フォルダ（注釈の層: 初回／専門家の修正後）ごとに、声の種類ごとの件数・1 回の長さの中央値・25–75%・最長・合計秒を出す。
 * 時刻列が読めなかったファイルは、そのヘッダ行をそのまま挙げる（列名を次の夜に直すため）。
 */
export function callTypeReport(tables, { source = 'Dog play pant（Zenodo 18972388、CC BY 4.0）' } = {}) {
  if (!tables.length) return '';
  const group = t => (t.name.includes('/') ? t.name.split('/')[0] : '（直下）');
  const groups = [...new Set(tables.map(group))];
  let md = `**${source} の注釈（音声はまだ落としていない。表 ${tables.length} 枚、層: ${groups.join('・')}）**\n\n`;
  const unread = tables.filter(t => !t.rows.length);
  for (const g of groups) {
    const ts = tables.filter(t => group(t) === g && t.rows.length);
    if (!ts.length) continue;
    const rows = ts.flatMap(t => t.rows);
    const byLabel = new Map();
    for (const r of rows) { const k = r.label || '（空）'; if (!byLabel.has(k)) byLabel.set(k, []); byLabel.get(k).push(r.dur); }
    const labelCols = [...new Set(ts.map(t => t.header[t.labelCol] ?? '（無し）'))];
    md += `### ${g}（${ts.length} 枚、${rows.length} 回。種類の列: ${labelCols.join('・')}）\n\n`;
    md += `| 種類（原文） | 日本語 | 件数 | 1 回の長さ 中央値 | 25–75% | 最長 | 合計 |\n|---|---|---|---|---|---|---|\n`;
    for (const [label, durs] of [...byLabel.entries()].sort((a, b) => b[1].length - a[1].length)) {
      md += `| ${label} | ${callJa(label)} | ${durs.length} | ${ms(q(durs, 0.5))} ms | ${ms(q(durs, 0.25))}–${ms(q(durs, 0.75))} ms | ${ms(Math.max(...durs))} ms | ${durs.reduce((p, c) => p + c, 0).toFixed(1)} 秒 |\n`;
    }
    const skipped = ts.reduce((p, t) => p + t.skipped, 0);
    md += `\n- 本体の境目との比較: 「長い ≥710ms」に入る回 ${rows.filter(r => r.dur >= 0.71).length}/${rows.length}、「短い ≤590ms」 ${rows.filter(r => r.dur <= 0.59).length}/${rows.length}${skipped ? `。時刻が読めず飛ばした行 ${skipped}` : ''}\n\n`;
  }
  if (unread.length) {
    md += `- **時刻の列（Begin Time (s) / End Time (s)）が見つからなかった表 ${unread.length} 枚**。ヘッダ行（先頭 1 枚）: \`${unread[0].header.join(' | ')}\` → \`tests/lab/playpant.mjs\` の parseRavenTable の列名を直す\n\n`;
  }
  return md;
}

/** Metadata.csv は中身を決め打ちしない: 列名と行数だけ（次の夜に datasets.md へ書く材料） */
export function metadataNote(csvText) {
  const lines = String(csvText).replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (!lines.length) return '';
  const header = lines[0].replace(/^﻿/, '').split(',').map(h => h.trim());
  return `- Metadata.csv: ${lines.length - 1} 行、列: ${header.join('、')}\n`;
}
