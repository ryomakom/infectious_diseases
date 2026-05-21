# プロジェクト構成解説

「主な感染症の流行状況」サイト（`https://ryomakom.github.io/infectious_diseases/`）の中身を、データの流れに沿って解説します。

---

## 1. プロジェクト全体像

このリポジトリは「**毎日決まった時刻に厚労省（国立健康危機管理研究機構）の感染症週報サイトをチェックし、新しいデータがあれば取得・加工し、GitHub Pages 経由でダッシュボードとして公開する**」という1本の自動パイプラインです。

中身は大きく分けて3つの層からなります：

```
[A] バックエンド            [B] 中間データ             [C] フロントエンド
┌───────────────┐          ┌──────────────┐          ┌──────────────────┐
│ R スクリプト   │  ──→     │ CSV / JSON   │  ──→     │ HTML/CSS/JS      │
│ (daily_task.Rmd)│         │ (docs/data/) │          │ (docs/index.html)│
└───────────────┘          └──────────────┘          └──────────────────┘
   ↑ GitHub Actions が                                   ↑ ブラウザが
   月〜金 05:00 UTC に起動                                fetch して描画
```

R スクリプトは「集計エンジン」、CSV/JSONは「データの保管庫」、HTML/JSは「閲覧 UI」という分業です。それぞれが別のフォルダに置かれています。

---

## 2. データの流れ（パイプラインの動き）

`R/daily_task.Rmd` を実行すると、内部で以下の順序で処理が進みます：

```
1. 厚労省サーベイランスサイトから今週分の HTML をダウンロード
        ↓
2. パースして 都道府県×疾患×週 のロングテーブルにする
        ↓
3. 既存の merged_data.csv とマージし、重複を除いて保存
        ↓
4. 都道府県別CSVを生成（全国/東京都/大阪府は単独で、他県は 県×疾患 単位に分割）
        ↓
5. 週次集計（4週移動平均 ma4 と週次素値 weekly_value）を年別CSVに分割
        ↓
6. ランキング指標を計算
   - current_ma4: 直近4週の平均
   - ratio_heinen: 平年比（過去3年×同時期4週の平均との比）
   - ratio_alert: 警報開始基準値との比
   - in_alert_level: ヒステリシス警報判定
        ↓
7. ニュースダイジェスト（bullets/rising/anomalies）を JSON で生成
        ↓
8. last_fetch.txt を更新、index.html の OGP キャッシュ無効化パラメータを更新
        ↓
9. GitHub Actions が成果物をコミット・プッシュ
```

ブラウザ側はこの結果ファイルだけを fetch するので、Rの実装内部を知らなくても表示は完結します。

---

## 3. フォルダ構造（完全版）

