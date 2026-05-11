#!/usr/bin/env node
/**
 * 警報アラートメール送信スクリプト
 * - ranking.csv から警報基準比 >= 1 の行を抽出
 * - スプレッドシート（CSV）から登録者一覧を取得
 * - 登録都道府県に該当するアラートがある登録者にメール送信
 *
 * 環境変数:
 *   RANKING_CSV_PATH   ranking.csv のパス (default: docs/results/ranking.csv)
 *   SUBSCRIPTIONS_CSV_URL   Google スプレッドシートの「ウェブに公開」CSV URL
 *   SENDGRID_API_KEY   SendGrid API キー
 *   SENDGRID_FROM      送信元メールアドレス（SendGridで認証済みのドメイン）
 *   DASHBOARD_URL      ダッシュボードのURL（メール本文のリンク）
 */

import { readFileSync } from 'fs';

const RANKING_CSV_PATH = process.env.RANKING_CSV_PATH || 'docs/results/ranking.csv';
const SUBSCRIPTIONS_CSV_URL = process.env.SUBSCRIPTIONS_CSV_URL;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM = process.env.SENDGRID_FROM || 'noreply@example.com';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://ryomakom.github.io/infectious_diseases_trends/';

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(current.replace(/^"|"$/g, '').trim());
      current = '';
    } else if (c === '\n' && !inQuotes) {
      result.push(current.replace(/^"|"$/g, '').trim());
      return result;
    } else {
      current += c;
    }
  }
  result.push(current.replace(/^"|"$/g, '').trim());
  return result;
}

function parseCsv(content) {
  const lines = [];
  let rest = content;
  while (rest.length > 0) {
    const lineEnd = rest.indexOf('\n');
    const line = lineEnd >= 0 ? rest.slice(0, lineEnd) : rest;
    rest = lineEnd >= 0 ? rest.slice(lineEnd + 1) : '';
    lines.push(line.replace(/\r$/, ''));
  }
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return [];
  const header = parseCsvLine(nonEmpty[0]);
  return nonEmpty.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => (row[h] = values[i] ?? ''));
    return row;
  });
}

function loadRankingAlerts() {
  const content = readFileSync(RANKING_CSV_PATH, 'utf-8');
  const rows = parseCsv(content);
  return rows
    .filter((r) => {
      const v = r.ratio_alert;
      if (v === '' || v === undefined || v === 'NA') return false;
      const n = Number(v);
      return !Number.isNaN(n) && n >= 1;
    })
    .map((r) => ({
      category: r.category,
      pref: r.pref,
      ratio_alert: Number(r.ratio_alert),
      current_ma4: Number(r.current_ma4) || 0,
    }));
}

async function fetchSubscriptions() {
  if (!SUBSCRIPTIONS_CSV_URL) {
    console.error('SUBSCRIPTIONS_CSV_URL が設定されていません');
    return [];
  }
  const res = await fetch(SUBSCRIPTIONS_CSV_URL);
  if (!res.ok) throw new Error(`登録データの取得に失敗しました: ${res.status}`);
  const text = await res.text();
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headerKeys = Object.keys(rows[0]);
  const emailCol = headerKeys.find((k) => /メール|mail|email/i.test(k)) || headerKeys[0];
  const prefCol = headerKeys.find((k) => /都道府県|prefecture|pref/i.test(k)) || headerKeys[1] || headerKeys[0];
  return rows
    .filter((r) => r[emailCol] && String(r[emailCol]).includes('@'))
    .map((r) => ({
      email: String(r[emailCol]).trim(),
      prefectures: String(r[prefCol] || '')
        .split(/[,、\s]+/)
        .map((p) => p.trim())
        .filter(Boolean),
    }));
}

function buildEmailHtml(subscriberEmail, alerts) {
  const rows = alerts
    .map(
      (a) =>
        `<tr><td style="padding:8px;border:1px solid #e2e8f0;">${escapeHtml(a.pref)}</td><td style="padding:8px;border:1px solid #e2e8f0;">${escapeHtml(a.category)}</td><td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${a.ratio_alert.toFixed(2)}</td><td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${a.current_ma4.toFixed(2)}</td></tr>`
    )
    .join('');
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Noto Sans JP', sans-serif; font-size: 14px; line-height: 1.6; color: #0f172a;">
  <p>登録いただいた都道府県のうち、<strong>警報基準（警報基準比1.0以上）を超えた感染症</strong>があります。</p>
  <table style="border-collapse:collapse; margin:16px 0;">
    <thead>
      <tr style="background:#f0f0f0;">
        <th style="padding:8px;border:1px solid #e2e8f0;">都道府県</th>
        <th style="padding:8px;border:1px solid #e2e8f0;">感染症</th>
        <th style="padding:8px;border:1px solid #e2e8f0;">警報基準比</th>
        <th style="padding:8px;border:1px solid #e2e8f0;">定点あたり患者数</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p>詳細はダッシュボードでご確認ください。<br><a href="${escapeHtml(DASHBOARD_URL)}">${escapeHtml(DASHBOARD_URL)}</a></p>
  <p style="margin-top:24px; font-size:12px; color:#64748b;">このメールは、感染症流行状況ダッシュボードのアラート登録により送信されています。登録解除はフォームの案内に従ってください。</p>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendEmail(to, subject, html) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDGRID_FROM, name: '感染症流行状況アラート' },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`SendGrid error: ${res.status} ${err}`);
  }
}

async function main() {
  if (!SENDGRID_API_KEY) {
    console.error('SENDGRID_API_KEY が設定されていません');
    process.exit(1);
  }

  const alerts = loadRankingAlerts();
  console.log(`警報該当: ${alerts.length} 件`);

  if (alerts.length === 0) {
    console.log('送信するアラートはありません');
    return;
  }

  const subscriptions = await fetchSubscriptions();
  console.log(`登録者数: ${subscriptions.length}`);

  const subject = '【感染症アラート】登録都道府県で警報基準を超えた感染症があります';
  let sent = 0;

  for (const sub of subscriptions) {
    const prefSet = new Set(sub.prefectures);
    const myAlerts = alerts.filter((a) => prefSet.has(a.pref));
    if (myAlerts.length === 0) continue;

    const html = buildEmailHtml(sub.email, myAlerts);
    await sendEmail(sub.email, subject, html);
    sent++;
    console.log(`送信: ${sub.email} (${myAlerts.length} 件)`);
  }

  console.log(`完了: ${sent} 通送信`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
