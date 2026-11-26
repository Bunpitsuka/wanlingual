// Dog play pant（Zenodo 18972388、CC BY 4.0）の注釈を読む純粋関数（2026-11-24。datasets.md「次の一手」4 の (a)）。
// 音声はまだ落とさない。落とすのは注釈 zip（Raven のタブ区切り選択表 ＋ Praat TextGrid、約 123 KB）と Metadata.csv だけで、
// 声の種類（Growl / Whine / Bark …）ごとの件数と 1 回の長さの分布を Summary に出す。
// 注釈の列名はこの作業環境から Zenodo に届かず未確認なので、列は名前で探し（Begin Time (s) / End Time (s) と、種類らしい列）、
// 見つからなければヘッダ行をそのまま Summary に出して次の夜に直せるようにしてある。
import zlib from 'node:zlib';

export const PLAYPANT = {
  record: 18972388,
  // 2026-11-25: Zenodo の記録ページは CC BY 4.0 と表記しているが、データ内の `06 Readme.txt`（run 45254846743）は
  // 「Creative Commons Attribution–NonCommercial 4.0 International (CC BY-NC 4.0)」と書いている。食い違いは安全側に倒して
  // **NC（非営利）扱い＝ESC-50 と同じ検証専用**にする（数字・表を docs に書くのは可、製品に組み込む学習データにはしない）。
  license: 'CC BY-NC 4.0 扱い',
  licenseNote: 'Zenodo の記録ページの表記は CC BY 4.0、データ内の 06 Readme.txt は CC BY-NC 4.0 → 安全側の NC（検証専用、製品には入れない）として扱う',
  url: 'https://zenodo.org/records/18972388',
  files: { annotations: '04 Annotations.zip', metadata: '05 Metadata.csv', readme: '06 Readme.txt', audio: '03 Play session recordings.zip' },
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
/** 注釈の記号 → 種類（Zenodo の `06 Readme.txt` の Annotation labels、run 45250645427 で確認） */
export const CODE_LABEL = { A: 'Growl', B: 'Whine', C: 'Bark / yelp', D: 'Moan', E: 'Pant', F: 'Cough / woof', G: 'Howl', H: 'Grunts', I: 'Other', J: 'Sneeze', K: 'Shake', L: 'Human vocalizations' };
/** 記号なら種類の英語に直す（それ以外はそのまま） */
export function decodeLabel(label) {
  const s = String(label ?? '').trim();
  return CODE_LABEL[s.toUpperCase()] && s.length === 1 ? CODE_LABEL[s.toUpperCase()] : s;
}
export function callJa(label) {
  const s = decodeLabel(label);
  for (const [re, ja] of CALL_JA) if (re.test(s)) return ja;
  return s || '（空）';
}

/**
 * 最小の zip 読み（store と deflate だけ。Node に zip が無く、Actions のランナーの unzip に頼らないため）。
 * 中央ディレクトリを後ろから読んで [{ name, data: Buffer }] を返す。ディレクトリ項目は含めない。
 * 2026-11-25: 音声 zip（377 MB、WAV 30 本で展開後 約 720 MB）を一度に展開しないよう、一覧（zipIndex）と 1 件ずつの展開（zipExtract）に分けた。
 * unzip() は従来どおり全部を展開する（注釈 zip 123 KB 向け）。zip64（4 GB 超・65,535 件超）は未対応（377 MB・30 件なら要らない）。
 */
export function zipIndex(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip: 終端レコードが無い');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error('zip: zip64 は未対応');
  const out = [];
  for (let k = 0; k < count; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: 中央ディレクトリが壊れている');
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), usize = b.readUInt32LE(p + 24);
    const nlen = b.readUInt16LE(p + 28), xlen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32), lh = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    out.push({ name, method, csize, usize, lh });
  }
  return out;
}
/** zipIndex の 1 件を展開して Buffer を返す */
export function zipExtract(buf, entry) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const { name, method, csize, usize, lh } = entry;
  if (b.readUInt32LE(lh) !== 0x04034b50) throw new Error('zip: ローカルヘッダが壊れている: ' + name);
  const start = lh + 30 + b.readUInt16LE(lh + 26) + b.readUInt16LE(lh + 28);
  const raw = b.subarray(start, start + csize);
  let data;
  if (method === 0) data = Buffer.from(raw);
  else if (method === 8) data = zlib.inflateRawSync(raw);
  else throw new Error(`zip: 未対応の圧縮 ${method}: ${name}`);
  if (data.length !== usize) throw new Error(`zip: 展開後の大きさが合わない: ${name}`);
  return data;
}
export function unzip(buf) {
  return zipIndex(buf).map(e => ({ name: e.name, data: zipExtract(buf, e) }));
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
  // 2 層目（Praat の TextGrid から書き出した表、run 45250645427 の Readme）は tmin / tier / text / tmax
  const beginCol = find(/^(begin ?time|tmin$|start)/), endCol = find(/^(end ?time|tmax$|end$)/), tierCol = find(/^tier$/);
  let labelCol = hn.findIndex(h => /annotation|call|type|vocal|label|category|class|sound|behav|^text$/.test(h) && !/^(begin|end|delta|file|low|high|peak|avg|center)/.test(h));
  const body = lines.slice(1).map(l => l.split('\t'));
  if (labelCol < 0) labelCol = hn.findIndex((h, i) => !STD_RAVEN.test(h) && body.some(c => (c[i] ?? '').trim() && Number.isNaN(Number(c[i]))));
  const rows = [];
  let skipped = 0;
  if (beginCol >= 0 && endCol >= 0) {
    for (const c of body) {
      const begin = Number(c[beginCol]), end = Number(c[endCol]);
      if (!Number.isFinite(begin) || !Number.isFinite(end) || end < begin) { skipped++; continue; }
      const row = { begin, end, dur: end - begin, label: labelCol >= 0 ? (c[labelCol] ?? '').trim() : '' };
      if (tierCol >= 0) row.tier = (c[tierCol] ?? '').trim();
      rows.push(row);
    }
  }
  return { header, beginCol, endCol, labelCol, rows, skipped };
}

