import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, requireTenant, type RequestContext } from '../../common/http/request-context';
import { ReportsService } from '../reports/reports.service';
import { AuditQueryService } from './audit-query.service';
import { JobsService } from './jobs.service';
import { AuditExportDto, AuditQueryDto, OutboxQueryDto } from './platform.dto';
import { PLATFORM } from './platform.permissions';

@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform')
export class AuditController {
  constructor(
    private readonly audit: AuditQueryService,
    private readonly reports: ReportsService,
    private readonly jobs: JobsService,
  ) {}

  @Get('audit')
  @ApiOperation({ summary: 'Query the audit log' })
  @RequirePermission(PLATFORM.auditView, { description: 'View audit logs for the school' })
  async list(@ReqCtx() ctx: RequestContext, @Query() q: AuditQueryDto) {
    const { rows, total } = await this.audit.list(requireTenant(ctx), q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Get('audit/:id')
  @RequirePermission(PLATFORM.auditView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.audit.get(requireTenant(ctx), id);
  }

  @Post('audit/export')
  @ApiOperation({ summary: 'Export the audit log (MFA); the export itself is audited' })
  @RequirePermission(PLATFORM.auditExport, { mfa: true, description: 'Export audit logs' })
  export(@ReqCtx() ctx: RequestContext, @Body() body: AuditExportDto) {
    return this.reports.create(
      ctx,
      { dataset: 'audit_logs', format: body.format, params: body.params, title: 'Audit log' },
      'platform.audit.export',
    );
  }

  @Get('jobs/outbox')
  @ApiOperation({
    summary: 'Background jobs of this school, including the dead-letter list (status=failed)',
  })
  @RequirePermission(PLATFORM.jobsView, {
    description: 'View background jobs and the dead-letter list',
  })
  async outbox(@ReqCtx() ctx: RequestContext, @Query() q: OutboxQueryDto) {
    const { rows, total } = await this.jobs.list(requireTenant(ctx), q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Post('jobs/outbox/:id/retry')
  @RequirePermission(PLATFORM.jobsManage, { description: 'Retry or cancel background jobs' })
  retry(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.jobs.retry(requireTenant(ctx), id);
  }
}
