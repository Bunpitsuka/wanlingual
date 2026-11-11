// OGP 画像の元になる HTML（tools/og-image.mjs の buildHtml）に、必要な文言とマスコットが入っているか。描画（Chromium）はしない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../tools/og-image.mjs';
import { MASCOTS } from '../../app/js/mascot.js';

test('OGP の HTML: 名前・6 つの気持ち・「推測です」の注意・安心の 3 点・マスコット（大 1 ＋ 育ち方 4）が入る', () => {
  const html = buildHtml({ fonts: '' });
  assert.match(html, /ワンリンガル/);
  for (const w of ['警戒', '威嚇', '要求', '遊ぼう', 'さみしい', 'うれしい']) assert.match(html, new RegExp(w));
  assert.match(html, /本物の翻訳ではなく、吠え方の特徴からの推測です/);
  assert.match(html, /無料.*登録不要.*音声は端末の外に出しません/);
  assert.equal((html.match(/<svg /g) || []).length, 5, '成犬 1 つ ＋ たまご→子犬→若犬→成犬 の 4 つ');
  for (const i of [0, 1, 2, 3]) assert.match(html, new RegExp(`aria-label="${MASCOTS[i].name}"`));
  assert.match(html, new RegExp(`全 ${MASCOTS.length} 段階`));
  assert.doesNotMatch(html, /https?:\/\/fonts\./, 'fonts を渡さなければ外へ取りに行かない');
});
