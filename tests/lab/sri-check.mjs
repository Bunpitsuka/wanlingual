// SRI の確認（plan #14 設計メモ 7-iii）: CDN（jsdelivr）が配っている tf.min.js の sha384 が、app/lab/yamnet.js の TFJS_SRI と
// app/lab/yamnet.html の <script integrity> と一致するかを、外に出られる GitHub Actions（lab-yamnet）で毎回確かめる。
// 一致しなければ、本体の犬の声チェックも実験室もブラウザが tfjs の読み込みを拒む（＝犬の声チェックは「読めなかった」扱い）ので、ここで赤くして気づく。
//
//   node tests/lab/sri-check.mjs            # CDN から取って比べる（終了コード 3 で不一致、4 で取得失敗）
//
// 参考: ハッシュの出し方は `npm pack @tensorflow/tfjs@<version>` → `openssl dgst -sha384 -binary package/dist/tf.min.js | openssl base64 -A`
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TFJS_URL, TFJS_SRI, TFJS_VERSION } from '../../app/lab/yamnet.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(root, 'app/lab/yamnet.html'), 'utf8');
const inHtml = html.match(/tf\.min\.js"[^>]*integrity="([^"]+)"/)?.[1] ?? null;

let md = `### tfjs ${TFJS_VERSION} の SRI 確認\n\n`;
let code = 0;
try {
  const res = await fetch(TFJS_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = 'sha384-' + createHash('sha384').update(buf).digest('base64');
  const okJs = got === TFJS_SRI, okHtml = inHtml === TFJS_SRI;
  md += `| 項目 | 値 | 一致 |\n|---|---|---|\n`;
  md += `| CDN（${TFJS_URL}、${buf.length.toLocaleString()} bytes） | \`${got}\` | — |\n`;
  md += `| app/lab/yamnet.js TFJS_SRI | \`${TFJS_SRI}\` | ${okJs ? '✅' : '❌'} |\n`;
  md += `| app/lab/yamnet.html integrity | \`${inHtml}\` | ${okHtml ? '✅' : '❌'} |\n`;
  if (!okJs || !okHtml) { md += `\n**不一致**: CDN の中身が変わったか、ハッシュの更新漏れ。ブラウザは tfjs を読まない（犬の声チェックは動かない）。\n`; code = 3; }
} catch (e) {
  md += `CDN から取得できず（${e?.message || e}）。比較できないので今回は判定なし。\n`;
  code = 4;
}
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
process.exitCode = code;
