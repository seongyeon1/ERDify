import type { ConventionProfile, DiagramDocument, SchemaFinding } from "@erdify/domain";
import { buildIntentBlock, type ChatIntent } from "./intent";

export interface SessionMeta {
  userName: string;
  userEmail: string;
  orgName: string;
  diagramId: string;
  diagramName: string;
  today: string;
}

const TOKEN_BUDGET_CHARS = 60_000;

export function buildDiagramContext(doc: DiagramDocument) {
  return {
    id: doc.id,
    name: doc.name,
    dialect: doc.dialect,
    entities: doc.entities.map((e) => ({
      id: e.id,
      name: e.name,
      ...(e.schema ? { schema: e.schema } : {}),
      ...(e.logicalName ? { logicalName: e.logicalName } : {}),
      columns: e.columns.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        primaryKey: c.primaryKey,
        unique: c.unique,
        ...(c.defaultValue !== null ? { defaultValue: c.defaultValue } : {}),
        ...(c.comment ? { comment: c.comment } : {}),
      })),
    })),
    relationships: doc.relationships.map((r) => ({
      id: r.id,
      sourceEntityId: r.sourceEntityId,
      sourceColumnIds: r.sourceColumnIds,
      targetEntityId: r.targetEntityId,
      cardinality: r.cardinality,
    })),
    indexes: doc.indexes.map((i) => ({
      id: i.id,
      entityId: i.entityId,
      name: i.name,
      columnIds: i.columnIds,
      unique: i.unique,
    })),
  };
}

function summarize(doc: DiagramDocument) {
  return {
    id: doc.id,
    name: doc.name,
    dialect: doc.dialect,
    entities: doc.entities.map((e) => ({ id: e.id, name: e.name, columnCount: e.columns.length })),
    relationships: doc.relationships.map((r) => ({
      id: r.id,
      sourceEntityId: r.sourceEntityId,
      targetEntityId: r.targetEntityId,
      cardinality: r.cardinality,
    })),
    _note: "Large diagram: tables summarized (names + column counts only). Call getTableDetails(tableId) to see a table's full columns/indexes/relationships.",
  };
}

/**
 * 큰 다이어그램을 위한 "compact-complete" 컨텍스트: 질의에 관련된 테이블은 컬럼/인덱스까지
 * 완전히 포함하고, 나머지는 요약(이름+컬럼 수)한다. 관계는 전부 포함해 그래프 맥락을 보존한다.
 */
function summarizeFocused(doc: DiagramDocument, focusTableIds: string[]) {
  const focus = new Set(focusTableIds);
  const ctx = buildDiagramContext(doc);
  return {
    id: ctx.id,
    name: ctx.name,
    dialect: ctx.dialect,
    focusedTables: ctx.entities.filter((e) => focus.has(e.id)),
    otherTables: doc.entities
      .filter((e) => !focus.has(e.id))
      .map((e) => ({ id: e.id, name: e.name, columnCount: e.columns.length })),
    relationships: ctx.relationships,
    indexes: ctx.indexes.filter((i) => focus.has(i.entityId)),
    _note: "Large diagram: only query-relevant tables are shown in full; otherTables are summarized — call getTableDetails(tableId) for any of them. ALL relationships are included.",
  };
}

function buildVerifiedFactsBlock(facts: SchemaFinding[]): string {
  const lines = facts.length
    ? facts.map((f) => `- [${f.kind}] ${f.detail}`).join("\n")
    : "- (코드 분석으로 검출된 구조적 이슈 없음)";
  return `
## VERIFIED FACTS — 이 다이어그램에 대한 코드 분석 결과 (신뢰 가능, 추측 아님)
다음은 ERDify가 현재 스키마를 결정적으로(deterministic) 분석해 계산한 사실 목록입니다.
${lines}
규칙:
- 분석/정규화/리뷰 답변은 위 사실을 근거로 삼으세요. 위 목록을 **넘어서는 문제를 지어내지(hallucinate) 마세요.**
- 사실에 명시된 테이블/컬럼만 문제로 언급하고, 세부 컬럼이 필요하면 \`getTableDetails\`로 실제 값을 확인한 뒤 말하세요.
- 위 목록이 비어 있는데도 사용자가 개선을 요청하면, 추측 대신 "구조적 이슈는 발견되지 않았다"고 분명히 말하세요.
`;
}

/**
 * 추출된 컨벤션 프로필을 프롬프트 블록으로 렌더링한다. 아는 규칙(unknown/null이 아닌 것)만
 * 줄로 포함하고, 알아낼 규칙이 하나도 없으면 빈 문자열을 반환해 블록 자체를 생략한다 —
 * 그러면 시스템 프롬프트의 "Database design defaults" 섹션이 그대로 적용된다.
 * 원본 문서에서 계산되므로 "Current diagram"이 요약돼도 이 규칙은 항상 유효하다.
 */
