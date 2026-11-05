# ワンリンガル — 作業ディレクトリ

犬の鳴き声から気持ちを**推測**して、飼い主が正解を教えると「うちの子専用」に育つスマホ用 PWA。本物の翻訳ではない。

- 指示書: リポジトリ直下の `WANLINGUAL_BRIEF.md`（社長作成）と `WANLINGUAL_ADDENDUM.md`（技術補足）
- 計画と進捗: `docs/plan.md` ／ 公開手順: `docs/deploy.md` ／ 精度記録: `docs/accuracy.md` ／ データセット調査: `docs/datasets.md` ／ 日報: `docs/daily/`
- 出発点: `prototypes/`（claude.ai の Artifact から取り出した試作2本。**参照用。実装は `app/`**）

## 構成

```
app/                 PWA 本体（静的サイト。このフォルダをそのまま公開する）
  index.html         画面
  css/app.css        デザイン（LCD風の緑パネル、DotGothic16 / Zen Kaku Gothic New、ライト／ダーク）
  js/features.js     特徴量抽出（吠え検出、ピッチ、スペクトル重心）
  js/classify.js     判定（ルール + kNN）、育成度
  js/store.js        保存（localStorage。特徴量と正解だけ。音声は保存しない）
  js/mic.js          マイク常時監視 → 吠えの塊を切り出す
  js/dogcheck.js     犬の声チェック（YAMNet。**既定オフ**。`?dogcheck=on` で試せる。オンのときだけ監視開始後に裏で tfjs とモデルを読む）
  js/app.js          画面の配線
  sw.js              オフライン用 service worker（更新時は VERSION を上げる）
  manifest.webmanifest, icons/
  lab/yamnet.html    フェーズ2の試作: YAMNet で「犬の声か、それ以外か」（本体とは別ページ。tfjs は CDN 固定版）
tests/
  unit/              node --test（特徴量・判定・育成度）
  e2e/               Playwright（Android / iPhone 相当のエミュレーション、偽マイク）
  fixtures/          合成した吠え声 WAV
  lab/               試作の確認スクリプト（GitHub Actions lab-yamnet で実行）。fetch-data.mjs が ESC-50 等の検証データを
                     tests/lab/data/ に落とす（gitignore。NC ライセンスなので検証のみ）。features-check.mjs は本体の検出器、
                     yamnet-check.mjs は YAMNet に本物の音を通して表を出す（ファイル全体、本体と同じ「吠えの塊」ごと、
                     塊を前後に広げて最低 2〜3 秒にしたもの）。
                     dogcheck-probe.mjs は本体の dogcheck.js を本体のページの中で本物の tfjs・モデルに通す
.github/workflows/pages.yml   main に push → GitHub Pages へ自動デプロイ
```

## 動かす

```
npm run serve        # http://localhost:4173 （localhost ならマイクが使える）
npm run test:unit
npm run test:e2e     # 初回は npm install と npx playwright install chromium
```
