# 公開データセットの洗い出し（犬の鳴き声、ライセンス確認つき）

フェーズ2の下調べ（2026-11-02 自動作業）。目的は2つ: (1) YAMNet の「犬か犬以外か」のしきい値を決める材料、(2) 6つの気持ちの判定ルールを見直す材料。
**ダウンロードはまだしていない**（アカウント作成や規約同意が要るものは社長の判断事項）。

## 結論（先に）

- **商用（アフィリエイト・クラファン導線あり）で安全に使えるのは CC0 / CC BY の素材だけ**。CC BY-NC（非営利限定）の ESC-50 / UrbanSound8K / DogSpeak は、**判定ルールの検証（的中率を測る）には使えるが、製品に組み込む学習データにはしない**方針が無難。
- 「気持ち（文脈）ラベル付き」で公開されている犬の鳴き声データは**ほとんど無い**。研究用はメールで申請（INAOE の 74 頭データ）か未公開（CREMD）。→ 6つの気持ちの正解データは、**結局うちのアプリで飼い主に教えてもらって集めるのが本筋**（フェーズ2の匿名化特徴量収集）。
- まず手を付けるなら **FSD50K の CC0 クリップ**（Freesound 由来、ライセンスがクリップ単位で明記、Dog/Bark などのクラスあり）と、**Internet Archive 由来の CC0 効果音**（少量だが即使える）。

## 一覧

| データセット | 犬の中身 | 気持ち／文脈ラベル | ライセンス | 入手 | 使い方の案 |
|---|---|---|---|---|---|
| **FSD50K**（Freesound Dataset 50k, Zenodo 4060432） | 200 クラス（AudioSet 準拠）の一部に Dog / Bark 系。51,197 クリップ・108 時間（全体） | なし（音の種類のみ） | 集合体は CC BY。**クリップ単位**: CC0 19,873・CC BY 23,506・CC BY-NC 6,041・Sampling+ 1,777 | Zenodo から直接 DL（アカウント不要、数十 GB） | CC0 / CC BY の犬クリップだけ抜いて、YAMNet しきい値と「犬以外（人の声・物音）」の誤検出率を測る |
| **ESC-50** | クラス「dog」40 本（5 秒）。他 49 クラスは「犬以外」の材料に | なし | 全体 **CC BY-NC 3.0**（クリップは CC0 / CC BY / CC BY-NC / Sampling+ 混在、一覧あり） | GitHub から直接 DL（600 MB） | 検証専用（NC）。犬以外 1,960 本は誤検出テストに便利 |
| **UrbanSound8K** | クラス「dog_bark」約 1,000 本（4 秒以下） | なし | **CC BY-NC 3.0**（by-nc） | 公式サイトでフォーム入力が必要 → **社長の判断** | 検証専用（NC）。入手にフォームが要るので後回し |
| **DogSpeak**（ArlingtonCL2、HF にミラー） | 77,202 吠え列・156 頭・5 犬種（チワワ・シェパード・ハスキー・ピットブル・柴） | なし（犬種・性別・個体 ID のみ） | **CC BY-NC-SA 4.0** | Hugging Face（DL 自体は可。規約同意が要るか未確認） | 犬種によるピッチの違いを見るのに良い。製品組み込みは不可（NC-SA） |
| **pet-decoder-audio-fixtures**（HF） | 5 本: 大型犬の吠え・小型犬の吠え・くんくん・遊びのうなり・息 | 行動の説明あり（遊び／苦しい等） | **CC0 1.0**（Internet Archive「Red Library: Animals Dogs」由来） | 即 DL 可 | テスト用 fixtures に追加して「本物の犬」の最初の数件に |
| **AudioSet**（Google） | Dog / Bark / Howl / Growling / Whimper (dog) など 7 クラス、数千本分の YouTube 区間 | なし | ラベルは CC BY 4.0。**音声そのものは配布されない**（YouTube ID だけ） | DL は YouTube から各自 → 規約上グレー | 使わない。YAMNet がこれで学習済みなので、間接的に恩恵は受けている |
| INAOE（メキシコ）74 頭データ（Pérez-Espinosa ら） | 16,789 区間・22,491 秒、チワワ・プードル・シュナウザー中心 | **14 文脈**（見知らぬ人に吠える・飼い主への攻撃・遊び・飼い主の帰宅・正／負の鳴き等） | 不明（論文では「メールで申請」） | 研究者宛てメール → **社長の判断**（外部とのやりとり） | 6 文脈 → うちの 6 つの気持ちに対応づけて的中率を測れる唯一の候補。欲しい |
| CREMD（2026, arXiv 2602.15349） | 351 頭・923 クリップ（動画） | 4 感情（happy / angry / fearful / neutral） | 未公開（採択後に研究目的で、商用禁止の同意が条件） | まだ無い | 待ち。公開されたら検証に |
| Pongrácz / Molnár（ムーディ犬の 6 文脈） | 判定ルールの元論文のデータ | 6 文脈 | 非公開 | — | 論文の数値（ピッチ・間隔）だけ参照。これが現在のルール |

## 次の一手（自動作業でやれること）

1. **pet-decoder-audio-fixtures（CC0, 5 本）を `tests/fixtures/real/` に入れ、YAMNet 試作と本体アプリの判定を通す**。初めての「本物の犬」。accuracy.md に 5 件として記録（的中率としては少なすぎるので参考値）。
2. FSD50K は巨大なので、**メタデータ（`dev.csv` / `vocabulary.csv`）だけ落として** Dog / Bark 系で CC0 のクリップ ID と件数を数える。音声は必要な数十本だけ Freesound から個別に（Freesound 本体の API はアカウントが要るので、Zenodo の zip から該当ファイルだけ抜く）。
3. ESC-50 の「dog」40 本と「犬以外」をいくつか使って、**YAMNet の犬らしさのしきい値（いま仮に 0.3）**を決める。これは検証利用なので NC でも問題なし。

## 社長の判断が要るもの（やっていない）

- UrbanSound8K のダウンロードフォーム入力（氏名・所属・メール）。
- INAOE の研究者への問い合わせメール（外部とのやりとり・名乗りが必要）。
- Kaggle 上のデータセット（アカウント作成と規約同意が必要）。

## 出典

- FSD50K: https://zenodo.org/records/4060432 、 https://fsannotator.upf.edu/fsd/release/FSD50K/
- ESC-50 ライセンス: https://github.com/karoldvl/ESC-50/blob/master/LICENSE
- UrbanSound8K（soundata の記述）: https://soundata.readthedocs.io/en/stable/_modules/soundata/datasets/urbansound8k.html
- DogSpeak: https://huggingface.co/datasets/mkkimgnu/DogSpeak_Dataset/blob/main/README.md
- pet-decoder-audio-fixtures: https://huggingface.co/datasets/petdecoder/pet-decoder-audio-fixtures/blob/main/README.md
- INAOE 74 頭データ（Towards Dog Bark Decoding, 2024）: https://arxiv.org/pdf/2404.18739
- CREMD: https://arxiv.org/html/2602.15349v1
- YAMNet クラス表: https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv
