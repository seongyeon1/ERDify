import type { DiagramColumn, DiagramDocument } from "../types/index.js";

/**
 * 다이어그램에서 코드로 추출한 결정적 네이밍/구조 컨벤션 프로필.
 * AI가 새 테이블/컬럼/인덱스를 만들 때 "이미 적용된 규칙"을 그대로 따르도록 프롬프트에
 * 주입한다. 원본 문서에서 계산하므로 컨텍스트가 요약돼도 규칙 근거가 사라지지 않는다.
 */
export interface ConventionProfile {
  caseStyle: "snake" | "camel" | "mixed" | "unknown";
  tableNaming: { number: "plural" | "singular" | "mixed" | "unknown"; commonPrefixes: string[] };
  /** "id" | "<table>_id" | "uuid" | "seq" | null */
  primaryKey: { pattern: string | null; typicalType: string | null };
  /** "<table>_id" | "<table>Id" | "<table>No" | null */
  foreignKey: { pattern: string | null };
  /** 실제로 쓰이는 타임스탬프 컬럼명, 빈도 내림차순 (예: ["created_at","updated_at"], ["reg_dt","mod_dt"]). */
  timestamps: string[];
  indexNaming: { uniquePrefix: string | null; indexPrefix: string | null; template: string | null };
  comments: { coveragePct: number; language: "korean" | "english" | "mixed" | "unknown" };
}

/** 알려진 생성/수정/삭제 시각 컬럼명(소문자 비교). */
const TIMESTAMP_NAMES = new Set([
  "created_at", "updated_at", "deleted_at",
  "createdat", "updatedat", "deletedat",
  "create_dt", "update_dt", "reg_dt", "mod_dt", "del_dt",
  "regdate", "moddate", "created_date", "updated_date",
  "created", "updated", "modified",
]);

const HANGUL = /[가-힣]/;

function caseStyle(name: string): "snake" | "camel" | "ambiguous" {
  const hasUpper = /[A-Z]/.test(name);
  const hasUnderscore = name.includes("_");
  if (hasUnderscore && !hasUpper) return "snake";
  if (hasUpper && !hasUnderscore) return "camel";
  return "ambiguous";
}

/** 빈도 최빈값(동률이면 처음 등장한 값). 후보가 없으면 null. */
function mode<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function classifyPkPattern(name: string): string | null {
  if (name === "id") return "id";
  if (name === "uuid") return "uuid";
  if (name === "seq" || name.endsWith("_seq")) return "seq";
  if (name.endsWith("_id")) return "<table>_id";
  return null;
}

function classifyFkPattern(name: string): string | null {
  if (name.endsWith("_id")) return "<table>_id";
  if (name.endsWith("Id")) return "<table>Id";
  if (name.endsWith("No") || name.endsWith("_no")) return "<table>No";
  return null;
}

/** 인덱스 이름의 접두사 토큰(첫 '_'까지, 포함). 언더스코어가 없으면 null. */
function indexPrefixOf(name: string): string | null {
  const i = name.indexOf("_");
  return i > 0 ? name.slice(0, i + 1) : null;
}

/**
 * 다이어그램의 컨벤션을 결정적으로 추출한다.
 * 순수 함수 — 입력을 변경하지 않으며 동일 입력에 항상 동일 출력(LLM 호출 없음).
 */
export function detectConventions(doc: DiagramDocument): ConventionProfile {
  const entities = doc.entities ?? [];
  const relationships = doc.relationships ?? [];
  const indexes = doc.indexes ?? [];
  const allColumns = entities.flatMap((e) => e.columns);

  // 1) 케이스 스타일 (컬럼명 기준)
  const styles = allColumns.map((c) => caseStyle(c.name));
  const snake = styles.filter((s) => s === "snake").length;
  const camel = styles.filter((s) => s === "camel").length;
  const caseResult: ConventionProfile["caseStyle"] =
    snake > 0 && camel > 0 ? "mixed" : snake > 0 ? "snake" : camel > 0 ? "camel" : "unknown";

  // 2) 테이블 단/복수 + 공통 접두사
  const tableNames = entities.map((e) => e.name);
  const plural = tableNames.filter((n) => n.endsWith("s")).length;
  const singular = tableNames.length - plural;
  const number: ConventionProfile["tableNaming"]["number"] =
    tableNames.length === 0 ? "unknown" : plural > singular ? "plural" : singular > plural ? "singular" : "mixed";
  const prefixCounts = new Map<string, number>();
  for (const n of tableNames) {
    const p = indexPrefixOf(n);
    if (p) prefixCounts.set(p, (prefixCounts.get(p) ?? 0) + 1);
  }
  const commonPrefixes = [...prefixCounts.entries()].filter(([, c]) => c >= 2).map(([p]) => p);

  // 3) PK 패턴 + 타입
  const pkColumns = entities.flatMap((e) => e.columns.filter((c) => c.primaryKey));
  const pkPatterns = pkColumns.map((c) => classifyPkPattern(c.name)).filter((p): p is string => p !== null);
  const primaryKey = {
    pattern: mode(pkPatterns),
    typicalType: mode(pkColumns.map((c) => c.type)),
  };

  // 4) FK 패턴 (관계의 source 컬럼명 기준)
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const fkColumns: DiagramColumn[] = [];
  for (const rel of relationships) {
    const src = entityById.get(rel.sourceEntityId);
    if (!src) continue;
    for (const cid of rel.sourceColumnIds) {
      const c = src.columns.find((x) => x.id === cid);
      if (c) fkColumns.push(c);
    }
  }
  const foreignKey = {
    pattern: mode(fkColumns.map((c) => classifyFkPattern(c.name)).filter((p): p is string => p !== null)),
  };

  // 5) 타임스탬프 컬럼명 (빈도 내림차순)
  const tsCounts = new Map<string, number>();
  for (const c of allColumns) {
    if (TIMESTAMP_NAMES.has(c.name.toLowerCase())) tsCounts.set(c.name, (tsCounts.get(c.name) ?? 0) + 1);
  }
  const timestamps = [...tsCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);

  // 6) 인덱스 네이밍 접두사 + 템플릿
  const uniquePrefixes = indexes.filter((i) => i.unique).map((i) => indexPrefixOf(i.name)).filter((p): p is string => p !== null);
  const plainPrefixes = indexes.filter((i) => !i.unique).map((i) => indexPrefixOf(i.name)).filter((p): p is string => p !== null);
  const indexPrefix = mode(plainPrefixes);
  const indexNaming = {
    uniquePrefix: mode(uniquePrefixes),
    indexPrefix,
    template: indexPrefix ? `${indexPrefix}<table>_<col>` : null,
  };

  // 7) 코멘트 커버리지 + 언어
  const withComment = allColumns.filter((c) => c.comment && c.comment.trim().length > 0);
  const coveragePct = allColumns.length === 0 ? 0 : Math.round((withComment.length / allColumns.length) * 100);
  const korean = withComment.filter((c) => HANGUL.test(c.comment!)).length;
  const english = withComment.filter((c) => !HANGUL.test(c.comment!) && /[A-Za-z]/.test(c.comment!)).length;
  const language: ConventionProfile["comments"]["language"] =
    korean > 0 && english > 0 ? "mixed" : korean > 0 ? "korean" : english > 0 ? "english" : "unknown";

  return {
    caseStyle: caseResult,
    tableNaming: { number, commonPrefixes },
    primaryKey,
    foreignKey,
    timestamps,
    indexNaming,
    comments: { coveragePct, language },
  };
}
