/**
 * Daily email digest — reads the latest analysis.json and sends
 * an HTML briefing to the configured recipient via Gmail SMTP.
 *
 * Structure (조간지 스타일):
 *   1. Header + 요약 바
 *   2. 📈 시장 현황 (SHFE)
 *   3. 💱 환율
 *   4. 📰 주요 뉴스 (10건)
 *   5. 🚨 오늘의 핵심 리스크 (최대 5건 — 전체 소스 통합)
 *   6. Footer → 대시보드 링크
 *
 * Required env vars:
 *   GMAIL_USER         — sender Gmail address
 *   GMAIL_APP_PASSWORD — Gmail app password (16 chars, no spaces)
 *   DIGEST_TO          — recipient email(s), comma-separated for multiple
 *
 * Run: GMAIL_USER=you@gmail.com GMAIL_APP_PASSWORD=xxxx DIGEST_TO=a@x.com,b@x.com node scripts/send-digest.mjs
 */
import { readFile } from 'node:fs/promises';
import { createTransport } from 'nodemailer';

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const TO = process.env.DIGEST_TO;
const DASHBOARD_URL = 'https://busanironseller.github.io/steel-sales-risk-dashboard/';

if (!GMAIL_USER) { console.error('GMAIL_USER is required'); process.exit(1); }
if (!GMAIL_APP_PASSWORD) { console.error('GMAIL_APP_PASSWORD is required'); process.exit(1); }
if (!TO) { console.error('DIGEST_TO is required'); process.exit(1); }

/* ── Load data ── */
const analysis = JSON.parse(
  await readFile(new URL('../public/data/analysis.json', import.meta.url), 'utf8'),
);
const market = JSON.parse(
  await readFile(new URL('../public/data/market.json', import.meta.url), 'utf8'),
);

let fx = null;
try {
  fx = JSON.parse(
    await readFile(new URL('../public/data/fx.json', import.meta.url), 'utf8'),
  );
} catch { /* fx optional */ }

