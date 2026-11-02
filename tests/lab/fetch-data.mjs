// 検証用の「本物の犬」データを取得する（リポジトリには入れない。tests/lab/data/ は .gitignore 済み）。
//
//   node tests/lab/fetch-data.mjs            # 無いものだけ落とす
//
// 1. ESC-50（CC BY-NC 3.0 → 検証専用。製品に組み込まない）: dog 40 本と、犬以外 8 クラス×5 本。
//    GitHub の raw から 1 本ずつ取る（600MB の zip を落とさない）。
// 2. pet-decoder-audio-fixtures（CC0 1.0、Internet Archive 由来の犬の音 5 本）: Hugging Face から。
//    この環境から HF に届かないときは飛ばす（GitHub Actions の lab-yamnet では届く）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA = path.join(here, 'data');
const ESC_RAW = 'https://raw.githubusercontent.com/karoldvl/ESC-50/master';
/** 犬以外: 音量だけの吠え検出が拾いそうな、短く大きい音と動物の声 */
export const NON_DOG = ['cat', 'rooster', 'crying_baby', 'door_wood_knock', 'clapping', 'laughing', 'car_horn', 'coughing'];
export const PER_CLASS = 5;

async function get(url, file, { optional = false } = {}) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return true;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    return true;
  } catch (e) {
    if (!optional) throw new Error(`${url}: ${e.message}`);
    console.warn('skip', url, '-', e.message);
    return false;
  }
}

/** ESC-50 のメタデータ → [{file, category}]。dog 40 本 + 犬以外 8×5 本（ファイル名順で先頭から） */
export function pickEsc50(csvText) {
  const rows = csvText.trim().split('\n').slice(1).map(l => { const c = l.split(','); return { file: c[0], category: c[3] }; });
  const dogs = rows.filter(r => r.category === 'dog').sort((a, b) => a.file.localeCompare(b.file));
  const others = NON_DOG.flatMap(cat => rows.filter(r => r.category === cat).sort((a, b) => a.file.localeCompare(b.file)).slice(0, PER_CLASS));
  return [...dogs, ...others];
}

/** 取得済みデータの一覧 [{file, path, category, source}]。無いものは含めない */
export function listData() {
  const out = [];
  const csv = path.join(DATA, 'esc50/esc50.csv');
  if (fs.existsSync(csv)) {
    for (const r of pickEsc50(fs.readFileSync(csv, 'utf8'))) {
      const p = path.join(DATA, 'esc50', r.file);
      if (fs.existsSync(p)) out.push({ file: r.file, path: p, category: r.category, source: 'ESC-50' });
    }
  }
  const cc0 = path.join(DATA, 'cc0');
  if (fs.existsSync(cc0)) {
    for (const f of fs.readdirSync(cc0).filter(f => /\.wav$/i.test(f)).sort()) out.push({ file: f, path: path.join(cc0, f), category: 'dog(cc0)', source: 'CC0' });
  }
  return out;
}

/** WAV 以外（mp3 等）は ffmpeg があれば 16bit モノラル WAV に変換して隣に置く（検証スクリプトは WAV だけ読む） */
function toWav(file) {
  if (/\.wav$/i.test(file)) return;
  const out = file.replace(/\.[^.]+$/, '.wav');
  if (fs.existsSync(out)) return;
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-ac', '1', '-sample_fmt', 's16', out], { stdio: 'inherit' });
  if (r.error) console.warn('ffmpeg が無いので変換できず（apt-get install ffmpeg）:', path.basename(file), r.error.code);
  else if (r.status !== 0) console.warn('ffmpeg で変換できず:', path.basename(file), 'exit', r.status);
}

export async function fetchAll() {
  const csvFile = path.join(DATA, 'esc50/esc50.csv');
  await get(`${ESC_RAW}/meta/esc50.csv`, csvFile);
  const picks = pickEsc50(fs.readFileSync(csvFile, 'utf8'));
  let n = 0;
  for (const r of picks) if (await get(`${ESC_RAW}/audio/${r.file}`, path.join(DATA, 'esc50', r.file))) n++;
  console.log(`ESC-50: ${n}/${picks.length} 本（dog ${picks.filter(r => r.category === 'dog').length}、犬以外 ${picks.length - picks.filter(r => r.category === 'dog').length}）`);

  // Hugging Face: ファイル一覧を API で取り、音声だけ落とす（ファイル名を決め打ちしない）
  const repo = 'petdecoder/pet-decoder-audio-fixtures';
  let files = [];
  try {
    const r = await fetch(`https://huggingface.co/api/datasets/${repo}/tree/main`, { signal: AbortSignal.timeout(30_000) });
    if (r.ok) files = (await r.json()).filter(e => e.type === 'file' && /\.(wav|mp3|flac|ogg|m4a)$/i.test(e.path)).map(e => e.path);
    else console.warn('HF 一覧 HTTP', r.status);
  } catch (e) { console.warn('HF に届かない:', e.message); }
  let m = 0;
  for (const f of files) {
    const dst = path.join(DATA, 'cc0', path.basename(f));
    const ok = await get(`https://huggingface.co/datasets/${repo}/resolve/main/${f}`, dst, { optional: true });
    if (ok) { m++; toWav(dst); }
  }
  console.log(`CC0 (HF): ${m}/${files.length} 本`, files.map(f => path.basename(f)).join(', '));
  const cc0Readme = path.join(DATA, 'cc0/README.md');
  if (files.length) await get(`https://huggingface.co/datasets/${repo}/resolve/main/README.md`, cc0Readme, { optional: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await fetchAll();
}
