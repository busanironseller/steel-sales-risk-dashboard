/**
 * Daily email digest — reads the latest analysis.json and sends
 * an HTML briefing to the configured recipient via Gmail SMTP.
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

/* ── Build HTML ── */
function buildHtml() {
  const { impacts, criticalSignals, salesImpact, eventClusters, marketSignals, newsDigest, aiEnabled } = analysis;
  const highImpacts = impacts.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH');
  const medImpacts = impacts.filter((i) => i.severity === 'MEDIUM');
  // AI insights — only ALERT and WATCH go into the email (no INFO/IGNORE noise)
  const aiInsights = impacts.filter((i) => i.origin === 'AI_INSIGHT' && (!i.assessmentStatus || i.assessmentStatus === 'ALERT' || i.assessmentStatus === 'WATCH'));

  // Count today's new articles vs total (KST-based date)
  const todayKST = new Date(now.toLocaleString('en-US', { timeZone: KST }));
  const todayDateStr = `${todayKST.getFullYear()}-${String(todayKST.getMonth() + 1).padStart(2, '0')}-${String(todayKST.getDate()).padStart(2, '0')}`;
  const newArticlesToday = newsDigest.filter((n) => (n.publishedAt || '').startsWith(todayDateStr)).length;

  // Market data
  const instruments = market.instruments || {};
  const hrc = instruments.hrc;
  const zinc = instruments.zinc;
  const al = instruments.aluminium;

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
    <div style="font-size:22px;font-weight:700;margin-bottom:6px;">📋 일일 리스크 브리핑</div>
    <div style="font-size:13px;color:#d1d5db;">${dateStr} ${timeStr} KST 기준</div>
  </div>

  <!-- Summary Bar -->
  <div style="display:flex;background:#1f2937;padding:14px 28px;gap:20px;">
    <div style="text-align:center;flex:1;">
      <div style="font-size:10px;color:#9ca3af;letter-spacing:0.08em;">위험 신호</div>
      <div style="font-size:20px;font-weight:700;color:#ef4444;">${highImpacts.length}건</div>
      <div style="font-size:10px;color:#9ca3af;">HIGH+</div>
    </div>
    <div style="text-align:center;flex:1;">
      <div style="font-size:10px;color:#9ca3af;letter-spacing:0.08em;">주의 신호</div>
      <div style="font-size:20px;font-weight:700;color:#f59e0b;">${medImpacts.length}건</div>
      <div style="font-size:10px;color:#9ca3af;">MEDIUM</div>
    </div>
    <div style="text-align:center;flex:1;">
      <div style="font-size:10px;color:#9ca3af;letter-spacing:0.08em;">오늘 뉴스</div>
      <div style="font-size:20px;font-weight:700;color:#ffffff;">+${newArticlesToday}건</div>
      <div style="font-size:10px;color:#9ca3af;">총 ${newsDigest.length}건</div>
    </div>
  </div>

  <!-- Section: Market Pulse -->
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
        { name: '열연(HRC)', data: hrc },
        { name: '아연', data: zinc },
        { name: '알루미늄', data: al },
        { name: '철광석', data: instruments.ironOre },
        { name: '원료탄', data: instruments.cokingCoal },
      ].map(({ name, data }) => {
        if (!data) return '';
        const c = data.change || {};
        const todayPct = c.today;
        const m30Pct = c.m30;
        const color = (v) => v > 0 ? '#dc2626' : v < 0 ? '#2563eb' : '#6b7280';
        return `<tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:6px 8px;font-weight:500;">${name}</td>
          <td style="padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums;">${data.last?.toLocaleString() ?? '-'}</td>
          <td style="padding:6px 8px;text-align:right;color:${color(todayPct)};font-variant-numeric:tabular-nums;">${pct(todayPct)}</td>
          <td style="padding:6px 8px;text-align:right;color:${color(m30Pct)};font-variant-numeric:tabular-nums;">${pct(m30Pct)}</td>
        </tr>`;
      }).join('')}
    </table>
  </div>

  ${fx ? `
  <!-- Section: FX -->
  <div style="padding:20px 28px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px;">💱 환율</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <tr style="background:#f9fafb;color:#6b7280;">
        <td style="padding:6px 8px;font-weight:600;">통화</td>
        <td style="padding:6px 8px;text-align:right;font-weight:600;">현재</td>
        <td style="padding:6px 8px;text-align:right;font-weight:600;">1일</td>
        <td style="padding:6px 8px;text-align:right;font-weight:600;">1주</td>
      </tr>
      ${(fx.pairs || []).map((p) => {
        const color = (v) => v > 0 ? '#dc2626' : v < 0 ? '#2563eb' : '#6b7280';
        return `<tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:6px 8px;font-weight:500;">${p.labelKo || p.label}</td>
          <td style="padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums;">${p.rate ?? '-'}</td>
          <td style="padding:6px 8px;text-align:right;color:${color(p.change1d)};font-variant-numeric:tabular-nums;">${pct(p.change1d)}</td>
          <td style="padding:6px 8px;text-align:right;color:${color(p.change1w)};font-variant-numeric:tabular-nums;">${pct(p.change1w)}</td>
        </tr>`;
      }).join('')}
    </table>
  </div>` : ''}

  <!-- Section: Critical Signals -->
  <div style="padding:20px 28px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px;">🚨 핵심 위험 신호 (${highImpacts.length}건)</div>
    ${highImpacts.map((imp) => `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 14px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="background:${severityColor[imp.severity]};color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;">${imp.severity}</span>
        <span style="font-size:10px;color:#ef4444;font-weight:600;">${directionArrow[imp.direction] || ''} ${directionKo[imp.direction] || ''}</span>
        <span style="font-size:10px;color:#6b7280;">${imp.riskTypeKo}</span>
      </div>
      <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:4px;">${imp.ruleNameKo}</div>
      <div style="font-size:11px;color:#4b5563;margin-bottom:4px;">${imp.fact}</div>
      <div style="font-size:10px;color:#6b7280;">
        제품: ${imp.products.join(' · ')} | 지역: ${imp.regions.join(' · ')}
      </div>
    </div>`).join('')}

    ${medImpacts.length > 0 ? `
    <div style="font-size:13px;font-weight:700;color:#111827;margin-top:16px;margin-bottom:12px;">⚠️ 주의 신호 (${medImpacts.length}건)</div>
    ${medImpacts.map((imp) => `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="background:${severityColor[imp.severity]};color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;">${imp.severity}</span>
        <span style="font-size:12px;font-weight:600;color:#111827;">${imp.ruleNameKo}</span>
      </div>
      <div style="font-size:11px;color:#4b5563;">${imp.fact}</div>
    </div>`).join('')}` : ''}
  </div>

  <!-- Section: Sales Impact Top 5 -->
  <div style="padding:20px 28px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px;">📊 판매 영향 요약 (상위 5건 / 총 ${salesImpact.length}건)</div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <tr style="background:#f9fafb;color:#6b7280;">
        <td style="padding:6px 8px;font-weight:600;">지역</td>
        <td style="padding:6px 8px;font-weight:600;">제품</td>
        <td style="padding:6px 8px;font-weight:600;">리스크</td>
        <td style="padding:6px 8px;font-weight:600;">위험도</td>
        <td style="padding:6px 8px;font-weight:600;">필요 조치</td>
      </tr>
      ${salesImpact.slice(0, 5).map((s) => `
      <tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:6px 8px;">${s.region}</td>
        <td style="padding:6px 8px;font-size:10px;">${s.products.join('/')}</td>
        <td style="padding:6px 8px;">${s.riskTypeKo}</td>
        <td style="padding:6px 8px;"><span style="background:${severityColor[s.severity]};color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;">${s.severity}</span></td>
        <td style="padding:6px 8px;font-size:10px;">${s.action}</td>
      </tr>`).join('')}
    </table>
  </div>

  ${aiInsights.length > 0 ? `
  <!-- Section: AI Insights (ALERT/WATCH only) -->
  <div style="padding:20px 28px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px;">🤖 AI 리스크 인사이트 (${aiInsights.length}건)</div>
    <div style="font-size:10px;color:#9ca3af;margin-bottom:10px;">규칙 엔진이 포착하지 못하는 간접적·구조적 리스크를 AI가 분석했습니다. (ALERT/WATCH만 표시)</div>
    ${aiInsights.map((ai) => {
      const statusBadge = ai.assessmentStatus === 'ALERT' ? '🔴 ALERT' : ai.assessmentStatus === 'WATCH' ? '🟡 WATCH' : '';
      const statusBg = ai.assessmentStatus === 'ALERT' ? '#fef2f2' : '#eff6ff';
      const statusBorder = ai.assessmentStatus === 'ALERT' ? '#fecaca' : '#bfdbfe';
      return `
    <div style="background:${statusBg};border:1px solid ${statusBorder};border-radius:8px;padding:12px 14px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="background:${severityColor[ai.severity] || '#6b7280'};color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;">${ai.severity}</span>
        <span style="font-size:10px;color:#3b82f6;font-weight:600;">${statusBadge || '🤖 AI'}</span>
        <span style="font-size:10px;color:#6b7280;">${ai.riskTypeKo || ai.riskType}</span>
        ${ai.timeHorizon && ai.timeHorizon !== 'UNKNOWN' ? `<span style="font-size:9px;color:#9ca3af;">⏱ ${ai.timeHorizon}</span>` : ''}
      </div>
      <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:4px;">${ai.ruleNameKo}</div>
      ${ai.threat ? `<div style="font-size:11px;color:#4b5563;margin-bottom:4px;">⚠ ${ai.threat}</div>` : ''}
      ${ai.opportunity ? `<div style="font-size:11px;color:#047857;margin-bottom:4px;">💡 ${ai.opportunity}</div>` : ''}
      ${ai.facts?.length ? `<div style="font-size:10px;color:#374151;margin-bottom:4px;">✓ 확인된 사실: ${ai.facts.slice(0, 2).join('; ')}</div>` : ''}
      ${ai.missingEvidence?.length ? `<div style="font-size:10px;color:#9ca3af;margin-bottom:4px;">❓ 부족: ${ai.missingEvidence.slice(0, 2).join('; ')}</div>` : ''}
      ${ai.causalChainDetailed?.length ? `<div style="font-size:10px;color:#6b7280;margin-bottom:4px;">📎 ${ai.causalChainDetailed.map(c => c.step + (c.state === 'CONFIRMED' ? '✓' : c.state === 'CONDITIONAL' ? '?' : '…')).join(' → ')}</div>` : (ai.chainKo?.length ? `<div style="font-size:10px;color:#6b7280;margin-bottom:4px;">📎 ${ai.chainKo.join(' → ')}</div>` : '')}
      <div style="font-size:10px;color:#6b7280;">
        제품: ${ai.products?.length ? ai.products.join(' · ') : '미정'} | 지역: ${ai.regions?.length ? ai.regions.join(' · ') : '미정'}
      </div>
      ${ai.actionsKo?.length ? `<div style="font-size:10px;color:#2563eb;margin-top:4px;">💡 ${ai.actionsKo[0]}</div>` : (ai.actions?.length ? `<div style="font-size:10px;color:#2563eb;margin-top:4px;">💡 ${ai.actions[0]}</div>` : '')}
      ${ai.watchSignals?.length ? `<div style="font-size:9px;color:#9ca3af;margin-top:4px;">👁 모니터링: ${ai.watchSignals.slice(0, 2).join(', ')}</div>` : ''}
    </div>`;
    }).join('')}
  </div>` : ''}

  <!-- Section: Top News -->
  <div style="padding:20px 28px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px;">📰 주요 뉴스 (최신 10건)</div>
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

  <!-- Footer -->
  <div style="padding:20px 28px;background:#f9fafb;text-align:center;">
    <a href="${DASHBOARD_URL}" style="display:inline-block;background:#111827;color:#ffffff;font-size:13px;font-weight:600;padding:10px 24px;border-radius:6px;text-decoration:none;">
      대시보드 전체 보기 →
    </a>
    <div style="font-size:10px;color:#9ca3af;margin-top:12px;">
      본 이메일은 Steel Sales Risk Intelligence Dashboard에서 자동 발송됩니다.<br/>
      데이터 출처: SHFE (지연), Sina Finance (비공식), Google News RSS, Yahoo Finance
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
  const { impacts, salesImpact, newsDigest } = analysis;
  const highImpacts = impacts.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH');
  const medImpacts = impacts.filter((i) => i.severity === 'MEDIUM');
  const instruments = market.instruments || {};

  // Count today's new articles (KST)
  const todayKST2 = new Date(now.toLocaleString('en-US', { timeZone: KST }));
  const todayDateStr2 = `${todayKST2.getFullYear()}-${String(todayKST2.getMonth() + 1).padStart(2, '0')}-${String(todayKST2.getDate()).padStart(2, '0')}`;
  const newToday = newsDigest.filter((n) => (n.publishedAt || '').startsWith(todayDateStr2)).length;

  let text = `철강 시황 일일 브리핑\n${dateStr} ${timeStr} KST 기준\n\n`;
  text += `위험 신호 ${highImpacts.length}건 (HIGH+) / 주의 ${medImpacts.length}건 / 오늘 뉴스 +${newToday}건 (총 ${newsDigest.length}건)\n\n`;

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

  if (highImpacts.length > 0) {
    text += `\n--- 핵심 위험 신호 ---\n`;
    for (const imp of highImpacts) {
      text += `[${imp.severity}] ${imp.ruleNameKo} - ${imp.fact}\n`;
      text += `  제품: ${imp.products.join('/')} | 지역: ${imp.regions.join('/')}\n`;
    }
  }

  text += `\n--- 판매 영향 상위 5건 ---\n`;
  for (const s of salesImpact.slice(0, 5)) {
    text += `${s.region} | ${s.products.join('/')} | ${s.severity} | ${s.action}\n`;
  }

  // AI insights section (ALERT/WATCH only — no INFO/IGNORE noise)
  const aiInsights = impacts.filter((i) => i.origin === 'AI_INSIGHT' && (!i.assessmentStatus || i.assessmentStatus === 'ALERT' || i.assessmentStatus === 'WATCH'));
  if (aiInsights.length > 0) {
    text += `\n--- AI 리스크 인사이트 (${aiInsights.length}건, ALERT/WATCH) ---\n`;
    for (const ai of aiInsights) {
      const status = ai.assessmentStatus || '';
      text += `[${ai.severity}] [${status}] ${ai.ruleNameKo}\n`;
      if (ai.threat) text += `  ⚠ 위협: ${ai.threat}\n`;
      if (ai.opportunity) text += `  💡 기회: ${ai.opportunity}\n`;
      if (ai.facts?.length) text += `  확인된 사실: ${ai.facts.slice(0, 3).join('; ')}\n`;
      if (ai.missingEvidence?.length) text += `  부족한 근거: ${ai.missingEvidence.slice(0, 2).join('; ')}\n`;
      if (ai.causalChainDetailed?.length) text += `  경로: ${ai.causalChainDetailed.map(c => c.step + '(' + c.state[0] + ')').join(' → ')}\n`;
      text += `  제품: ${ai.products?.length ? ai.products.join('/') : '미정'} | 지역: ${ai.regions?.length ? ai.regions.join('/') : '미정'}\n`;
      if (ai.actionsKo?.[0]) text += `  조치: ${ai.actionsKo[0]}\n`;
      if (ai.watchSignals?.length) text += `  모니터링: ${ai.watchSignals.slice(0, 2).join(', ')}\n`;
    }
  }

  text += `\n대시보드: ${DASHBOARD_URL}\n`;
  text += `\n본 메일은 철강 시황 분석 시스템에서 발송됩니다.\n`;
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