function buildConventionsBlock(p?: ConventionProfile): string {
  if (!p) return "";
  const lines: string[] = [];

  if (p.caseStyle !== "unknown") {
    const label = p.caseStyle === "snake" ? "snake_case" : p.caseStyle === "camel" ? "camelCase" : "혼용(mixed) — 기존 컬럼과 일치시킬 것";
    lines.push(`- 케이스: ${label}`);
  }
  if (p.tableNaming.number !== "unknown" || p.tableNaming.commonPrefixes.length > 0) {
    const parts: string[] = [];
    if (p.tableNaming.number !== "unknown") {
      parts.push(p.tableNaming.number === "plural" ? "복수형" : p.tableNaming.number === "singular" ? "단수형" : "단/복수 혼용");
    }
    if (p.tableNaming.commonPrefixes.length > 0) parts.push(`공통 접두사 [${p.tableNaming.commonPrefixes.join(", ")}]`);
    lines.push(`- 테이블명: ${parts.join(", ")}`);
  }
  if (p.primaryKey.pattern) {
    lines.push(`- PK: ${p.primaryKey.pattern}${p.primaryKey.typicalType ? ` (${p.primaryKey.typicalType})` : ""}`);
  }
  if (p.foreignKey.pattern) lines.push(`- FK: ${p.foreignKey.pattern}`);
  if (p.timestamps.length > 0) lines.push(`- 타임스탬프: ${p.timestamps.join(", ")}`);
  if (p.indexNaming.indexPrefix || p.indexNaming.uniquePrefix) {
    const parts: string[] = [];
    if (p.indexNaming.template) parts.push(`인덱스 ${p.indexNaming.template}`);
    else if (p.indexNaming.indexPrefix) parts.push(`인덱스 ${p.indexNaming.indexPrefix}…`);
    if (p.indexNaming.uniquePrefix) parts.push(`유니크 ${p.indexNaming.uniquePrefix}<table>_<col>`);
    lines.push(`- 인덱스: ${parts.join(" / ")}`);
  }
  if (p.comments.language !== "unknown") {
    const lang = p.comments.language === "korean" ? "한국어" : p.comments.language === "english" ? "영어" : "혼용";
    lines.push(`- 코멘트: ${lang}, ${p.comments.coveragePct}% 컬럼에 존재`);
  }

  if (lines.length === 0) return "";
  return `
## DETECTED CONVENTIONS — 이 다이어그램에서 코드로 추출한 실제 규칙 (전체 스키마 기준, 요약과 무관)
${lines.join("\n")}
규칙: 새 테이블/컬럼/인덱스는 위 규칙을 **그대로** 따르세요. 아래 "Current diagram"이 요약돼 있어도 위 규칙은 전체 스키마에서 계산된 것이라 항상 유효합니다.
`;
}

export interface PromptOptions {
  /** 질의 관련 테이블 id (스키마-RAG). 큰 다이어그램에서 이 테이블만 완전히 포함한다. */
  focusTableIds?: string[];
  /** 결정적으로 분류된 사용자 의도. */
  intent?: ChatIntent;
  /** 코드로 추출한 다이어그램 컨벤션. 새 객체 생성 시 일관성 유지에 사용한다. */
  conventions?: ConventionProfile;
}

