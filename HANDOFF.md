# Steel Sales Risk Dashboard — 인수인계서

> **작성일**: 2026-08-18 (월)  
> **마감**: 2026-08-20 (수) 발표  
> **라이브 URL**: https://busanironseller.github.io/steel-sales-risk-dashboard/  
> **GitHub**: https://github.com/busanironseller/steel-sales-risk-dashboard (public, branch: `master`)  
> **로컬 경로**: `C:\Users\admin\Downloads\260818 AI 활용 전문가 과정 최종 과제`

---

## 1. 프로젝트 개요

도금/컬러강판(CRC/GI/GL/PPGI/Color) 수출영업을 위한 **철강 판매 리스크 인텔리전스 & 조기경보 대시보드**.

- SHFE HRC 선물 실제 데이터 + Google News RSS 메타데이터 기반
- 9개 인과 규칙(R1-R9)을 통한 rule-based 영향도 분석
- FACT/RULE/INFERENCE/ACTION 인식론적 구분
- PGlite (WASM PostgreSQL → IndexedDB) 기반 Issue 관리
- GitHub Actions로 30분마다 자동 데이터 수집 → 자동 배포

---

## 2. 현재 완료된 것

### ✅ 완전 작동 중
| 항목 | 상태 |
|------|------|
| SHFE 공식 지연 데이터 수집 (HRC/철근/아연/알루미늄) | ✅ |
| Sina Finance 차트 히스토리 백필 (DCE 철광석/원료탄 포함) | ✅ |
| 유동성 점수로 주력 계약월 자동 선정 (0.6×OI + 0.4×Vol) | ✅ |
| 세션 브레이크 제외 30분봉 구축 | ✅ |
| Google News RSS 9개 도메인 수집 | ✅ |
| Jaccard 유사도(≥0.6) 기반 중복 제거 + 도메인 통합 | ✅ |
| 관련성 필터링 (strong/contextual/negative 용어 점수) | ✅ |
| 9개 규칙 기반 이벤트 클러스터링 | ✅ |
| 시장 신호 + 뉴스 클러스터 reconciliation | ✅ |
| Region×Product Sales Impact 테이블 | ✅ |
| PGlite Issue 생성/상태관리/삭제 (새로고침 후에도 유지) | ✅ |
| lightweight-charts 캔들차트 (SHFE=진한봉, 백필=연한봉) | ✅ |
| GitHub Pages 배포 | ✅ |
| GitHub Actions cron 30분 자동 수집 (`collect.yml`) | ✅ |
| workflow_run 체이닝으로 수집 → 자동 재배포 (`deploy.yml`) | ✅ |
| 데이터 출처(provenance) 표시 | ✅ |

### 🔴 아직 안 된 것 (우선순위 순)
| 항목 | 설명 | 난이도 |
|------|------|--------|
| **UI 비주얼 폴리시** | 현재 기능은 다 되지만 "쌈뽕한" B2B 터미널 느낌이 부족. 레퍼런스: https://supply-guard-risk-monitor.vercel.app/ | 🟡 중 |
| **Period/Region/Product 필터** | 레퍼런스 사이트에 있는 필터 컨트롤 없음 | 🟡 중 |
| **HRC Market Signal 임계값 튜닝** | 현재 HRC m120 ±2.0%, m60 ±1.2% → 일반적 장중 변동에선 0개 시그널. 실용적 민감도 조정 필요 | 🟢 쉬움 |
| **뉴스 클러스터 세분화** | "Hormuz 29건"이 하나로 뭉침 → 개별 이벤트로 분리 필요 | 🟡 중 |
| **모바일 반응형** | 기본 테이블은 overflow-x-auto지만 작은 화면 최적화 안 됨 | 🟡 중 |
| **Daily Brief (§16)** | 프롬프트에 명시됐으나 미구현 | 🔴 높음 |
| **FX 데이터 (§17)** | USD/KRW, EUR/USD 환율 Market Pulse에 포함 안 됨 | 🟡 중 |
| **다크 모드** | 현재 라이트 모드만 | 🟢 쉬움 |

