// E2E（Playwright）: ファイル読み込み→判定→正解を教える→育つ→再読み込みしても残る、マイク監視（偽マイク）、オフライン起動。
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = f => path.join(here, '../fixtures', f);
const shots = path.join(here, 'screenshots');

test.beforeEach(async ({ page }) => {
  page.on('pageerror', e => { throw e; });
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('初期表示: たまご LV.0、判定は空', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('ワンリンガル');
  await expect(page.locator('#lvLabel')).toHaveText('LV.0');
  await expect(page.locator('#stage')).toHaveText('たまご');
  await expect(page.locator('#predBig')).toHaveText('── ──');
  await expect(page.locator('#answer')).not.toHaveClass(/on/);
});

test('録音ファイル → 判定 → 正解を教える → LV.1 → 再読み込みしても残る', async ({ page }, testInfo) => {
  await page.locator('#file').setInputFiles(fx('bark4.wav'));
  await expect(page.locator('#predBig')).not.toHaveText('── ──', { timeout: 15000 });
  await expect(page.locator('#predBig')).not.toHaveText('？');
  await expect(page.locator('#predConf')).toContainText('推測');
  await expect(page.locator('#feat')).toContainText('吠え 4回');
  await expect(page.locator('#answer')).toHaveClass(/on/);
  await expect(page.locator('#choices button[data-k]')).toHaveCount(6);
  await page.screenshot({ path: path.join(shots, `${testInfo.project.name}-judge.png`), fullPage: true });

  await page.locator('#choices button[data-k="demand"]').click();
  await expect(page.locator('#lvLabel')).toHaveText('LV.1');
  await expect(page.locator('#stage')).toHaveText('たまご');
  await expect(page.locator('#next')).toContainText('あと 4 回');
  await expect(page.locator('#answer')).not.toHaveClass(/on/);
  await expect(page.locator('#hist li')).toHaveCount(1);
  await expect(page.locator('#hist li').first()).toContainText('要求');

  await page.reload();
  await expect(page.locator('#lvLabel')).toHaveText('LV.1');
  await expect(page.locator('#hist li')).toHaveCount(1);
  const raw = await page.evaluate(() => localStorage.getItem('wanlingual.samples.v1'));
  const arr = JSON.parse(raw);
  expect(arr).toHaveLength(1);
  expect(arr[0].label).toBe('demand');
  expect(Object.keys(arr[0].f).sort()).toEqual(['cent', 'dur', 'durCv', 'f0', 'gap', 'gapCv', 'n']); // 特徴量だけ。音声は保存しない
});

test('無音ファイルは「？」で記録しない', async ({ page }) => {
  await page.locator('#file').setInputFiles(fx('silence.wav'));
  await expect(page.locator('#predBig')).toHaveText('？', { timeout: 15000 });
  await expect(page.locator('#status')).toContainText('近く');
  await expect(page.locator('#answer')).not.toHaveClass(/on/);
});

test('5回教えると「子犬」になる', async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await page.locator('#file').setInputFiles(fx(i % 2 ? 'howl.wav' : 'bark4.wav'));
    await expect(page.locator('#answer')).toHaveClass(/on/, { timeout: 15000 });
    await page.locator(`#choices button[data-k="${i % 2 ? 'lonely' : 'demand'}"]`).click();
    await expect(page.locator('#answer')).not.toHaveClass(/on/);
  }
  await expect(page.locator('#lvLabel')).toHaveText('LV.5');
  await expect(page.locator('#stage')).toHaveText('子犬');
  await expect(page.locator('#acc')).toHaveText(/\d+%/);
});

test('学習データのコピー／読み込み／リセット', async ({ page, context }) => {
  await page.locator('#file').setInputFiles(fx('bark4.wav'));
  await expect(page.locator('#answer')).toHaveClass(/on/, { timeout: 15000 });
  await page.locator('#choices button[data-k="play"]').click();
  await expect(page.locator('#lvLabel')).toHaveText('LV.1');
  const json = await page.evaluate(() => localStorage.getItem('wanlingual.samples.v1'));

  await page.locator('#reset').click();
  await expect(page.locator('#reset')).toContainText('本当に');
  await page.locator('#reset').click();
  await expect(page.locator('#lvLabel')).toHaveText('LV.0');

  await page.locator('#import').click();
  await expect(page.locator('#ioText')).toBeVisible();
  await page.locator('#ioText').fill(JSON.stringify({ app: 'wanlingual', v: 1, samples: JSON.parse(json) }));
  await page.locator('#import').click();
  await expect(page.locator('#lvLabel')).toHaveText('LV.1');
  await expect(page.locator('#toast')).toContainText('1件');
});

