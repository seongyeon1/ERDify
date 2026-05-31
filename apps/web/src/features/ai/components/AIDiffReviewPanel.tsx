import type { DiffChange } from "@erdify/contracts";
import type { DiagramDocument } from "@erdify/domain";
import * as css from "./AIDiffReviewPanel.css";

interface ColumnReview {
  id: string;
  name: string;
  type: string;
  isPk: boolean;
  comment?: string;
  changeType: "added" | "removed" | "modified" | "unchanged";
}

interface IndexReview {
  indexId: string;
  tableName: string;
  indexName: string;
  columnNames: string[];
  unique: boolean;
}

interface TableReview {
  tableId: string;
  tableName: string;
  changeType: "added" | "removed" | "modified";
  /** 이름이 바뀐 경우 이전 이름(헤더에 old → new로 표시). */
  renamedFrom?: string;
  columns: ColumnReview[];
}

/** 어떤 섹션으로도 시각화되지 않은 변경. 카운트와 화면이 어긋나지 않도록 항상 노출한다. */
interface OtherChange {
  id: string;
  label: string;
}

interface RelationReview {
  relationId: string;
  fromTable: string;
  toTable: string;
  cardinality: string;
  changeType: "added" | "removed";
}

const buildReview = (
  diff: DiffChange[],
  currentDoc: DiagramDocument | null,
  pendingDoc: DiagramDocument,
): { tables: TableReview[]; relations: RelationReview[]; indexes: IndexReview[]; others: OtherChange[] } => {
  const tableMap = new Map<string, TableReview>();
  const others: OtherChange[] = [];

  const getTableReview = (tableId: string, tableName: string, changeType: TableReview["changeType"]): TableReview => {
    if (!tableMap.has(tableId)) {
      tableMap.set(tableId, { tableId, tableName, changeType, columns: [] });
    }
    return tableMap.get(tableId)!;
  };

  for (const [i, change] of diff.entries()) {
    switch (change.type) {
      case "updateTable": {
        const review = getTableReview(change.tableId, change.newName, "modified");
        review.tableName = change.newName;
        review.renamedFrom = change.oldName;
        break;
      }
      case "addTable": {
        const entity = pendingDoc.entities.find((e) => e.id === change.tableId);
        const review = getTableReview(change.tableId, change.tableName, "added");
        review.columns = (entity?.columns ?? []).map((c) => ({
          id: c.id, name: c.name, type: c.type, isPk: c.primaryKey, changeType: "added" as const,
          ...(c.comment ? { comment: c.comment } : {}),
        }));
        break;
      }
      case "removeTable": {
        const entity = currentDoc?.entities.find((e) => e.id === change.tableId);
        const review = getTableReview(change.tableId, change.tableName, "removed");
        review.columns = (entity?.columns ?? []).map((c) => ({
          id: c.id, name: c.name, type: c.type, isPk: c.primaryKey, changeType: "removed",
        }));
        break;
      }
      case "addColumn": {
        const review = getTableReview(change.tableId, change.tableName, "modified");
        if (!review.columns.some((c) => c.id === change.columnId)) {
          review.columns.push({ id: change.columnId, name: change.columnName, type: change.columnType, isPk: false, changeType: "added", ...(change.comment ? { comment: change.comment } : {}) });
        }
        break;
      }
      case "removeColumn": {
        const review = getTableReview(change.tableId, change.tableName, "modified");
        if (!review.columns.some((c) => c.id === change.columnId)) {
          review.columns.push({ id: change.columnId, name: change.columnName, type: "", isPk: false, changeType: "removed" });
        }
        break;
      }
      case "updateColumn": {
        const review = getTableReview(change.tableId, change.tableName, "modified");
        const entity = pendingDoc.entities.find((e) => e.id === change.tableId);
        const col = entity?.columns.find((c) => c.id === change.columnId);
        if (col && !review.columns.some((c) => c.id === change.columnId)) {
          review.columns.push({ id: col.id, name: col.name, type: col.type, isPk: col.primaryKey, changeType: "modified" });
        }
        break;
      }
      // 관계/인덱스는 아래에서 따로 모으므로 여기서는 통과시킨다.
      case "addRelation":
      case "removeRelation":
      case "addIndex":
        break;
      // 시각화 케이스가 없는 변경(향후 추가될 타입 등)은 절대 조용히 버리지 않고 '기타 변경'에 노출한다.
      default: {
        const unknown = change as { type?: string };
        others.push({ id: `other-${i}`, label: unknown.type ?? "알 수 없는 변경" });
      }
    }
  }

  // modified 테이블은 변경되지 않은 컬럼도 함께 표시
  for (const review of tableMap.values()) {
    if (review.changeType !== "modified") continue;
    const entity = pendingDoc.entities.find((e) => e.id === review.tableId);
    if (!entity) continue;
    for (const col of entity.columns) {
      if (!review.columns.some((c) => c.id === col.id)) {
        review.columns.push({ id: col.id, name: col.name, type: col.type, isPk: col.primaryKey, changeType: "unchanged", ...(col.comment ? { comment: col.comment } : {}) });
      }
    }
    // 정렬: PK 먼저, 변경된 것 위로
    review.columns.sort((a, b) => {
      if (a.isPk !== b.isPk) return a.isPk ? -1 : 1;
      const order = { added: 0, removed: 1, modified: 2, unchanged: 3 };
      return order[a.changeType] - order[b.changeType];
    });
  }

  const relations: RelationReview[] = diff
    .filter((c): c is Extract<DiffChange, { type: "addRelation" | "removeRelation" }> =>
      c.type === "addRelation" || c.type === "removeRelation"
    )
    .map((c) =>
      c.type === "addRelation"
        ? { relationId: c.relationId, fromTable: c.fromTable, toTable: c.toTable, cardinality: c.cardinality, changeType: "added" as const }
        : { relationId: c.relationId, fromTable: c.fromTable, toTable: c.toTable, cardinality: "", changeType: "removed" as const }
    );

  const indexes: IndexReview[] = diff
    .filter((c): c is Extract<DiffChange, { type: "addIndex" }> => c.type === "addIndex")
    .map((c) => ({ indexId: c.indexId, tableName: c.tableName, indexName: c.indexName, columnNames: c.columnNames, unique: c.unique }));

  return { tables: Array.from(tableMap.values()), relations, indexes, others };
};

