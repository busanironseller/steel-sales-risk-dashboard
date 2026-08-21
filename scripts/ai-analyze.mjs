/**
 * AI-powered news analysis using Google Gemini 2.5 Flash.
 *
 * Reads all collected articles and asks the LLM to identify steel-business
 * risks that the deterministic rule engine might miss — geopolitical shifts,
 * indirect supply-chain effects, emerging demand signals, etc.
 *
 * Returns Impact[] in the same shape as rule-engine impacts so they merge
 * seamlessly into the dashboard.
 *
 * Required env: GEMINI_API_KEY
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.5-flash';

function geminiUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
}

/* ── Company context baked into the prompt ── */
const COMPANY_CONTEXT = `
## 회사 프로필
- 한국 기반 도금강판 수출 전문 기업 (포스코스틸리온 AL 독점판매)
- 가공 공정: 포스코 열연(HRC) → 냉연(CRC) → 용융도금(GI/GL) → 컬러(COLOR)
- 주요 원재료: HRC(기판), 아연(GI 도금), 알루미늄(GL 도금)
- 수출 시장: 유럽(EU), 중동(GCC/사우디/UAE), 동남아(ASEAN), 미국(US)
- 경쟁국: 터키, 인도, 베트남, 중국

## 제품별 원재료 연관
- CRC: HRC 가격에 직접 연동
- GI (아연도금): HRC + 아연
- GL (갈바륨): HRC + 아연(45%) + 알루미늄(55%)
- COLOR (컬러강판): CRC/GI/GL + 도료

## 리스크 유형
- 원재료 원가 (HRC, 아연, 알루미늄, 철광석, 원료탄)
- 운임/물류 (유가, 해운, 항만, 해협 차단)
- 통상/관세 (반덤핑, 세이프가드, 관세, CBAM)
- 경쟁 (중국 과잉공급, 터키/인도/베트남 수출 확대)
- 수요 변동 (건설, 인프라, 자동차)
- 지정학 (전쟁, 제재, 해협 봉쇄, 양안, 한반도)
- 환율 (원/달러, 원/엔, 원/유로)
- 제재 (이란, 러시아 등)
`.trim();

const SYSTEM_PROMPT = `당신은 한국 도금강판 수출 기업의 시니어 리스크 분석가입니다.

${COMPANY_CONTEXT}

## 임무
아래 뉴스 기사 목록을 읽고, 우리 회사의 철강 수출 비즈니스에 직접적 또는 간접적으로 영향을 줄 수 있는 리스크를 식별하세요.

## 분석 원칙
1. **직접 연관뿐 아니라 간접 연관도 포착**: "양안 긴장 → 대만해협 봉쇄 가능성 → 동아시아 해운 마비 → 원재료 공급 차질"처럼 2~3단계 인과관계도 추론
2. **기존 규칙이 놓치는 영역 집중**: 지정학, 자연재해, 환율 급변, 수요 구조 변화, 신규 무역장벽 등
3. **구체적 근거 제시**: 어떤 기사(번호)에서 어떤 정보를 읽었는지 명시
4. **과도한 해석 금지**: 실제 기사 내용에 근거한 분석만. 추측성 위험은 confidence를 LOW로

## 출력 형식 (JSON)
반드시 아래 형식의 JSON 배열을 반환하세요. 리스크가 없으면 빈 배열 [].

[
  {
    "title": "리스크 제목 (한국어, 간결하게)",
    "severity": "CRITICAL | HIGH | MEDIUM | LOW",
    "confidence": "HIGH | MEDIUM | LOW",
    "direction": "UP | DOWN",
    "riskType": "리스크 유형 (한국어)",
    "products": ["CRC", "GI", "GL", "COLOR"] 중 해당되는 것,
    "regions": ["Europe", "GCC", "Asia", "US", "Korea Export"] 중 해당되는 것,
    "chain": ["원인 → 중간단계 → 결과"] 인과관계 체인 (한국어, 3~5단계),
    "narrative": "이 리스크가 우리 비즈니스에 미치는 영향을 2~3문장으로 설명 (한국어)",
    "actions": ["권장 대응 조치 1", "권장 대응 조치 2"] (한국어),
    "evidenceIndices": [기사 번호들],
    "reasoning": "왜 이것이 철강 수출에 영향을 주는지 한 문장 설명"
  }
]

## 중요
- 이미 명확한 철강 가격/관세/경쟁국 뉴스는 기존 규칙 엔진이 처리합니다. 당신은 규칙이 놓치는 **간접적, 구조적, 지정학적** 리스크에 집중하세요.
- CRITICAL은 사업 중단 수준(해협 봉쇄, 전쟁, 전면 제재)에만 사용
- 최대 10개까지만 출력 (가장 중요한 순서로)
- JSON만 출력. 다른 텍스트 없이.`;

/**
 * Call Gemini 2.5 Flash and return parsed AI risk assessments.
 *
 * @param {Array} articles — full news article list from news.json
 * @param {Array} existingImpactIds — rule-engine impact IDs for dedup reference
 * @returns {Array} impacts in dashboard-compatible format
 */
