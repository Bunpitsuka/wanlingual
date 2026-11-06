# 公開（デプロイ）と動作確認の手順

**現在の公開URL: https://bunpitsuka.github.io/wanlingual/** （リポジトリ Bunpitsuka/wanlingual、main に push すると自動更新。A の手順は 2026-11-01 に完了済み）

マイクはブラウザの決まりで **https か localhost でしか使えません**。スマホで試すには https の公開URLが必要です。
一番簡単で無料なのが GitHub Pages。ただし GitHub のアカウント操作は社長の担当（指示書 §6）。

## A. 社長にお願いすること（1回だけ、3分）

1. GitHub にログインして「New repository」→ 名前 `wanlingual`、Public、他は空のまま「Create repository」。
   - Pages の URL は `https://<GitHubのユーザー名>.github.io/wanlingual/` になります。ユーザー名が公開されて困らないアカウントで。
2. できたリポジトリの URL（例 `https://github.com/xxxx/wanlingual`）をチャットで教えてください。
   - あわせて claude.ai の設定 → コネクタで GitHub をつないでもらえると、こちらから push まで自動でできます。つなぎたくなければ、下の「B. 手動アップロード」でも動きます。
3. push 後、リポジトリの Settings → Pages → Source を **GitHub Actions** にする（1クリック）。これで `main` に push するたび自動で公開されます。

## B. 手動アップロード（GitHub を Claude につながない場合）

1. GitHub のリポジトリページで「Add file → Upload files」。
2. `wanlingual/` フォルダの中身（`app/ tests/ docs/ .github/ package.json .gitignore README.md`）をドラッグ＆ドロップ → Commit。
   - `.github` は隠しフォルダなのでエクスプローラーで「隠しファイルを表示」にする。
3. Settings → Pages → Source を GitHub Actions に。数分で `https://<ユーザー名>.github.io/wanlingual/` が開きます。

## C. 公開前に PC で試す（今日できる）

```
cd（wanlingual フォルダ）
npm run serve
```
Chrome で http://localhost:4173 を開く → 「マイクで監視を始める」→ 許可。
**犬がいなくても、YouTube で犬の吠え声の動画をスピーカーで流せば判定が出ます**（PC のマイクが拾う）。
判定が出たら正解をタップ → LV が上がる、まで確認できます。

## D. テスト

```
npm install            # 初回だけ
npx playwright install chromium   # 初回だけ（E2E 用のブラウザ）
npm run test:unit      # 特徴量・判定の単体テスト（6本）
npm run test:e2e       # Android / iPhone 相当のエミュレーションで E2E（8本×2）
```
E2E のスクリーンショットは `tests/e2e/screenshots/` に出ます。

## スマホで「ホーム画面に追加」

- iPhone: Safari で URL を開く → 共有ボタン → 「ホーム画面に追加」。以後は全画面で開く。
- Android: Chrome で開く → メニュー → 「ホーム画面に追加」または「アプリをインストール」。
- 2回目以降は電波がなくても起動・判定できます（学習データは端末内）。

## 犬の声チェック（試験中・既定オフ）を実機で試す

人の声や物音を「吠え」と間違えないための仕組み（YAMNet）。まだ試験中なので、ふつうに開いたときは動きません。

1. スマホで **https://bunpitsuka.github.io/wanlingual/?dogcheck=on** を開く（Wi-Fi 推奨。初回だけ約 15MB のモデルを読みます）。
2. 「マイクで監視を始める」→ 数秒〜十数秒で「犬の声チェックの準備ができました」と出る。
3. 吠え声で判定が出たあと、少し遅れて判定欄のいちばん下に「犬らしさ 94%（0.9秒）」のように出る。かっこの中が 1 回の計算にかかった時間。
4. 犬らしさが 30% 未満だと、出ている判定が薄くなって「犬の声ではないかもしれません」と出る（人の声・手をたたく音などで試せます）。そのぶんは「吠え ◯回」に数えません。**犬の声だったのに薄くなった場合は、そのまま下で気持ちをタップ**すれば、いつもどおり覚えます（くんくん・息の音は機械が犬と見分けにくいため、捨てずに残しています）。
5. やめるときは **https://bunpitsuka.github.io/wanlingual/?dogcheck=off** を 1 回開く。

気持ちの判定のしかたや、育成ログに保存する中身は変わりません。音声は端末の外に出ません（モデルを端末に読み込んで、端末の中で計算します）。見た目は `docs/screenshots/android-chrome-dogcheck-notdog.png`。

## 注意

- iPhone はバックグラウンド録音ができません。監視中は画面を点けたまま、アプリを前面に。
- 判定ルールを変えたら `app/sw.js` の `VERSION` を上げる（古いキャッシュを捨てるため）。