```
infectious_diseases_trends-main/
│
├── README.md                        # プロジェクトの一行説明
├── ARCHITECTURE.md                  # ← この文書
├── .gitignore                       # .Rhistory, daily_task.html, _tmp_*, .claude/ 等を除外
│
├── .github/workflows/
│   └── r-code-workflow.yml          # GitHub Actions: 月〜金 05:00 UTC に自動実行
│
├── R/                               # 【A層】R スクリプト
│   ├── daily_task.Rmd               # メインパイプライン
│   ├── initial_processing.Rmd       # 初回セットアップ（過去データ一括処理）
│   ├── lib/
│   │   ├── generate_merged_weekly.R # by_week 再生成（debug 用）
│   │   └── generate_ogp.R           # OGP 画像（SNS シェア用）生成
│   └── tests/
│       └── test_bullets.R           # 任意の週で bullets 計算を試行
│
├── config/                          # 不変の参照テーブル
│   ├── year_week.csv                # 年-週 → 週末日 の変換表
│   ├── prefecture_population.csv    # 都道府県別人口（生成スクリプトで使用予定）
│   └── README_alert_thresholds.md   # 警報閾値ファイルの仕様メモ
│
├── data/                            # 【B層】パイプライン内部のデータ
│   ├── raw/                         # 厚労省から取得した週次CSV（700+）
│   │   ├── 2012-37-teiten.csv
│   │   ├── ...
│   │   └── 2026-19-teiten.csv
│   └── merged/
│       └── merged_data.csv          # 全期間結合済みロングテーブル
│
├── logs/
│   └── log.csv                      # ダウンロード履歴（timestamp, week_label, action, rows）
│
└── docs/                            # 【C層】GitHub Pages 公開ルート
    │
    ├── index.html                   # メインダッシュボード
    ├── bullets_tester.html          # 任意週の bullets 生成を確認するデバッグツール
    ├── heatmap.html                 # ニュースダイジェストのヒートマップ表示
    ├── disclaimer.html              # 解説・データ出典・各疾患の説明
    ├── favicon.png                  # ファビコン
    ├── ogp.png                      # SNS シェア用カバー画像（generate_ogp.R が生成）
    │
    ├── assets/                      # 静的アセット
    │   ├── css/style.css
    │   ├── js/
    │   │   ├── state.js             # 定数・グローバル状態・共通ユーティリティ
    │   │   ├── urlState.js          # URL クエリパラメータ同期
    │   │   ├── chart.js             # 折れ線グラフ描画
    │   │   ├── ranking.js           # ランキング表とフィルタ・スパークライン
    │   │   ├── newsDigest.js        # ニュースダイジェスト描画
    │   │   └── dataLoader.js        # 初期データ取得と全モジュール起動
    │   └── img/
    │       └── note-icon.svg
    │
    └── data/                        # ブラウザが fetch する公開データ
        ├── alert_thresholds.csv     # 疾患ごとの警報開始/終息/注意報閾値
        ├── last_fetch.txt           # 最終ダウンロード成功日（YYYY-MM-DD）
        ├── ranking.csv              # 都道府県×疾患のランキング指標 912行
        ├── news_digest.json         # bullets/rising/anomalies の構造化データ
        ├── pref/                    # 都道府県別データ
        │   ├── data-全国.csv         # 初期ロード3点（全疾患まとめ）
        │   ├── data-東京都.csv
        │   ├── data-大阪府.csv
        │   └── data-{県}-{疾患}.csv   # 遅延ロード用（945組み合わせ）
        └── weekly/                  # 年別週次集計
            ├── merged_weekly_2012.csv
            ├── ...
            └── merged_weekly_2026.csv
```

---

## 4. 【A層】R スクリプト詳説

### 4-1. `R/daily_task.Rmd` ─ メインパイプライン

毎日の処理を一手に引き受ける Rmd。中身は連続した R チャンクで、上から順に実行されます。

| ブロック | 行 | 役割 |
|---|---|---|
| setup | 冒頭 | `knit時CWD` をプロジェクトルートに固定（`knitr::opts_knit$set(root.dir = normalizePath(".."))`） |
| ライブラリ読み込み | ~10 | tidyverse, rvest, lubridate, jsonlite |
| `pref_lookup` | ~20 | 都道府県名（日本語 ↔ 英語）の対応表 |
| `merged_data.csv` 読み込み | ~108 | 既存データを初期データとしてロード |
| ダウンロード対象週リスト構築 | ~200 | `year_week.csv` を使って未取得週を割り出す |
| 厚労省サイトから HTML 取得＆パース | ~300 | 各週の HTML を `read_html` で解析、定点あたり患者数を抽出 |
| ログ更新 | ~365 | `logs/log.csv` に `downloaded`/`skipped`/`not_found`/`parse_error` を記録 |
| `last_fetch.txt` 書き出し | ~373 | 成功した最後の `timestamp` を UTC 基準で日付化 |
| 新規データなし時の早期終了 | ~388 | `knitr::knit_exit()` でここで処理打ち切り |
| データ統合 | ~390 | 既存 + 新規 をマージし `data/merged/merged_data.csv` に保存 |
| 公開用 CSV 出力 | ~446 | 全国/東京/大阪は単独、他県は県×疾患で分割保存 |
| 週次集計 | ~485 | 4週移動平均 `ma4` を計算、年別CSVに分割 |
| ランキング指標 | ~545 | `current_ma4`, `ratio_heinen`, `ratio_alert`, `in_alert_level` 計算 |
| `ranking.csv` 書き出し | ~1137 | 都道府県×疾患のテーブル（912行） |
| `news_digest.json` 書き出し | ~1159 | bullets/rising/anomalies の構造化データ |
| `index.html` の `?v=` 更新 | ~1180 | OGP 画像の SNS キャッシュ無効化用パラメータを最新日付に書換え |

