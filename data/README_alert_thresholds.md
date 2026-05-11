# 警報・注意報基準値（alert_thresholds.csv）

- **出典**: [福岡市 感染症情報（定点当たり報告数等解説）](https://www.city.fukuoka.lg.jp/hofuku/hokensho/kansensho/kansenshojoho/chosa/houkokukaisetu.html) の「警報・注意報レベルの基準値」表。
- 感染症発生動向調査に基づき国で定められた基準を福岡市が掲載しているものです。
- 新型コロナウイルス感染症は国から基準が示されていないため、このCSVには含めていません（ダッシュボードでは平年比のみ表示）。

| 列 | 説明 |
|----|------|
| category | 感染症名（merged_data / フロントの category と一致） |
| alert_start | 警報レベル開始基準値（定点あたり報告数） |
| alert_end | 警報レベル終息基準値 |
| attention | 注意報レベル基準値（対象としない場合は空） |
| source_note | 備考（未使用時は空） |