---

## 3. 파일 구조 & 역할

```
📁 프로젝트 루트
├── 📁 .github/workflows/
│   ├── collect.yml        # GitHub Actions cron: 30분마다 데이터 수집 → git push
│   └── deploy.yml         # push 또는 collect 완료 시 → vite build → GitHub Pages 배포
│
├── 📁 scripts/            # Node.js 수집·분석 파이프라인 (ESM .mjs)
│   ├── sources.mjs        # 공유 소스 정의: 6개 선물, 9개 뉴스 RSS 쿼리, URL 빌더
│   ├── shfe.mjs           # SHFE 공식 어댑터: 세션, 주력계약 선정, 30분봉 빌드
│   ├── collect-market.mjs # → public/data/market.json (SHFE + Sina 통합)
│   ├── collect-news.mjs   # → public/data/news.json (Google News RSS)
│   ├── rules.mjs          # 9개 인과 규칙 정의 + 시장 임계값 + 관련성 용어
│   └── analyze.mjs        # → public/data/analysis.json (신호·클러스터·영향·판매영향)
│
├── 📁 public/data/        # 수집된 JSON (git tracked, news.json만 gitignore)
│   ├── market.json        # 6개 선물 스냅샷 + 30분봉
│   ├── news.json          # 뉴스 기사 메타 (gitignored — CI에서만 생성)
│   └── analysis.json      # 분석 결과: 시그널, 클러스터, 임팩트, 세일즈 임팩트
│
├── 📁 src/                # React SPA (TypeScript + Tailwind v4)
│   ├── main.tsx           # 엔트리포인트
│   ├── App.tsx            # 메인 대시보드 (~665줄) — 7개 패널
│   ├── Chart.tsx          # lightweight-charts 캔들차트
│   ├── ui.tsx             # 공유 UI 컴포넌트: Panel, SeverityTag, ConfidenceTag 등
│   ├── db.ts              # PGlite DB 레이어: issues 테이블 CRUD
│   ├── types.ts           # TypeScript 인터페이스
│   ├── index.css          # Tailwind v4 @theme + 터미널 팔레트 + 테이블 스타일
│   └── vite-env.d.ts      # Vite 클라이언트 타입 선언
│
├── index.html             # SPA 셸 (lang="ko")
├── vite.config.ts         # React + Tailwind v4 + PGlite 제외 + GitHub Pages base
├── tsconfig.json          # ES2022, bundler resolution, strict
├── package.json           # 스크립트: collect→analyze→refresh, dev, build
├── .gitignore             # news.json gitignored
└── .claude/launch.json    # Claude Code 개발서버: npm run dev, port 5178
```

---

## 4. 데이터 파이프라인

```
┌─────────────────────────────────────────────────────────────────┐
│  npm run refresh  =  collect:market → collect:news → analyze    │
└─────────────────────────────────────────────────────────────────┘

1. collect-market.mjs
   ├── SHFE 공식 API (delaymarket_hc.dat, hc.dat 등)
   │   → 주력계약 선정 → 세션 브레이크 제외 30분봉
   ├── Sina Finance JSONP (차트 히스토리 백필)
   │   → normalizeSinaBars → SHFE 봉과 mergeBars (SHFE 우선)
   └── 출력: public/data/market.json (HRC 240봉, 나머지 12봉)

2. collect-news.mjs
   ├── Google News RSS × 9개 도메인 (when:7d 필수!)
   │   → XML 파싱 → 10일 이내 필터 → Jaccard 중복 합치기 → 도메인 유니온
   └── 출력: public/data/news.json (최대 400건, gitignored)

3. analyze.mjs
   ├── 뉴스 관련성 점수 (strong +2 / contextual +1 / negative -3, 임계 ≥2)
   ├── 이벤트 클러스터링 (규칙별 그룹, confidence = 매체 수 × 최신성)
   ├── 마켓 시그널 (임계값 돌파 감지)
   ├── Impact 생성 (시장+뉴스 → 규칙 체인)
   ├── Reconciliation (같은 규칙 = severity 중복 X, confidence만 상향)
   └── 출력: public/data/analysis.json
```