#### 4-1-1. ランキング指標の意味

| 列名 | 計算式 | 何を表すか |
|---|---|---|
| `current_value` | 直近1週の素値 | 「いまの患者数」（定点あたり） |
| `current_ma4` | 直近4週の平均 | 数値のブレを慣らした水準 |
| `baseline_ma4` | 過去3年×同時期4週の素値の平均 | 平年並みの値（季節性込み） |
| `ratio_heinen` | `current_ma4 / baseline_ma4` | 平年比。1.0なら平年並み、2.0なら倍 |
| `alert_start` | `alert_thresholds.csv` から | 警報開始基準（疾患固有） |
| `ratio_alert` | `current_value / alert_start` | 警報基準の何倍か |
| `in_alert_level` | ヒステリシスウォーク | `alert_start` を超えたら ON、`alert_end` を下回るまで ON のまま |

#### 4-1-2. ニュースダイジェスト（bullets）の作り方

`buildAlertBullets`：
- `in_alert_level == TRUE` の県×疾患を抽出（全国は除く）
- 疾患ごとに `current_ma4` 降順で上位3県＋総数を文言化
  - 例: 「インフルエンザ：東京都、大阪府、神奈川県など12県で患者数が警報レベル」

`buildAnomalyBullets`：
- 「全国」のレコードで、平年比でみて異常値（`anomaly_z >= 3` かつ `anomaly_ratio > 1`）の疾患
- 既に警報レベルの疾患は除外（重複防止）
- 例: 「水痘：全国の患者数が平年比+42%で、とくに北海道、青森県、宮城県で多い」

### 4-2. `R/initial_processing.Rmd`

リポジトリ初回構築時に1度だけ使うスクリプト。`data/raw/` 全件を読み込んで `data/merged/merged_data.csv` を作る。日次運用では使われません。

### 4-3. `R/lib/generate_merged_weekly.R`

`merged_data.csv` から年別の `merged_weekly_YYYY.csv` を再生成するスタンドアロンスクリプト。`daily_task.Rmd` の途中で同じことをやるので普段は不要だが、フロントエンドのデバッグ時に「`merged_data.csv` はあるけど年別ファイルが古い」というときに単独実行できる。

### 4-4. `R/lib/generate_ogp.R`

SNS シェア用の OGP 画像（`docs/ogp.png`、1200×630）を生成。`ranking.csv` と `news_digest.json` を読んで、警報中の疾患・上位県・スパークラインを含む画像を ggplot2 で描画。

### 4-5. `R/tests/test_bullets.R`

任意の週を指定して bullets 計算ロジックだけを単体実行する確認用スクリプト。`daily_task.Rmd` の bullets ロジックと完全に同じものを抜き出している。週を変えるには:

```bash
Rscript R/tests/test_bullets.R 2025-18
```

---

## 5. 【C層】フロントエンド詳説

### 5-1. HTML ページ4本

| ページ | 役割 |
|---|---|
| `index.html` | メインダッシュボード。ヘッダー / シェアボタン / ニュースダイジェスト / ランキング表 / 折れ線グラフセクション の構成 |
| `bullets_tester.html` | 任意の過去週を選んで bullets を再生成し表示するデバッグ画面 |
| `heatmap.html` | `news_digest.json` の中身をヒートマップ形式で可視化 |
| `disclaimer.html` | サイト説明、データ出典、各疾患の解説（disclaimer.html#covid19 などのアンカー対応） |

