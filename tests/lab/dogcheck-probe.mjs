// 本体の dogcheck.js（plan #14 の実装 ②）を、本体のページ（app/index.html）の中で本物の tfjs・モデルに通す。
// E2E（tests/e2e）は偽の tf で配線だけを見るので、「jsdelivr から <script> を動的に足す → TF Hub のモデルを読む → 推論」が
// 本当に通るかは、外に出られる GitHub Actions（lab-yamnet）でここが確かめる。
//
// 戻り値: { state, error, loadMs, first, second }（first / second は check() の結果。1 回目は準備運動ぶん遅い）
// route: テスト用に通信を差し替える関数（page を受け取る）。pageOptions: browser.newPage() に渡す（差し替えるときは serviceWorkers: 'block'。
// Service Worker 経由の通信は page.route では拾えないため）
export async function probeDogcheck(browser, baseUrl, x, sr, { route, pageOptions } = {}) {
  const page = await browser.newPage(pageOptions);
  try {
    if (route) await route(page);
    await page.goto(baseUrl);
    return await page.evaluate(async ([arr, sr]) => {
      const { DogCheck } = await import('/js/dogcheck.js');
      const d = new DogCheck();
      const t0 = performance.now();
      const ok = await d.load();
      const loadMs = Math.round(performance.now() - t0);
      const wide = Float32Array.from(arr);
      const first = ok ? await d.check(wide, sr) : null;
      const second = ok ? await d.check(wide, sr) : null;
      return { state: d.state, error: d.error, loadMs, first, second };
    }, [Array.from(x), sr]);
  } catch (e) {
    return { state: 'error', error: String(e?.message || e), loadMs: null, first: null, second: null };
  } finally { await page.close(); }
}
