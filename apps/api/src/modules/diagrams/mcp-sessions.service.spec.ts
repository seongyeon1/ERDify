import { NotFoundException } from "@nestjs/common";
import type { Diagram, DiagramVersion, McpSession } from "@erdify/db";
import type { Repository } from "typeorm";
import { McpSessionsService } from "./mcp-sessions.service";
import type { DiagramsService } from "./diagrams.service";

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeDiagram = (o: Partial<Diagram> = {}): Diagram =>
  ({ id: "diag-1", projectId: "proj-1", name: "Test", content: { foo: "bar" } as object, ...o }) as Diagram;

const makeVersion = (o: Partial<DiagramVersion> = {}): DiagramVersion =>
  ({ id: "ver-1", diagramId: "diag-1", revision: 1, content: {} as object, ...o }) as DiagramVersion;

const makeSession = (o: Partial<McpSession> = {}): McpSession =>
  ({
    id: "sess-1",
    diagramId: "diag-1",
    toolCalls: [],
    summary: null,
    snapshotVersionId: "ver-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...o,
  }) as McpSession;

type MockRepo<_T> = {
  findOne: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("McpSessionsService", () => {
  let service: McpSessionsService;
  let sessionRepo: MockRepo<McpSession>;
  let diagramRepo: MockRepo<Diagram>;
  let versionRepo: MockRepo<DiagramVersion>;
  let eventEmitter: { emit: ReturnType<typeof vi.fn> };
  let diagramsService: { assertEditorAccess: ReturnType<typeof vi.fn>; assertReadAccess: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    sessionRepo = { findOne: vi.fn(), find: vi.fn(), create: vi.fn(), save: vi.fn() };
    diagramRepo = { findOne: vi.fn(), find: vi.fn(), create: vi.fn(), save: vi.fn() };
    versionRepo = { findOne: vi.fn(), find: vi.fn(), create: vi.fn(), save: vi.fn() };
    eventEmitter = { emit: vi.fn() };
    diagramsService = {
      assertEditorAccess: vi.fn().mockResolvedValue(undefined),
      assertReadAccess: vi.fn().mockResolvedValue(undefined),
    };

    service = new McpSessionsService(
      sessionRepo as unknown as Repository<McpSession>,
      diagramRepo as unknown as Repository<Diagram>,
      versionRepo as unknown as Repository<DiagramVersion>,
      eventEmitter as never,
      diagramsService as unknown as DiagramsService
    );
  });

  // ── recordToolCall ──────────────────────────────────────────────────────────

  describe("recordToolCall", () => {
    describe("새 세션 (session not found)", () => {
      beforeEach(() => {
        sessionRepo.findOne.mockResolvedValue(null);
        diagramRepo.findOne.mockResolvedValue(makeDiagram());
        versionRepo.findOne.mockResolvedValue(makeVersion({ revision: 2 }));
        versionRepo.create.mockImplementation((v: Partial<DiagramVersion>) => ({ ...v }));
        versionRepo.save.mockImplementation(async (v: DiagramVersion) => v);
      });

      it("editor 접근 권한 검증을 수행한다", async () => {
        const createdSession = makeSession({ toolCalls: [{ tool: "add_table", summary: "테이블 추가" }], summary: "테이블 추가" });
        sessionRepo.create.mockReturnValue(createdSession);
        sessionRepo.save.mockResolvedValue(createdSession);

        await service.recordToolCall("diag-1", "sess-1", "user-1", { tool: "add_table", summary: "테이블 추가" });

        expect(diagramsService.assertEditorAccess).toHaveBeenCalledWith("diag-1", "user-1");
      });

      it("다이어그램이 없으면 NotFoundException을 던진다", async () => {
        diagramRepo.findOne.mockResolvedValue(null);

        await expect(
          service.recordToolCall("diag-1", "sess-1", "user-1", { tool: "add_table", summary: "테이블 추가" })
        ).rejects.toThrow(NotFoundException);
      });

      it("현재 다이어그램 상태를 스냅샷으로 저장한다", async () => {
        const createdSession = makeSession({ toolCalls: [{ tool: "add_table", summary: "테이블 추가" }], summary: "테이블 추가" });
        sessionRepo.create.mockReturnValue(createdSession);
        sessionRepo.save.mockResolvedValue(createdSession);

        await service.recordToolCall("diag-1", "sess-1", "user-1", { tool: "add_table", summary: "테이블 추가" });

        expect(versionRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            diagramId: "diag-1",
            content: { foo: "bar" },
            createdBy: "mcp",
          })
        );
        expect(versionRepo.save).toHaveBeenCalled();
      });

      it("마지막 리비전에서 +1 revision으로 버전을 생성한다", async () => {
        versionRepo.findOne.mockResolvedValue(makeVersion({ revision: 5 }));
        const createdSession = makeSession();
        sessionRepo.create.mockReturnValue(createdSession);
        sessionRepo.save.mockResolvedValue(createdSession);

        await service.recordToolCall("diag-1", "sess-1", "user-1", { tool: "add_table", summary: "테이블 추가" });

        expect(versionRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ revision: 6 })
        );
      });

      it("이전 버전이 없으면 revision 1로 버전을 생성한다", async () => {
        versionRepo.findOne.mockResolvedValue(null);
        const createdSession = makeSession();
        sessionRepo.create.mockReturnValue(createdSession);
        sessionRepo.save.mockResolvedValue(createdSession);

        await service.recordToolCall("diag-1", "sess-1", "user-1", { tool: "add_table", summary: "테이블 추가" });

        expect(versionRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ revision: 1 })
        );
      });

      it("첫 번째 tool call로 새 세션을 생성한다", async () => {
        const entry = { tool: "add_table", summary: "테이블 추가" };
        const savedVersion = makeVersion({ id: "ver-new" });
        versionRepo.save.mockResolvedValue(savedVersion);

        const createdSession = makeSession({ toolCalls: [entry], summary: "테이블 추가", snapshotVersionId: "ver-new" });
        sessionRepo.create.mockReturnValue(createdSession);
        sessionRepo.save.mockResolvedValue(createdSession);

        await service.recordToolCall("diag-1", "sess-1", "user-1", entry);

        expect(sessionRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "sess-1",
            diagramId: "diag-1",
            toolCalls: [entry],
            snapshotVersionId: "ver-new",
          })
        );
      });

      it("저장된 세션을 반환한다", async () => {
        const entry = { tool: "add_table", summary: "테이블 추가" };
        const savedSession = makeSession({ toolCalls: [entry], summary: "테이블 추가" });
        sessionRepo.create.mockReturnValue(savedSession);
        sessionRepo.save.mockResolvedValue(savedSession);

        const result = await service.recordToolCall("diag-1", "sess-1", "user-1", entry);

        expect(result).toEqual(savedSession);
      });

      it("mcp.tool_call.recorded 이벤트를 emit한다", async () => {
        const entry = { tool: "add_table", summary: "테이블 추가" };
        const savedSession = makeSession({ toolCalls: [entry], summary: "테이블 추가" });
        sessionRepo.create.mockReturnValue(savedSession);
        sessionRepo.save.mockResolvedValue(savedSession);

        await service.recordToolCall("diag-1", "sess-1", "user-1", entry);

        expect(eventEmitter.emit).toHaveBeenCalledWith(
          "mcp.tool_call.recorded",
          expect.objectContaining({
            diagramId: "diag-1",
            sessionId: "sess-1",
            toolCall: { tool: "add_table", summary: "테이블 추가" },
          })
        );
      });
    });

    describe("기존 세션 (session found)", () => {
      it("기존 toolCalls에 새 항목을 추가한다", async () => {
        const existingEntry = { tool: "add_table", summary: "테이블 추가" };
        const existingSession = makeSession({ toolCalls: [existingEntry], summary: "테이블 추가" });
        sessionRepo.findOne.mockResolvedValue(existingSession);

        const newEntry = { tool: "add_column", summary: "컬럼 추가" };
        const updatedSession = makeSession({
          toolCalls: [existingEntry, newEntry],
          summary: "테이블 추가, 컬럼 추가",
        });
        sessionRepo.save.mockResolvedValue(updatedSession);

        const result = await service.recordToolCall("diag-1", "sess-1", "user-1", newEntry);

        expect(result.toolCalls).toHaveLength(2);
        expect(result.toolCalls[1]).toEqual(newEntry);
      });

      it("summary를 갱신한다", async () => {
        const existingEntry = { tool: "add_table", summary: "테이블 추가" };
        const existingSession = makeSession({ toolCalls: [existingEntry], summary: "테이블 추가" });
        sessionRepo.findOne.mockResolvedValue(existingSession);

        const newEntry = { tool: "add_column", summary: "컬럼 추가" };
        const updatedSession = makeSession({
          toolCalls: [existingEntry, newEntry],
          summary: "테이블 추가, 컬럼 추가",
        });
        sessionRepo.save.mockResolvedValue(updatedSession);

        const result = await service.recordToolCall("diag-1", "sess-1", "user-1", newEntry);

        expect(result.summary).toBe("테이블 추가, 컬럼 추가");
      });

      it("기존 세션일 때는 다이어그램 스냅샷을 새로 찍지 않는다", async () => {
        const existingSession = makeSession({ toolCalls: [{ tool: "add_table", summary: "테이블 추가" }] });
        sessionRepo.findOne.mockResolvedValue(existingSession);
        sessionRepo.save.mockResolvedValue(existingSession);

        await service.recordToolCall("diag-1", "sess-1", "user-1", { tool: "add_column", summary: "컬럼 추가" });

        expect(diagramRepo.findOne).not.toHaveBeenCalled();
        expect(versionRepo.create).not.toHaveBeenCalled();
        expect(versionRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  // ── buildSummary (간접 테스트) ──────────────────────────────────────────────

  describe("buildSummary (summary truncation)", () => {
    it("200자 이하 summary는 그대로 유지한다", async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      diagramRepo.findOne.mockResolvedValue(makeDiagram());
      versionRepo.findOne.mockResolvedValue(null);
      versionRepo.create.mockImplementation((v: Partial<DiagramVersion>) => ({ ...v }));
      versionRepo.save.mockResolvedValue(makeVersion());

      const entry = { tool: "add_table", summary: "테이블 추가" };

      let capturedSession: Partial<McpSession> = {};
      sessionRepo.create.mockImplementation((s: Partial<McpSession>) => {
        capturedSession = s;
        return s;
      });
      sessionRepo.save.mockImplementation(async (s: McpSession) => s);

      await service.recordToolCall("diag-1", "sess-1", "user-1", entry);

      expect(capturedSession.summary).toBe("테이블 추가");
    });

    it("200자를 초과하는 summary는 199자로 자르고 '…'를 붙인다", async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      diagramRepo.findOne.mockResolvedValue(makeDiagram());
      versionRepo.findOne.mockResolvedValue(null);
      versionRepo.create.mockImplementation((v: Partial<DiagramVersion>) => ({ ...v }));
      versionRepo.save.mockResolvedValue(makeVersion());

      const longSummary = "A".repeat(201);
      const entry = { tool: "add_table", summary: longSummary };

      let capturedSession: Partial<McpSession> = {};
      sessionRepo.create.mockImplementation((s: Partial<McpSession>) => {
        capturedSession = s;
        return s;
      });
      sessionRepo.save.mockImplementation(async (s: McpSession) => s);

      await service.recordToolCall("diag-1", "sess-1", "user-1", entry);

      expect(capturedSession.summary).toHaveLength(200);
      expect(capturedSession.summary).toMatch(/…$/);
    });
  });

  // ── listSessions ────────────────────────────────────────────────────────────

  describe("listSessions", () => {
    it("read 접근 권한 검증을 수행한다", async () => {
      sessionRepo.find.mockResolvedValue([]);

      await service.listSessions("diag-1", "user-1");

      expect(diagramsService.assertReadAccess).toHaveBeenCalledWith("diag-1", "user-1");
    });

    it("세션 목록을 McpSessionResponse 형태로 반환한다", async () => {
      const session = makeSession({
        id: "sess-1",
        diagramId: "diag-1",
        summary: "테이블 추가",
        toolCalls: [{ tool: "add_table", summary: "테이블 추가" }],
        snapshotVersionId: "ver-1",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      });
      sessionRepo.find.mockResolvedValue([session]);

      const result = await service.listSessions("diag-1", "user-1");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "sess-1",
        summary: "테이블 추가",
        toolCalls: [{ tool: "add_table", summary: "테이블 추가" }],
        snapshotVersionId: "ver-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      });
    });

    it("세션이 없으면 빈 배열을 반환한다", async () => {
      sessionRepo.find.mockResolvedValue([]);

      const result = await service.listSessions("diag-1", "user-1");

      expect(result).toEqual([]);
    });

    it("createdAt DESC, take 50 조건으로 세션을 조회한다", async () => {
      sessionRepo.find.mockResolvedValue([]);

      await service.listSessions("diag-1", "user-1");

      expect(sessionRepo.find).toHaveBeenCalledWith({
        where: { diagramId: "diag-1" },
        order: { createdAt: "DESC" },
        take: 50,
      });
    });

    it("read 접근 권한이 없으면 예외를 전파한다", async () => {
      const error = new Error("Forbidden");
      diagramsService.assertReadAccess.mockRejectedValue(error);

      await expect(service.listSessions("diag-1", "user-1")).rejects.toThrow("Forbidden");
    });
  });

  // ── revertSession ────────────────────────────────────────────────────────────

  describe("revertSession", () => {
    it("editor 접근 권한 검증을 수행한다", async () => {
      const session = makeSession({ snapshotVersionId: "ver-1" });
      const version = makeVersion({ content: { restored: true } as object });
      const diagram = makeDiagram();
      sessionRepo.findOne.mockResolvedValue(session);
      versionRepo.findOne.mockResolvedValue(version);
      diagramRepo.findOne.mockResolvedValue(diagram);
      diagramRepo.save.mockImplementation(async (d: Diagram) => d);

      await service.revertSession("diag-1", "sess-1", "user-1");

      expect(diagramsService.assertEditorAccess).toHaveBeenCalledWith("diag-1", "user-1");
    });

    it("세션이 없으면 NotFoundException을 던진다", async () => {
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.revertSession("diag-1", "sess-1", "user-1")
      ).rejects.toThrow(NotFoundException);
    });

    it("snapshotVersionId가 없으면 NotFoundException을 던진다", async () => {
      const session = makeSession({ snapshotVersionId: null });
      sessionRepo.findOne.mockResolvedValue(session);

      await expect(
        service.revertSession("diag-1", "sess-1", "user-1")
      ).rejects.toThrow(NotFoundException);
    });

    it("스냅샷 버전이 없으면 NotFoundException을 던진다", async () => {
      const session = makeSession({ snapshotVersionId: "ver-ghost" });
      sessionRepo.findOne.mockResolvedValue(session);
      versionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.revertSession("diag-1", "sess-1", "user-1")
      ).rejects.toThrow(NotFoundException);
    });

    it("다이어그램이 없으면 NotFoundException을 던진다", async () => {
      const session = makeSession({ snapshotVersionId: "ver-1" });
      const version = makeVersion();
      sessionRepo.findOne.mockResolvedValue(session);
      versionRepo.findOne.mockResolvedValue(version);
      diagramRepo.findOne.mockResolvedValue(null);

      await expect(
        service.revertSession("diag-1", "sess-1", "user-1")
      ).rejects.toThrow(NotFoundException);
    });

    it("스냅샷 버전의 content를 다이어그램에 복원하고 저장한다", async () => {
      const snapshotContent = { restored: true, version: "snapshot" };
      const session = makeSession({ snapshotVersionId: "ver-1" });
      const version = makeVersion({ content: snapshotContent as object });
      const diagram = makeDiagram({ content: { current: "state" } as object });
      sessionRepo.findOne.mockResolvedValue(session);
      versionRepo.findOne.mockResolvedValue(version);
      diagramRepo.findOne.mockResolvedValue(diagram);
      diagramRepo.save.mockImplementation(async (d: Diagram) => d);

      await service.revertSession("diag-1", "sess-1", "user-1");

      expect(diagramRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ content: snapshotContent })
      );
    });

    it("editor 접근 권한이 없으면 예외를 전파한다", async () => {
      const error = new Error("Forbidden");
      diagramsService.assertEditorAccess.mockRejectedValue(error);

      await expect(
        service.revertSession("diag-1", "sess-1", "user-1")
      ).rejects.toThrow("Forbidden");
    });

    it("세션과 버전 조회 시 diagramId 조건을 사용한다", async () => {
      const session = makeSession({ snapshotVersionId: "ver-1" });
      const version = makeVersion();
      const diagram = makeDiagram();
      sessionRepo.findOne.mockResolvedValue(session);
      versionRepo.findOne.mockResolvedValue(version);
      diagramRepo.findOne.mockResolvedValue(diagram);
      diagramRepo.save.mockImplementation(async (d: Diagram) => d);

      await service.revertSession("diag-1", "sess-1", "user-1");

      expect(sessionRepo.findOne).toHaveBeenCalledWith({
        where: { id: "sess-1", diagramId: "diag-1" },
      });
      expect(versionRepo.findOne).toHaveBeenCalledWith({
        where: { id: "ver-1", diagramId: "diag-1" },
      });
    });
  });
});
