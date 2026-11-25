// 検証用の「本物の犬」データを取得する（リポジトリには入れない。tests/lab/data/ は .gitignore 済み）。
//
//   node tests/lab/fetch-data.mjs            # 無いものだけ落とす
//
// 1. ESC-50（CC BY-NC 3.0 → 検証専用。製品に組み込まない）: dog 40 本と、犬以外 8 クラス×5 本。
//    GitHub の raw から 1 本ずつ取る（600MB の zip を落とさない）。
// 2. pet-decoder-audio-fixtures（CC0 1.0、Internet Archive 由来の犬の音 5 本）: Hugging Face から。
//    この環境から HF に届かないときは飛ばす（GitHub Actions の lab-yamnet では届く）。
//    mp3 は Playwright の Chromium で WAV に変換する（tests/lab/decode.mjs。ffmpeg は要らない）。
// 3. Dog play pant（Zenodo 18972388。2026-11-24。Readme は CC BY-NC 4.0 → ESC-50 と同じ検証専用）: 注釈 zip（約 123 KB）と Metadata.csv。
//    音声 zip（約 377 MB）は PLAYPANT_AUDIO=1 のときだけ（2026-11-25。Actions の lab-yamnet で付ける。ファイルに流し込むので メモリに全部は持たない）。
//    Zenodo に届かなければ飛ばす（この作業環境からは届かない。Actions では API の /content ＋ UA 付きなら届く）。
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { toWavWithChromium } from './decode.mjs';
import { PLAYPANT, playpantUrl, ZENODO_HEADERS } from './playpant.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA = path.join(here, 'data');
const ESC_RAW = 'https://raw.githubusercontent.com/karoldvl/ESC-50/master';
/** 犬以外: 音量だけの吠え検出が拾いそうな、短く大きい音と動物の声 */
export const NON_DOG = ['cat', 'rooster', 'crying_baby', 'door_wood_knock', 'clapping', 'laughing', 'car_horn', 'coughing'];
export const PER_CLASS = 5;

/** 1 回の取得。5xx と通信エラーは少し待って最大 retries 回やり直す（2026-11-05: GitHub raw が一時的に 503 を返して run が落ちたため） */
async function fetchRetry(url, { retries = 3, waitMs = 3000, headers, timeoutMs = 60_000 } = {}) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers });
      if (r.ok) return r;
      if (r.status < 500 || i >= retries) throw new Error('HTTP ' + r.status);
      console.warn(`retry ${i + 1}/${retries}`, url, '- HTTP', r.status);
    } catch (e) {
      if (i >= retries || /^HTTP [1-4]/.test(e.message)) throw e;
      console.warn(`retry ${i + 1}/${retries}`, url, '-', e.message);
    }
    await new Promise(ok => setTimeout(ok, waitMs * (i + 1)));
  }
}

async function get(url, file, { optional = false, headers, timeoutMs, stream = false } = {}) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return true;
  try {
    const r = await fetchRetry(url, { retries: optional ? 1 : 3, headers, timeoutMs });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (stream) {
      // 大きいファイル（音声 zip 377 MB）はファイルに流し込む。途中で切れたら .part を消して失敗にする
      const part = file + '.part';
      try { await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(part)); fs.renameSync(part, file); }
      catch (e) { fs.rmSync(part, { force: true }); throw e; }
    } else {
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    }
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

/**
 * 取得済みデータの一覧 [{file, path, category, source}]。無いものは含めない。
 * playpant: true なら Dog play pant の切り出し（playpant-check.mjs が data/playpant/clips/<種類>/ に置く。2026-11-26）も足す
 * （source 'PlayPant'、category は犬の声なら `dog(pp:growl)` 等、人の声は `human(pp)`、ppType にフォルダ名）。
 * 既定は false: yamnet-check.mjs（本数で時間が伸びる）と highlights.mjs（ESC-50・CC0 の集計）はいままでどおり。
 */
export function listData({ playpant = false } = {}) {
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
  const clips = path.join(DATA, 'playpant/clips');
  if (playpant && fs.existsSync(clips)) {
    for (const t of fs.readdirSync(clips).sort()) {
      const d = path.join(clips, t);
      if (!fs.statSync(d).isDirectory()) continue;
      for (const f of fs.readdirSync(d).filter(f => /\.wav$/i.test(f)).sort()) out.push({ file: f, path: path.join(d, f), category: t === 'human' ? 'human(pp)' : `dog(pp:${t})`, source: 'PlayPant', ppType: t });
    }
  }
  return out;
}