export function buildSystemPrompt(
  doc: DiagramDocument,
  meta: SessionMeta,
  facts: SchemaFinding[] = [],
  options: PromptOptions = {},
): string {
  const full = buildDiagramContext(doc);
  const oversized = JSON.stringify(full).length > TOKEN_BUDGET_CHARS;
  const focusIds = options.focusTableIds ?? [];
  const diagramJson = JSON.stringify(
    !oversized ? full : focusIds.length > 0 ? summarizeFocused(doc, focusIds) : summarize(doc),
  );
  const verifiedFactsBlock = buildVerifiedFactsBlock(facts);
  const intentBlock = buildIntentBlock(options.intent ?? "general");
  const conventionsBlock = buildConventionsBlock(options.conventions);

  const readToolsBlock = `
## Analysis / review / normalization / redesign requests (IMPORTANT)
- The "Current diagram" below may be SUMMARIZED for large diagrams (only table names, ids, and column counts — not the columns themselves).
- **Inspect first.** Call \`getTableDetails(tableId)\` for the relevant tables (ids are below; \`listTables\` lists all). Never guess column names or ids, and never ask the user which table to look at — look it up yourself.
- **Then ACT — do not stop at prose.** After a short explanation of the issues you found, APPLY the concrete improvements using the editing tools so the user gets a reviewable diff. For normalization/review specifically:
  - add missing foreign-key relationships with \`addRelation\` (it creates the FK column),
  - add \`addIndex\` on FK columns and natural keys (email, slug, code, token…),
  - extract repeated / lookup values into their own table with \`addTable\` + \`addRelation\`,
  - fix wrong types, nullability, and any missing \`id\` / \`created_at\` / \`updated_at\`.
- **Every change is shown to the user for approval before it takes effect**, so prefer making the changes over only listing them. Implement your recommendations with tools, then briefly summarize what you changed and why. Only ask a clarifying question when the intent is genuinely ambiguous (e.g. a destructive change you're unsure about).
- Flow: inspect → analyze → apply changes via tools → summarize.
`;

  return `You are a senior database architect assistant inside ERDify, an ERD design tool.
You help users design and modify relational database schemas through natural conversation.
Respond in the same language the user writes in (Korean if they write Korean).

## Session
- User: ${meta.userName} <${meta.userEmail}>
- Organization: ${meta.orgName}
- Diagram: ${meta.diagramName} (id: ${meta.diagramId})
- Today: ${meta.today}

## Core responsibilities
- Interpret user intent and translate it into precise schema changes using the provided tools.
- Think step-by-step: identify what tables, columns, and relationships are needed before calling tools.
- You operate in a loop: after tools run you will see the result and may continue. Inspect the schema, reason, then modify.
- Call multiple tools in a single response when a request requires creating several tables or columns at once.

## Naming — MATCH THE EXISTING DIAGRAM (IMPORTANT)
Before adding any table or column, infer the diagram's existing conventions from the current columns and follow them for EVERYTHING you create. Consistency with what already exists beats any generic default.
- **Case style**: detect snake_case vs camelCase from existing names and match it.
- **Primary key**: copy the existing PK pattern — \`id\` vs \`<table>_id\` vs \`uuid\` vs \`seq\`.
- **Foreign key**: match the existing FK pattern — \`user_id\` vs \`userId\` vs \`userNo\`. (\`addRelation.fkColumnName\` must follow it.)
- **Timestamps**: reuse whatever the diagram already uses (\`created_at\`/\`updated_at\`, \`createdAt\`/\`updatedAt\`, \`reg_dt\`/\`mod_dt\`, \`regDate\` …). Do NOT impose \`created_at\`/\`updated_at\` when another convention is already present.
- **Types**: express a concept the same way existing columns do (e.g. uuid vs bigint PKs, varchar length style).
Only fall back to the generic defaults below when the diagram has NO existing column to copy a convention from.

## Normalization — PRESERVE ORIGINAL NAMES (IMPORTANT)
- When normalizing (extracting a table, splitting a repeating group, moving columns), keep each existing column's **name, type, nullability and comment EXACTLY as-is** — MOVE it, do not rename or re-type it. Never invent a new name for data that already has one.
- Only brand-new columns you must introduce (the PK of an extracted table, the FK back-reference, timestamps) get new names — and those still follow the detected convention above.
- If you think an existing name is poor, mention it in your summary but do NOT silently rename it.

## Database design defaults (use ONLY when no existing convention applies)
1. **New tables**: \`id\` (uuid, primaryKey, not null) + \`created_at\`/\`updated_at\` (timestamptz, not null) — but if the diagram already uses a different PK/timestamp convention, MATCH IT instead.
2. **Names**: snake_case, plural table nouns (users, orders, products).
3. **Foreign keys**: \`addRelation\` with \`fkColumnName\` \`<referenced_table_singular>_id\`; \`fkNullable: false\` unless optional. The FK column (uuid) is created automatically.
4. **Cardinality**: one-to-many → the "many" side holds the FK column (sourceTableId = many side).
5. **Data types**: uuid for PKs/FKs, varchar for short strings, text for long strings, integer/bigint for counts, boolean for flags, timestamptz for timestamps, numeric/decimal for money, jsonb for flexible data.
6. **Logical names (comment)**: set a short Korean \`comment\` on every NEW column (e.g. \`id\` → "고유 식별자"). When moving an existing column, keep its existing comment.
7. **Indexes**: after every \`addRelation\`, \`addIndex\` on the FK column; unique indexes for natural keys (email, slug).
8. For a "system"/"module" request (e.g. "쇼핑몰"), proactively design all necessary tables and relationships.

## Multi-table design workflow (MUST follow this order)
1. \`addTable\` for ALL tables first (own columns, excluding FK columns).
2. \`addRelation\` with \`fkColumnName\` for each relationship (auto-adds FK column).
3. \`addIndex\` for every FK column from step 2.
4. \`addIndex\` for natural key columns with \`unique: true\`.

## Rules
- Always use the exact entity/column IDs from the current diagram when modifying existing items.
- Never hallucinate IDs. If you cannot find a referenced table/column, say so clearly.
- If the request is ambiguous, make a reasonable assumption and explain it.
- After making changes, briefly summarize what was done in the user's language.

${intentBlock}
${conventionsBlock}${verifiedFactsBlock}${readToolsBlock}
## Current diagram (JSON)
${diagramJson}`;
}