### 자동화 흐름 (GitHub Actions)
```
collect.yml (cron */30 1-15 * * 1-5)
  → npm run refresh
  → git add public/data && git commit && git push (변경 있을 때만)
  
deploy.yml (triggers: push to master OR workflow_run of collect)
  → npm ci → npm run refresh (continue-on-error) → vite build → GitHub Pages deploy
```

---

## 5. 핵심 기술 디테일

### 5.1 SHFE 데이터 소스
- `delaymarket_<pid>.dat`: 계약별 스냅샷 (OI, 거래량, 가격, 시간)
- `<pid>.dat`: 분봉 틱 (계약코드 키)
- **주력계약 선정**: `liquidityScore = 0.60 × (OI share) + 0.40 × (volume share)` — 최고 점수 계약
- **product ID 매핑**: hc→HRC, rb→rebar, zn→zinc, al→aluminium

### 5.2 세션 시간 (Asia/Shanghai)
| 세션 | 시간 |
|------|------|
| NIGHT | 21:00-23:00 |
| DAY 1 | 09:00-10:15 |
| (break) | 10:15-10:30 |
| DAY 2 | 10:30-11:30 |
| (break) | 11:30-13:30 |
| DAY 3 | 13:30-15:00 |

- 30분봉은 세션 브레이크 구간의 틱을 **버림** → "last 60m" = 완료된 봉 2개, 벽시계 아님
- `barChange(bars, N)` = 마지막 봉 대비 N번째 이전 봉의 종가 변화율

### 5.3 시장 신호 임계값 (rules.mjs MARKET_THRESHOLDS)
```
HRC:  m120 ±2.0% → HIGH,  m60 ±1.2% → MEDIUM,  today ±3.0% → HIGH, today ±1.5% → MEDIUM
Zinc: today ±2.5% → HIGH,  today ±1.2% → MEDIUM
Aluminium: today ±2.5% → HIGH,  today ±1.2% → MEDIUM
Iron Ore:  today ±3.0% → MEDIUM
Coking Coal: today ±3.0% → MEDIUM
Rebar: today ±3.0% → LOW
```
**주의**: 이 임계값이 너무 높아서 평상시 시그널 0개 → 낮춰야 의미 있는 데모 가능

### 5.4 9개 인과 규칙 (R1-R9)
| ID | 이름 | 트리거 | 영향 제품 |
|----|------|--------|-----------|
| R1 | China HRC → coated offer pressure | 시장 (HRC) | CRC/GI/GL/PPGI/COLOR |
| R2 | China mill offer hike → Asia reference | 뉴스 (china_supply, steel_price) | CRC/GI/COLOR |
| R3 | Iron ore/coking coal → integrated mill cost | 시장 (ironOre, cokingCoal) | CRC/GI/GL |
| R4 | Zinc/aluminium → coating cost | 시장 (zinc, aluminium) | GI/GL/PPGI/COLOR |
| R5 | Crude oil → bunker → freight → CIF | 뉴스 (energy, logistics) | GI/GL/PPGI/COLOR |
| R6 | Hormuz/Red Sea/Suez disruption | 뉴스 (logistics, geopolitics) | GI/GL/COLOR |
| R7 | Port closure → delay → demurrage | 뉴스 (logistics) | GI/GL/PPGI/COLOR |
| R8 | AD/CVD/Safeguard/Tariff | 뉴스 (trade_policy) | ALL |
| R9 | Sanction → payment restriction | 뉴스 (geopolitics, trade_policy) | ALL |

### 5.5 PGlite (WASM PostgreSQL)
- 연결: `idb://steel-sales-risk` (IndexedDB 백엔드)
- 테이블: `issues` — id SERIAL, title, impact_id, rule_id, risk_type, region, products, action, status, created_at, updated_at
- 중복 방지: 같은 impact_id + region 조합으로 열린 이슈 있으면 생성 거부
- `optimizeDeps.exclude: ['@electric-sql/pglite']` 필수 (vite.config.ts)