const hasColumnChanges = (table: TableReview): boolean =>
  table.columns.some((c) => c.changeType !== "unchanged");

/** 테이블 카드 배지: 이름만 바뀐 경우 '이름 변경', 그 외에는 변경 종류 라벨. */
const tableBadgeLabel = (table: TableReview): string =>
  table.renamedFrom && !hasColumnChanges(table) ? "이름 변경" : CHANGE_LABEL[table.changeType];

const CHANGE_LABEL: Record<TableReview["changeType"], string> = {
  added: "추가됨",
  removed: "삭제됨",
  modified: "수정됨",
};

const COLUMN_MARKER: Record<ColumnReview["changeType"], string> = {
  added: "+",
  removed: "-",
  modified: "~",
  unchanged: " ",
};

const tableHeaderClass = (changeType: TableReview["changeType"]) => {
  if (changeType === "added") return `${css.tableHeader} ${css.tableHeaderAdded}`;
  if (changeType === "removed") return `${css.tableHeader} ${css.tableHeaderRemoved}`;
  return `${css.tableHeader} ${css.tableHeaderModified}`;
};

const tableCardClass = (changeType: TableReview["changeType"]) => {
  if (changeType === "added") return `${css.tableCard} ${css.tableCardAdded}`;
  if (changeType === "removed") return `${css.tableCard} ${css.tableCardRemoved}`;
  return `${css.tableCard} ${css.tableCardModified}`;
};

