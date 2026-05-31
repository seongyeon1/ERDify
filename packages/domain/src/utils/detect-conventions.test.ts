import { describe, expect, it } from "vitest";
import { createEmptyDiagram, detectConventions } from "../index.js";
import type { DiagramColumn, DiagramDocument, DiagramEntity, DiagramIndex, DiagramRelationship } from "../index.js";

let seq = 0;
function col(partial: Partial<DiagramColumn> & { name: string; type: string }): DiagramColumn {
  return {
    id: partial.id ?? `col_${seq++}`,
    name: partial.name,
    type: partial.type,
    nullable: partial.nullable ?? true,
    primaryKey: partial.primaryKey ?? false,
    unique: partial.unique ?? false,
    defaultValue: partial.defaultValue ?? null,
    comment: partial.comment ?? null,
    ordinal: partial.ordinal ?? 0,
  };
}

function entity(id: string, name: string, columns: DiagramColumn[]): DiagramEntity {
  return { id, name, logicalName: null, comment: null, color: null, columns };
}

function rel(partial: Partial<DiagramRelationship> & { id: string; sourceEntityId: string; sourceColumnIds: string[]; targetEntityId: string }): DiagramRelationship {
  return {
    id: partial.id,
    name: partial.name ?? "",
    sourceEntityId: partial.sourceEntityId,
    sourceColumnIds: partial.sourceColumnIds,
    targetEntityId: partial.targetEntityId,
    targetColumnIds: partial.targetColumnIds ?? [],
    cardinality: partial.cardinality ?? "many-to-one",
    onDelete: partial.onDelete ?? "no-action",
    onUpdate: partial.onUpdate ?? "no-action",
    identifying: partial.identifying ?? false,
  };
}

function docWith(entities: DiagramEntity[], opts: { relationships?: DiagramRelationship[]; indexes?: DiagramIndex[] } = {}): DiagramDocument {
  const d = createEmptyDiagram({ id: "d1", name: "t", dialect: "postgresql" });
  d.entities = entities;
  d.relationships = opts.relationships ?? [];
  d.indexes = opts.indexes ?? [];
  return d;
}

