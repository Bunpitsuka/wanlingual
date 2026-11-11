// tools/og-image.mjs — OGP 画像（app/icons/og.png、1200×630）を作り直す。
//
//   node tools/og-image.mjs            # app/icons/og.png を上書き
//   node tools/og-image.mjs --html     # 元の HTML も隣（tools/out/og.html）に残す（見た目の調整用）
//
// 文言・色は本体（app/css/app.css のトークン、share.js の画像カード）と揃える。マスコットは app/js/mascot.js の
// ドット絵をそのまま使う（絵の定義を二重に持たない）。描画は Playwright の Chromium（E2E と同じもの）。
// フォント: node_modules/@fontsource/{dotgothic16,zen-kaku-gothic-new} があればそれを使う
// （`npm i --no-save @fontsource/dotgothic16 @fontsource/zen-kaku-gothic-new`。package.json には入れない）。
// 無ければ Google Fonts、それも届かなければ端末のゴシック体に落ちる（絵と配置は同じ）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MASCOTS, mascotSvg } from '../app/js/mascot.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const OUT = path.join(root, 'app/icons/og.png');
const W = 1200, H = 630;

/** 本体と同じ色（app/css/app.css のライト側のトークン、share.js の画像カード） */
const C = { bg: '#f3f1ea', lcd: '#c9d6a3', ink: '#1f2a12', sub: '#3f4a2c', panel: '#fffdf7' };

/** フォントの @font-face。fontsource があればローカルの CSS をそのまま読む（file:// なので同じ Chromium で読める） */
function fontCss() {
  const fs1 = path.join(root, 'node_modules/@fontsource/dotgothic16/index.css');
  const fs2 = path.join(root, 'node_modules/@fontsource/zen-kaku-gothic-new/index.css');
  const fs3 = path.join(root, 'node_modules/@fontsource/zen-kaku-gothic-new/700.css');
  const fs4 = path.join(root, 'node_modules/@fontsource/zen-kaku-gothic-new/500.css');
  if ([fs1, fs2, fs3, fs4].every(f => fs.existsSync(f))) {
    return { how: 'fontsource（ローカル）', html: [fs1, fs2, fs3, fs4].map(f => `<link rel="stylesheet" href="file://${f}">`).join('') };
  }
  return { how: 'Google Fonts（届かなければ端末のゴシック体）', html: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DotGothic16&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=block">' };
}

/** 段階 index のマスコット（色は currentColor） */
const mascot = (i, size) => mascotSvg(i, size);
const stageName = i => MASCOTS[i].name;

export function buildHtml({ fonts }) {
  // 右側: 大きな成犬（主役）と、下に たまご→子犬→若犬→成犬 の育ち方。左側: 名前・一言・6 つの気持ち・安心の 3 点・「推測です」の注意。
  const growth = [0, 1, 2, 3].map(i => `<div class="g"><span class="m">${mascot(i, 48)}</span><span class="n">${stageName(i)}</span></div>`).join('<span class="arrow">→</span>');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">${fonts}
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;background:${C.bg};overflow:hidden}
body{font-family:"Zen Kaku Gothic New","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP",system-ui,sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased}
.card{position:absolute;left:60px;top:60px;width:${W - 120}px;height:${H - 120}px;background:${C.lcd};border:6px solid ${C.ink};border-radius:40px;padding:44px 52px 40px 56px;display:grid;grid-template-columns:1fr 260px;column-gap:20px}
h1{font-family:"DotGothic16","Zen Kaku Gothic New",monospace;font-size:84px;line-height:1;letter-spacing:.04em;font-weight:400;margin:6px 0 28px;white-space:nowrap}
.lead{font-size:31px;line-height:1.4;font-weight:500;white-space:nowrap}
.lead b{font-weight:700}
.row{font-size:25px;line-height:1.45;color:${C.sub};font-weight:500;white-space:nowrap}
.feel{margin-top:26px;letter-spacing:.01em}
.feel .sep{opacity:.55;margin:0 .15em}
.safe{margin-top:6px}
.note{display:inline-block;margin-top:28px;padding:8px 22px;border:3px solid ${C.ink};border-radius:999px;background:${C.panel};font-size:24px;font-weight:700;line-height:1.3;white-space:nowrap}
.right{display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding-top:2px}
.hero{width:204px;height:204px;color:${C.ink}}
.hero svg{width:100%;height:100%;display:block}
.growth{display:flex;align-items:center;gap:5px;color:${C.ink}}
.growth .g{display:flex;flex-direction:column;align-items:center;gap:2px}
.growth .m svg{display:block}
.growth .n{font-family:"DotGothic16","Zen Kaku Gothic New",monospace;font-size:17px;line-height:1;white-space:nowrap}
.growth .arrow{font-size:20px;line-height:1;margin:0 0 18px;opacity:.7}
.cap{font-size:20px;color:${C.sub};font-weight:500;margin-top:6px;white-space:nowrap}
</style></head><body>
<div class="card">
  <div class="left">
    <h1>ワンリンガル</h1>
    <p class="lead">犬の鳴き声から気持ちを<b>推測</b>。<br>正解を教えるほど「うちの子専用」に育つ。</p>
    <p class="row feel">警戒<span class="sep">・</span>威嚇<span class="sep">・</span>要求<span class="sep">・</span>遊ぼう<span class="sep">・</span>さみしい<span class="sep">・</span>うれしい</p>
    <p class="row safe">無料<span class="sep">・</span>登録不要<span class="sep">・</span>音声は端末の外に出しません</p>
    <p class="note">本物の翻訳ではなく、吠え方の特徴からの推測です</p>
  </div>
  <div class="right">
    <div class="hero">${mascot(3, 204)}</div>
    <div>
      <div class="growth">${growth}</div>
      <p class="cap" style="text-align:center">教えるほど育つ（全 ${MASCOTS.length} 段階）</p>
    </div>
  </div>
</div>
</body></html>`;
}

async function main() {
  // playwright はここで読む（deploy-pages の単体テストは npm ci 無しで走るので、buildHtml の import で playwright を要求しない）
  const { chromium } = await import('playwright');
  const keepHtml = process.argv.includes('--html');
  const fonts = fontCss();
  const html = buildHtml({ fonts: fonts.html });
  const outDir = path.join(here, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const htmlPath = path.join(outDir, 'og.html');
  fs.writeFileSync(htmlPath, html);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto('file://' + htmlPath, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));
  await page.screenshot({ path: OUT, type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
  await browser.close();
  if (!keepHtml) fs.rmSync(htmlPath, { force: true });
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`wrote ${path.relative(root, OUT)} (${W}×${H}, ${kb} KB) fonts: ${fonts.how}; loaded: ${[...new Set(loaded)].join(', ') || '（Web フォントなし）'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