/**
 * WAV 以外（mp3 等）を 16bit モノラル WAV（元の sr のまま）に変換して隣に置く（検証スクリプトは WAV だけ読む）。
 * 2026-11-20 から ffmpeg ではなく Playwright の Chromium で復号する（tests/lab/decode.mjs。apt が 2 晩つづけて止まったため）。
 */
async function toWavAll(files) {
  const res = await toWavWithChromium(files);
  for (const r of res) if (!r.error) console.log(`変換: ${path.basename(r.file)} → ${path.basename(r.wav)}（${r.sr} Hz、${r.seconds} 秒）`);
  return res;
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
  const got = [];
  for (const f of files) {
    const dst = path.join(DATA, 'cc0', path.basename(f));
    const ok = await get(`https://huggingface.co/datasets/${repo}/resolve/main/${f}`, dst, { optional: true });
    if (ok) { m++; got.push(dst); }
  }
  console.log(`CC0 (HF): ${m}/${files.length} 本`, files.map(f => path.basename(f)).join(', '));
  if (got.length) await toWavAll(got);
  const cc0Readme = path.join(DATA, 'cc0/README.md');
  if (files.length) await get(`https://huggingface.co/datasets/${repo}/resolve/main/README.md`, cc0Readme, { optional: true });

  await fetchPlayPant();
}

/**
 * Dog play pant の注釈 zip と Metadata.csv だけ（音声はまだ）。届かなければ飛ばす。取れた数を返す。
 * 2026-11-24: 記録ページの `?download=1` は Actions から 403 だったので、API の `/content` → 従来の URL の順に、UA を付けて試す。
 */
export async function fetchPlayPant() {
  let k = 0;
  for (const name of [PLAYPANT.files.annotations, PLAYPANT.files.metadata]) {
    const dst = path.join(DATA, 'playpant', name);
    for (const api of [true, false]) {
      if (await get(playpantUrl(name, { api }), dst, { optional: true, headers: ZENODO_HEADERS })) { k++; break; }
    }
  }
  // 記録の JSON と Readme（注釈の記号 A〜L の凡例を探す。run 45243790948 で Annotation 列が記号で、run 45248126366 で説明文には凡例が無く
  // zip の外に `06 Readme.txt`（7 KB）があると分かった）
  await get(`https://zenodo.org/api/records/${PLAYPANT.record}`, path.join(DATA, 'playpant', 'record.json'), { optional: true, headers: ZENODO_HEADERS });
  for (const api of [true, false]) {
    if (await get(playpantUrl(PLAYPANT.files.readme, { api }), path.join(DATA, 'playpant', PLAYPANT.files.readme), { optional: true, headers: ZENODO_HEADERS })) break;
  }
  console.log(`Dog play pant (Zenodo, ${PLAYPANT.license}): ${k}/2 ファイル（注釈と Metadata）`);
  if (process.env.PLAYPANT_AUDIO === '1') await fetchPlayPantAudio();
  else console.log(`Dog play pant の音声 zip（約 377 MB）は PLAYPANT_AUDIO=1 のときだけ落とす`);
  return k;
}

/**
 * Dog play pant の音声 zip（`03 Play session recordings.zip`、約 377 MB、WAV 30 本）。2026-11-25、datasets.md 次の一手 4 の (b) の 1 歩目。
 * ファイルに流し込む（メモリに全部は持たない）。15 分で諦める。届かなければ飛ばす。落ちたかを返す。
 * リポジトリには入れない（tests/lab/data/ は .gitignore 済み）。製品にも入れない（Readme のライセンスは CC BY-NC → 検証専用）。
 */
export async function fetchPlayPantAudio() {
  const name = PLAYPANT.files.audio;
  const dst = path.join(DATA, 'playpant', name);
  const t0 = Date.now();
  let ok = false;
  for (const api of [true, false]) {
    if (await get(playpantUrl(name, { api }), dst, { optional: true, headers: ZENODO_HEADERS, timeoutMs: 15 * 60_000, stream: true })) { ok = true; break; }
  }
  if (ok) console.log(`Dog play pant の音声 zip: ${(fs.statSync(dst).size / 1e6).toFixed(1)} MB（${Math.round((Date.now() - t0) / 1000)} 秒）`);
  else console.log('Dog play pant の音声 zip: 届かなかった（飛ばす）');
  return ok;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await fetchAll();
}