/** macOS が zip に混ぜる `__MACOSX/`・`._*`・`.DS_Store` は中身ではない（run 45243790948 で 97 ファイルのうち 30 枚ぶんがこれだった） */
export function isJunk(name) {
  return /(^|\/)__MACOSX\//.test(name) || /(^|\/)\._/.test(name) || /(^|\/)\.DS_Store$/.test(name);
}
/** zip の中身から Raven の表（.txt / .tsv）だけ選ぶ。TextGrid・README・凡例・macOS のごみは読まない */
export function pickRavenFiles(entries) {
  // 2 層目は `P-04-S-P_1.Table` のように拡張子が .Table（run 45248126366）
  return entries.filter(e => !isJunk(e.name) && /\.(txt|tsv|table)$/i.test(e.name) && !/readme|license|metadata|legend|codes?\b|categor/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
}
/**
 * 表でも TextGrid でもない小さなテキスト（README・凡例・コード表）を選ぶ。Annotation 列が A〜L の記号だった（run 45243790948）ので、
 * 記号→声の種類の対応はこういうファイルか Zenodo の説明文にあるはず。中身は playpant-check.mjs が Summary に出す
 */
export function pickNoteFiles(entries, { maxBytes = 64 * 1024 } = {}) {
  const tables = new Set(pickRavenFiles(entries).map(e => e.name));
  return entries.filter(e => !isJunk(e.name) && !tables.has(e.name) && /\.(txt|md|csv|tsv|json|rtf)$/i.test(e.name) && e.data.length <= maxBytes).sort((a, b) => a.name.localeCompare(b.name));
}

const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const ms = v => Math.round(v * 1000);

/**
 * 注釈の表（複数ファイル）→ Markdown。
 * tables = [{ name, header, labelCol, rows: [{dur, label}], skipped }]（parseRavenTable の結果に name を添えたもの）。
 * 表の入っているフォルダ（注釈の層: `04 Annotations/FirstLayer/` と `…/SecondLayer/` のように、ファイルの親フォルダ）ごとに、
 * 声の種類ごとの件数・1 回の長さの中央値・25–75%・最長・合計秒を出す。
 * 時刻列が読めなかったファイルは、そのヘッダ行をそのまま挙げる（列名を次の夜に直すため）。
 */
export function callTypeReport(tables, { source = `Dog play pant（Zenodo 18972388、${PLAYPANT.license}）` } = {}) {
  if (!tables.length) return '';
  const group = t => (t.name.includes('/') ? t.name.slice(0, t.name.lastIndexOf('/')) : '（直下）');
  const groups = [...new Set(tables.map(group))];
  let md = `**${source} の注釈（表 ${tables.length} 枚、層: ${groups.join('・')}）**\n\n`;
  const unread = tables.filter(t => !t.rows.length);
  for (const g of groups) {
    const ts = tables.filter(t => group(t) === g && t.rows.length);
    if (!ts.length) continue;
    const all = ts.flatMap(t => t.rows);
    // Praat 由来の表に tier 列があれば、声の tier（calls 等）だけ数え、他の tier は件数だけ添える
    const tiers = [...new Set(all.map(r => r.tier).filter(t => t))];
    const callTiers = tiers.filter(t => /call|sound|vocal/i.test(t));
    const rows = callTiers.length ? all.filter(r => callTiers.includes(r.tier)) : all;
    const byLabel = new Map();
    for (const r of rows) { const k = r.label || '（空）'; if (!byLabel.has(k)) byLabel.set(k, []); byLabel.get(k).push(r.dur); }
    const labelCols = [...new Set(ts.map(t => t.header[t.labelCol] ?? '（無し）'))];
    md += `### ${g}（${ts.length} 枚、${rows.length} 回。種類の列: ${labelCols.join('・')}${tiers.length ? `。tier: ${tiers.map(t => `${t} ${all.filter(r => r.tier === t).length}`).join('・')}${callTiers.length ? `（数えたのは ${callTiers.join('・')}）` : ''}` : ''}）\n\n`;
    md += `| 種類（原文） | 種類 | 日本語 | 件数 | 1 回の長さ 中央値 | 25–75% | 最長 | 合計 |\n|---|---|---|---|---|---|---|---|\n`;
    for (const [label, durs] of [...byLabel.entries()].sort((a, b) => b[1].length - a[1].length)) {
      md += `| ${label} | ${decodeLabel(label)} | ${callJa(label)} | ${durs.length} | ${ms(q(durs, 0.5))} ms | ${ms(q(durs, 0.25))}–${ms(q(durs, 0.75))} ms | ${ms(Math.max(...durs))} ms | ${durs.reduce((p, c) => p + c, 0).toFixed(1)} 秒 |\n`;
    }
    const skipped = ts.reduce((p, t) => p + t.skipped, 0);
    md += `\n- 本体の境目との比較: 「長い ≥710ms」に入る回 ${rows.filter(r => r.dur >= 0.71).length}/${rows.length}、「短い ≤590ms」 ${rows.filter(r => r.dur <= 0.59).length}/${rows.length}${skipped ? `。時刻が読めず飛ばした行 ${skipped}` : ''}\n\n`;
  }
  if (unread.length) {
    md += `- **時刻の列（Begin Time (s) / End Time (s)）が見つからなかった表 ${unread.length} 枚**。ヘッダ行（先頭 1 枚）: \`${unread[0].header.join(' | ')}\` → \`tests/lab/playpant.mjs\` の parseRavenTable の列名を直す\n\n`;
  }
  return md;
}

/** HTML の説明文（Zenodo の record.json の metadata.description）を素のテキストに（タグを外し、段落・改行を保つ） */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h\d)\s*\/?>/gi, '\n').replace(/<\s*li[^>]*>/gi, '- ').replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map(l => l.replace(/[ \t]+$/g, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Zenodo の record.json → 説明文（素のテキスト）とファイル一覧の Markdown。無ければ空文字 */
export function recordNote(json, { maxChars = 6000 } = {}) {
  let d; try { d = typeof json === 'string' ? JSON.parse(json) : json; } catch { return ''; }
  if (!d || typeof d !== 'object') return '';
  const files = (d.files ?? []).map(f => `${f.key}（${f.size >= 1e6 ? (f.size / 1e6).toFixed(0) + ' MB' : Math.round(f.size / 1e3) + ' KB'}）`);
  const text = htmlToText(d.metadata?.description);
  // ライセンス（旧 API は metadata.license.id、InvenioRDM は metadata.rights[].id / title.en）。Readme の CC BY-NC と食い違うので両方出す
  const lic = [d.metadata?.license?.id ?? d.metadata?.license, ...(d.metadata?.rights ?? []).map(r => r?.id ?? r?.title?.en ?? r?.title)].filter(v => typeof v === 'string' && v);
  let s = '';
  if (lic.length) s += `- Zenodo の記録のライセンス欄: ${[...new Set(lic)].join('、')}（${PLAYPANT.licenseNote}）\n`;
  if (files.length) s += `- Zenodo のファイル一覧: ${files.join('、')}\n`;
  if (text) s += `\n<details><summary>Zenodo の説明文（記号の凡例を探す。${text.length} 文字${text.length > maxChars ? `、先頭 ${maxChars} 文字` : ''}）</summary>\n\n\`\`\`\n${text.slice(0, maxChars)}\n\`\`\`\n\n</details>\n`;
  return s;
}

/**
 * Metadata.csv: 列名と行数、それに「値の種類が少ない列」（sr・チャンネル数・ビット深度・場面・注釈の有無 など）は値ごとの件数も出す
 * （run 45243790948 で分かった形: `;` 区切り、30 行、列 Audio_file;ID_dog;Session;…;Sample_rate-hz;Bit_depth;Channels;…;Context;Annotation_available;…）。
 * 区切りは 1 行目に多い方（`;` か `,`）。値の種類が maxUnique 以下の列だけ内訳を出す（犬の名前や日付は出さない）。
 */
export function metadataNote(csvText, { maxUnique = 6 } = {}) {
  const lines = String(csvText).replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (!lines.length) return '';
  const first = lines[0].replace(/^﻿/, '');
  const sep = (first.split(';').length > first.split(',').length) ? ';' : ',';
  const header = first.split(sep).map(h => h.trim());
  const rows = lines.slice(1).map(l => l.split(sep).map(c => c.trim()));
  let s = `- Metadata.csv: ${rows.length} 行（区切り \`${sep}\`）、列: ${header.join('、')}\n`;
  const details = [];
  header.forEach((h, i) => {
    if (/name|date|^id|file|session|annotator|reviewer|author|person/i.test(h)) return; // 人の名前になり得る列は出さない
    const count = new Map();
    for (const r of rows) { const v = r[i] ?? ''; count.set(v, (count.get(v) || 0) + 1); }
    if (count.size >= 1 && count.size <= maxUnique) details.push(`${h}: ${[...count.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v || '（空）'} ${n}`).join('・')}`);
  });
  if (details.length) s += `  - 値の種類が少ない列: ${details.join('／')}\n`;
  const dogCol = header.findIndex(h => /^id_dog$|dog_?id/i.test(h));
  if (dogCol >= 0) s += `  - 犬の数: ${new Set(rows.map(r => r[dogCol])).size}\n`;
  const durCol = header.findIndex(h => /duration/i.test(h));
  if (durCol >= 0) { const tot = rows.reduce((p, r) => p + (Number(r[durCol]) || 0), 0); if (tot) s += `  - 合計の長さ: ${(tot / 60).toFixed(1)} 分\n`; }
  return s;
}

/** 切り出す声の種類（日本語 → clips/ のフォルダ名）。人の声は「犬以外の誤検出の材料」（犬と遊んでいる人の声） */
export const CLIP_TYPES = { 'うなり': 'growl', '吠え／キャン': 'bark', 'くんくん': 'whine', '息': 'pant', 'うめき': 'moan', '人の声': 'human' };
/** 混ざった塊（2026-11-27）: 違う種類の声が 0.7 秒以内に続いた塊をそのまま 1 本に。本体 mic.js は種類を知らずに 1 塊にするので、実態に近い行になる。clips/mixed/ */
export const MIXED_TYPE = '混ざり', MIXED_DIR = 'mixed';
const isCallTier = t => !t || /call|sound|vocal/i.test(t);

/**
 * 注釈 → 切り出す塊の一覧（2026-11-26、datasets.md 次の一手 4 の (b) の 2 歩目）。
 * tables: parseRavenTable の結果に name を添えたもの（playpant-check と同じ）。layer: 使う層（フォルダ名の正規表現。既定は 2 層目 /second/i。無ければ全部の表）。
 * 本体 mic.js と同じく、声と声の間が gapSec 未満なら 1 つの塊にまとめ（maxSec を超えるところで区切る）、前 preRoll・後 postRoll を足す。
 * 塊の中に違う種類の声が混ざれば捨てる（種類ごとの表の純度のため。混ざった塊の数は counts.mixed に残す）。
 * 息（パンティング）だけは別扱い: ほぼ続いている小さい声なので他の種類の塊には混ぜず、息の塊は他の声と時間が重なれば捨てる。
 * calls 以外の tier（2 層目の noise 等）は 人の声 だけ拾う。種類ごとに perType 本まで、幹（セッション）の名前順に 1 本ずつ回して取る（決定的で、1 セッションに偏らない）。
 * 各幹の中では 2 回以上鳴いた塊を先に（lvlDrop が測れるのは n ≥ 2）、同じなら時刻順。
 * 2026-11-27: 混ざった塊（息以外の種類が 2 つ以上）も捨てずに type '混ざり'（dir 'mixed'）として perType 本まで取る（clip.mix に「うなり+吠え／キャン」の形で中身）。
 * 本体 mic.js は種類を知らずに 1 塊にするので、こちらの方が実態に近い。counts['混ざり'] は { all: 混ざった塊の数, mixed: 0, multi, picked, stems }、mixes に組み合わせごとの数。
 * 戻り値: { layer, clips: [{ type, dir, stem, begin, end, calls, mix? }], counts: { [type]: { all, mixed, multi, picked, stems } }, mixes: { [組み合わせ]: 数 } }（begin/end は余白込みの秒、0 未満は 0）
 */
export function pickClips(tables, { layer = /second/i, perType = 20, gapSec = 0.7, maxSec = 6, preRoll = 0.25, postRoll = 0.12, types = CLIP_TYPES } = {}) {
  const group = t => (t.name.includes('/') ? t.name.slice(0, t.name.lastIndexOf('/')).split('/').pop() : '（直下）');
  let use = tables.filter(t => layer && layer.test(group(t)) && t.rows.length);
  const layerName = use.length ? group(use[0]) : '（全部の表）';
  if (!use.length) use = tables.filter(t => t.rows.length);
  const byStem = new Map();
  for (const t of use) {
    const stem = stemOf(t.name);
    if (!byStem.has(stem)) byStem.set(stem, []);
    for (const r of t.rows) {
      const ja = callJa(r.label);
      if (!isCallTier(r.tier) && ja !== '人の声') continue; // noise 等の tier は人の声だけ
      byStem.get(stem).push({ begin: r.begin, end: r.end, ja });
    }
  }
  const counts = {}, mixes = {};
  for (const ja of [...Object.keys(types), MIXED_TYPE]) counts[ja] = { all: 0, mixed: 0, multi: 0, picked: 0, stems: 0 };
  const cluster = rows => {
    const out = [];
    let cur = null;
    for (const r of rows) {
      if (cur && r.begin - cur.end < gapSec && r.begin - cur.begin < maxSec) { cur.end = Math.max(cur.end, r.end); cur.calls++; cur.jas.add(r.ja); }
      else { if (cur) out.push(cur); cur = { begin: r.begin, end: r.end, calls: 1, jas: new Set([r.ja]) }; }
    }
    if (cur) out.push(cur);
    return out;
  };
  const perStem = new Map();
  for (const stem of [...byStem.keys()].sort()) {
    const rows = byStem.get(stem).sort((a, b) => a.begin - b.begin);
    // 息（パンティング）は遊びの間ほぼ続いていて小さい声なので、他の種類の塊とは別に作る（うなり・吠えの塊が「息が隣にある」だけで捨てられないように）。
    // 息の塊は、うなり・吠え等（息以外）の声と時間が重なれば捨てる（息だけの音にする）
    const loud = rows.filter(r => r.ja !== '息'), pants = rows.filter(r => r.ja === '息');
    const clusters = cluster(loud);
    for (const c of cluster(pants)) { if (loud.some(r => r.begin < c.end && r.end > c.begin)) c.jas.add('（重なり）'); clusters.push(c); }
    const pure = [];
    for (const c of clusters) {
      const ja = [...c.jas][0];
      const clip = { stem, begin: +Math.max(0, c.begin - preRoll).toFixed(3), end: +(c.end + postRoll).toFixed(3), calls: c.calls };
      if (c.jas.size > 1) {
        for (const j of c.jas) if (counts[j]) counts[j].mixed++;
        if (c.jas.has('息')) continue; // 息の塊が他の声と重なったもの（その声は息以外の塊の側で数えてある）
        if (![...c.jas].some(j => types[j])) continue; // 切り出す種類（うなり・吠え…）が 1 つも入らない塊（ぶつぶつ+その他 など）は取らない
        const mix = [...c.jas].sort().join('+'); // 息以外の種類が 2 つ以上（人の声も含む）
        mixes[mix] = (mixes[mix] || 0) + 1;
        counts[MIXED_TYPE].all++;
        if (c.calls >= 2) counts[MIXED_TYPE].multi++;
        pure.push({ type: MIXED_TYPE, dir: MIXED_DIR, ...clip, mix });
        continue;
      }
      if (!types[ja]) continue;
      counts[ja].all++;
      if (c.calls >= 2) counts[ja].multi++;
      pure.push({ type: ja, dir: types[ja], ...clip });
    }
    pure.sort((a, b) => (b.calls >= 2) - (a.calls >= 2) || a.begin - b.begin);
    perStem.set(stem, pure);
  }
  const clips = [];
  for (const ja of [...Object.keys(types), MIXED_TYPE]) {
    const queues = [...perStem.keys()].sort().map(s => perStem.get(s).filter(c => c.type === ja));
    counts[ja].stems = queues.filter(q => q.length).length;
    let got = 0;
    for (let round = 0; got < perType && queues.some(q => q.length > round); round++) {
      for (const q of queues) { if (got >= perType) break; if (q[round]) { clips.push(q[round]); got++; } }
    }
    counts[ja].picked = got;
  }
  return { layer: layerName, clips, counts, mixes };
}

/** pickClips の結果 → Markdown（どの層から、種類ごとに 塊がいくつ・混ざって捨てた数・2 回以上の塊・選んだ本数・セッション数） */
export function clipPlanReport(picked, { perType = 20 } = {}) {
  const { layer, clips, counts, mixes = {} } = picked;
  let md = `### 切り出す塊（${layer} の注釈。本体 mic.js と同じく 0.7 秒あいたら区切り、前 0.25 秒・後 0.12 秒。違う種類が混ざった塊は種類の表からは外して「混ざり」に、1 種類 ${perType} 本まで、セッションの名前順に 1 本ずつ）\n\n`;
  md += `| 種類 | フォルダ | 塊（純） | 混ざって外した | 2 回以上の塊 | 選んだ | セッション |\n|---|---|---|---|---|---|---|\n`;
  for (const [ja, c] of Object.entries(counts)) md += `| ${ja} | ${CLIP_TYPES[ja] ?? MIXED_DIR} | ${c.all} | ${ja === MIXED_TYPE ? '—' : c.mixed} | ${c.multi} | ${c.picked} | ${c.stems} |\n`;
  const sec = clips.reduce((p, c) => p + (c.end - c.begin), 0);
  md += `\n- 合計 ${clips.length} 本・${sec.toFixed(1)} 秒（2 回以上鳴いた塊 ${clips.filter(c => c.calls >= 2).length} 本）\n`;
  const mixList = Object.entries(mixes).sort((a, b) => b[1] - a[1]);
  if (mixList.length) md += `- 混ざりの内訳（息以外の種類が 2 つ以上。本体 mic.js はこれをそのまま 1 塊にする）: ${mixList.map(([k, v]) => `${k} ${v}`).join('・')}\n`;
  return md;
}

/** `P-01-S-P_1.Table.1.selections.txt` / `P-04-S-P_1.Table` / `P-01-S-P_1.wav` → `P-01-S-P_1`（Readme の「File naming conventions」。注釈と音声を結ぶ幹） */
export function stemOf(name) {
  const base = String(name ?? '').split('/').pop();
  return base.replace(/\.(Table\b.*|wav|txt|tsv|TextGrid)$/i, '');
}

/**
 * 音声 zip の WAV の一覧 → Markdown（2026-11-25、(b) の 1 歩目「落として WAV の一覧を出す」）。
 * wavs = [{ name, csize, usize, sr, ch, bits, fmt, seconds }]（zipIndex ＋ wavHeader）。tables は注釈の表（callTypeReport と同じ形、name と rows）で、
 * 幹（stemOf）が同じ注釈の件数を層ごとに添える。合計の分数と、Metadata.csv の 124.7 分・48 kHz と合うかを目で見るための表。
 */
export function audioListReport(wavs, tables = []) {
  if (!wavs.length) return '';
  const group = t => (t.name.includes('/') ? t.name.slice(0, t.name.lastIndexOf('/')).split('/').pop() : '（直下）');
  const layers = [...new Set(tables.map(group))];
  const countIn = (stem, layer) => tables.filter(t => group(t) === layer && stemOf(t.name) === stem).reduce((p, t) => p + t.rows.filter(r => !r.tier || /call|sound|vocal/i.test(r.tier)).length, 0);
  const total = wavs.reduce((p, w) => p + (w.seconds || 0), 0);
  const mb = n => (n / 1e6).toFixed(1);
  let md = `### 音声 zip（${PLAYPANT.files.audio}）の WAV ${wavs.length} 本、合計 ${(total / 60).toFixed(1)} 分（zip ${mb(wavs.reduce((p, w) => p + w.csize, 0))} MB → 展開 ${mb(wavs.reduce((p, w) => p + w.usize, 0))} MB）\n\n`;
  const srs = {}; for (const w of wavs) { const k = `${w.sr} Hz・${w.ch} ch・${w.bits} bit${w.fmt === 3 ? ' float' : ''}`; srs[k] = (srs[k] || 0) + 1; }
  md += `- 形式の内訳: ${Object.entries(srs).map(([k, v]) => `${k} ${v}`).join('／')}\n`;
  const noAnn = wavs.filter(w => tables.length && !layers.some(l => countIn(stemOf(w.name), l)));
  if (tables.length) md += `- 注釈と幹（P-01-S-P_1 など）で結べた WAV: ${wavs.length - noAnn.length}/${wavs.length}${noAnn.length ? `（結べない: ${noAnn.map(w => w.name.split('/').pop()).join('、')}）` : ''}\n`;
  md += `\n| WAV | 長さ | 形式 | 展開後 MB |${layers.map(l => ` ${l} の声 |`).join('')}\n|---|---|---|---|${layers.map(() => '---|').join('')}\n`;
  for (const w of [...wavs].sort((a, b) => a.name.localeCompare(b.name))) {
    const stem = stemOf(w.name);
    md += `| ${w.name.split('/').pop()} | ${(w.seconds / 60).toFixed(1)} 分 | ${w.sr} Hz・${w.ch} ch・${w.bits} bit | ${mb(w.usize)} |${layers.map(l => ` ${countIn(stem, l)} |`).join('')}\n`;
  }
  return md + '\n';
}
