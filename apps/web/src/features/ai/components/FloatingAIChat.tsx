import { randomUUID } from "@/shared/utils/uuid";
import React, { useRef, useEffect, useState } from "react";
import { useAIChatStore } from "../store/useAIChatStore";
import { DEFAULT_SESSION_ID } from "../store/aiChatSlice";
import { MessageBubble } from "./MessageBubble";
import { AIDiffReviewPanel } from "./AIDiffReviewPanel";
import { acceptAiDiff, rejectAiDiff, sendAiChatStream, getSessions, createSession, getAiChatConfig } from "../api/ai.api";
import { AIChatSessionSelector } from "./AIChatSessionSelector";
import { PROVIDER_LABELS, AI_PROVIDERS, type AiModelOption } from "../models";
import { useEditorStore } from "@/features/editor/store/useEditorStore";
import * as s from "./FloatingAIChat.css";

interface FloatingAIChatProps {
  diagramId: string;
}

const MODEL_STORAGE_KEY = "erdify.ai.model";

export const FloatingAIChat = ({ diagramId }: FloatingAIChatProps) => {
  const {
    isOpen, isLoading,
    reviewingMessageId, openReview, closeReview,
    openChat, closeChat,
    addUserMessage,
    acceptDiff, rejectDiff,
    currentSessionId, sessions, sessionMessages,
    setCurrentSession, setSessions, addSession,
    setCurrentDiagramId, streamingStatus, setStreamingStatus,
    startStreamingMessage, appendStreamingDelta, finalizeStreamingMessage,
  } = useAIChatStore();
  const [input, setInput] = useState("");
  const [models, setModels] = useState<AiModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevDiagramIdRef = useRef<string | null>(null);

  // diagramId 변경 감지 — 세션 목록 + 사용 가능 모델을 불러온다
  useEffect(() => {
    if (prevDiagramIdRef.current === diagramId) return;
    prevDiagramIdRef.current = diagramId;

    setCurrentDiagramId(diagramId);
    getSessions(diagramId)
      .then((fetchedSessions) => setSessions(fetchedSessions))
      .catch(() => {});
    getAiChatConfig(diagramId)
      .then((config) => {
        setModels(config.models);
        const saved = localStorage.getItem(MODEL_STORAGE_KEY) ?? "";
        const valid = config.models.some((m) => m.value === saved);
        setSelectedModel(valid ? saved : (config.models[0]?.value ?? ""));
      })
      .catch(() => {});
  }, [diagramId, setCurrentDiagramId, setSessions]);

  const handleModelChange = (value: string) => {
    setSelectedModel(value);
    localStorage.setItem(MODEL_STORAGE_KEY, value);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessionMessages]);

  const currentMessages = sessionMessages[currentSessionId ?? DEFAULT_SESSION_ID] ?? [];

  const buildStreamingCallbacks = (sessionId: string, tempId: string) => ({
    onText: (delta: string) => appendStreamingDelta(sessionId, tempId, delta),
    onDone: (result: { messageId: string; diff: unknown[] | null; pendingDocument: unknown | null }) =>
      finalizeStreamingMessage(sessionId, tempId, result),
    onError: (errorMsg: string) =>
      finalizeStreamingMessage(sessionId, tempId, {
        messageId: randomUUID(),
        content: `오류가 발생했습니다: ${errorMsg}`,
        diff: null,
        pendingDocument: null,
      }),
  });

  const handleSend = async (message: string) => {
    let sessionId = currentSessionId;

    if (!sessionId) {
      try {
        const { sessionId: newSessionId } = await createSession(diagramId);
        const newSession = {
          id: newSessionId,
          name: "새 대화",
          createdAt: new Date().toISOString(),
        };
        addSession(newSession);
        setCurrentSession(newSessionId);
        sessionId = newSessionId;
      } catch {
        // 세션 생성 실패 시 default 세션으로 폴백
        sessionId = DEFAULT_SESSION_ID;
      }
    }

    addUserMessage(message, sessionId);

    const tempId = randomUUID();
    startStreamingMessage(sessionId, tempId);

    const { onText, onDone, onError } = buildStreamingCallbacks(sessionId, tempId);

    try {
      // 에디터의 라이브 문서를 함께 보내 AI가 화면과 동일한 상태를 보게 한다(DB 스냅샷 지연 회피).
      const liveDocument = useEditorStore.getState().document;
      await sendAiChatStream(diagramId, message, sessionId, selectedModel, liveDocument, onText, onDone, onError, setStreamingStatus);
    } catch {
      finalizeStreamingMessage(sessionId, tempId, {
        messageId: randomUUID(),
        content: "오류가 발생했습니다. 다시 시도해주세요.",
        diff: null,
        pendingDocument: null,
      });
    }
  };

  const handleSendInput = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    handleSend(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSendInput();
    }
  };

  const handleAccept = async (messageId: string) => {
    const msg = currentMessages.find((m) => m.id === messageId);
    if (!msg?.pendingDocument) return;
    acceptDiff(messageId);
    closeReview();
    await acceptAiDiff(messageId).catch(() => {});
    useEditorStore.getState().setDocument(msg.pendingDocument);
  };

  const handleReject = async (messageId: string) => {
    rejectDiff(messageId);
    closeReview();
    await rejectAiDiff(messageId).catch(() => {});
  };

  const handleSelectSession = (sessionId: string) => {
    setCurrentSession(sessionId);
  };

  const handleNewSession = async () => {
    try {
      const { sessionId } = await createSession(diagramId);
      const newSession = {
        id: sessionId,
        name: "새 대화",
        createdAt: new Date().toISOString(),
      };
      addSession(newSession);
      setCurrentSession(sessionId);
    } catch {
      // 세션 생성 실패 시 무시
    }
  };

  const sendBtnDisabled = isLoading || !input.trim();

  const reviewingMessage = reviewingMessageId
    ? currentMessages.find((m) => m.id === reviewingMessageId)
    : null;

  const currentDocument = useEditorStore.getState().document;

  return (
    <>
      {reviewingMessage?.diff && reviewingMessage.pendingDocument && (
        <AIDiffReviewPanel
          diff={reviewingMessage.diff}
          pendingDocument={reviewingMessage.pendingDocument}
          currentDocument={currentDocument}
          onAccept={() => handleAccept(reviewingMessage.id)}
          onReject={() => handleReject(reviewingMessage.id)}
        />
      )}

      <div
        className={isOpen ? s.floatContainerOpen : s.floatContainerClosed}
        onClick={!isOpen ? () => openChat() : undefined}
      >
        <div className={isOpen ? s.fabContentOpen : s.fabContentClosed}>
          <div className={s.fabIcon}>✦</div>
          <div className={s.fabLabel}>AI</div>
        </div>

        <div className={isOpen ? s.chatContentOpen : s.chatContentClosed}>
          <div className={s.chatHeader}>
            <div className={s.chatHeaderLeft}>
              <div className={s.chatHeaderIcon}>✦</div>
              <div>
                <div className={s.chatHeaderTitle}>ERDify AI</div>
                {models.length > 0 ? (
                  <select
                    className={s.modelSelect}
                    value={selectedModel}
                    onChange={(e) => handleModelChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    title="모델 선택"
                  >
                    {AI_PROVIDERS.filter((p) => models.some((m) => m.provider === p)).map((p) => (
                      <optgroup key={p} label={PROVIDER_LABELS[p]}>
                        {models.filter((m) => m.provider === p).map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                ) : (
                  <div className={s.chatHeaderSub}>모델 미설정</div>
                )}
              </div>
            </div>
            <button type="button" className={s.chatCloseBtn} onClick={closeChat}>×</button>
          </div>

          <AIChatSessionSelector
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSelectSession={handleSelectSession}
            onNewSession={handleNewSession}
          />

          <div className={s.chatMessages}>
            {currentMessages.length === 0 && (
              <div className={s.chatEmpty}>
                <div className={s.chatEmptyIcon}>✦</div>
                ERD에 대해 무엇이든 물어보세요.<br />
                <span style={{ fontSize: 12 }}>"orders 테이블 추가해줘" 같은 명령도 가능해요.</span>
              </div>
            )}
            {currentMessages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} onOpenReview={openReview} />
            ))}
            {streamingStatus && (
              <div className={s.chatThinking}>
                <span>🔧</span> {streamingStatus}
              </div>
            )}
            {isLoading && (
              <div className={s.chatThinking}>
                <div className={s.thinkingDots}>
                  <div className={s.thinkingDot} />
                  <div className={s.thinkingDot} />
                  <div className={s.thinkingDot} />
                </div>
                AI가 생각 중...
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className={s.chatInputArea}>
            <textarea
              className={s.chatTextarea}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="메시지 입력 (Enter 전송)"
              rows={2}
            />
            <button
              type="button"
              className={`${s.chatSendBtnBase} ${sendBtnDisabled ? s.chatSendBtnDisabled : s.chatSendBtnEnabled}`}
              onClick={handleSendInput}
              disabled={sendBtnDisabled}
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
