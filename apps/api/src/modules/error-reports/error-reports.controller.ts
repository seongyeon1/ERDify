import { BadRequestException, Body, Controller, Get, Patch, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ErrorReportsService, type CreateErrorReportDto } from "./error-reports.service";
import { User } from "@erdify/db";
import type { ErrorType } from "@erdify/db";

@Controller("error-reports")
@UseGuards(JwtAuthGuard)
export class ErrorReportsController {
  constructor(
    private readonly service: ErrorReportsService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  @Post()
  async create(@Body() body: CreateErrorReportDto, @Req() req: { user: { sub: string } }): Promise<void> {
    await this.service.create({ ...body, userId: req.user.sub });
  }

  @Get()
  async findAll(
    @Req() req: { user: { sub: string } },
    @Query("type") type?: ErrorType,
    @Query("resolved") resolved?: string,
    @Query("from") from?: string,
  ) {
    await this.assertAdmin(req.user.sub);
    const filters: { type?: ErrorType; resolved?: boolean; from?: Date } = {};
    if (type !== undefined) filters.type = type;
    if (resolved === "true") {
      filters.resolved = true;
    } else if (resolved === "false") {
      filters.resolved = false;
    }
    if (from !== undefined) filters.from = new Date(from);

    const [groups, stats] = await Promise.all([
      this.service.findGrouped(filters),
      this.service.getStats(),
    ]);
    return { groups, stats };
  }

  @Get("occurrences")
  async getOccurrences(
    @Req() req: { user: { sub: string } },
    @Query("errorType") errorType: ErrorType,
    @Query("path") path: string,
  ) {
    await this.assertAdmin(req.user.sub);
    const VALID_ERROR_TYPES: ErrorType[] = ["5xx", "network", "403", "404"];
    if (!VALID_ERROR_TYPES.includes(errorType)) {
      throw new BadRequestException(`Invalid errorType: ${errorType}`);
    }
    const records = await this.service.getOccurrences(errorType, path);
    return records.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      userId: r.userId,
      pageName: r.pageName,
      url: r.url,
      requestMethod: r.requestMethod,
      requestBody: r.requestBody,
      requestParams: r.requestParams,
      responseBody: r.responseBody,
      userAgent: r.userAgent,
      httpStatus: r.httpStatus,
    }));
  }

  @Patch("resolve")
  async resolve(
    @Body() body: { path: string; errorType: ErrorType; note?: string },
    @Req() req: { user: { sub: string } },
  ): Promise<void> {
    await this.assertAdmin(req.user.sub);
    await this.service.resolve({ ...body, resolvedById: req.user.sub });
  }

  private async assertAdmin(userId: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId }, select: ["isAdmin"] });
    if (!user?.isAdmin) throw new UnauthorizedException();
  }
}