### 5-2. JavaScript モジュール6本

ロード順は HTML 末尾で `state.js → urlState.js → ranking.js → chart.js → newsDigest.js → dataLoader.js` の順。最後の `dataLoader.js` が起動エントリ。

#### `state.js` ─ 共通基盤
| 中身 | 用途 |
|---|---|
| `CATEGORY_ORDER` | 19疾患の表示順序リスト |
| `PREF_ORDER` | 全国＋47都道府県の表示順序 |
| `RANKING_PAGE_SIZE = 10` | ランキング表の1ページ行数 |
| `state` オブジェクト | 全UI状態（選択中の県・疾患・ソート・データキャッシュ）の集約 |
| `els` オブジェクト | DOM 要素の参照キャッシュ |
| `categoryToDisplay()` / `prefToDisplay()` | サーバ表記とフロント表記の正規化 |
| `DISEASE_ANCHOR_MAP` | 疾患名 → disclaimer.html のアンカーID対応 |
| `loadCsvFlexible()` / `loadTextFlexible()` | 複数のパス候補を試して fetch するヘルパー |
| `buildPathCandidates()` | `data/...` のような相対パスを `./data/`, `docs/data/` など複数候補に展開（GitHub Pages 配下・ローカル開発・ZIPダウンロード後など環境差を吸収） |
| `_cacheBuster` | `?v=YYYYMMDD` を毎日更新する変数。CSV取得時に付与しブラウザキャッシュを1日単位で無効化 |
| グラフ用ユーティリティ | `computeTickInterval`, `csvEscape`, `downloadCsv` など |

#### `urlState.js` ─ URL ↔ 状態 双方向同期
- 5つのクエリパラメータ `?w=2026-W20&pref=全国,東京都&cat=インフルエンザ&hi=東京都&t0=2025-01-01&t1=2025-12-31` を扱う
- `w` は ISO 週番号で**毎週自動更新**される。これは SNS で共有された URL が翌週も同じ画像をキャッシュ表示してしまうのを防ぐため
- ページ読み込み時に最新週に正規化し、グラフをクリックしたとき・ハイライトを変えたときに `history.replaceState` で URL を書き換える

#### `chart.js` ─ 折れ線グラフ
- d3 で複数都道府県×複数疾患の時系列を並べて描画
- 警報レベル超え・注意報レベル超えの部分は色分け（赤・薄赤）
- ブラシで期間を絞れる小型スライダー付き
- レスポンシブ対応（`setupResizeRedraw`）

#### `ranking.js` ─ ランキング表
- `state.rankingData`（912行）をフィルタしてテーブル描画
- 警報・注意報・平常の3色でセル色分け
- 各行に直近52週の「ミニスパークライン」を表示（`buildMiniSparkline`）
- 「もっと見る」で `RANKING_PAGE_SIZE = 10` ずつ拡張
- 行クリックで該当の県×疾患をグラフ表示に追加
- 表示中の県・疾患のうち未ロードのものは `ensurePrefCatLoaded` でバックグラウンド遅延ロード

#### `newsDigest.js` ─ ニュースダイジェスト
- `news_digest.json` から `bullets`（箇条書き）と3シグナルカード（警戒・増加・季節外れ）を描画
- ハイライトカテゴリを変えると関連グラフがその疾患・上位3県にスクロール

#### `dataLoader.js` ─ 起動エントリ
- 初期ロードでは「**全国 + 東京都 + 大阪府の3CSV + 閾値 + last_fetch + ranking.csv + news_digest.json**」だけを並列取得（数百KB 程度に抑えて初期表示を最速化）
- ニュースダイジェストの3シグナルに該当する疾患の上位3県だけ追加で先読み
- 残りの 945 県×疾患 CSV はランキング表で表示されたタイミングで `ensurePrefCatLoaded` がオンデマンド取得
- `computeRankingFromAllData()` は CSV が取れなかった場合のフォールバック（通常は使われない）

### 5-3. 初期ロードのフロー