---

## 6. 대시보드 UI 구조 (App.tsx — 7개 패널)

```
Header: STEEL SALES RISK INTELLIGENCE
  StatusChip: MODE=PROTOTYPE | HRC SESSION (DAY/NIGHT/BREAK/CLOSED) | DATA freshness

01 Market Pulse     — 6개 선물 테이블 (Last, Today, 30m, 60m, 120m, Vol, OI, Source)
02 Critical Signals — 클릭 가능 리스트 (MEDIUM 이상 Impact)
03 Sales Impact     — Region×Product 테이블 + [+ISSUE] 버튼
04 Risk Brief       — 선택된 Impact의 FACT/RULE/INFERENCE/ACTION 브레이크다운 + 증거 링크
05 HRC Intraday     — 캔들차트 + 메트릭 + 출처 정보
06 Event Radar      — 뉴스 클러스터 테이블 (기사수, 매체수, 최신일, 매칭 용어)
07 Issue & Action   — Issue 목록 + 상태 전환 (NEW/REVIEWING/ACTION_REQUIRED/RESOLVED) + 삭제

Footer: DATA PROVENANCE — 수집시각, 실패 건수, 규칙 수, 면책 문구
```

### UI 스타일 시스템 (index.css)
- Tailwind v4의 `@theme` 사용
- 터미널 팔레트: ink, graphite, slate-line, muted, faint, panel, canvas, steel
- 리스크 색상: risk-high(빨강), risk-med(앰버), ok(초록) — **장식용 사용 금지, 항상 의미 부여**
- `.num` 클래스: 모노스페이스 + tabular-nums (숫자 열 정렬)
- `.panel`, `.panel-head`, `.panel-title`, `.eyebrow`, `table.grid` — 공유 스타일

---

## 7. 로컬 개발 방법

```bash
# 1. 의존성 설치
npm ci

# 2. 데이터 수집 (SHFE + 뉴스 + 분석)
npm run refresh

# 3. 개발 서버 실행
npm run dev
# → http://localhost:5173 (또는 Claude Code에서 port 5178)

# 4. 빌드 (GitHub Pages용)
VITE_BASE=/steel-sales-risk-dashboard/ npm run build

# 5. 개별 수집/분석
npm run collect:market   # market.json만
npm run collect:news     # news.json만
npm run analyze          # analysis.json (market.json + news.json 필요)
```

### Claude Code 개발 서버
`.claude/launch.json`에 `steel-risk-dashboard` 설정 → `preview_start`로 바로 실행 가능

---

## 8. 알려진 이슈 & 주의사항

### ⚠️ 반드시 알아야 할 것
1. **`when:7d`는 Google News RSS 쿼리에 필수** — 없으면 수개월 전 기사가 상위에 올라옴
2. **news.json은 gitignored** — CI에서 collect 시 생성. 로컬에서도 `npm run collect:news`로 생성 필요
3. **market.json은 git tracked** — CI가 변경분만 커밋. 로컬에서 수정 후 커밋 시 충돌 가능
4. **SHFE 데이터는 장 시간에만** — 장 마감 시간(15:00 SHA / 16:00 KST 이후)엔 마지막 데이터 유지
5. **GitHub Actions GITHUB_TOKEN push는 다른 workflow 트리거 안 함** — 그래서 `workflow_run` 체이닝 사용
6. **PGlite는 vite optimizeDeps에서 exclude 해야 함** — 안 하면 WASM 로딩 실패

