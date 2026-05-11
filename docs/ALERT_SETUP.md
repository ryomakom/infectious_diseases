# アラートメールの設定手順

登録した都道府県で警報基準を超えた感染症が出たときに、SendGrid でメールを送信する仕組みです。

## 1. Google フォームとスプレッドシートの作成

1. [Google フォーム](https://forms.google.com) で新しいフォームを作成する。
2. 質問を追加する：
   - **メールアドレス**（記述式・回答を検証 → テキスト → 正規表現 `^[^@]+@[^@]+$` など）
   - **知りたい都道府県**（チェックボックス・都道府県一覧を選択肢に）
3. 回答先を「新しいスプレッドシートを作成」にし、スプレッドシートを作成する。
4. スプレッドシートの列名を次のいずれかにする（推奨）：
   - 1列目: 「メールアドレス」または「メール」
   - 2列目: 「都道府県」（チェックボックスなら複数がカンマ区切りで1セルに入る）

### スプレッドシートをウェブに公開（CSV）

1. スプレッドシートで **ファイル → 共有 → ウェブに公開** を開く。
2. 「リンク」で **シート全体** または 該当シートを選び、形式 **CSV** を選ぶ。
3. 「公開」して表示される **URL をコピー** する。  
   例: `https://docs.google.com/spreadsheets/d/xxxxx/export?format=csv&gid=0`

---

## 2. SendGrid の準備

1. [SendGrid](https://sendgrid.com) でアカウント作成（無料枠: 100通/日など）。
2. **Settings → API Keys** で API キーを作成（Mail Send の権限があれば可）。
3. **Settings → Sender Authentication** で送信元ドメインまたは単一送信者を認証する。  
   送信元メールアドレス（例: `noreply@yourdomain.com`）を用意する。

---

## 3. リポジトリの設定

### GitHub の Variables と Secrets

| 種類 | 名前 | 値 |
|------|------|-----|
| **Variable** | `SUBSCRIPTIONS_CSV_URL` | 上記でコピーしたスプレッドシートの CSV 公開 URL |
| **Variable** | `SENDGRID_FROM` | 送信元メールアドレス（SendGrid で認証済みのもの） |
| **Variable** | `DASHBOARD_URL` | ダッシュボードの URL（例: `https://ryomakom.github.io/infectious_diseases_trends/`） |
| **Secret** | `SENDGRID_API_KEY` | SendGrid の API キー |

- **Variables**: リポジトリの **Settings → Secrets and variables → Actions** で **Variables** タブから追加。
- **Secrets**: 同じページの **Secrets** タブから追加。

---

## 4. サイトにフォームリンクを設定

`docs/index.html` の「アラート登録フォームを開く」のリンクを、作成した Google フォームの URL に変更する。

```html
<a href="https://docs.google.com/forms/d/e/あなたのフォームID/viewform" id="alert-form-link" ...>
```

---

## 5. 動作確認

- **手動実行**: リポジトリの **Actions** タブで「アラートメール送信」ワークフローを選び、**Run workflow** で実行する。
- 警報該当が 0 件の場合はメールは送信されない。テスト時は `scripts/send-alert-emails.mjs` の `ratio_alert >= 1` を一時的に `>= 0` にするなどして確認できる。

---

## アラートメールの内容

- **件名**: 【感染症アラート】登録都道府県で警報基準を超えた感染症があります
- **本文**: 警報基準比 1.0 以上の感染症について、都道府県・感染症名・警報基準比・定点あたり患者数を表で表示。ダッシュボードへのリンクと、登録解除の案内を記載。

---

## 注意

- `docs/results/ranking.csv` は、R の日次処理（`daily_task.Rmd` や `run_ranking.R`）で生成されている必要があります。この CSV に `ratio_alert` 列が含まれていれば、その値が 1 以上の場合に「警報」として扱います。
- 登録解除は、フォームの説明文に「登録解除は〇〇までご連絡ください」などと記載し、運用で対応することを推奨します。
