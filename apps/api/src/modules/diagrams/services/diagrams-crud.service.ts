import { randomUUID } from "crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Diagram, Organization, Project } from "@erdify/db";
import type { Repository } from "typeorm";
import { AuthorizationService } from "../../../common/services/authorization.service";
import type { CreateDiagramDto } from "../dto/create-diagram.dto";
import type { UpdateDiagramDto } from "../dto/update-diagram.dto";

@Injectable()
export class DiagramsCrudService {
  constructor(
    @InjectRepository(Diagram)
    private readonly diagramRepo: Repository<Diagram>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    private readonly authorizationService: AuthorizationService
  ) {}

  async getDiagramWithOrg(diagramId: string): Promise<{ diagram: Diagram; orgId: string; projectName: string; orgName: string }> {
    const diagram = await this.diagramRepo.findOne({ where: { id: diagramId } });
    if (!diagram) throw new NotFoundException("Diagram not found");
    const project = await this.projectRepo.findOne({ where: { id: diagram.projectId } });
    if (!project) throw new NotFoundException("Project not found");
    const org = await this.orgRepo.findOne({ where: { id: project.organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    return { diagram, orgId: project.organizationId, projectName: project.name, orgName: org.name };
  }

  async create(projectId: string, userId: string, dto: CreateDiagramDto): Promise<Diagram> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException("Project not found");
    await this.authorizationService.requireEditorOrOwner(project.organizationId, userId);
    const now = new Date().toISOString();
    const id = randomUUID();
    const content: object = dto.content
      ? { ...(dto.content as object), id }
      : {
          format: "erdify.schema.v1",
          id,
          name: dto.name,
          dialect: dto.dialect,
          entities: [],
          relationships: [],
          indexes: [],
          views: [],
          layout: { entityPositions: {} },
          metadata: { revision: 1, stableObjectIds: true, createdAt: now, updatedAt: now },
        };
    return this.diagramRepo.save(
      this.diagramRepo.create({ id, projectId, name: dto.name, content, createdBy: userId })
    );
  }

  async findAll(projectId: string, userId: string) {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException("Project not found");
    await this.authorizationService.requireMember(project.organizationId, userId);
    const rows: Array<Record<string, unknown>> = await this.diagramRepo.query(
      `SELECT
        id,
        project_id AS "projectId",
        name,
        created_by AS "createdBy",
        share_token AS "shareToken",
        share_expires_at AS "shareExpiresAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        content->>'dialect' AS dialect,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', e->>'id',
                'name', e->>'name',
                'columns', (
                  SELECT COALESCE(
                    jsonb_agg(jsonb_build_object('id', c->>'id', 'name', c->>'name')),
                    '[]'::jsonb
                  )
                  FROM (SELECT c FROM jsonb_array_elements(e->'columns') c LIMIT 3) cols
                )
              )
            ),
            '[]'::jsonb
          )
          FROM (SELECT e FROM jsonb_array_elements(content->'entities') e LIMIT 2) entities
        ) AS "previewEntities"
      FROM diagrams
      WHERE project_id = $1`,
      [projectId]
    );
    // pg driver may return JSONB subquery columns as strings — parse defensively
    return rows.map((row) => ({
      ...row,
      previewEntities: Array.isArray(row.previewEntities)
        ? row.previewEntities
        : typeof row.previewEntities === "string"
          ? JSON.parse(row.previewEntities)
          : [],
    }));
  }

  async findOne(
    diagramId: string,
    userId: string
  ): Promise<Diagram & { organizationId: string; organizationName: string; projectName: string; myRole: string }> {
    const { diagram, orgId, orgName, projectName } = await this.getDiagramWithOrg(diagramId);
    const member = await this.authorizationService.requireMember(orgId, userId);
    return { ...diagram, organizationId: orgId, organizationName: orgName, projectName, myRole: member.role };
  }

  async update(diagramId: string, userId: string, dto: UpdateDiagramDto): Promise<Diagram> {
    const { diagram, orgId } = await this.getDiagramWithOrg(diagramId);
    await this.authorizationService.requireEditorOrOwner(orgId, userId);
    if (dto.name !== undefined) diagram.name = dto.name;
    if (dto.content !== undefined) diagram.content = dto.content;
    if (dto.dialect !== undefined) {
      diagram.content = { ...(diagram.content as object), dialect: dto.dialect };
    }
    return this.diagramRepo.save(diagram);
  }

  async remove(diagramId: string, userId: string): Promise<void> {
    const { diagram, orgId } = await this.getDiagramWithOrg(diagramId);
    await this.authorizationService.requireEditorOrOwner(orgId, userId);
    await this.diagramRepo.remove(diagram);
  }

  async canAccessDiagram(diagramId: string, userId: string): Promise<boolean> {
    try {
      const { orgId } = await this.getDiagramWithOrg(diagramId);
      await this.authorizationService.requireMember(orgId, userId);
      return true;
    } catch {
      return false;
    }
  }

  async assertReadAccess(diagramId: string, userId: string): Promise<void> {
    const { orgId } = await this.getDiagramWithOrg(diagramId);
    await this.authorizationService.requireMember(orgId, userId);
  }

  async assertEditorAccess(diagramId: string, userId: string): Promise<void> {
    const { orgId } = await this.getDiagramWithOrg(diagramId);
    await this.authorizationService.requireEditorOrOwner(orgId, userId);
  }
}