```
1. HTML が読まれて <script> 6本が順次実行
2. dataLoader.js の initialize() が起動
3. Promise.all で並列取得：
     - data/pref/data-{東京都,大阪府,全国}.csv
     - data/alert_thresholds.csv
     - data/last_fetch.txt
     - data/ranking.csv
     - data/news_digest.json
4. state.allData にデータを格納
5. state.rankingData は ranking.csv をそのまま採用
6. ニュースダイジェスト3シグナル上位県のCSVを先読み
7. 各セクションを描画（ニュース → ランキング表 → グラフ）
8. URL パラメータがあれば反映してグラフセクションへスクロール
9. リサイズ時の再描画リスナを登録
```

---

## 6. 【B層】データファイル詳説

### 6-1. `data/raw/YYYY-WW-teiten.csv`

厚労省サイトから取得した1週ぶんの生データ。1ファイル＝1週、713本ある（2012年第37週〜現在）。中身は「都道府県×疾患」の縦持ち。

例外的に `2025-04-zensu.csv` は別系統の全数把握データ（百日咳など対応）。

### 6-2. `data/merged/merged_data.csv`

`data/raw/*.csv` を全部結合したロングテーブル。`(pref, category, date, value)` の縦持ち。R側パイプラインの **唯一の信頼源**。フロントエンドは触らない。

### 6-3. `docs/data/ranking.csv`

`(category, pref, year_week, reference_date, current_value, current_ma4, baseline_ma4, ratio_heinen, alert_start, ratio_alert, in_alert_level)`、約912行。

**全国＋47都道府県 × 約19疾患の組み合わせ** が並ぶ。患者ゼロで `baseline_ma4 = 0` の組み合わせも、`ratio_heinen = NA` として残してある（「ゼロも情報」）。

### 6-4. `docs/data/news_digest.json`

```json
{
  "week": "2026-19",
  "generated_text": { "bullets": ["...", "..."] },
  "rising":    [ {category, pref, current_value, growth1Rate, ...}, ... ],
  "anomalies": [ {category, anomaly_z, anomaly_ratio, ...}, ... ]
}
```

`rising` は4週連続上昇など「急増」、`anomalies` は平年比から見た季節外れの異常値。トップに表示される箇条書きは `generated_text.bullets`。

### 6-5. `docs/data/pref/`

- `data-全国.csv`, `data-東京都.csv`, `data-大阪府.csv` — 全疾患まとめて単独CSV（初期ロード対象）
- `data-{県}-{疾患}.csv` — 1組み合わせ1ファイル（残り44県×ほぼ全疾患＝945本、遅延ロード対象）

なぜ分割するか？「全国・東京・大阪は誰でもよく見るので初期ロード」「他県の特定疾患はクリックされたタイミングで取得」というレイテンシ最適化。一括ファイルだと数MB単位になり、モバイルの初期表示が大幅に遅くなる。

### 6-6. `docs/data/weekly/merged_weekly_YYYY.csv`

各年の `(pref, category, year_week, ma4, weekly_value, yr, wk)` を持つ年別ファイル。`bullets_tester.html` が「対象週＋過去3年」だけを遅延ロードして bullets を再計算するために使う。

### 6-7. `docs/data/alert_thresholds.csv`

`(category, alert_start, alert_end, attention, source_note)` の5列。厚労省ガイドラインに基づく疾患別の警報・注意報基準。**設定値**なので手動メンテ。

### 6-8. `docs/data/last_fetch.txt`

たった1行、`2026-05-19` のような YYYY-MM-DD。サイトヘッダーの「最終更新」表示と、OGP画像の `?v=` パラメータの元になる。

### 6-9. `logs/log.csv`

各週への HTTP リクエスト結果を行追記。`(timestamp UTC, week_label, action, rows)`。`action` は `downloaded` / `skipped` / `not_found` / `parse_error` のいずれか。`last_fetch.txt` の元データ。

### 6-10. `config/year_week.csv`

