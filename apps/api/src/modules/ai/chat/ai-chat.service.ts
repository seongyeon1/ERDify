import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User, Organization } from "@erdify/db";
import type { DiffChange } from "@erdify/contracts";
import type { DiagramDocument } from "@erdify/domain";
import { AiService } from "../ai.service";
import { AiHistoryService } from "../ai-history.service";
import { ToolExecutor } from "../tools/tool-executor";
import { DomainLoaderService } from "../../../common/services/domain-loader.service";
import { UsageService } from "../../usage/usage.service";
import { AnthropicProvider } from "../providers/anthropic.provider";
import { OpenAiProvider } from "../providers/openai.provider";
import { GeminiProvider } from "../providers/gemini.provider";
import { buildSystemPrompt } from "../context/context-builder";
import { classifyIntent } from "../context/intent";
import { ERD_TOOLS } from "../erd-tools";
import { READ_TOOLS } from "../tools/read-tools";
import type { ConvMessage, AiProvider, NormalizedToolCall } from "../providers/provider.types";

const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 8;
/** 적용 전 자동검증에서 새 오류가 나오면 모델에게 수정 기회를 주는 최대 횟수. */
const MAX_VALIDATION_RETRIES = 2;
const READ_TOOL_NAMES = new Set(["listTables", "getTableDetails"]);
const APPLY_NUDGE =
  "Now apply the schema improvements you just identified using the editing tools (addRelation, addIndex, addTable, addColumn, updateColumn, removeColumn, etc.) so the user gets a reviewable diff. Make the concrete changes now — do not just describe them again. If, and only if, no change is actually warranted, reply in one short sentence saying the schema is already fine.";

/** SSE 이벤트 (프론트 sendAiChatStream과 호환되는 master 프로토콜). */
export type StreamEvent =
  | { event: "text"; delta: string }
  | { event: "status"; label: string } // 도구 진행 표시(메시지 본문에 누적되지 않는 일시적 상태)
  | { event: "done"; messageId: string; content: string; diff: DiffChange[] | null; pendingDocument: DiagramDocument | null }
  | { event: "error"; message: string };

