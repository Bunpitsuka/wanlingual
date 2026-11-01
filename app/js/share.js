// share.js — 判定結果を画像カードにして共有する。ユーザー自身が投稿する（アプリは投稿しない）。
import { MASCOTS } from './mascot.js';
export const APP_URL = 'https://bunpitsuka.github.io/wanlingual/';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function wrap(ctx, text, maxW) {
  const lines = []; let cur = '';
  for (const ch of text) { if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch; }
  if (cur) lines.push(cur); return lines;
}
/** 育成段階のドット絵を描く（1 ドット = px） */
function mascot(ctx, x0, y0, px, stageIndex, color) {
  const m = MASCOTS[Math.max(0, Math.min(MASCOTS.length - 1, stageIndex | 0))];
  ctx.fillStyle = color;
  m.art.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '#') ctx.fillRect(x0 + x * px, y0 + y * px, px, px); });
}
function paw(ctx, cx, cy, s, color) {
  ctx.fillStyle = color;
  for (const [dx, dy, r] of [[-0.62, -0.56, 0.22], [-0.22, -0.84, 0.2], [0.22, -0.84, 0.2], [0.62, -0.56, 0.22]]) { ctx.beginPath(); ctx.arc(cx + dx * s, cy + dy * s, r * s, 0, Math.PI * 2); ctx.fill(); }
  ctx.beginPath(); ctx.ellipse(cx, cy + 0.12 * s, 0.6 * s, 0.44 * s, 0, 0, Math.PI * 2); ctx.fill();
}

// r: {dog, label, glyph, conf(0-1), quote, lv, stage, n, dur, f0}
export function renderCard(r) {
  const W = 1080, H = 1080, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const body = '"Zen Kaku Gothic New","Hiragino Kaku Gothic ProN","Noto Sans JP",system-ui,sans-serif';
  const disp = '"DotGothic16",' + body;
  ctx.fillStyle = '#f3f1ea'; ctx.fillRect(0, 0, W, H);
  roundRect(ctx, 60, 60, W - 120, H - 120, 40); ctx.fillStyle = '#c9d6a3'; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = '#1f2a12'; ctx.stroke();
  ctx.fillStyle = '#1f2a12'; ctx.textBaseline = 'top';
  ctx.font = `500 34px ${body}`; ctx.fillText(`${r.dog} の気持ち（推測）`, 120, 120);
  ctx.font = `700 150px ${disp}`; ctx.fillText(r.label, 110, 180);
  ctx.font = `500 44px ${body}`; ctx.fillText(`たぶん ${Math.round(r.conf * 100)}%`, 124, 350);
  ctx.font = `500 46px ${body}`;
  let y = 450; for (const line of wrap(ctx, `「${r.quote}」`, W - 260).slice(0, 4)) { ctx.fillText(line, 124, y); y += 62; }
  ctx.font = `400 32px ${body}`; ctx.fillStyle = '#3f4a2c';
  const feat = [r.n ? `吠え ${r.n}回` : '', r.dur ? `長さ ${Math.round(r.dur * 1000)}ms` : '', r.f0 ? `ピッチ ${Math.round(r.f0)}Hz` : ''].filter(Boolean).join('　');
  const fy = Math.max(y + 40, 640); // セリフの直後に寄せる（短いセリフで間延びしない）
  if (feat) ctx.fillText(feat, 124, fy);
  ctx.fillText(`育成 LV.${r.lv}　${r.stage}`, 124, fy + 50);
  if (r.stageIndex != null) mascot(ctx, 780, 120, 18, r.stageIndex, '#1f2a12'); else paw(ctx, 900, 200, 110, '#1f2a12');
  ctx.fillStyle = '#1f2a12'; ctx.font = `700 40px ${disp}`; ctx.fillText('ワンリンガル', 120, 868);
  ctx.font = `400 30px ${body}`; ctx.fillStyle = '#3f4a2c'; ctx.fillText('犬の鳴き声から気持ちを推測して、教えるほど育つ', 120, 918);
  ctx.fillText(APP_URL.replace('https://', ''), 120, 956);
  return cv;
}

export function shareText(r) {
  return `${r.dog}の気持ちは「${r.label}」（たぶん${Math.round(r.conf * 100)}%）\n「${r.quote}」\n#ワンリンガル 鳴き声から気持ちを推測して、教えるほど育つ\n${APP_URL}`;
}

const toBlob = cv => new Promise(res => cv.toBlob(res, 'image/png'));

// 戻り値: 'shared' | 'copied' | 'shown'
export async function share(r, { onFallback } = {}) {
  const cv = renderCard(r); const text = shareText(r);
  const blob = await toBlob(cv);
  const file = blob && new File([blob], 'wanlingual.png', { type: 'image/png' });
  try {
    if (file && navigator.share && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return 'shared'; }
    if (navigator.share) { await navigator.share({ text, url: APP_URL }); return 'shared'; }
  } catch (e) { if (e?.name === 'AbortError') return 'shared'; }
  // PC など: 画像を表示して、文面はコピー
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch {}
  onFallback?.(cv.toDataURL('image/png'), text, copied);
  return copied ? 'copied' : 'shown';
}
