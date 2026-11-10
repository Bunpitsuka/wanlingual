// E2E（Playwright）: ファイル読み込み→判定→正解を教える→育つ→再読み込みしても残る、マイク監視（偽マイク）、オフライン起動。
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CATS } from '../../app/js/classify.js';
import { TONES } from '../../app/js/voice.js';

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
  // はじめての人向けの 3 ステップ案内が出て、判定前の空の棒グラフは出ない
  await expect(page.locator('#guide')).toBeVisible();
  await expect(page.locator('#guide li')).toHaveCount(3);
  await expect(page.locator('#bars')).toBeHidden();
  await expect(page.locator('#mascot svg')).toHaveAttribute('aria-label', 'たまご');
});

test('録音ファイル → 判定 → 正解を教える → LV.1 → 再読み込みしても残る', async ({ page }, testInfo) => {
  await page.locator('#file').setInputFiles(fx('bark4.wav'));
  await expect(page.locator('#predBig')).not.toHaveText('── ──', { timeout: 15000 });
  await expect(page.locator('#predBig')).not.toHaveText('？');
  await expect(page.locator('#predConf')).toContainText('推測');
  await expect(page.locator('#predConf .lvl')).toContainText('自信');
  // 判定の「なぜ」（plan #22）: 効いた特徴を短く 1〜3 個。合成 4 連吠えは間隔か短さか回数が理由に出る
  await expect(page.locator('#why')).toBeVisible();
  await expect(page.locator('#why')).toContainText('こう見ました');
  expect(await page.locator('#why span').count()).toBeGreaterThanOrEqual(1);
  expect(await page.locator('#why span').count()).toBeLessThanOrEqual(3);
  await expect(page.locator('#why')).toContainText(/間隔|短い声|回数/);
  await expect(page.locator('#guide')).toBeHidden();
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
  await expect(page.locator('#tally')).toBeVisible();                 // 気持ち別の集計（1 件でも出る）
  await expect(page.locator('#tally .chip')).toHaveCount(1);
  await expect(page.locator('#tally .chip').first()).toContainText('要求 1');

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
  await expect(page.locator('#why')).toBeHidden(); // 鳴き声が無ければ「なぜ」も出ない
});

test('5回教えると「子犬」になる', async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await page.locator('#file').setInputFiles(fx(i % 2 ? 'howl.wav' : 'bark4.wav'));
    await expect(page.locator('#answer')).toHaveClass(/on/, { timeout: 15000 });
    // 教えた声が 3 件以上になると、「なぜ」に「教えてもらった似た声 ◯件のうち ◯件が…」が足される（kNN の根拠）
    if (i >= 3) await expect(page.locator('#why')).toContainText('教えてもらった似た声');
    else await expect(page.locator('#why')).not.toContainText('似た声');
    await page.locator(`#choices button[data-k="${i % 2 ? 'lonely' : 'demand'}"]`).click();
    await expect(page.locator('#answer')).not.toHaveClass(/on/);
  }
  await expect(page.locator('#lvLabel')).toHaveText('LV.5');
  await expect(page.locator('#stage')).toHaveText('子犬');
  await expect(page.locator('#mascot svg')).toHaveAttribute('aria-label', '子犬');
  await expect(page.locator('#toast')).toContainText('子犬');
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
  await expect(page.locator('#micState')).toContainText(/\d:\d\d/);
  await expect(page.locator('body')).toHaveClass(/listening/);
  await expect(page.locator('#micBtn')).toHaveText('監視をやめる');
  // mic10s.wav には 2 つの吠えクラスタが入っている（ループ再生される）
  await expect(page.locator('#predBig')).not.toHaveText('── ──', { timeout: 25000 });
  await expect(page.locator('#answer')).toHaveClass(/on/);
  await expect(page.locator('#micState')).toContainText('吠え 1回');
  await page.screenshot({ path: path.join(shots, `${testInfo.project.name}-mic.png`), fullPage: true });
  await page.locator('#choices button[data-k="alarm"]').click();
  await expect(page.locator('#hist li').first()).toContainText('🎤');
  await page.locator('#micBtn').click();
  await expect(page.locator('#micState')).toHaveText('');
  await expect(page.locator('body')).not.toHaveClass(/listening/);
});