export interface RunChatParams {
  userId: string;
  diagramId: string;
  message: string;
  sessionId: string | null;
  model?: string;
  isAborted?: () => boolean;
}

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly historyService: AiHistoryService,
    private readonly toolExecutor: ToolExecutor,
    private readonly usageService: UsageService,
    private readonly anthropic: AnthropicProvider,
    private readonly openai: OpenAiProvider,
    private readonly gemini: GeminiProvider,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Organization) private readonly orgRepo: Repository<Organization>,
    private readonly domainLoader: DomainLoaderService,
  ) {}

  async runChat(params: RunChatParams, emit: (e: StreamEvent) => void): Promise<void> {
    const { userId, diagramId, message, sessionId } = params;
    try {
      const { doc, orgId, diagramName } = await this.aiService.getDiagramAndOrgId(diagramId);
      const { apiKey, provider, model } = await this.aiService.resolveChatCredentials(orgId, userId, params.model?.trim());

      const [user, org] = await Promise.all([
        this.userRepo.findOne({ where: { id: userId } }),
        this.orgRepo.findOne({ where: { id: orgId } }),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const domain = await this.domainLoader.load();
      // ① 결정적 스키마 분석 → VERIFIED FACTS로 주입 (추측이 아닌 코드 계산 결과)
      const facts = domain.analyzeSchema(doc);
      // ② 적용 전 검증의 기준선: 원본 문서에 이미 존재하던 오류는 AI 책임이 아니므로 제외한다
      const baseErrors = new Set([...domain.validateDiagram(doc).errors, ...extraIntegrityErrors(doc)]);
      // ④ 스키마-RAG: 큰 다이어그램에서 질의 관련 테이블을 완전한 형태로 포함하기 위한 선택
      const focusTableIds = domain.selectRelevantTables(doc, message);
      // ⑤ 의도 분류: 의도별 가이드 + 근거기반 규칙을 프롬프트에 반영
      const intent = classifyIntent(message);
      // ⑥ 컨벤션 추출: 새 객체 생성 시 기존 규칙을 그대로 따르도록 주입(요약돼도 근거 유지)
      const conventions = domain.detectConventions(doc);
      const system = buildSystemPrompt(
        doc,
        {
          userName: user?.name ?? "Unknown",
          userEmail: user?.email ?? "",
          orgName: org?.name ?? "",
          diagramId,
          diagramName,
          today,
        },
        facts,
        { focusTableIds, intent, conventions },
      );

      const history = await this.historyService.findRecentTurns(userId, diagramId, sessionId);
      await this.historyService.saveUserMessage(userId, diagramId, message, sessionId);

      const tools = [...ERD_TOOLS, ...READ_TOOLS];
      const impl: AiProvider = provider === "openai" ? this.openai : provider === "gemini" ? this.gemini : this.anthropic;
      const messages: ConvMessage[] = [...history, { role: "user", content: message }];

      let updatedDoc: DiagramDocument = doc;
      const diffs: DiffChange[] = [];
      const allToolCalls: NormalizedToolCall[] = [];
      let finalText = "";
      let usedReadTools = false;
      let nudgedToApply = false;
      let validationAttempts = 0;

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        if (params.isAborted?.()) return;
        const turn = await impl.streamTurn({
          apiKey,
          model,
          system,
          messages,
          tools,
          maxTokens: MAX_TOKENS,
          onText: (d) => emit({ event: "text", delta: d }),
        });
        finalText = turn.text;
        if (turn.toolCalls.length === 0) {
          // 스키마를 조회(분석)만 하고 변경 없이 끝나면 한 번 적용을 유도
          if (!nudgedToApply && usedReadTools && diffs.length === 0) {
            nudgedToApply = true;
            messages.push({ role: "assistant", text: turn.text, toolCalls: [] });
            messages.push({ role: "user", content: APPLY_NUDGE });
            continue;
          }
          // ② 적용 전 자동검증: 변경이 있으면 커밋 전에 무결성을 확인하고,
          //    AI가 새로 만든 오류가 있으면 모델에게 수정 기회를 준다.
          if (diffs.length > 0 && validationAttempts < MAX_VALIDATION_RETRIES) {
            const newErrors = [...domain.validateDiagram(updatedDoc).errors, ...extraIntegrityErrors(updatedDoc)]
              .filter((e) => !baseErrors.has(e));
            if (newErrors.length > 0) {
              validationAttempts++;
              this.logger.warn(`AI proposed invalid changes for diagram ${diagramId}: ${newErrors.join(" | ")}`);
              messages.push({ role: "assistant", text: turn.text, toolCalls: [] });
              messages.push({
                role: "user",
                content: `제안한 변경이 스키마 검증에 실패했어. 다음 문제를 편집 도구로 직접 수정해줘(없는 id/컬럼을 참조하지 말고, 필요하면 listTables·getTableDetails로 실제 id를 먼저 확인해):\n- ${newErrors.join("\n- ")}`,
              });
              continue;
            }
          }
          break;
        }

        messages.push({ role: "assistant", text: turn.text, toolCalls: turn.toolCalls });
        const results: { toolCallId: string; toolName: string; content: string }[] = [];
        for (const call of turn.toolCalls) {
          allToolCalls.push(call);
          if (READ_TOOL_NAMES.has(call.name)) usedReadTools = true;
          emit({ event: "status", label: toolLabel(call) });
          const res = await this.toolExecutor.execute(call.name, call.input, updatedDoc);
          updatedDoc = res.doc;
          for (const ch of res.changes) diffs.push(ch);
          results.push({ toolCallId: call.id, toolName: call.name, content: res.resultText });
        }
        messages.push({ role: "tool", results });
        if (i === MAX_ITERATIONS - 1) this.logger.warn(`AI loop hit MAX_ITERATIONS for diagram ${diagramId}`);
      }

      const hasDiff = diffs.length > 0;
      const content = finalText || (hasDiff ? "ERD를 업데이트했습니다. 아래 변경사항을 확인해주세요." : "");
      const saved = await this.historyService.saveAssistantMessage(
        userId,
        diagramId,
        content,
        hasDiff ? diffs : null,
        allToolCalls.length ? (allToolCalls as unknown as Record<string, unknown>[]) : null,
        sessionId,
      );

      this.usageService
        .log(orgId, userId, "ai_chat", "diagram", diagramId, { provider, model, tool_call_count: allToolCalls.length })
        .catch((e) => this.logger.error(e));

      emit({
        event: "done",
        messageId: saved.id,
        content,
        diff: hasDiff ? diffs : null,
        pendingDocument: hasDiff ? updatedDoc : null,
      });
    } catch (e) {
      this.logger.error(e);
      emit({ event: "error", message: e instanceof Error ? e.message : "AI 처리 중 오류가 발생했습니다." });
    }
  }
}

