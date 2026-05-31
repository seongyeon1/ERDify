import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { OrganizationMember, Project } from "@erdify/db";
import type { Repository } from "typeorm";
import { AuthorizationService } from "../../common/services/authorization.service";
import { ProjectService } from "./project.service";

type MockRepo<_T> = {
  findOne: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

const makeProject = (overrides: Partial<Project> = {}): Project =>
  ({ id: "proj-1", organizationId: "org-1", name: "My Project", description: null, ...overrides }) as Project;

const makeMember = (overrides: Partial<OrganizationMember> = {}): OrganizationMember =>
  ({ organizationId: "org-1", userId: "user-1", role: "owner", ...overrides }) as OrganizationMember;

describe("ProjectService", () => {
  let service: ProjectService;
  let projectRepo: MockRepo<Project>;
  let memberRepo: MockRepo<OrganizationMember>;
  let authorizationService: AuthorizationService;

  beforeEach(() => {
    projectRepo = { findOne: vi.fn(), find: vi.fn(), create: vi.fn(), save: vi.fn(), remove: vi.fn() };
    memberRepo = { findOne: vi.fn(), find: vi.fn(), create: vi.fn(), save: vi.fn(), remove: vi.fn() };
    authorizationService = new AuthorizationService(memberRepo as unknown as Repository<OrganizationMember>);
    const mockUsageService = { log: vi.fn().mockResolvedValue(undefined) };
    service = new ProjectService(
      projectRepo as unknown as Repository<Project>,
      authorizationService,
      mockUsageService as never,
    );
  });

  describe("create", () => {
    it("throws ForbiddenException if viewer", async () => {
      memberRepo.findOne.mockResolvedValue(makeMember({ role: "viewer" }));
      await expect(
        service.create("org-1", "user-1", { name: "P" })
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws ForbiddenException if not a member", async () => {
      memberRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create("org-1", "user-1", { name: "P" })
      ).rejects.toThrow(ForbiddenException);
    });

    it("creates and returns project", async () => {
      const project = makeProject();
      memberRepo.findOne.mockResolvedValue(makeMember({ role: "editor" }));
      projectRepo.create.mockReturnValue(project);
      projectRepo.save.mockResolvedValue(project);
      const result = await service.create("org-1", "user-1", { name: "My Project" });
      expect(result).toEqual(project);
    });
  });

  describe("findAll", () => {
    it("throws ForbiddenException if not a member", async () => {
      memberRepo.findOne.mockResolvedValue(null);
      await expect(service.findAll("org-1", "user-1")).rejects.toThrow(ForbiddenException);
    });

    it("returns projects for member", async () => {
      const projects = [makeProject()];
      memberRepo.findOne.mockResolvedValue(makeMember());
      projectRepo.find.mockResolvedValue(projects);
      const result = await service.findAll("org-1", "user-1");
      expect(result).toEqual(projects);
    });
  });

  describe("findOne", () => {
    it("throws NotFoundException if project not found", async () => {
      memberRepo.findOne.mockResolvedValue(makeMember());
      projectRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne("org-1", "proj-1", "user-1")).rejects.toThrow(NotFoundException);
    });

    it("returns project for member", async () => {
      const project = makeProject();
      memberRepo.findOne.mockResolvedValue(makeMember());
      projectRepo.findOne.mockResolvedValue(project);
      const result = await service.findOne("org-1", "proj-1", "user-1");
      expect(result).toEqual(project);
    });
  });

  describe("update", () => {
    it("throws ForbiddenException if viewer", async () => {
      memberRepo.findOne.mockResolvedValue(makeMember({ role: "viewer" }));
      await expect(
        service.update("org-1", "proj-1", "user-1", { name: "New" })
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException if project missing", async () => {
      memberRepo.findOne.mockResolvedValue(makeMember());
      projectRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update("org-1", "proj-1", "user-1", { name: "New" })
      ).rejects.toThrow(NotFoundException);
    });

    it("updates and returns project", async () => {
      const project = makeProject();
      memberRepo.findOne.mockResolvedValue(makeMember());
      projectRepo.findOne.mockResolvedValue(project);
      projectRepo.save.mockResolvedValue({ ...project, name: "New" });
      const result = await service.update("org-1", "proj-1", "user-1", { name: "New" });
      expect(result.name).toBe("New");
    });
  });

  describe("remove", () => {
    it("throws ForbiddenException if viewer", async () => {
      memberRepo.findOne.mockResolvedValue(makeMember({ role: "viewer" }));
      await expect(service.remove("org-1", "proj-1", "user-1")).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException if project missing", async () => {
      memberRepo.findOne.mockResolvedValue(makeMember());
      projectRepo.findOne.mockResolvedValue(null);
      await expect(service.remove("org-1", "proj-1", "user-1")).rejects.toThrow(NotFoundException);
    });

    it("removes project", async () => {
      const project = makeProject();
      memberRepo.findOne.mockResolvedValue(makeMember());
      projectRepo.findOne.mockResolvedValue(project);
      projectRepo.remove.mockResolvedValue(undefined);
      await expect(service.remove("org-1", "proj-1", "user-1")).resolves.toBeUndefined();
      expect(projectRepo.remove).toHaveBeenCalledWith(project);
    });
  });
});
