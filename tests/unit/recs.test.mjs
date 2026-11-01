// おすすめリンクの単体テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECS, links, amazonUrl, rakutenUrl } from '../../app/js/recs.js';
import { CATS } from '../../app/js/classify.js';

test('6つの気持ち全部におすすめがある', () => {
  for (const c of CATS) assert.ok(RECS[c.k]?.length >= 2, c.k);
});
test('設定が無ければ何も出さない', () => {
  assert.deepEqual(links('lonely', null), []);
});
test('Amazon のタグ、楽天の ID がリンクに入る', () => {
  const l = links('lonely', { amazonTag: 'test-22', rakutenId: 'abc.def' });
  assert.equal(l.length, 2);
  assert.ok(l[0].amazon.includes('amazon.co.jp/s?k=') && l[0].amazon.endsWith('&tag=test-22'));
  assert.ok(l[0].rakuten.startsWith('https://hb.afl.rakuten.co.jp/hgc/abc.def/?pc=https%3A%2F%2Fsearch.rakuten.co.jp'));
  const only = links('play', { amazonTag: 'x-22', rakutenId: '' });
  assert.equal(only[0].rakuten, null);
  assert.ok(amazonUrl('犬', '').endsWith('k=%E7%8A%AC'));
  assert.ok(rakutenUrl('犬', '').startsWith('https://search.rakuten.co.jp/'));
});
