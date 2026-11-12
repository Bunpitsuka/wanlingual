// tools/screenshots.mjs — docs/screenshots/ を E2E のスクリーンショットから更新する。
//
//   npm run test:e2e && node tools/screenshots.mjs     # tests/e2e/screenshots/ → docs/screenshots/ にコピー
//   node tools/screenshots.mjs --check                 # コピーせず、元の有無と新旧だけ表示
//
// docs/screenshots/ に置く絵は E2E（Playwright、Pixel 7 相当 / iPhone 14 相当のエミュレーション、偽マイク）が
// 毎回撮っているものと同じ。手で撮らないので、画面が変わるたびに E2E を 1 周すれば同じ手順で撮り直せる。
// どの絵を docs に置くかはこの表で決める（E2E が撮る絵は他にもある）。app/ は触らない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
export const SRC = path.join(root, 'tests/e2e/screenshots');
export const DST = path.join(root, 'docs/screenshots');

/** docs に置く絵（ファイル名は E2E の `${project}-${name}.png` と同じ） */
export const SHOTS = [
  ['android-chrome-judge.png', '録音ファイルを読んで判定したところ（判定・「なぜ」・自信・正解ボタン）'],
  ['android-chrome-why.png', '判定パネルだけ（「こう見ました」の 3 つの特徴）'],
  ['android-chrome-mic.png', 'マイク監視中（経過時間・吠え回数）'],
  ['android-chrome-home-dark.png', 'はじめての画面（ダーク）'],
  ['android-chrome-settings.png', '設定パネルの「犬の声チェック（試験中）」トグル'],
  ['android-chrome-dogcheck-notdog.png', '犬らしさが低い判定の薄い表示（偽の tf で 5%）'],
  ['iphone-safari-emulated-judge.png', 'iPhone 相当（Chromium のエミュレーション）の判定'],
  ['iphone-safari-emulated-mic.png', 'iPhone 相当のマイク監視中'],
];

/** コピー計画 [{file, src, dst, exists, changed}]。dryRun でなければコピーもする */
export function syncShots({ src = SRC, dst = DST, dryRun = false } = {}) {
  const out = [];
  for (const [file] of SHOTS) {
    const s = path.join(src, file), d = path.join(dst, file);
    const exists = fs.existsSync(s);
    let changed = false;
    if (exists) {
      const a = fs.readFileSync(s);
      changed = !fs.existsSync(d) || !a.equals(fs.readFileSync(d));
      if (changed && !dryRun) { fs.mkdirSync(dst, { recursive: true }); fs.writeFileSync(d, a); }
    }
    out.push({ file, src: s, dst: d, exists, changed });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes('--check');
  const res = syncShots({ dryRun });
  for (const r of res) console.log(`${r.exists ? (r.changed ? (dryRun ? '更新あり' : 'コピー  ') : '同じ    ') : '元が無い'}  ${r.file}`);
  const missing = res.filter(r => !r.exists).length;
  if (missing) console.log(`\n${missing} 本は tests/e2e/screenshots/ に無い。先に npm run test:e2e`);
}
