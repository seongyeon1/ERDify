import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIDiffReviewPanel } from "./AIDiffReviewPanel";
import type { DiffChange } from "@erdify/contracts";
import type { DiagramDocument } from "@erdify/domain";

const makeEmptyDoc = (id = "doc-1"): DiagramDocument => ({
  format: "erdify.schema.v1",
  id,
  name: "Test",
  dialect: "postgresql",
  entities: [],
  relationships: [],
  indexes: [],
  views: [],
  layout: { entityPositions: {} },
  metadata: { revision: 1, stableObjectIds: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
});

const makeDoc = (entities: DiagramDocument["entities"]): DiagramDocument => ({
  ...makeEmptyDoc(),
  entities,
});

describe("AIDiffReviewPanel", () => {
  let onAccept: ReturnType<typeof vi.fn>;
  let onReject: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onAccept = vi.fn();
    onReject = vi.fn();
  });

  // ── addTable changes ────────────────────────────────────────────────────────

  it("addTable 변경이 있을 때 테이블 카드를 렌더링한다", () => {
    const pendingDoc = makeDoc([
      {
        id: "tbl-1",
        name: "users",
        logicalName: null,
        comment: null,
        color: null,
        columns: [
          { id: "col-1", name: "id", type: "uuid", nullable: false, primaryKey: true, unique: false, defaultValue: null, comment: null, ordinal: 0 },
        ],
      },
    ]);

    const diff: DiffChange[] = [{ type: "addTable", tableId: "tbl-1", tableName: "users" }];

    render(
      <AIDiffReviewPanel
        diff={diff}
        pendingDocument={pendingDoc}
        currentDocument={null}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("추가됨")).toBeInTheDocument();
  });

  it("addTable 변경 시 해당 테이블의 컬럼들도 표시된다", () => {
    const pendingDoc = makeDoc([
      {
        id: "tbl-1",
        name: "orders",
        logicalName: null,
        comment: null,
        color: null,
        columns: [
          { id: "col-1", name: "id", type: "uuid", nullable: false, primaryKey: true, unique: false, defaultValue: null, comment: null, ordinal: 0 },
          { id: "col-2", name: "total_price", type: "numeric", nullable: false, primaryKey: false, unique: false, defaultValue: null, comment: null, ordinal: 1 },
        ],
      },
    ]);

    const diff: DiffChange[] = [{ type: "addTable", tableId: "tbl-1", tableName: "orders" }];

    render(
      <AIDiffReviewPanel
        diff={diff}
        pendingDocument={pendingDoc}
        currentDocument={null}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("total_price")).toBeInTheDocument();
  });

  // ── removeTable changes ─────────────────────────────────────────────────────

  it("removeTable 변경이 있을 때 '삭제됨' 배지와 테이블 이름을 렌더링한다", () => {
    const currentDoc = makeDoc([
      {
        id: "tbl-old",
        name: "legacy_table",
        logicalName: null,
        comment: null,
        color: null,
        columns: [
          { id: "col-1", name: "id", type: "uuid", nullable: false, primaryKey: true, unique: false, defaultValue: null, comment: null, ordinal: 0 },
        ],
      },
    ]);
    const pendingDoc = makeDoc([]);

    const diff: DiffChange[] = [{ type: "removeTable", tableId: "tbl-old", tableName: "legacy_table" }];

    render(
      <AIDiffReviewPanel
        diff={diff}
        pendingDocument={pendingDoc}
        currentDocument={currentDoc}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(screen.getByText("legacy_table")).toBeInTheDocument();
    expect(screen.getByText("삭제됨")).toBeInTheDocument();
  });

  // ── column changes within modified tables ───────────────────────────────────

  it("addColumn 변경이 있을 때 '수정됨' 배지와 추가된 컬럼을 렌더링한다", () => {
    const pendingDoc = makeDoc([
      {
        id: "tbl-1",
        name: "users",
        logicalName: null,
        comment: null,
        color: null,
        columns: [
          { id: "col-existing", name: "id", type: "uuid", nullable: false, primaryKey: true, unique: false, defaultValue: null, comment: null, ordinal: 0 },
          { id: "col-new", name: "email", type: "varchar", nullable: false, primaryKey: false, unique: true, defaultValue: null, comment: null, ordinal: 1 },
        ],
      },
    ]);

    const diff: DiffChange[] = [{
      type: "addColumn",
      tableId: "tbl-1",
      tableName: "users",
      columnId: "col-new",
      columnName: "email",
      columnType: "varchar",
    }];

    render(
      <AIDiffReviewPanel
        diff={diff}
        pendingDocument={pendingDoc}
        currentDocument={null}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("수정됨")).toBeInTheDocument();
    expect(screen.getByText("email")).toBeInTheDocument();
  });

  it("removeColumn 변경이 있을 때 해당 컬럼 이름을 렌더링한다", () => {
    const pendingDoc = makeDoc([
      {
        id: "tbl-1",
        name: "products",
        logicalName: null,
        comment: null,
        color: null,
        columns: [
          { id: "col-1", name: "id", type: "uuid", nullable: false, primaryKey: true, unique: false, defaultValue: null, comment: null, ordinal: 0 },
        ],
      },
    ]);

    const diff: DiffChange[] = [{
      type: "removeColumn",
      tableId: "tbl-1",
      tableName: "products",
      columnId: "col-removed",
      columnName: "deprecated_field",
    }];

    render(
      <AIDiffReviewPanel
        diff={diff}
        pendingDocument={pendingDoc}
        currentDocument={null}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(screen.getByText("deprecated_field")).toBeInTheDocument();
  });

  // ── updateTable (테이블 이름 변경) ───────────────────────────────────────────

  it("updateTable 변경 시 old → new 이름과 '이름 변경' 배지를 렌더링한다", () => {
    const col = { id: "col-1", name: "contract_id", type: "uuid", nullable: false, primaryKey: true, unique: false, defaultValue: null, comment: null, ordinal: 0 };
    const currentDoc = makeDoc([{ id: "t1", name: "contract_terms", logicalName: null, comment: null, color: null, columns: [col] }]);
    const pendingDoc = makeDoc([{ id: "t1", name: "ContractTerms", logicalName: null, comment: null, color: null, columns: [col] }]);

    const diff: DiffChange[] = [{ type: "updateTable", tableId: "t1", oldName: "contract_terms", newName: "ContractTerms" }];

    render(
      <AIDiffReviewPanel diff={diff} pendingDocument={pendingDoc} currentDocument={currentDoc} onAccept={onAccept} onReject={onReject} />
    );

    expect(screen.getByText("contract_terms")).toBeInTheDocument();
    expect(screen.getByText("ContractTerms")).toBeInTheDocument();
    expect(screen.getByText("이름 변경")).toBeInTheDocument();
  });

  it("이름만 바뀐 테이블도 기존 컬럼을 그대로 표시한다", () => {
    const col = { id: "col-1", name: "contract_id", type: "uuid", nullable: false, primaryKey: true, unique: false, defaultValue: null, comment: null, ordinal: 0 };
    const currentDoc = makeDoc([{ id: "t1", name: "contract_terms", logicalName: null, comment: null, color: null, columns: [col] }]);
    const pendingDoc = makeDoc([{ id: "t1", name: "ContractTerms", logicalName: null, comment: null, color: null, columns: [col] }]);

    render(
      <AIDiffReviewPanel
        diff={[{ type: "updateTable", tableId: "t1", oldName: "contract_terms", newName: "ContractTerms" }]}
        pendingDocument={pendingDoc}
        currentDocument={currentDoc}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(screen.getByText("contract_id")).toBeInTheDocument();
  });

  // ── catch-all (시각화되지 않은 변경은 '기타 변경'으로 노출) ────────────────────

  it("알려지지 않은 변경 타입도 '기타 변경' 섹션에 노출해 누락을 막는다", () => {
    const diff = [{ type: "futureChange", detail: "x" }] as unknown as DiffChange[];

    render(
      <AIDiffReviewPanel diff={diff} pendingDocument={makeEmptyDoc()} currentDocument={null} onAccept={onAccept} onReject={onReject} />
    );

    expect(screen.getByText("기타 변경")).toBeInTheDocument();
  });

  // ── 수락 / 거절 버튼 ─────────────────────────────────────────────────────────

  it("'수락' 버튼 클릭 시 onAccept를 호출한다", () => {
    render(
      <AIDiffReviewPanel
        diff={[{ type: "addTable", tableId: "t1", tableName: "foo" }]}
        pendingDocument={makeDoc([{ id: "t1", name: "foo", logicalName: null, comment: null, color: null, columns: [] }])}
        currentDocument={null}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "수락" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });

  it("'거절' 버튼 클릭 시 onReject를 호출한다", () => {
    render(
      <AIDiffReviewPanel
        diff={[{ type: "addTable", tableId: "t1", tableName: "foo" }]}
        pendingDocument={makeDoc([{ id: "t1", name: "foo", logicalName: null, comment: null, color: null, columns: [] }])}
        currentDocument={null}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "거절" }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("오버레이 배경 클릭 시 onReject를 호출한다", () => {
    const { container } = render(
      <AIDiffReviewPanel
        diff={[{ type: "addTable", tableId: "t1", tableName: "foo" }]}
        pendingDocument={makeDoc([{ id: "t1", name: "foo", logicalName: null, comment: null, color: null, columns: [] }])}
        currentDocument={null}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    // Click the overlay element itself (first child of container), not the inner panel
    const overlay = container.firstChild as HTMLElement;
    fireEvent.click(overlay);

    expect(onReject).toHaveBeenCalledTimes(1);
  });

  // ── relation changes ────────────────────────────────────────────────────────

  it("addRelation 변경이 있을 때 관계 정보를 렌더링한다", () => {
    render(
      <AIDiffReviewPanel
        diff={[{
          type: "addRelation",
          relationId: "rel-1",
          fromTable: "orders",
          toTable: "users",
          cardinality: "many-to-one",
        }]}
        pendingDocument={makeEmptyDoc()}
        currentDocument={null}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(screen.getByText(/orders/i)).toBeInTheDocument();
    expect(screen.getByText(/users/i)).toBeInTheDocument();
    expect(screen.getByText(/many-to-one/i)).toBeInTheDocument();
  });

  it("removeRelation 변경이 있을 때 관계 행을 렌더링한다", () => {
    render(
      <AIDiffReviewPanel
        diff={[{
          type: "removeRelation",
          relationId: "rel-2",
          fromTable: "invoices",
          toTable: "clients",
        }]}
        pendingDocument={makeEmptyDoc()}
        currentDocument={null}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(screen.getByText(/invoices/i)).toBeInTheDocument();
    expect(screen.getByText(/clients/i)).toBeInTheDocument();
  });

  it("변경사항 개수를 헤더 배지에 표시한다", () => {
    const diff: DiffChange[] = [
      { type: "addTable", tableId: "t1", tableName: "a" },
      { type: "addTable", tableId: "t2", tableName: "b" },
      { type: "addTable", tableId: "t3", tableName: "c" },
    ];

    render(
      <AIDiffReviewPanel
        diff={diff}
        pendingDocument={makeDoc([
          { id: "t1", name: "a", logicalName: null, comment: null, color: null, columns: [] },
          { id: "t2", name: "b", logicalName: null, comment: null, color: null, columns: [] },
          { id: "t3", name: "c", logicalName: null, comment: null, color: null, columns: [] },
        ])}
        currentDocument={null}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(screen.getByText("3개 변경사항")).toBeInTheDocument();
  });

  it("PK 컬럼에 PK 배지를 표시한다", () => {
    const pendingDoc = makeDoc([
      {
        id: "tbl-1",
        name: "users",
        logicalName: null,
        comment: null,
        color: null,
        columns: [
          { id: "col-pk", name: "id", type: "uuid", nullable: false, primaryKey: true, unique: false, defaultValue: null, comment: null, ordinal: 0 },
        ],
      },
    ]);

    render(
      <AIDiffReviewPanel
        diff={[{ type: "addTable", tableId: "tbl-1", tableName: "users" }]}
        pendingDocument={pendingDoc}
        currentDocument={null}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(screen.getByText("PK")).toBeInTheDocument();
  });
});
