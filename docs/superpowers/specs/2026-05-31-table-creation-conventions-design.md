# 테이블 생성 컨벤션 일관성 — 설계

- **날짜**: 2026-05-31
- **브랜치**: feat/ai-context-routing
- **상태**: 승인됨 (구현 대기)

## 배경 / 문제

ERDify의 AI 어시스턴트는 한 다이어그램을 여러 단계(턴)에 걸쳐 수정한다.
예: 계약 테이블 정규화를 `Contract → contract_terms → contract_approval → 다음 단계…`로
나눠 진행. 사용자는 단계마다 생성되는 테이블/컬럼/인덱스가 **앞 단계에서 적용한 규칙과
동일하게** 만들어지길 원한다.

### 현재 동작
- `apps/api/src/modules/ai/context/context-builder.ts`의 시스템 프롬프트에
  `## Naming — MATCH THE EXISTING DIAGRAM` 블록이 있어, AI가 매 턴 현재 다이어그램에서
  케이스 스타일 / PK / FK / 타임스탬프 / 타입 규칙을 **재추론**한다.
- 인덱스 이름 접두사(`idx_`, `ux_`), 제약 네이밍, 코멘트(논리명) 언어·스타일은
  어디에도 규칙으로 적혀 있지 않다. `addIndex` 툴 설명의 예시(`'idx_orders_user_id'`)와
  다이어그램에 흩어진 기존 인덱스를 보고 매 턴 LLM이 다시 추측한다.

### 일관성이 깨지는 실제 지점
1. 규칙이 명시적으로 "기록"되지 않고 매 턴 흩어진 근거에서 재추론된다(인덱스/코멘트 특히).
2. 큰 다이어그램은 `summarizeFocused`로 요약되면서 focus 밖 테이블의 컬럼/인덱스가
   빠진다 → AI가 자신이 앞서 적용한 규칙의 근거를 잃는다.

### 범위 (brainstorming에서 확정)
- **같은 세션/다이어그램 내 일관성**만 다룬다. 세션을 넘는 영구 저장이나 사용자 정의
  규칙은 범위 밖(YAGNI).
- 일관성을 보장할 대상 규칙: 테이블명(단/복수·접두사), 인덱스/제약 네이밍,
  컬럼 코멘트(논리명) 스타일, PK/FK/타임스탬프 패턴.

## 접근법

**결정적 컨벤션 추출 + 프롬프트 주입.** 이미 있는 `analyzeSchema → VERIFIED FACTS`
파이프라인과 동일한 패턴을 하나 더 추가한다. 코드가 **원본 다이어그램**(요약 전)을
결정적으로 스캔해 실제 컨벤션을 계산하고, 그 결과를 프롬프트의 별도 블록으로 주입한다.

검토했으나 기각한 대안:
- **다이어그램 메타데이터에 영구 저장**: 스키마/저장 변경 필요, "같은 세션 내" 범위엔 과함.
- **프롬프트 지시만 강화**: 가장 싸지만 "요약 시 근거 손실"을 못 고침 — 실제 깨지는
  지점을 안 건드림.

## 데이터 흐름

```
ai-chat.service.runChat()
  ├─ domain.analyzeSchema(doc)        → facts        → VERIFIED FACTS 블록 (기존)
  └─ domain.detectConventions(doc)    → conventions  → DETECTED CONVENTIONS 블록 (신규)
        ↓
  buildSystemPrompt(doc, meta, facts, { focusTableIds, intent, conventions })
```

`detectConventions`는 원본 `doc`에서 계산하므로, 프롬프트의 `Current diagram` JSON이
`summarizeFocused`로 요약돼도 규칙 근거가 살아있다 — 일관성이 깨지던 지점의 직접 해결책.

## 컴포넌트

### 1. `detectConventions(doc)` — `packages/domain/src/utils/detect-conventions.ts`

`analyzeSchema`처럼 순수 함수: 입력 불변, 동일 입력 → 동일 출력, LLM 호출 없음.

```ts
export interface ConventionProfile {
  caseStyle: "snake" | "camel" | "mixed" | "unknown";
  tableNaming: { number: "plural" | "singular" | "mixed" | "unknown"; commonPrefixes: string[] };
  primaryKey: { pattern: string | null; typicalType: string | null }; // "id" | "<table>_id" | "uuid" | "seq"
  foreignKey: { pattern: string | null };                              // "<table>_id" | "<table>Id" | "<table>No"
  timestamps: string[];                                                // 실제 이름: ["created_at","updated_at"] | ["reg_dt","mod_dt"]
  indexNaming: { uniquePrefix: string | null; indexPrefix: string | null; template: string | null };
  comments: { coveragePct: number; language: "korean" | "english" | "mixed" | "unknown" };
}

export function detectConventions(doc: DiagramDocument): ConventionProfile;
```

검출 규칙:
- **caseStyle**: 기존 `analyzeSchema`의 `caseStyle()` 로직 재사용(snake/camel/ambiguous
  → 다수결로 snake/camel/mixed/unknown).