test('マイク監視: 偽マイクの吠え声を自動で判定する', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', '偽マイクは Chromium のみ');
  await page.locator('#micBtn').click();
  await expect(page.locator('#micState')).toContainText('監視中', { timeout: 10000 });
  await expect(page.locator('body')).toHaveClass(/listening/);
  await expect(page.locator('#micBtn')).toHaveText('監視をやめる');
  // mic10s.wav には 2 つの吠えクラスタが入っている（ループ再生される）
  await expect(page.locator('#predBig')).not.toHaveText('── ──', { timeout: 25000 });
  await expect(page.locator('#answer')).toHaveClass(/on/);
  await page.screenshot({ path: path.join(shots, `${testInfo.project.name}-mic.png`), fullPage: true });
  await page.locator('#choices button[data-k="alarm"]').click();
  await expect(page.locator('#hist li').first()).toContainText('🎤');
  await page.locator('#micBtn').click();
  await expect(page.locator('#micState')).toHaveText('');
  await expect(page.locator('body')).not.toHaveClass(/listening/);
});

test('オフラインでも起動する（Service Worker）', async ({ page, context }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  // 事前キャッシュが終わるまで待つ
  await page.waitForFunction(async () => {
    const c = await caches.open('wl-v2'); const keys = await c.keys();
    return keys.some(r => r.url.endsWith('/js/mic.js'));
  }, null, { timeout: 15000 });
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.locator('h1')).toHaveText('ワンリンガル');
    await expect(page.locator('#lvLabel')).toHaveText('LV.0');
    await page.locator('#file').setInputFiles(fx('bark4.wav'));
    await expect(page.locator('#answer')).toHaveClass(/on/, { timeout: 15000 });
  } finally { await context.setOffline(false); }
});

test('画面を見た感じ（スクリーンショット）', async ({ page }, testInfo) => {
  await page.screenshot({ path: path.join(shots, `${testInfo.project.name}-home.png`), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(shots, `${testInfo.project.name}-home-dark.png`), fullPage: true });
  // 横スクロールが出ていない
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
});

test('おすすめ: ID 未設定なら出ない、設定すればアフィリエイトリンクが出る', async ({ page }) => {
  await page.locator('#file').setInputFiles(fx('bark4.wav'));
  await expect(page.locator('#answer')).toHaveClass(/on/, { timeout: 15000 });
  await page.locator('#choices button[data-k="lonely"]').click();
  await expect(page.locator('#recs')).toBeHidden();

  await page.evaluate(() => window.__wl.setRecsConfig({ amazonTag: 'test-22', rakutenId: '' }));
  await page.locator('#file').setInputFiles(fx('bark4.wav'));
  await expect(page.locator('#answer')).toHaveClass(/on/, { timeout: 15000 });
  await page.locator('#choices button[data-k="lonely"]').click();
  await expect(page.locator('#recs')).toBeVisible();
  await expect(page.locator('#recsTitle')).toContainText('さみしい');
  const a = page.locator('#recList a').first();
  await expect(a).toHaveText('Amazonで探す');
  await expect(a).toHaveAttribute('href', /tag=test-22/);
  await expect(a).toHaveAttribute('rel', /sponsored/);
  await expect(page.locator('#recsNote')).toContainText('アソシエイト');
});

test('結果をシェア: 画像カードができる（共有シートが無い環境は画像表示にフォールバック）', async ({ page }) => {
  await page.locator('#file').setInputFiles(fx('bark4.wav'));
  await expect(page.locator('#answer')).toHaveClass(/on/, { timeout: 15000 });
  await page.evaluate(() => { try { delete navigator.share; } catch {} Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); });
  await page.locator('#share').click();
  await expect(page.locator('#sharebox')).toBeVisible({ timeout: 10000 });
  const src = await page.locator('#shareImg').getAttribute('src');
  expect(src.startsWith('data:image/png;base64,')).toBeTruthy();
  expect(src.length).toBeGreaterThan(20000);
  await expect(page.locator('#shareNote')).toContainText('Threads');
});