const columnRowClass = (changeType: ColumnReview["changeType"]) => {
  if (changeType === "added") return `${css.columnRow} ${css.columnRowAdded}`;
  if (changeType === "removed") return `${css.columnRow} ${css.columnRowRemoved}`;
  if (changeType === "modified") return `${css.columnRow} ${css.columnRowModified}`;
  return css.columnRow;
};

interface AIDiffReviewPanelProps {
  diff: DiffChange[];
  pendingDocument: DiagramDocument;
  currentDocument: DiagramDocument | null;
  onAccept: () => void;
  onReject: () => void;
}

export const AIDiffReviewPanel = ({ diff, pendingDocument, currentDocument, onAccept, onReject }: AIDiffReviewPanelProps) => {
  const { tables, relations, indexes, others } = buildReview(diff, currentDocument, pendingDocument);

  return (
    <div className={css.overlay} onClick={(e) => { if (e.target === e.currentTarget) onReject(); }}>
      <div className={css.panel}>
        <div className={css.header}>
          <span className={css.headerTitle}>AI 제안 검토</span>
          <span className={css.headerBadge}>{diff.length}개 변경사항</span>
          <button type="button" className={css.rejectBtn} onClick={onReject}>거절</button>
          <button type="button" className={css.acceptBtn} onClick={onAccept}>수락</button>
        </div>

        <div className={css.body}>
          {tables.length > 0 && (
            <div>
              <div className={css.sectionTitle}>테이블</div>
              <div className={css.tablesGrid}>
                {tables.map((table) => (
                  <div key={table.tableId} className={tableCardClass(table.changeType)}>
                    <div className={tableHeaderClass(table.changeType)}>
                      {table.renamedFrom && table.renamedFrom !== table.tableName ? (
                        <span className={css.tableName}>
                          <span style={{ textDecoration: "line-through", opacity: 0.6 }}>{table.renamedFrom}</span>
                          {" → "}
                          <span>{table.tableName}</span>
                        </span>
                      ) : (
                        <span className={css.tableName}>{table.tableName}</span>
                      )}
                      <span className={css.tableChangeBadge}>{tableBadgeLabel(table)}</span>
                    </div>
                    <div className={css.columnList}>
                      {table.columns.map((col) => (
                        <div key={col.id} className={columnRowClass(col.changeType)}>
                          <span className={css.columnChangeMarker}>{COLUMN_MARKER[col.changeType]}</span>
                          {col.isPk && <span className={css.pkBadge}>PK</span>}
                          <span className={css.columnName}>{col.name}</span>
                          {col.comment && <span className={css.columnComment}>{col.comment}</span>}
                          {col.type && <span className={css.columnType}>{col.type}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {indexes.length > 0 && (
            <div>
              <div className={css.sectionTitle}>인덱스</div>
              <div className={css.relationsSection}>
                {indexes.map((idx) => (
                  <div key={idx.indexId} className={`${css.relationRow} ${css.relationRowAdded}`}>
                    <span>+</span>
                    <span>{idx.indexName}</span>
                    <span style={{ opacity: 0.7, fontSize: "11px" }}>({idx.tableName}: {idx.columnNames.join(", ")}{idx.unique ? ", UNIQUE" : ""})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {relations.length > 0 && (
            <div>
              <div className={css.sectionTitle}>관계</div>
              <div className={css.relationsSection}>
                {relations.map((rel) => (
                  <div
                    key={rel.relationId}
                    className={rel.changeType === "added" ? `${css.relationRow} ${css.relationRowAdded}` : `${css.relationRow} ${css.relationRowRemoved}`}
                  >
                    <span>{rel.changeType === "added" ? "+" : "-"}</span>
                    <span>{rel.fromTable} → {rel.toTable}</span>
                    {rel.cardinality && <span style={{ opacity: 0.7, fontSize: "11px" }}>({rel.cardinality})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {others.length > 0 && (
            <div>
              <div className={css.sectionTitle}>기타 변경</div>
              <div className={css.relationsSection}>
                {others.map((o) => (
                  <div key={o.id} className={css.relationRow}>
                    <span>•</span>
                    <span>{o.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
