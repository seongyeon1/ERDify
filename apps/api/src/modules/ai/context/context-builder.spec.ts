import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildDiagramContext } from "./context-builder";
import type { ConventionProfile, DiagramDocument } from "@erdify/domain";

const fullConventions: ConventionProfile = {
  caseStyle: "snake",
  tableNaming: { number: "plural", commonPrefixes: ["contract_"] },
  primaryKey: { pattern: "<table>_id", typicalType: "uuid" },
  foreignKey: { pattern: "<table>_id" },
  timestamps: ["reg_dt", "mod_dt"],
  indexNaming: { uniquePrefix: "ux_", indexPrefix: "idx_", template: "idx_<table>_<col>" },
  comments: { coveragePct: 92, language: "korean" },
};

const emptyConventions: ConventionProfile = {
  caseStyle: "unknown",
  tableNaming: { number: "unknown", commonPrefixes: [] },
  primaryKey: { pattern: null, typicalType: null },
  foreignKey: { pattern: null },
  timestamps: [],
  indexNaming: { uniquePrefix: null, indexPrefix: null, template: null },
  comments: { coveragePct: 0, language: "unknown" },
};

const doc: DiagramDocument = {
  format: "erdify.schema.v1",
  id: "d1",
  name: "shop",
  dialect: "postgresql",
  entities: [
    {
      id: "e1",
      name: "users",
      schema: null,
      logicalName: null,
      comment: null,
      color: null,
      columns: [
        { id: "c1", name: "id", type: "uuid", nullable: false, primaryKey: true, unique: false, defaultValue: null, comment: "고유 식별자", ordinal: 0 },
      ],
    },
  ],
  relationships: [],
  indexes: [{ id: "i1", entityId: "e1", name: "idx_users_id", columnIds: ["c1"], unique: true }],
  views: [],
  layout: { entityPositions: {} },
  metadata: { revision: 1, stableObjectIds: true, createdAt: "", updatedAt: "" },
};

const meta = { userName: "홍길동", userEmail: "a@b.com", orgName: "Acme", diagramId: "d1", diagramName: "shop", today: "2026-05-30" };

describe("buildDiagramContext", () => {
  it("모든 테이블을 상세히 포함하고 comment와 인덱스를 담는다", () => {
    const ctx = buildDiagramContext(doc);
    expect(ctx.entities[0]!.columns[0]!).toMatchObject({ comment: "고유 식별자" });
    expect(ctx.indexes[0]!.name).toBe("idx_users_id");
  });
});

describe("buildSystemPrompt", () => {
  it("세션 메타와 다이어그램 JSON을 포함한다", () => {
    const p = buildSystemPrompt(doc, meta);
    expect(p).toContain("홍길동");
    expect(p).toContain("a@b.com");
    expect(p).toContain("Acme");
    expect(p).toContain("users");
  });

  it("읽기 도구 안내(getTableDetails/listTables)를 항상 포함하고 되묻지 말라고 지시한다", () => {
    const p = buildSystemPrompt(doc, meta);
    expect(p).toContain("listTables");
    expect(p).toContain("getTableDetails");
    expect(p).toContain("never ask the user");
  });

  it("분석 요청에 줄글로 그치지 말고 도구로 적용하라고 지시한다", () => {
    const p = buildSystemPrompt(doc, meta);
    expect(p).toContain("do not stop at prose");
    expect(p).toContain("reviewable diff");
  });

  it("기존 다이어그램 네이밍 규칙을 따르고 정규화 시 원본 컬럼명을 보존하라고 지시한다", () => {
    const p = buildSystemPrompt(doc, meta);
    expect(p).toContain("MATCH THE EXISTING DIAGRAM");
    expect(p).toContain("PRESERVE ORIGINAL NAMES");
    expect(p).toMatch(/keep each existing column's[\s\S]*EXACTLY as-is/);
  });

  it("VERIFIED FACTS 블록을 항상 포함하고 무할루시네이션을 지시한다", () => {
    const p = buildSystemPrompt(doc, meta);
    expect(p).toContain("VERIFIED FACTS");
    expect(p).toContain("hallucinate");
  });

  it("facts가 주어지면 detail을 그대로 렌더링한다", () => {
    const p = buildSystemPrompt(doc, meta, [
      { kind: "missing_pk", table: "orders", detail: '테이블 "orders"에 기본키(PK)가 없습니다.' },
    ]);
    expect(p).toContain("[missing_pk]");
    expect(p).toContain('테이블 "orders"에 기본키(PK)가 없습니다.');
  });

  it("facts가 비면 이슈 없음을 명시한다", () => {
    const p = buildSystemPrompt(doc, meta, []);
    expect(p).toContain("구조적 이슈 없음");
  });

  it("의도 블록과 근거기반 규칙을 포함한다", () => {
    const p = buildSystemPrompt(doc, meta, [], { intent: "edit" });
    expect(p).toContain("intent: EDIT");
    expect(p).toContain("Grounded answer rules");
  });

  it("컨벤션 프로필이 주어지면 DETECTED CONVENTIONS 블록에 실제 값을 렌더링한다", () => {
    const p = buildSystemPrompt(doc, meta, [], { conventions: fullConventions });
    expect(p).toContain("DETECTED CONVENTIONS");
    expect(p).toContain("idx_<table>_<col>");
    expect(p).toContain("ux_");
    expect(p).toContain("contract_");
    expect(p).toContain("reg_dt");
    expect(p).toContain("snake");
  });

  it("추출된 컨벤션이 없으면(전부 unknown) DETECTED CONVENTIONS 블록을 생략한다", () => {
    const p = buildSystemPrompt(doc, meta, [], { conventions: emptyConventions });
    expect(p).not.toContain("DETECTED CONVENTIONS");
  });
});

describe("buildSystemPrompt — focused context (large diagram)", () => {
  function bigDoc(): DiagramDocument {
    const entities = Array.from({ length: 60 }, (_, i) => ({
      id: `e${i}`,
      name: `table_${i}`,
      schema: null,
      logicalName: null,
      comment: null,
      color: null,
      columns: Array.from({ length: 20 }, (_, j) => ({
        id: `e${i}_c${j}`,
        name: `t${i}_field_${j}`,
        type: "varchar",
        nullable: true,
        primaryKey: false,
        unique: false,
        defaultValue: null,
        comment: "어떤 설명",
        ordinal: j,
      })),
    }));
    return { ...doc, entities, relationships: [], indexes: [] };
  }

  it("초과 크기일 때 focus 테이블만 완전히 포함하고 나머지는 요약한다", () => {
    const big = bigDoc();
    const p = buildSystemPrompt(big, meta, [], { focusTableIds: ["e3"] });
    expect(p).toContain("focusedTables");
    expect(p).toContain("otherTables");
    // focus 테이블의 컬럼은 전체 포함
    expect(p).toContain("t3_field_0");
    // 비-focus 테이블의 컬럼은 포함되지 않음(요약만)
    expect(p).not.toContain("t7_field_0");
  });

  it("초과 크기인데 focus가 없으면 전체 요약으로 폴백한다", () => {
    const big = bigDoc();
    const p = buildSystemPrompt(big, meta, []);
    expect(p).toContain("tables summarized");
    expect(p).not.toContain("t3_field_0");
  });

  it("다이어그램이 요약돼도 DETECTED CONVENTIONS 블록은 유지된다", () => {
    const big = bigDoc();
    const p = buildSystemPrompt(big, meta, [], { conventions: fullConventions });
    expect(p).toContain("tables summarized");
    expect(p).toContain("DETECTED CONVENTIONS");
    expect(p).toContain("idx_<table>_<col>");
  });
});