ISO 週番号 → 週末日 の対応表（2012年〜未来分まで予め生成済み）。HTTP リクエスト先 URL を組み立てるのに使う。

---

## 7. GitHub Actions ワークフロー

`.github/workflows/r-code-workflow.yml`：

```yaml
on:
  push: { branches: [main] }
  schedule: [{ cron: '0 5 * * 1,2,3,4,5' }]   # 月〜金 05:00 UTC (= 14:00 JST)
  workflow_dispatch:                          # 手動実行も可
```

ジョブの流れ：
1. リポジトリチェックアウト
2. システムライブラリ（pandoc, libxml2, ...）インストール
3. R セットアップ（バイナリ版のRSPMでビルドを高速化）
4. R パッケージインストール（rmarkdown, tidyverse, rvest, lubridate, showtext, sysfonts）
5. `Rscript -e "rmarkdown::render('R/daily_task.Rmd')"` を実行
6. 出力ファイルを `git add` → コミット → `pull --rebase` → `push`

生成物は次回起動時に上書きされていく（履歴は溜まる）。

---

## 8. 開発時の運用

### ローカルで全パイプラインを試す

```powershell
& "C:\Program Files\R\R-4.6.0\bin\Rscript.exe" -e "rmarkdown::render('R/daily_task.Rmd')"
```

プロジェクトルートを CWD にした状態で実行（`knitr::opts_knit$set(root.dir = normalizePath(".."))` が ".." を解決してプロジェクトルートに移動するため）。

### ローカルでサイトを動作確認

簡易HTTPサーバを立てる（`.local_serve.R` は `.gitignore` に入れる前提）：

```r
library(httpuv)
# docs/ を / にマップして 4321 ポートで公開
# http://localhost:4321/index.html
```

`file://` で開くと CORS 制約で fetch が失敗するので、必ず HTTP サーバ経由で確認する。

### Bullets ロジックだけ試す

```bash
Rscript R/tests/test_bullets.R 2025-18
```

### Actions を一時停止したいとき

`.github/workflows/r-code-workflow.yml` の `schedule:` ブロックをコメントアウト。`workflow_dispatch:` は残しておくと手動実行はできる。

---

## 9. 設計上の重要な約束

1. **R は `data/merged/merged_data.csv` を信頼源とする**。フロントエンドはこれを直接読まない。
2. **フロントエンドは `docs/data/` 配下しか fetch しない**。`docs/data/` の中身は R が生成・更新する。
3. **`docs/data/alert_thresholds.csv` だけは手動メンテ**。R はこれを「読む」だけ。
4. **タイムスタンプは UTC で保存する**（GitHub Actions と JST ローカルの両方で動くため）。
5. **JS の fetch パスはすべて `docs/` からの相対**。GitHub Pages のサブパス配信に対応するため。
6. **`?v=YYYYMMDD` でブラウザキャッシュを1日単位で揃える**（state.js の `_cacheBuster`）。
7. **`?w=YYYY-WW` で SNS シェア URL を毎週変える**（urlState.js）。これも OGP キャッシュ対策。

---

## 10. よくある質問

**Q. ランキング表が「残り902件」と出るが、912行のはずでは？**
A. 初期表示は `RANKING_PAGE_SIZE = 10` 行だけ。912 − 10 = 902 が「残り」。

**Q. `daily_task.html` がローカル実行で生成される。コミットすべき？**
A. しない。knit 出力なので `.gitignore` で除外している。

**Q. 過去年のデータを差し替えたい**
A. `data/raw/` の該当週ファイルを書き換え → `R/initial_processing.Rmd` を実行して `merged_data.csv` を再生成 → コミット。

**Q. 新しい疾患を追加するには？**
A. 厚労省サイトの HTML パース部分（`daily_task.Rmd` 内）に疾患名マッピングを追加し、`docs/data/alert_thresholds.csv` に閾値を追記、`docs/assets/js/state.js` の `CATEGORY_ORDER` と `DISEASE_ANCHOR_MAP` に登録、`docs/disclaimer.html` に解説セクションを追加。