/* ── Helpers ── */
const KST = 'Asia/Seoul';
const now = new Date();
const dateStr = now.toLocaleDateString('ko-KR', { timeZone: KST, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const timeStr = now.toLocaleTimeString('ko-KR', { timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false });

const severityColor = { CRITICAL: '#dc2626', HIGH: '#ef4444', MEDIUM: '#f59e0b', LOW: '#6b7280' };
const directionArrow = { UP: '▲', DOWN: '▼' };
const directionKo = { UP: '상승', DOWN: '하락' };

function pct(v) {
  if (v == null) return '-';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

/**
 * Pick the top N most important impacts across ALL sources
 * (rule-based market signals, event clusters, and AI insights).
 */
function pickTopImpacts(impacts, n = 5) {
  const sevScore = { CRITICAL: 40, HIGH: 30, MEDIUM: 20, LOW: 10 };
  const statusBonus = { ALERT: 5, WATCH: 0, INFO: -5 };

  const scored = impacts
    .filter(imp => {
      // Exclude LOW severity — not interesting for the digest
      if (imp.severity === 'LOW') return false;
      // For AI insights, only include ALERT/WATCH
      if (imp.origin === 'AI_INSIGHT') {
        return imp.assessmentStatus === 'ALERT' || imp.assessmentStatus === 'WATCH';
      }
      return true;
    })
    .map(imp => {
      let score = sevScore[imp.severity] || 0;
      // AI ALERT gets boosted
      if (imp.assessmentStatus) score += (statusBonus[imp.assessmentStatus] || 0);
      // Confidence boost
      if (imp.confidence === 'HIGH') score += 2;
      return { imp, score };
    })
    .sort((a, b) => b.score - a.score);

  // Deduplicate: avoid showing the same event twice. Identity keys, strongest
  // first: originId (signal/cluster/case ID — the actual risk identity), then
  // the fact string (identical for same-signal impacts), then names. The old
  // key led with ruleNameKo, which DIFFERS between rules fired by the same
  // signal (R1A vs R1B) — exactly the duplication it was meant to remove.
  const seen = new Set();
  const result = [];
  for (const { imp } of scored) {
    const key = imp.originId || (imp.fact || imp.canonicalEventTitle || imp.ruleNameKo || imp.ruleName || '').slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(imp);
    if (result.length >= n) break;
  }
  return result;
}

/* ── Build HTML ── */
function buildHtml() {
  const { impacts, salesImpact, newsDigest } = analysis;
  const allHigh = impacts.filter(i => i.severity === 'CRITICAL' || i.severity === 'HIGH');
  const allMed = impacts.filter(i => i.severity === 'MEDIUM');
  const totalSignals = allHigh.length + allMed.length;

  // Top 5 combined from all sources
  const topRisks = pickTopImpacts(impacts, 5);

  // Count today's new articles (KST)
  const todayKST = new Date(now.toLocaleString('en-US', { timeZone: KST }));
  const todayDateStr = `${todayKST.getFullYear()}-${String(todayKST.getMonth() + 1).padStart(2, '0')}-${String(todayKST.getDate()).padStart(2, '0')}`;
  const newArticlesToday = newsDigest.filter(n => (n.publishedAt || '').startsWith(todayDateStr)).length;

  // Market data
  const instruments = market.instruments || {};

  // Top news (latest 10 unique titles)
  const seenTitles = new Set();
  const topNews = [];
  for (const n of newsDigest) {
    const title = n.titleKo || n.title;
    if (seenTitles.has(title)) continue;
    seenTitles.add(title);
    topNews.push(n);
    if (topNews.length >= 10) break;
  }

  return `
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:640px;margin:0 auto;background:#ffffff;">

  <!-- Header -->
  <div style="background:#111827;color:#ffffff;padding:24px 28px;">
    <div style="font-size:11px;letter-spacing:0.15em;color:#9ca3af;margin-bottom:4px;">STEEL RISK INTELLIGENCE</div>
    <div style="font-size:22px;font-weight:700;margin-bottom:6px;">📋 철강 시황 조간 브리핑</div>
    <div style="font-size:13px;color:#d1d5db;">${dateStr} ${timeStr} KST 기준</div>
  </div>

  <!-- Summary Bar -->
  <div style="display:flex;background:#1f2937;padding:14px 28px;gap:20px;">
    <div style="text-align:center;flex:1;">
      <div style="font-size:10px;color:#9ca3af;letter-spacing:0.08em;">위험 신호</div>
      <div style="font-size:20px;font-weight:700;color:#ef4444;">${allHigh.length}건</div>
      <div style="font-size:10px;color:#9ca3af;">HIGH+</div>
    </div>
    <div style="text-align:center;flex:1;">
      <div style="font-size:10px;color:#9ca3af;letter-spacing:0.08em;">주의 신호</div>
      <div style="font-size:20px;font-weight:700;color:#f59e0b;">${allMed.length}건</div>
      <div style="font-size:10px;color:#9ca3af;">MEDIUM</div>
    </div>
    <div style="text-align:center;flex:1;">
      <div style="font-size:10px;color:#9ca3af;letter-spacing:0.08em;">오늘 뉴스</div>
      <div style="font-size:20px;font-weight:700;color:#ffffff;">+${newArticlesToday}건</div>
      <div style="font-size:10px;color:#9ca3af;">총 ${newsDigest.length}건</div>
    </div>
  </div>

  <!-- ① 시장 현황 -->
  <div style="padding:20px 28px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px;">📈 시장 현황 (SHFE)</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <tr style="background:#f9fafb;color:#6b7280;">
        <td style="padding:6px 8px;font-weight:600;">상품</td>
        <td style="padding:6px 8px;text-align:right;font-weight:600;">최종가</td>
        <td style="padding:6px 8px;text-align:right;font-weight:600;">당일</td>
        <td style="padding:6px 8px;text-align:right;font-weight:600;">30분</td>
      </tr>
      ${[
        { name: '열연(HRC)', data: instruments.hrc },
        { name: '아연', data: instruments.zinc },
        { name: '알루미늄', data: instruments.aluminium },
        { name: '철광석', data: instruments.ironOre },
        { name: '원료탄', data: instruments.cokingCoal },
      ].map(({ name, data }) => {
        if (!data) return '';
        const c = data.change || {};
        const color = v => v > 0 ? '#dc2626' : v < 0 ? '#2563eb' : '#6b7280';
        return `<tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:6px 8px;font-weight:500;">${name}</td>
          <td style="padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums;">${data.last?.toLocaleString() ?? '-'}</td>
          <td style="padding:6px 8px;text-align:right;color:${color(c.today)};font-variant-numeric:tabular-nums;">${pct(c.today)}</td>
          <td style="padding:6px 8px;text-align:right;color:${color(c.m30)};font-variant-numeric:tabular-nums;">${pct(c.m30)}</td>
        </tr>`;
      }).join('')}
    </table>
  </div>

  ${fx ? `
  <!-- ② 환율 -->
  <div style="padding:20px 28px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px;">💱 환율</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <tr style="background:#f9fafb;color:#6b7280;">
        <td style="padding:6px 8px;font-weight:600;">통화</td>
        <td style="padding:6px 8px;text-align:right;font-weight:600;">현재</td>
        <td style="padding:6px 8px;text-align:right;font-weight:600;">1일</td>
        <td style="padding:6px 8px;text-align:right;font-weight:600;">1주</td>
      </tr>
      ${(fx.pairs || []).map(p => {
        const color = v => v > 0 ? '#dc2626' : v < 0 ? '#2563eb' : '#6b7280';
        return `<tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:6px 8px;font-weight:500;">${p.labelKo || p.label}</td>
          <td style="padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums;">${p.rate ?? '-'}</td>
          <td style="padding:6px 8px;text-align:right;color:${color(p.change1d)};font-variant-numeric:tabular-nums;">${pct(p.change1d)}</td>
          <td style="padding:6px 8px;text-align:right;color:${color(p.change1w)};font-variant-numeric:tabular-nums;">${pct(p.change1w)}</td>
        </tr>`;
      }).join('')}
    </table>
  </div>` : ''}

  <!-- ③ 주요 뉴스 -->
  <div style="padding:20px 28px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px;">📰 주요 뉴스</div>
    ${topNews.map((n, i) => `
    <div style="margin-bottom:8px;padding-bottom:8px;${i < topNews.length - 1 ? 'border-bottom:1px solid #f3f4f6;' : ''}">
      <div style="display:flex;align-items:flex-start;gap:8px;">
        <span style="background:#e5e7eb;color:#374151;font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap;">${n.theme}</span>
        <div>
          <a href="${n.link}" style="font-size:12px;color:#111827;text-decoration:none;font-weight:500;">${n.titleKo || n.title}</a>
          <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${n.source} · ${n.publishedAt}</div>
        </div>
      </div>
    </div>`).join('')}
  </div>

  <!-- ④ 오늘의 핵심 리스크 (top 5) -->
  <div style="padding:20px 28px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:4px;">🚨 오늘의 핵심 리스크</div>
    <div style="font-size:10px;color:#9ca3af;margin-bottom:12px;">규칙 + AI 분석 통합 · 전체 ${totalSignals}건 중 상위 ${topRisks.length}건</div>
    ${topRisks.map(imp => {
      const isAI = imp.origin === 'AI_INSIGHT';
      const bgColor = imp.severity === 'CRITICAL' || imp.severity === 'HIGH' ? '#fef2f2' : '#fffbeb';
      const borderColor = imp.severity === 'CRITICAL' || imp.severity === 'HIGH' ? '#fecaca' : '#fde68a';
      const label = imp.ruleNameKo || imp.ruleName || imp.canonicalEventTitle || '';
      const factText = imp.threat || imp.fact || '';
      const sourceTag = isAI ? (imp.assessmentStatus === 'ALERT' ? '🔴 AI' : '🟡 AI') : '📊 규칙';
      const products = imp.products?.length ? imp.products.join(' · ') : '';
      const regions = imp.regions?.length ? imp.regions.join(' · ') : '';
      const meta = [products, regions].filter(Boolean).join(' | ');

      return `
    <div style="background:${bgColor};border:1px solid ${borderColor};border-radius:8px;padding:12px 14px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
        <span style="background:${severityColor[imp.severity]};color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;">${imp.severity}</span>
        <span style="font-size:10px;color:#6b7280;font-weight:600;">${sourceTag}</span>
        ${imp.direction ? `<span style="font-size:10px;color:${imp.direction === 'UP' ? '#dc2626' : '#2563eb'};font-weight:600;">${directionArrow[imp.direction] || ''} ${directionKo[imp.direction] || ''}</span>` : ''}
      </div>
      <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:3px;">${label}</div>
      <div style="font-size:11px;color:#4b5563;margin-bottom:3px;">${factText.length > 120 ? factText.slice(0, 120) + '…' : factText}</div>
      ${meta ? `<div style="font-size:10px;color:#9ca3af;">${meta}</div>` : ''}
    </div>`;
    }).join('')}

    <div style="text-align:center;margin-top:12px;">
      <a href="${DASHBOARD_URL}" style="font-size:12px;color:#3b82f6;text-decoration:none;font-weight:600;">
        나머지 ${Math.max(0, totalSignals - topRisks.length)}건 대시보드에서 보기 →
      </a>
    </div>
  </div>

  <!-- Footer -->
  <div style="padding:20px 28px;background:#f9fafb;text-align:center;">
    <a href="${DASHBOARD_URL}" style="display:inline-block;background:#111827;color:#ffffff;font-size:13px;font-weight:600;padding:10px 24px;border-radius:6px;text-decoration:none;">
      대시보드 전체 보기 →
    </a>
    <div style="font-size:10px;color:#9ca3af;margin-top:12px;">
      본 이메일은 Steel Sales Risk Intelligence에서 자동 발송됩니다.<br/>
      데이터: SHFE · Sina · Google News · Yahoo Finance
    </div>
    <div style="font-size:9px;color:#d1d5db;margin-top:8px;">
      분석 생성: ${analysis.generatedAt}
    </div>
  </div>

</div>
</body>
</html>`;
}

/* ── Build plain-text version (helps avoid spam filters) ── */
function buildPlainText() {
  const { impacts, newsDigest } = analysis;
  const allHigh = impacts.filter(i => i.severity === 'CRITICAL' || i.severity === 'HIGH');
  const allMed = impacts.filter(i => i.severity === 'MEDIUM');
  const instruments = market.instruments || {};
  const topRisks = pickTopImpacts(impacts, 5);

  // Count today's new articles (KST)
  const todayKST2 = new Date(now.toLocaleString('en-US', { timeZone: KST }));
  const todayDateStr2 = `${todayKST2.getFullYear()}-${String(todayKST2.getMonth() + 1).padStart(2, '0')}-${String(todayKST2.getDate()).padStart(2, '0')}`;
  const newToday = newsDigest.filter(n => (n.publishedAt || '').startsWith(todayDateStr2)).length;

  let text = `철강 시황 조간 브리핑\n${dateStr} ${timeStr} KST 기준\n\n`;
  text += `위험 ${allHigh.length}건 (HIGH+) / 주의 ${allMed.length}건 / 오늘 뉴스 +${newToday}건 (총 ${newsDigest.length}건)\n\n`;

  // ① 시장 현황
  text += `--- 시장 현황 ---\n`;
  for (const { name, data } of [
    { name: '열연(HRC)', data: instruments.hrc },
    { name: '아연', data: instruments.zinc },
    { name: '알루미늄', data: instruments.aluminium },
    { name: '철광석', data: instruments.ironOre },
    { name: '원료탄', data: instruments.cokingCoal },
  ]) {
    if (!data) continue;
    text += `${name}: ${data.last?.toLocaleString() ?? '-'} (당일 ${pct(data.change?.today)}, 30분 ${pct(data.change?.m30)})\n`;
  }

  // ② 환율
  if (fx?.pairs?.length) {
    text += `\n--- 환율 ---\n`;
    for (const p of fx.pairs) {
      text += `${p.labelKo || p.label}: ${p.rate ?? '-'} (1일 ${pct(p.change1d)}, 1주 ${pct(p.change1w)})\n`;
    }
  }

  // ③ 주요 뉴스
  const seenTitles = new Set();
  const topNews = [];
  for (const n of newsDigest) {
    const title = n.titleKo || n.title;
    if (seenTitles.has(title)) continue;
    seenTitles.add(title);
    topNews.push(n);
    if (topNews.length >= 10) break;
  }
  text += `\n--- 주요 뉴스 ---\n`;
  for (const n of topNews) {
    text += `[${n.theme}] ${n.titleKo || n.title} (${n.source}, ${n.publishedAt})\n`;
  }

  // ④ 핵심 리스크
  text += `\n--- 오늘의 핵심 리스크 (상위 ${topRisks.length}건 / 전체 ${allHigh.length + allMed.length}건) ---\n`;
  for (const imp of topRisks) {
    const isAI = imp.origin === 'AI_INSIGHT';
    const label = imp.ruleNameKo || imp.ruleName || imp.canonicalEventTitle || '';
    const fact = imp.threat || imp.fact || '';
    text += `[${imp.severity}]${isAI ? ' [AI]' : ''} ${label}\n`;
    text += `  ${fact.length > 100 ? fact.slice(0, 100) + '…' : fact}\n`;
    const products = imp.products?.length ? imp.products.join('/') : '';
    const regions = imp.regions?.length ? imp.regions.join('/') : '';
    if (products || regions) text += `  ${[products, regions].filter(Boolean).join(' | ')}\n`;
  }

  text += `\n대시보드: ${DASHBOARD_URL}\n`;
  text += `\n본 메일은 철강 시황 분석 시스템에서 자동 발송됩니다.\n`;
  return text;
}

/* ── Send via Gmail SMTP ── */
async function sendEmail() {
  const html = buildHtml();
  const text = buildPlainText();
  const senderName = process.env.SENDER_NAME || '철강시황브리핑';
  const highCount = analysis.impacts.filter(i => i.severity === 'CRITICAL' || i.severity === 'HIGH').length;
  const subject = `철강 시황 브리핑 ${dateStr} - 위험신호 ${highCount}건`;

  console.log(`Sending digest to ${TO} from ${GMAIL_USER}...`);
  console.log(`Subject: ${subject}`);

  const transporter = createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });

  const info = await transporter.sendMail({
    from: `${senderName} <${GMAIL_USER}>`,
    to: TO,
    subject,
    html,
    text,  // plain-text alternative — reduces spam score
    headers: {
      'X-Priority': '3',        // normal priority (not bulk)
      'X-Mailer': 'NodeMailer', // standard mailer tag
    },
  });

  console.log(`✅ Email sent: messageId=${info.messageId}`);
}

sendEmail().catch((err) => {
  console.error('send-digest failed:', err);
  process.exit(1);
});
