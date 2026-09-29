import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { AiReportsService } from './ai-reports.service';
import { AlertsService } from './alerts.service';
import { AssistantService } from './assistant.service';
import { DEPARTMENTS, DepartmentsService, type Department } from './departments.service';
import { InsightsService } from './insights.service';
import { ResultsAnalyticsService } from './results-analytics.service';

export const INSIGHTS = {
  dashboardView: 'insights.dashboard.view',
  martRefresh: 'insights.mart.refresh',
  /** Sprint 13: department dashboards open by module permission */
  departmentView: 'insights.department.view',
  /** Sprint 14: the assistant */
  assistantUse: 'insights.assistant.use',
  assistantAudit: 'insights.assistant.audit',
  /** Sprint 15: anomaly alerts */
  alertView: 'insights.alert.view',
  alertAck: 'insights.alert.ack',
  /** Sprint 16: AI reports */
  reportView: 'insights.report.view',
  /** Sprint 18: results analytics */
  resultsView: 'insights.results.view',
  reportRun: 'insights.report.run',
} as const;

const AskSchema = z.object({
  question: z.string().trim().min(2).max(1000),
  conversationId: z.string().uuid().optional(),
  language: z.enum(['en', 'hi', 'hinglish']).optional(),
  surface: z.enum(['admin', 'teacher', 'parent']).optional(),
});
export class AskAssistantDto extends createZodDto(AskSchema) {}
const AuditQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
const AlertsQuerySchema = z.object({
  open: z.enum(['true', 'false']).default('true'),
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export class AlertsQueryDto extends createZodDto(AlertsQuerySchema) {}
const RunReportSchema = z.object({
  kind: z.enum(['principal_brief', 'department_weekly']),
  department: z.enum(['academics', 'attendance', 'fees', 'communication']).optional(),
  periodTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  language: z.enum(['en', 'hi']).optional(),
});
export class RunReportDto extends createZodDto(RunReportSchema) {}
const CostsQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
export class CostsQueryDto extends createZodDto(CostsQuerySchema) {}
export class AssistantAuditQueryDto extends createZodDto(AuditQuerySchema) {}

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
    private readonly assistant: AssistantService,
    private readonly alerts: AlertsService,
    private readonly aiReports: AiReportsService,
    private readonly results: ResultsAnalyticsService,
  ) {}

  // ---- Sprint 14: the assistant ----
  @Get('assistant/catalogue')
  @ApiOperation({ summary: 'The query catalogue with what the caller may run' })
  @RequirePermission(INSIGHTS.assistantUse, {
    description:
      "Ask the assistant (answers come from the query catalogue with the caller's permissions)",
  })
  async catalogue(@ReqCtx() ctx: RequestContext) {
    return { data: await this.assistant.catalogue(ctx) };
  }

  @Post('assistant')
  @ApiOperation({ summary: 'Ask the assistant a question about school data (English or Hindi)' })
  @RequirePermission(INSIGHTS.assistantUse)
  ask(@ReqCtx() ctx: RequestContext, @Body() body: AskAssistantDto) {
    return this.assistant.ask(ctx, body);
  }

  @Get('assistant/conversations')
  @RequirePermission(INSIGHTS.assistantUse)
  async conversations(@ReqCtx() ctx: RequestContext) {
    return { data: await this.assistant.conversations(ctx) };
  }

  @Get('assistant/conversations/:id')
  @RequirePermission(INSIGHTS.assistantUse)
  conversation(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.assistant.conversation(ctx, id);
  }

  @Get('assistant/audit')
  @ApiOperation({ summary: 'Assistant audit trail and cost for the school' })
  @RequirePermission(INSIGHTS.assistantAudit, {
    description: 'Read the assistant audit trail and cost',
  })
  audit(@ReqCtx() ctx: RequestContext, @Query() q: AssistantAuditQueryDto) {
    return this.assistant.audit(ctx, q.days);
  }

  // ---- Sprint 16: AI reports and the cost dashboard ----
  @Get('reports')
  @ApiOperation({ summary: 'AI reports: weekly department narratives and the Monday brief' })
  @RequirePermission(INSIGHTS.reportView, { description: 'Read AI reports' })
  async reportsList(@ReqCtx() ctx: RequestContext) {
    return { data: await this.aiReports.list(ctx) };
  }

  @Post('reports/run')
  @ApiOperation({ summary: 'Generate an AI report now (facts → narrative → PDF export)' })
  @RequirePermission(INSIGHTS.reportRun, { description: 'Generate AI reports on demand' })
  reportRun(@ReqCtx() ctx: RequestContext, @Body() body: RunReportDto) {
    return this.aiReports.run(ctx, body);
  }

  @Get('reports/:id')
  @RequirePermission(INSIGHTS.reportView)
  report(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.aiReports.get(ctx, id);
  }

  @Get('assistant/costs')
  @ApiOperation({ summary: 'Assistant cost dashboard: by day, surface, user and model' })
  @RequirePermission(INSIGHTS.assistantAudit)
  costs(@ReqCtx() ctx: RequestContext, @Query() q: CostsQueryDto) {
    return this.assistant.costs(ctx, q.days);
  }

  // ---- Sprint 15: anomaly alerts ----
  @Get('alerts')
  @ApiOperation({ summary: 'Anomaly alerts (attendance drop, collection dip, silent reader)' })
  @RequirePermission(INSIGHTS.alertView, { description: 'View anomaly alerts' })
  async alertsList(@ReqCtx() ctx: RequestContext, @Query() q: AlertsQueryDto) {
    return { data: await this.alerts.list(ctx, q.open === 'true', q.days) };
  }

  @Post('alerts/:id/ack')
  @RequirePermission(INSIGHTS.alertAck, { description: 'Acknowledge anomaly alerts' })
  ack(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.alerts.ack(ctx, id);
  }

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

  // ---- Sprint 18: results analytics ----
  @Get('results')
  @ApiOperation({
    summary: 'Results analytics: pass rates and means by exam, class and section; weakest subjects',
  })
  @RequirePermission(INSIGHTS.resultsView, { description: 'Results analytics for the principal' })
  resultsAnalytics(@ReqCtx() ctx: RequestContext, @Query('examId') examId?: string) {
    return this.results.summary(ctx, examId && /^\d+$/.test(examId) ? examId : null);
  }
}