/**
 * validateDiagram(format/관계 엔티티 참조)이 못 잡는 참조 무결성 오류를 추가로 수집한다.
 * AI가 만든 변경이 구조적으로 일관적인지 확인하는 용도(무할루시네이션 안전망).
 */
function extraIntegrityErrors(doc: DiagramDocument): string[] {
  const errors: string[] = [];
  const entityById = new Map(doc.entities.map((e) => [e.id, e]));

  for (const entity of doc.entities) {
    const seen = new Set<string>();
    for (const col of entity.columns) {
      const key = col.name.toLowerCase();
      if (seen.has(key)) errors.push(`Table "${entity.name}" has duplicate column name "${col.name}".`);
      seen.add(key);
    }
  }

  for (const rel of doc.relationships) {
    const src = entityById.get(rel.sourceEntityId);
    if (src) {
      for (const cid of rel.sourceColumnIds) {
        if (!src.columns.some((c) => c.id === cid)) {
          errors.push(`Relationship ${rel.id} references missing source column ${cid} on "${src.name}".`);
        }
      }
    }
    const tgt = entityById.get(rel.targetEntityId);
    if (tgt) {
      for (const cid of rel.targetColumnIds) {
        if (!tgt.columns.some((c) => c.id === cid)) {
          errors.push(`Relationship ${rel.id} references missing target column ${cid} on "${tgt.name}".`);
        }
      }
    }
  }

  for (const idx of doc.indexes) {
    const entity = entityById.get(idx.entityId);
    if (!entity) {
      errors.push(`Index ${idx.name || idx.id} references missing table ${idx.entityId}.`);
      continue;
    }
    for (const cid of idx.columnIds) {
      if (!entity.columns.some((c) => c.id === cid)) {
        errors.push(`Index "${idx.name || idx.id}" references missing column ${cid} on "${entity.name}".`);
      }
    }
  }

  return errors;
}

function toolLabel(call: NormalizedToolCall): string {
  const name = (call.input["name"] as string) ?? "";
  switch (call.name) {
    case "addTable": return `${name} 테이블 생성 중`;
    case "removeTable": return "테이블 삭제 중";
    case "updateTable": return "테이블 수정 중";
    case "addColumn": return `${name} 컬럼 추가 중`;
    case "removeColumn": return "컬럼 삭제 중";
    case "updateColumn": return "컬럼 수정 중";
    case "addRelation": return "관계 추가 중";
    case "removeRelation": return "관계 삭제 중";
    case "addIndex": return "인덱스 추가 중";
    case "listTables": return "스키마 조회 중";
    case "getTableDetails": return "테이블 상세 조회 중";
    default: return `${call.name} 실행 중`;
  }
}