- **tableNaming.number**: 테이블명 끝 `s` 휴리스틱으로 복수/단수 다수결. commonPrefixes는
  `_` 또는 camel 경계로 토큰화한 첫 토큰이 2개 이상 테이블에서 반복되면 추출(예: `contract_`).
- **primaryKey**: PK 컬럼명이 `id` / `<table>_id` / `uuid` / `seq` 중 어느 패턴에 다수
  부합하는지. typicalType은 PK 타입 최빈값.
- **foreignKey**: 관계의 sourceColumn 이름들에서 `<refTable>_id` / `<refTable>Id` /
  `<refTable>No` 패턴 다수결.
- **timestamps**: 모든 컬럼명에서 생성/수정 시각 후보(`created_at`/`updated_at`/
  `reg_dt`/`mod_dt`/`createdAt`/`updatedAt` 등 known 집합 ∩ 실제 존재)를 빈도순으로 수집.
- **indexNaming**: 기존 인덱스 이름을 `_`로 토큰화 → 첫 토큰을 접두사 후보로. unique=true
  인덱스의 다수 접두사 → uniquePrefix(`ux_`/`uq_`), 비유니크 다수 접두사 → indexPrefix
  (`idx_`). template은 가장 흔한 `<prefix>_<table>_<col>` 형태를 일반화.
- **comments**: comment 있는 컬럼 비율(coveragePct) + 한글 정규식으로 언어 판정.
- **빈/근거부족 다이어그램**: 해당 필드는 `unknown` / `null` / `[]` 반환.

`@erdify/domain`에서 `detectConventions`와 `ConventionProfile` export 추가
(`packages/domain/src/index.ts`). `domain-loader.service`는 모듈 전체를 반환하므로
추가 배선 불필요.

### 2. 프롬프트 블록 — `context-builder.ts`

`buildVerifiedFactsBlock` 옆에 `buildConventionsBlock(profile)` 추가.
`PromptOptions`에 `conventions?: ConventionProfile` 필드 추가, `buildSystemPrompt`가
`intentBlock`/`verifiedFactsBlock`과 같은 위치에 주입.

블록 예시:
```
## DETECTED CONVENTIONS — 이 다이어그램에서 코드로 추출한 실제 규칙 (전체 스키마 기준, 요약과 무관)
- 케이스: snake_case
- 테이블명: 복수형, 공통 접두사 [contract_]
- PK: <table>_id (uuid) / FK: <table>_id
- 타임스탬프: reg_dt, mod_dt
- 인덱스: idx_<table>_<col> / 유니크: ux_<table>_<col>
- 코멘트: 한국어, 92% 컬럼에 존재
규칙: 새 테이블/컬럼/인덱스는 위 규칙을 **그대로** 따르세요. 아래 Current diagram이
요약돼 있어도 위 규칙은 전체 스키마에서 계산된 것이라 항상 유효합니다.
```

- profile이 전부 unknown/null이면(새 다이어그램) **블록을 완전히 생략**한다 → 기존
  `Database design defaults` 섹션이 그대로 적용되어 충돌·중복 없음. (부분적으로만 unknown인
  필드는 블록에 포함하되 해당 줄을 생략한다.)
- 기존 `MATCH EXISTING DIAGRAM` 블록은 **행동 지침**으로 유지. 신규 블록은 **구체적 값
  (근거 시트)** 제공. 역할 분리(지침 vs 데이터)로 중복·모순 없음.

### 3. 배선 — `ai-chat.service.ts`

`runChat`에서 `const conventions = domain.detectConventions(doc);` 추가 후
`buildSystemPrompt(..., facts, { focusTableIds, intent, conventions })`로 전달.

## 테스트

- `packages/domain/src/utils/detect-conventions.test.ts`
  - snake_case 픽스처 → caseStyle "snake"
  - camelCase 픽스처 → caseStyle "camel"
  - `idx_*`/`ux_*` 인덱스 → indexPrefix/uniquePrefix 추출
  - `reg_dt`/`mod_dt` → timestamps 검출
  - 한국어 코멘트 → comments.language "korean", coveragePct 계산
  - 공통 접두사 `contract_` 검출
  - 빈 다이어그램 → 전 필드 unknown/null/[]
  - snake+camel 혼용 → "mixed"
- `apps/api/src/modules/ai/context/context-builder.spec.ts`
  - conventions 주입 시 "DETECTED CONVENTIONS" 블록 포함
  - profile 전부 unknown이면 블록 생략(또는 축약)
  - 요약된(oversized) 다이어그램에서도 블록 존재
- `apps/api/src/modules/ai/eval/` 그라운딩 회귀 픽스처 1개:
  요약된 다이어그램에서도 컨벤션 블록이 프롬프트에 존재함을 확인.

## 범위 밖 (YAGNI)
- 다이어그램/조직 단위 규칙 영구 저장.
- 사용자가 직접 정의하는 규칙.
- 기존 인덱스/컬럼 자동 리네임.