export async function aiAnalyze(articles, existingImpactIds = []) {
  if (!GEMINI_API_KEY) {
    console.log('  ai       GEMINI_API_KEY not set — skipping AI analysis');
    return [];
  }

  // Prepare article list for the prompt (title + source + date)
  const articleLines = articles.map((a, i) =>
    `[${i + 1}] ${a.title}${a.titleKo ? ' / ' + a.titleKo : ''} (${a.source}, ${a.publishedAt?.slice(0, 10)})`
  );

  // Split into chunks if too many articles (keep under ~800K tokens)
  const CHUNK_SIZE = 300;
  const chunks = [];
  for (let i = 0; i < articleLines.length; i += CHUNK_SIZE) {
    chunks.push(articleLines.slice(i, i + CHUNK_SIZE));
  }

  const allRisks = [];

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const userPrompt = `## 뉴스 기사 목록 (${chunk.length}건)\n\n${chunk.join('\n')}\n\n위 기사들에서 철강 수출 비즈니스에 영향을 줄 수 있는 리스크를 분석해주세요.`;

    console.log(`  ai       chunk ${ci + 1}/${chunks.length} — ${chunk.length} articles → Gemini...`);

    try {
      const res = await fetch(geminiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + userPrompt }] },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.3,
            maxOutputTokens: 8192,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`  ai       Gemini API error ${res.status}: ${errText.slice(0, 200)}`);
        continue;
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        console.error('  ai       Gemini returned empty response');
        continue;
      }

      // Parse JSON (Gemini should return clean JSON with responseMimeType)
      let risks;
      try {
        risks = JSON.parse(text);
        if (!Array.isArray(risks)) risks = [risks];
      } catch (parseErr) {
        // Try extracting JSON from markdown code block
        const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) {
          risks = JSON.parse(match[1]);
          if (!Array.isArray(risks)) risks = [risks];
        } else {
          console.error('  ai       Failed to parse Gemini response as JSON');
          continue;
        }
      }

      allRisks.push(...risks);
    } catch (err) {
      console.error(`  ai       Gemini call failed: ${err.message}`);
    }
  }

  if (allRisks.length === 0) {
    console.log('  ai       No AI risks identified');
    return [];
  }

  // Convert to dashboard Impact format
  const impacts = allRisks
    .filter((r) => r && r.title && r.severity)
    .slice(0, 10)
    .map((r, i) => {
      const severity = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(r.severity) ? r.severity : 'MEDIUM';
      const confidence = ['HIGH', 'MEDIUM', 'LOW'].includes(r.confidence) ? r.confidence : 'MEDIUM';
      const direction = r.direction === 'DOWN' ? 'DOWN' : 'UP';
      const products = (r.products || []).filter((p) => ['CRC', 'GI', 'GL', 'COLOR'].includes(p));
      const regions = (r.regions || []).filter((reg) =>
        ['Europe', 'GCC', 'Asia', 'US', 'Korea Export'].includes(reg)
      );

      // Build evidence from article indices
      const evidence = (r.evidenceIndices || [])
        .filter((idx) => idx >= 1 && idx <= articles.length)
        .slice(0, 5)
        .map((idx) => {
          const a = articles[idx - 1];
          return {
            id: a.id,
            title: a.title,
            titleKo: a.titleKo ?? null,
            source: a.source,
            publishedAt: a.publishedAt,
            link: a.link,
          };
        });

      return {
        id: `IM_AI_${String(i + 1).padStart(2, '0')}`,
        ruleId: `AI_${String(i + 1).padStart(2, '0')}`,
        ruleName: r.title,
        ruleNameKo: r.title,
        origin: 'AI_INSIGHT',
        originId: `AI_ANALYSIS_${Date.now()}`,
        severity,
        confidence,
        direction,
        riskType: r.riskType || '기타',
        riskTypeKo: r.riskType || '기타',
        products: products.length > 0 ? products : ['CRC', 'GI', 'GL', 'COLOR'],
        regions: regions.length > 0 ? regions : ['Europe', 'GCC', 'Asia', 'US'],
        chain: r.chain || [],
        chainKo: r.chain || [],
        lagNote: null,
        lagNoteKo: null,
        narrativeKo: r.narrative || null,
        fact: r.reasoning || r.title,
        factSource: 'AI 분석 (Gemini 2.5 Flash)',
        factTimestamp: new Date().toISOString(),
        rule: (r.chain || []).join(' → '),
        inference:
          `${(regions.length > 0 ? regions : ['전체']).join('/')} 향 ${(products.length > 0 ? products : ['전 제품']).join('/')} 거래에서 ` +
          `${r.riskType || '복합'} 리스크가 ${direction === 'UP' ? '상승' : '하락'}할 가능성이 있습니다. ` +
          `(AI 분석 기반 추론이며, 실제 영향은 개별 확인이 필요합니다)`,
        actions: r.actions || [],
        actionsKo: r.actions || [],
        evidence,
      };
    });

  console.log(`  ai       ${impacts.length} AI risk(s) identified`);
  for (const imp of impacts) {
    console.log(`             ${imp.severity.padEnd(8)} ${imp.ruleNameKo}`);
  }

  return impacts;
}