describe("detectConventions", () => {
  describe("caseStyle", () => {
    it("detects snake_case from columns", () => {
      const d = docWith([entity("e1", "users", [col({ name: "user_id", type: "uuid" }), col({ name: "full_name", type: "varchar" })])]);
      expect(detectConventions(d).caseStyle).toBe("snake");
    });

    it("detects camelCase from columns", () => {
      const d = docWith([entity("e1", "users", [col({ name: "userId", type: "uuid" }), col({ name: "fullName", type: "varchar" })])]);
      expect(detectConventions(d).caseStyle).toBe("camel");
    });

    it("reports mixed when snake and camel coexist", () => {
      const d = docWith([entity("e1", "users", [col({ name: "user_id", type: "uuid" }), col({ name: "fullName", type: "varchar" })])]);
      expect(detectConventions(d).caseStyle).toBe("mixed");
    });

    it("reports unknown when only ambiguous single-word names exist", () => {
      const d = docWith([entity("e1", "users", [col({ name: "id", type: "uuid" }), col({ name: "email", type: "varchar" })])]);
      expect(detectConventions(d).caseStyle).toBe("unknown");
    });
  });

  describe("tableNaming", () => {
    it("detects plural table names", () => {
      const d = docWith([entity("e1", "users", []), entity("e2", "orders", []), entity("e3", "products", [])]);
      expect(detectConventions(d).tableNaming.number).toBe("plural");
    });

    it("detects singular table names", () => {
      const d = docWith([entity("e1", "user", []), entity("e2", "order", [])]);
      expect(detectConventions(d).tableNaming.number).toBe("singular");
    });

    it("detects a common prefix shared by several tables", () => {
      const d = docWith([entity("e1", "contract", []), entity("e2", "contract_terms", []), entity("e3", "contract_approval", [])]);
      expect(detectConventions(d).tableNaming.commonPrefixes).toContain("contract_");
    });

    it("returns no common prefix when tables share none", () => {
      const d = docWith([entity("e1", "users", []), entity("e2", "orders", [])]);
      expect(detectConventions(d).tableNaming.commonPrefixes).toEqual([]);
    });
  });

  describe("primaryKey", () => {
    it("detects the <table>_id PK pattern and its type", () => {
      const d = docWith([
        entity("e1", "contract", [col({ name: "contract_id", type: "uuid", primaryKey: true, nullable: false })]),
        entity("e2", "contract_terms", [col({ name: "contract_terms_id", type: "uuid", primaryKey: true, nullable: false })]),
      ]);
      const pk = detectConventions(d).primaryKey;
      expect(pk.pattern).toBe("<table>_id");
      expect(pk.typicalType).toBe("uuid");
    });

    it("detects the plain id PK pattern", () => {
      const d = docWith([
        entity("e1", "users", [col({ name: "id", type: "bigint", primaryKey: true, nullable: false })]),
        entity("e2", "orders", [col({ name: "id", type: "bigint", primaryKey: true, nullable: false })]),
      ]);
      expect(detectConventions(d).primaryKey.pattern).toBe("id");
    });
  });

  describe("foreignKey", () => {
    it("detects the <table>_id FK pattern from relationships", () => {
      const fk = col({ id: "c_fk", name: "user_id", type: "uuid", nullable: false });
      const d = docWith(
        [
          entity("e1", "users", [col({ name: "id", type: "uuid", primaryKey: true, nullable: false })]),
          entity("e2", "orders", [col({ name: "id", type: "uuid", primaryKey: true, nullable: false }), fk]),
        ],
        { relationships: [rel({ id: "r1", sourceEntityId: "e2", sourceColumnIds: ["c_fk"], targetEntityId: "e1" })] },
      );
      expect(detectConventions(d).foreignKey.pattern).toBe("<table>_id");
    });
  });

  describe("timestamps", () => {
    it("detects created_at/updated_at convention", () => {
      const d = docWith([
        entity("e1", "users", [col({ name: "created_at", type: "timestamptz" }), col({ name: "updated_at", type: "timestamptz" })]),
      ]);
      expect(detectConventions(d).timestamps).toEqual(expect.arrayContaining(["created_at", "updated_at"]));
    });

    it("detects a non-default reg_dt/mod_dt convention", () => {
      const d = docWith([
        entity("e1", "users", [col({ name: "reg_dt", type: "timestamptz" }), col({ name: "mod_dt", type: "timestamptz" })]),
      ]);
      expect(detectConventions(d).timestamps).toEqual(expect.arrayContaining(["reg_dt", "mod_dt"]));
    });
  });

  describe("indexNaming", () => {
    it("extracts idx_ and ux_ prefixes and a template", () => {
      const d = docWith(
        [entity("e1", "contract", [col({ id: "c1", name: "contract_uuid", type: "uuid" }), col({ id: "c2", name: "user_id", type: "uuid" })])],
        {
          indexes: [
            { id: "i1", entityId: "e1", name: "idx_contract_user_id", columnIds: ["c2"], unique: false },
            { id: "i2", entityId: "e1", name: "ux_contract_contract_uuid", columnIds: ["c1"], unique: true },
          ],
        },
      );
      const ix = detectConventions(d).indexNaming;
      expect(ix.indexPrefix).toBe("idx_");
      expect(ix.uniquePrefix).toBe("ux_");
      expect(ix.template).toBe("idx_<table>_<col>");
    });
  });

  describe("comments", () => {
    it("computes coverage and detects Korean comment language", () => {
      const d = docWith([
        entity("e1", "users", [
          col({ name: "id", type: "uuid", comment: "고유 식별자" }),
          col({ name: "email", type: "varchar", comment: "이메일" }),
          col({ name: "age", type: "int" }),
        ]),
      ]);
      const c = detectConventions(d).comments;
      expect(c.coveragePct).toBe(67);
      expect(c.language).toBe("korean");
    });
  });

  describe("empty diagram", () => {
    it("returns unknown/null/empty when there is nothing to infer", () => {
      const d = docWith([]);
      const p = detectConventions(d);
      expect(p.caseStyle).toBe("unknown");
      expect(p.tableNaming.number).toBe("unknown");
      expect(p.tableNaming.commonPrefixes).toEqual([]);
      expect(p.primaryKey.pattern).toBeNull();
      expect(p.primaryKey.typicalType).toBeNull();
      expect(p.foreignKey.pattern).toBeNull();
      expect(p.timestamps).toEqual([]);
      expect(p.indexNaming.indexPrefix).toBeNull();
      expect(p.indexNaming.uniquePrefix).toBeNull();
      expect(p.indexNaming.template).toBeNull();
      expect(p.comments.coveragePct).toBe(0);
      expect(p.comments.language).toBe("unknown");
    });
  });
});
