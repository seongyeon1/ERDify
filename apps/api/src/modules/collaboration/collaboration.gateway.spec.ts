import { describe, it, expect, vi, beforeEach } from "vitest";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { CollaborationGateway } from "./collaboration.gateway";
import { CollaborationService } from "./collaboration.service";
import { DiagramsService } from "../diagrams/diagrams.service";
import type { Socket, Server } from "socket.io";

function makeSocket(overrides: Partial<Record<string, unknown>> = {}): Socket {
  return {
    id: "socket-1",
    data: {},
    handshake: { auth: { token: "Bearer valid-token" } },
    join: vi.fn(),
    emit: vi.fn(),
    to: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
    ...overrides
  } as unknown as Socket;
}

describe("CollaborationGateway", () => {
  let gateway: CollaborationGateway;
  const mockService = {
    joinRoom: vi.fn(),
    applyChanges: vi.fn(),
    addPresence: vi.fn(),
    updatePresence: vi.fn(),
    leaveRoom: vi.fn(),
    getPresence: vi.fn(),
    schedulePersist: vi.fn(),
    persistNow: vi.fn()
  };
  const mockJwt = { verify: vi.fn() };
  const mockDiagramsService = { canAccessDiagram: vi.fn() };
  const mockServer = { to: vi.fn().mockReturnThis(), emit: vi.fn() } as unknown as Server;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        CollaborationGateway,
        { provide: CollaborationService, useValue: mockService },
        { provide: JwtService, useValue: mockJwt },
        { provide: DiagramsService, useValue: mockDiagramsService }
      ]
    }).compile();
    gateway = module.get(CollaborationGateway);
    gateway.server = mockServer;
  });

  describe("handleConnection", () => {
    it("disconnects if no token provided", async () => {
      const client = makeSocket({ handshake: { auth: {} } });
      await gateway.handleConnection(client);
      expect(client.disconnect).toHaveBeenCalled();
    });

    it("disconnects if token is invalid", async () => {
      mockJwt.verify.mockImplementation(() => { throw new Error("invalid"); });
      const client = makeSocket();
      await gateway.handleConnection(client);
      expect(client.disconnect).toHaveBeenCalled();
    });

    it("sets userId on client.data when token is valid", async () => {
      mockJwt.verify.mockReturnValue({ sub: "user-1", email: "a@b.com" });
      const client = makeSocket();
      await gateway.handleConnection(client);
      expect(client.data.userId).toBe("user-1");
      expect(client.disconnect).not.toHaveBeenCalled();
    });
  });

  describe("handleJoin", () => {
    it("joins socket room, emits am:init, broadcasts presence:state", async () => {
      const docBytes = new Uint8Array([1, 2, 3]);
      mockDiagramsService.canAccessDiagram.mockResolvedValue(true);
      mockService.joinRoom.mockResolvedValue(docBytes);
      mockService.getPresence.mockReturnValue([]);
      const client = makeSocket();
      client.data.userId = "user-1";

      await gateway.handleJoin(client, { diagramId: "d1" });

      expect(client.join).toHaveBeenCalledWith("d1");
      expect(client.data.diagramId).toBe("d1");
      expect(client.emit).toHaveBeenCalledWith("am:init", Array.from(docBytes));
      expect(mockService.addPresence).toHaveBeenCalledWith("d1", "user-1", "socket-1", undefined);
      expect(mockServer.to).toHaveBeenCalledWith("d1");
      expect(mockServer.emit).toHaveBeenCalledWith("presence:state", []);
    });

    it("disconnects if user has no access to diagram", async () => {
      mockDiagramsService.canAccessDiagram.mockResolvedValue(false);
      const client = makeSocket();
      client.data.userId = "user-1";

      await gateway.handleJoin(client, { diagramId: "d1" });

      expect(client.emit).toHaveBeenCalledWith("error", { message: "Forbidden" });
      expect(client.disconnect).toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
      expect(mockService.joinRoom).not.toHaveBeenCalled();
    });
  });

  describe("handleChange", () => {
    it("applies changes, broadcasts am:change to others in room, schedules persist", async () => {
      const change = [1, 2, 3];
      const client = makeSocket();
      client.data = { userId: "user-1", diagramId: "d1" };
      mockDiagramsService.canAccessDiagram.mockResolvedValue(true);

      await gateway.handleChange(client, change);

      expect(mockService.applyChanges).toHaveBeenCalledWith("d1", [Uint8Array.from(change)]);
      expect(client.to).toHaveBeenCalledWith("d1");
      expect(mockService.schedulePersist).toHaveBeenCalledWith("d1");
    });
  });

  describe("handlePresenceUpdate", () => {
    it("updates presence and broadcasts presence:state to all in room", async () => {
      mockService.getPresence.mockReturnValue([]);
      const client = makeSocket();
      client.data = { userId: "user-1", diagramId: "d1" };

      await gateway.handlePresenceUpdate(client, { selectedEntityId: "e1" });

      expect(mockService.updatePresence).toHaveBeenCalledWith("d1", "user-1", { selectedEntityId: "e1" });
      expect(mockServer.to).toHaveBeenCalledWith("d1");
      expect(mockServer.emit).toHaveBeenCalledWith("presence:state", []);
    });
  });

  describe("handleDisconnect", () => {
    it("leaves room and broadcasts updated presence", async () => {
      mockService.leaveRoom.mockResolvedValue(undefined);
      mockService.getPresence.mockReturnValue([]);
      const client = makeSocket();
      client.data = { userId: "user-1", diagramId: "d1" };

      await gateway.handleDisconnect(client);

      expect(mockService.leaveRoom).toHaveBeenCalledWith("d1", "user-1");
      expect(mockServer.to).toHaveBeenCalledWith("d1");
      expect(mockServer.emit).toHaveBeenCalledWith("presence:state", []);
    });

    it("does nothing if client never joined a diagram", async () => {
      const client = makeSocket();
      client.data = {};
      await gateway.handleDisconnect(client);
      expect(mockService.leaveRoom).not.toHaveBeenCalled();
    });
  });
});