test('オフラインでも起動する（Service Worker）', async ({ page, context }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  // 事前キャッシュが終わるまで待つ（キャッシュ名は sw.js の VERSION から読む）
  const version = (await (await page.request.get('./sw.js')).text()).match(/VERSION = '([^']+)'/)[1];
  await page.waitForFunction(async v => {
    if (!(await caches.has(v))) return false;
    const c = await caches.open(v); const keys = await c.keys();
    return keys.some(r => r.url.endsWith('/js/mic.js')) && keys.some(r => r.url.endsWith('/js/mascot.js'));
  }, version, { timeout: 15000 });
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.locator('h1')).toHaveText('ワンリンガル');
    await expect(page.locator('#lvLabel')).toHaveText('LV.0');
    await page.locator('#file').setInputFiles(fx('bark4.wav'));
    await expect(page.locator('#answer')).toHaveClass(/on/, { timeout: 15000 });
  } finally { await context.setOffline(false); }
});

test('Service Worker は tfjs（jsdelivr）に手を出さず、自分のキャッシュにも入れない。中身の違う tfjs は SRI で拒む', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '偽マイクは Chromium のみ');
  // Service Worker が動いていて、このページを受け持っている状態にする
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  // Service Worker が respondWith しない通信はページの通信として出るので、ここで偽の tf に差し替えられる
  const cdn = [];
  await page.route('https://cdn.jsdelivr.net/**', r => { cdn.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.tf = { tensor1d: x => ({ dispose() {} }), loadGraphModel: async () => ({ execute: () => { const row = new Float32Array(521); row[70] = 0.9; return { shape: [1, 521], array: async () => [row], dispose() {} }; } }) };' }); });
  await page.goto('./?dogcheck=on');
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.locator('#micBtn').click();
  // ここでは Service Worker が同じオリジンの lab/yamnet.js を受け持つので TFJS_SRI は本物のまま → 偽の tf は SRI（integrity）で拒まれて 'failed' になる。
  // 通信そのものは page.route に届いている（＝Service Worker が respondWith していない）ことを cdn の件数で見る
  await expect.poll(() => page.evaluate(() => window.__wl.dogcheck?.state), { timeout: 15000 }).toBe('failed');
  expect(await page.evaluate(() => window.__wl.dogcheck?.error)).toContain('TensorFlow.js が読み込めません');
  expect(cdn).toHaveLength(1);
  await page.locator('#micBtn').click();
  const keys = await page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) out.push(r.url);
    return out;
  });
  expect(keys.length).toBeGreaterThan(5); // 本体は事前キャッシュされている
  expect(keys.filter(u => /jsdelivr|tfhub|kaggle/.test(u))).toEqual([]);
  await page.goto('./?dogcheck=off');
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

test('セリフの読み上げ: 日本語の声を選び、判定の気持ちに合わせた高さ・速さで speak する（plan #22）', async ({ page }) => {
  // 本物の speechSynthesis は端末の声に依存するので、偽物に差し替えて「何を渡したか」だけを確かめる
  await page.addInitScript(() => {
    window.__spoken = [];
    const voices = [
      { name: 'Samantha', lang: 'en-US', localService: true, default: true },
      { name: 'Google 日本語', lang: 'ja-JP', localService: false, default: false },
      { name: 'Kyoko', lang: 'ja-JP', localService: true, default: false },
    ];
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.lang = ''; this.pitch = 1; this.rate = 1; this.voice = null; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => voices, cancel() {}, addEventListener() {},
      speak(u) { window.__spoken.push({ text: u.text, lang: u.lang, pitch: u.pitch, rate: u.rate, voice: u.voice?.name }); },
    } });
  });
  await page.reload();
  await page.locator('#file').setInputFiles(fx('bark4.wav'));
  await expect(page.locator('#answer')).toHaveClass(/on/, { timeout: 15000 });
  const quote = await page.locator('#quote').textContent();
  const predLabel = await page.locator('#predBig').textContent();
  await page.locator('#speak').click();
  const spoken = await page.evaluate(() => window.__spoken);
  expect(spoken).toHaveLength(1);
  expect(spoken[0].text).toBe(quote);
  expect(spoken[0].lang).toBe('ja-JP');
  expect(spoken[0].voice).toBe('Kyoko'); // 端末内の日本語の声が、ネットの声・英語の既定の声より優先される
  const k = CATS.find(c => c.label === predLabel).k;
  expect(spoken[0].pitch).toBe(TONES[k].pitch);
  expect(spoken[0].rate).toBe(TONES[k].rate);
  expect(spoken[0].pitch).not.toBe(1.4); // 従来の固定値（1.4 / 1.05）ではなく、気持ちごとの値になっている
});