### 🐛 알려진 버그/한계
- Market Signal 0개: 현재 임계값이 일반적 장중 변동 대비 높음 → 시연용으로 낮출 필요
- "Hormuz 29 articles" 같은 대형 클러스터 → 규칙별 1개 클러스터로만 묶임, 세부 이벤트 분리 안 됨
- 차트 배경색 하드코딩(#ffffff) → 다크 모드 시 변경 필요

---

## 9. 배포 관련

### GitHub Pages
- Settings > Pages > Source: GitHub Actions (이미 설정됨)
- URL: `https://busanironseller.github.io/steel-sales-risk-dashboard/`
- base path: `VITE_BASE=/steel-sales-risk-dashboard/` (deploy.yml에서 `${{ github.event.repository.name }}` 사용)

### 수동 배포 트리거
```bash
gh workflow run deploy.yml
```

### 수동 데이터 수집 트리거
```bash
gh workflow run collect.yml
```

---

## 10. 다음 작업 우선순위 (발표까지)

### P0 — 꼭 해야 할 것
1. **UI 비주얼 폴리시**: 레퍼런스(supply-guard-risk-monitor) 수준의 B2B 터미널 룩. 현재는 기능 위주로 밋밋함
2. **시장 신호 임계값 낮추기**: 시연 시 시그널이 뜨도록 `MARKET_THRESHOLDS`를 현실적으로 (예: HRC m60 ±0.5% MEDIUM)
3. **한글화 보강**: 현재 영/한 혼용. 발표 대상이 한국어 사용자이므로 주요 레이블 한글로

### P1 — 하면 좋은 것
4. **필터 컨트롤**: Period(24h/7d/30d), Region, Product 드롭다운
5. **뉴스 클러스터 세분화**: 같은 규칙이라도 이벤트별로 분리
6. **차트 영역 개선**: 사이즈 조정, 더 나은 범례, 시간축 포맷

### P2 — 발표 후
7. Daily Brief(§16), FX 데이터(§17)
8. 다크 모드
9. 모바일 최적화
10. Deal/Order 매칭 아키텍처(§15)
11. Neon/Supabase 마이그레이션 (PGlite → 서버 PostgreSQL)

---

## 11. 유저 컨텍스트

- **이름**: yongdeok1995@gmail.com
- **역할**: AI 활용 전문가 과정 수강생, 철강 수출영업 실무자
- **발표**: 2026-08-20 (수) — 과정 최종 과제
- **핵심 니즈**: "실제로 굴러가는 쌈뽕한 웹사이트" → **시각적 임팩트** 최우선
- **깃허브**: github.com/busanironseller
- **기술 환경**: Windows 11, Node 22, npm 11.16 (postinstall 차단 이슈 있음), Git Bash

### 유저 발언 핵심
> "아직 다듬을 부분이 많아보여"  
> "지금은 우선 실제로 굴러가는 쌈뽕한 웹사이트를 내 눈에 보여주는게 최우선 과제"  
> "과제 발표 그 이후로 생각하고" (자율 운영은 발표 후)

---

## 12. 이전 세션 히스토리 참고

전체 대화 기록 (컨텍스트 요약 포함):  
`C:\Users\admin\.claude\projects\C--Users-admin-Downloads-260818-AI----------------\53409109-e010-41f3-87b0-586a5a29c7e7.jsonl`

메모리 파일:  
`C:\Users\admin\.claude\projects\C--Users-admin-Downloads-260818-AI----------------\memory\`
- `steel-sales-risk-dashboard.md` — 프로젝트 목표 및 제약
- `dev-toolchain-2026-08.md` — 설치된 도구 상세
- `MEMORY.md` — 인덱스

---

## 13. 빠른 시작 프롬프트

새 세션에서 바로 이어서 작업하려면 이 프롬프트를 사용:

```
HANDOFF.md 읽고 이어서 작업해줘. 

최우선: 발표용 UI 폴리시. 레퍼런스 https://supply-guard-risk-monitor.vercel.app/ 참고해서 
B2B commodity terminal 느낌의 프로페셔널한 대시보드로 만들어줘.

- 시장 신호 임계값 낮춰서 시연 시 실제 시그널이 뜨게
- 한글 레이블 보강
- 필터 컨트롤 추가 (region/product)
- 전체적으로 시각적 임팩트 강화

발표일: 8/20 수요일. 시간 없으니 바로 작업 시작해.
```
