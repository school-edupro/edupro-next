import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { DEPARTMENTS, DepartmentsService, type Department } from './departments.service';
import { InsightsService } from './insights.service';

export const INSIGHTS = {
  dashboardView: 'insights.dashboard.view',
  martRefresh: 'insights.mart.refresh',
  /** Sprint 13: department dashboards open by module permission */
  departmentView: 'insights.department.view',
} as const;

const DashboardQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export class DashboardQueryDto extends createZodDto(DashboardQuerySchema) {}

const DepartmentQuerySchema = DashboardQuerySchema.extend({
  classId: z.string().regex(/^\d+$/).optional(),
});
export class DepartmentQueryDto extends createZodDto(DepartmentQuerySchema) {}

const departmentOf = (v: string): Department => {
  if (!(DEPARTMENTS as readonly string[]).includes(v))
    throw new DomainError('not-found', `Unknown department "${v}"`, { status: 404 });
  return v as Department;
};

/** Sprint 12 (AI track): principal dashboard v1 and the reporting marts. */
@ApiTags('insights')
@ApiBearerAuth()
@Controller('insights')
export class InsightsController {
  constructor(
    private readonly insights: InsightsService,
    private readonly departments: DepartmentsService,
  ) {}

  // ---- Sprint 13: department dashboards and report centres ----
  @Get('departments')
  @ApiOperation({ summary: 'The departments the caller may open, with their report counts' })
  @RequirePermission(INSIGHTS.departmentView, {
    description: "Open the department dashboards and report centres one's module permissions allow",
  })
  departmentList(@ReqCtx() ctx: RequestContext) {
    return { data: this.departments.list(ctx) };
  }

  @Get('departments/:dept')
  @ApiOperation({
    summary:
      'One department dashboard (academics, attendance, fees, admissions, transport, communication, hr)',
  })
  @RequirePermission(INSIGHTS.departmentView)
  department(
    @ReqCtx() ctx: RequestContext,
    @Param('dept') dept: string,
    @Query() q: DepartmentQueryDto,
  ) {
    return this.departments.dashboard(ctx, departmentOf(dept), q);
  }

  @Get('departments/:dept/reports')
  @ApiOperation({ summary: 'Report centre: the export datasets of a department' })
  @RequirePermission(INSIGHTS.departmentView)
  departmentReports(@ReqCtx() ctx: RequestContext, @Param('dept') dept: string) {
    return { data: this.departments.reports(ctx, departmentOf(dept)) };
  }

  @Get('principal')
  @ApiOperation({
    summary:
      'Principal dashboard: attendance, fees, admissions, communication, approvals, readers, alerts',
  })
  @RequirePermission(INSIGHTS.dashboardView, {
    description: 'View the principal and department dashboards',
  })
  principal(@ReqCtx() ctx: RequestContext, @Query() q: DashboardQueryDto) {
    return this.insights.principal(ctx, q.date);
  }

  @Get('marts')
  @ApiOperation({ summary: 'Refresh status of every reporting mart' })
  @RequirePermission(INSIGHTS.dashboardView)
  async marts(@ReqCtx() ctx: RequestContext) {
    return { data: await this.insights.martStatus(ctx) };
  }

  @Post('marts/refresh')
  @ApiOperation({ summary: 'Rebuild the marts of the working school now' })
  @RequirePermission(INSIGHTS.martRefresh, { description: 'Refresh the reporting marts on demand' })
  refresh(@ReqCtx() ctx: RequestContext) {
    return this.insights.refresh(ctx);
  }
}