// ---------- 犬の声チェック（YAMNet。既定オフ。plan #14 の実装 ②・③） ----------
// 本物の tfjs・モデルはネットワークが要るので、ここでは偽の tf を返して「配線」だけを確かめる（本物の数字は lab-yamnet）。
test.describe('犬の声チェック（既定オフ）', () => {
  test.use({ serviceWorkers: 'block' }); // page.route は Service Worker 経由の通信を拾えないため

  /** 犬系クラス（Bark = 70 番）に score 点を出す偽の tf */
  const fakeTf = score => `window.tf = {
    version: { tfjs: 'fake' },
    tensor1d: x => ({ n: x.length, dispose() {} }),
    loadGraphModel: async (url, opts) => { window.__fakeTf = { url, opts, calls: 0, lens: [] }; return {
      execute: input => { window.__fakeTf.calls++; window.__fakeTf.lens.push(input.n); const row = new Float32Array(521); row[70] = ${score}; return { shape: [1, 521], array: async () => [row], dispose() {} }; },
    }; },
  };`;
  const FAKE_TF = fakeTf(0.93);
  const sri = body => 'sha384-' + createHash('sha384').update(body).digest('base64');
  /**
   * jsdelivr の代わりに偽の tf を返す。本体は <script integrity>（SRI）で本物の tf.min.js のハッシュを要求するので、
   * 同じページが読む lab/yamnet.js の TFJS_SRI も偽の tf のハッシュに差し替える（Service Worker を止めているので同じオリジンも差し替えられる）。
   * 戻り値: jsdelivr に出た要求の URL の配列
   */
  async function routeFakeTf(page, body) {
    const cdn = [];
    await page.route('https://cdn.jsdelivr.net/**', r => { cdn.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'application/javascript', body }); });
    await page.route('**/lab/yamnet.js', async r => {
      const res = await r.fetch();
      const text = (await res.text()).replace(/TFJS_SRI = '[^']+'/, `TFJS_SRI = '${sri(body)}'`);
      await r.fulfill({ status: 200, contentType: 'application/javascript', body: text });
    });
    return cdn;
  }

  test('既定では tfjs もモデルも読みに行かず、犬らしさも出ない', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', '偽マイクは Chromium のみ');
    const urls = [];
    page.on('request', r => urls.push(r.url()));
    await page.reload();
    expect(await page.evaluate(() => localStorage.getItem('wl.dogcheck'))).toBeNull();
    await page.locator('#micBtn').click();
    await expect(page.locator('#predBig')).not.toHaveText('── ──', { timeout: 25000 });
    await page.waitForTimeout(1500);
    await expect(page.locator('#dogChip')).toHaveCount(0);
    expect(await page.evaluate(() => window.__wl.dogcheck)).toBeNull();
    expect(urls.filter(u => /jsdelivr|tfhub|kaggle|\/lab\/yamnet/.test(u))).toEqual([]);
    await page.locator('#micBtn').click();
  });

  test('?dogcheck=on で監視を始めると裏で読み、判定に犬らしさを添える（判定・保存は従来どおり）', async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', '偽マイクは Chromium のみ');
    const cdn = await routeFakeTf(page, FAKE_TF);
    await page.goto('./?dogcheck=on');
    expect(await page.evaluate(() => localStorage.getItem('wl.dogcheck'))).toBe('on');
    expect(await page.evaluate(() => window.__wl.dogcheck)).toBeNull(); // 監視を始めるまでは何も読まない
    expect(cdn).toEqual([]);

    await page.locator('#micBtn').click();
    await expect(page.locator('#micState')).toContainText('監視中', { timeout: 10000 });
    await expect.poll(() => page.evaluate(() => window.__wl.dogcheck?.state), { timeout: 15000 }).toBe('ready');
    expect(cdn).toEqual(['https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js']); // 固定バージョン
    expect(await page.evaluate(() => window.__fakeTf.url)).toBe('https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1');

    await expect(page.locator('#dogChip')).toContainText('犬らしさ 93%', { timeout: 30000 });
    await expect(page.locator('#feat')).toContainText('吠え');
    await expect(page.locator('#answer')).toHaveClass(/on/);
    // 犬（0.3 以上）なら薄くしない・注記も出さない
    await expect(page.locator('#result')).not.toHaveClass(/notdog/);
    await expect(page.locator('#dogNote')).toBeHidden();
    await page.screenshot({ path: path.join(shots, `${testInfo.project.name}-dogcheck.png`), fullPage: true });
    // YAMNet に渡るのは 16kHz。塊の前を足すので、塊そのもの（約 1 秒）より長く、リングバッファ（6 秒）以内
    const lens = await page.evaluate(() => window.__fakeTf.lens);
    testInfo.annotations.push({ type: 'yamnet-input-samples', description: lens.join(',') });
    expect(Math.max(...lens)).toBeGreaterThanOrEqual(15600);
    expect(Math.max(...lens)).toBeLessThanOrEqual(6 * 16000);

    // 教えたときに保存されるのは従来と同じ項目だけ（犬らしさは ② では保存しない）
    await page.locator('#choices button[data-k="alarm"]').click();
    const arr = JSON.parse(await page.evaluate(() => localStorage.getItem('wanlingual.samples.v1')));
    expect(arr).toHaveLength(1);
    expect(Object.keys(arr[0]).sort()).toEqual(['f', 'label', 'pred', 'src', 't']);
    await page.locator('#micBtn').click();

    // ?dogcheck=off で戻せる
    await page.goto('./?dogcheck=off');
    expect(await page.evaluate(() => localStorage.getItem('wl.dogcheck'))).toBeNull();
  });

  test('犬らしさが低い音は薄く表示して吠え回数に入れない。教えたら通常どおり保存する（③）', async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', '偽マイクは Chromium のみ');
    await routeFakeTf(page, fakeTf(0.05));
    await page.goto('./?dogcheck=on');
    await page.locator('#micBtn').click();
    await expect.poll(() => page.evaluate(() => window.__wl.dogcheck?.state), { timeout: 15000 }).toBe('ready');

    // 判定は捨てずに出したまま、薄くして注記を添える
    await expect(page.locator('#result')).toHaveClass(/notdog/, { timeout: 30000 });
    await expect(page.locator('#dogNote')).toBeVisible();
    await expect(page.locator('#dogNote')).toContainText('犬の声ではないかも');
    await expect(page.locator('#dogChip')).toContainText('犬らしさ 5%');
    await expect(page.locator('#predBig')).not.toHaveText('── ──');
    await expect(page.locator('#answer')).toHaveClass(/on/); // 教える入口は残す
    await page.screenshot({ path: path.join(shots, `${testInfo.project.name}-dogcheck-notdog.png`), fullPage: true });
    // 薄くなっている瞬間は、吠え回数に数えていない・育成ログにも何も残っていない（1 回の evaluate で同時に見る）
    await expect.poll(() => page.evaluate(() => document.getElementById('result').classList.contains('notdog')
      ? { barks: window.__wl.micBarks, state: document.getElementById('micState').textContent.includes('吠え '), saved: window.__wl.samples.length }
      : null), { timeout: 30000 }).toEqual({ barks: 0, state: false, saved: 0 });

    // 飼い主が教えたら「犬の声」と確定: 通常どおり保存し、薄い表示を戻し、吠え回数にも数える
    await expect(page.locator('#result')).toHaveClass(/notdog/, { timeout: 30000 });
    const [cls, barks, n] = await page.evaluate(() => {
      const r = document.getElementById('result');
      if (!r.classList.contains('notdog')) return [null, 0, 0]; // ちょうど次の吠えが来た瞬間（下でやり直す）
      document.querySelector('#choices button[data-k="lonely"]').click();
      return [r.className, window.__wl.micBarks, window.__wl.samples.length];
    });
    if (cls !== null) {
      expect(cls).not.toMatch(/notdog/);
      expect(barks).toBe(1);
      expect(n).toBe(1);
    } else {
      await expect(page.locator('#result')).toHaveClass(/notdog/, { timeout: 30000 });
      await page.locator('#choices button[data-k="lonely"]').click();
    }
    const arr = JSON.parse(await page.evaluate(() => localStorage.getItem('wanlingual.samples.v1')));
    expect(arr).toHaveLength(1);
    expect(arr[0].label).toBe('lonely');
    expect(arr[0].src).toBe('mic');
    expect(Object.keys(arr[0]).sort()).toEqual(['f', 'label', 'pred', 'src', 't']); // 保存する項目は増やしていない
    await expect(page.locator('#hist li').first()).toContainText('さみしい');
    await page.locator('#micBtn').click();
  });

  test('設定のトグルでオン／オフできる。監視中にオンにすると裏で読み、オフにすると以後の判定に掛けない（④）', async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', '偽マイクは Chromium のみ');
    const cdn = await routeFakeTf(page, FAKE_TF);
    await page.reload();
    const toggle = page.locator('#dogcheckToggle');
    await expect(toggle).not.toBeChecked();            // 既定はオフ
    await expect(page.locator('#dogcheckState')).toHaveText('');
    expect(await page.evaluate(() => localStorage.getItem('wl.dogcheck'))).toBeNull();

    // 監視を始めてから、トグルでオンにする → その場で読み込みが始まる
    await page.locator('#micBtn').click();
    await expect(page.locator('#micState')).toContainText('監視中', { timeout: 10000 });
    await page.locator('#settings .switch').click();
    await expect(toggle).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('wl.dogcheck'))).toBe('on');
    // （トーストは「オンにしました」→ 偽の tf が一瞬で読めて「準備ができました」に変わるので、ここでは見ない）
    await expect.poll(() => page.evaluate(() => window.__wl.dogcheck?.state), { timeout: 15000 }).toBe('ready');
    await expect(page.locator('#dogcheckState')).toContainText('準備できています');
    expect(cdn).toHaveLength(1);
    await expect(page.locator('#dogChip')).toContainText('犬らしさ 93%', { timeout: 30000 });
    await page.screenshot({ path: path.join(shots, `${testInfo.project.name}-settings.png`), fullPage: true });

    // トグルでオフ → 設定は項目ごと消え、以後の判定には犬らしさを添えない
    await page.locator('#settings .switch').click();
    await expect(toggle).not.toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('wl.dogcheck'))).toBeNull();
    await expect(page.locator('#dogcheckState')).toHaveText('');
    expect(await page.evaluate(() => window.__wl.dogcheck)).toBeNull();
    await expect.poll(() => page.evaluate(() => document.getElementById('dogChip') === null), { timeout: 30000 }).toBe(true); // 次の判定で消える
    await page.waitForTimeout(1500);
    await expect(page.locator('#dogChip')).toHaveCount(0);
    await page.locator('#micBtn').click();

    // URL の ?dogcheck=on はトグルにも反映される（同じ設定）
    await page.goto('./?dogcheck=on');
    await expect(toggle).toBeChecked();
    await expect(page.locator('#dogcheckState')).toContainText('監視を始めると');
    await page.goto('./?dogcheck=off');
    await expect(toggle).not.toBeChecked();
  });

  test('オンでも tfjs が読めなければ従来どおり判定する', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', '偽マイクは Chromium のみ');
    await page.route('https://cdn.jsdelivr.net/**', r => r.abort());
    await page.goto('./?dogcheck=on');
    await page.locator('#micBtn').click();
    await expect.poll(() => page.evaluate(() => window.__wl.dogcheck?.state), { timeout: 15000 }).toBe('failed');
    await expect(page.locator('#predBig')).not.toHaveText('── ──', { timeout: 25000 });
    await expect(page.locator('#answer')).toHaveClass(/on/);
    await expect(page.locator('#dogChip')).toHaveCount(0);
    await page.locator('#micBtn').click();
  });
});
