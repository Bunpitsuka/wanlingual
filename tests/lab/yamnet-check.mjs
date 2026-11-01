// フェーズ2試作の確認スクリプト: app/lab/yamnet.html を Chromium で開き、fixtures の WAV を YAMNet に聞かせて
// 「犬らしさ」を表にする。CDN と tfhub.dev に届くネットワークが必要（GitHub Actions の lab-yamnet で回す）。
//
//   node tests/lab/yamnet-check.mjs                 # 本番どおり CDN から読む
//   TFJS_LOCAL=node_modules/@tensorflow/tfjs/dist/tf.min.js node tests/lab/yamnet-check.mjs   # CDN の代わりにローカルの tf.min.js
//
// 出力: 標準出力に Markdown の表、$GITHUB_STEP_SUMMARY があればそこにも追記、tests/lab/out/yamnet-result.json に生データ。
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const PORT = 4174;
const FIXTURES = ['bark4.wav', 'howl.wav', 'mic10s.wav', 'silence.wav'];

/** PCM16 モノラル WAV → { x: Float32Array, sr } */
function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF: ' + file);
  let off = 12, sr = 0, ch = 1, bits = 16, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(off + 10); sr = b.readUInt32LE(off + 12); bits = b.readUInt16LE(off + 22); }
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + size); break; }
    off += 8 + size + (size & 1);
  }
  if (!data || bits !== 16) throw new Error('unsupported wav: ' + file);
  const n = Math.floor(data.length / 2 / ch), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < ch; c++) s += data.readInt16LE((i * ch + c) * 2); x[i] = s / ch / 32768; }
  return { x, sr };
}

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'app'], { cwd: root, stdio: 'ignore' });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const rows = [];
let summary = '';
try {
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
  if (process.env.TFJS_LOCAL) {
    const body = fs.readFileSync(path.resolve(root, process.env.TFJS_LOCAL));
    await page.route('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body }));
  }
  for (let i = 0; i < 50 && !(await fetch(`http://127.0.0.1:${PORT}/lab/yamnet.html`).then(r => r.ok).catch(() => false)); i++) await new Promise(ok => setTimeout(ok, 200));
  await page.goto(`http://127.0.0.1:${PORT}/lab/yamnet.html`);
  await page.waitForFunction(() => window.__lab && (window.__lab.ready || window.__lab.error), null, { timeout: 180_000 });
  const lab = await page.evaluate(() => ({ ready: window.__lab.ready, error: window.__lab.error, tf: window.__lab.tf, status: document.getElementById('status').textContent }));
  console.log('tfjs:', lab.tf, '| ready:', lab.ready, '| status:', lab.status);
  if (!lab.ready) { summary = `YAMNet 読み込み失敗: ${lab.error}`; console.log(summary); process.exitCode = 2; }
  else {
    for (const f of FIXTURES) {
      const { x, sr } = readWav(path.join(root, 'tests/fixtures', f));
      const r = await page.evaluate(([arr, sr]) => window.__lab.classifySamples(Float32Array.from(arr), sr), [Array.from(x), sr]);
      rows.push({ file: f, seconds: +(x.length / sr).toFixed(2), ...r });
    }
    const line = r => `| ${r.file} | ${r.seconds}s | **${r.label}** | ${(r.dog * 100).toFixed(0)}% | ${(r.dogMean * 100).toFixed(0)}% | ${r.top.slice(0, 3).map(t => `${t.name} ${(t.score * 100).toFixed(0)}%`).join(', ')} | ${r.ms} |`;
    summary = `### YAMNet 試作の結果（tfjs ${lab.tf}）\n\n| ファイル | 長さ | 判定 | 犬らしさ(最大) | 犬らしさ(平均) | 上位3クラス | ms |\n|---|---|---|---|---|---|---|\n${rows.map(line).join('\n')}\n`;
    console.log(summary);
    fs.mkdirSync(path.join(here, 'out'), { recursive: true });
    fs.writeFileSync(path.join(here, 'out/yamnet-result.json'), JSON.stringify({ tfjs: lab.tf, at: new Date().toISOString(), rows }, null, 1));
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
} finally {
  await browser.close();
  server.kill();
}
