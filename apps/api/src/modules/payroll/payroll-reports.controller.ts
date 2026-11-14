import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PayrollAnnualService } from './payroll-annual.service';
import { PayrollAuditService } from './payroll-audit.service';
import { PayrollHomeService } from './payroll-home.service';
import { RUN } from './payroll-inputs.dto';
import {
  AsOfDto,
  AuditQueryDto,
  BonusPostDto,
  BonusRuleDto,
  FyOnlyDto,
  HomeQueryDto,
  OptionsQueryDto,
  PresetDto,
  PresetQueryDto,
  ReportQueryDto,
} from './payroll-reports.dto';
import { AUDIT_VIEW, PayrollReportsService } from './payroll-reports.service';

const id = (v: string) => {
  if (!/^\d{1,18}$/.test(v))
    throw new DomainError('validation-failed', 'Not a valid id', { status: 400 });
  return v;
};
const fyOf = (v: string) => {
  if (!/^\d{4}-\d{2}$/.test(v))
    throw new DomainError('validation-failed', 'A financial year (2026-27)', { status: 400 });
  return v;
};
const keyOf = (v: string) => {
  if (!/^[a-z_]{2,40}$/.test(v))
    throw new DomainError('validation-failed', 'No such report', { status: 404 });
  return v;
};

/** Reports, the payroll home, the bonus and gratuity, the audit trail (docs/design/86, phase F). */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollReportsController {
  constructor(
    private readonly reports: PayrollReportsService,
    private readonly annual: PayrollAnnualService,
    private readonly auditTrail: PayrollAuditService,
    private readonly home: PayrollHomeService,
  ) {}

  @Get('home')
  @ApiOperation({ summary: 'The payroll home: a month’s figures, the work waiting, small charts' })
  @RequirePermission(RUN.view)
  homePage(@ReqCtx() ctx: RequestContext, @Query() q: HomeQueryDto) {
    return this.home.home(ctx, q.month);
  }

  @Get('reports')
  @ApiOperation({ summary: 'The report catalogue' })
  @RequirePermission(RUN.view)
  catalogue(@ReqCtx() ctx: RequestContext) {
    return this.reports.catalogue(ctx);
  }

  @Get('reports/options')
  @ApiOperation({ summary: 'A month’s filter choices: runs, departments, staff types, staff' })
  @RequirePermission(RUN.view)
  options(@ReqCtx() ctx: RequestContext, @Query() q: OptionsQueryDto) {
    return this.reports.options(ctx, q.month);
  }

  @Get('reports/presets')
  @ApiOperation({
    summary: 'A report’s column presets: the built-in views, one’s own and the shared ones',
  })
  @RequirePermission(RUN.view)
  presets(@ReqCtx() ctx: RequestContext, @Query() q: PresetQueryDto) {
    return this.reports.presets(ctx, q.report);
  }

  @Post('reports/presets')
  @ApiOperation({ summary: 'Save a column preset (shared only by a checker)' })
  @RequirePermission(RUN.view)
  savePreset(@ReqCtx() ctx: RequestContext, @Body() dto: PresetDto) {
    return this.reports.savePreset(ctx, dto);
  }

  @Post('reports/presets/:id/delete')
  @ApiOperation({ summary: 'Remove one’s own preset (a checker: a shared one)' })
  @RequirePermission(RUN.view)
  deletePreset(@ReqCtx() ctx: RequestContext, @Param('id') pid: string) {
    return this.reports.deletePreset(ctx, id(pid));
  }

  @Get('reports/:key')
  @ApiOperation({ summary: 'A report as one grid' })
  @RequirePermission(RUN.view)
  run(@ReqCtx() ctx: RequestContext, @Param('key') key: string, @Query() q: ReportQueryDto) {
    return this.reports.run(ctx, keyOf(key), q);
  }

  @Get('reports/:key/file')
  @ApiOperation({ summary: 'The same report as Excel, PDF or CSV' })
  @RequirePermission(RUN.view)
  file(@ReqCtx() ctx: RequestContext, @Param('key') key: string, @Query() q: ReportQueryDto) {
    const { format, ...p } = q;
    return this.reports.file(ctx, keyOf(key), p, format);
  }

  @Get('gratuity/actuary')
  @ApiOperation({ summary: 'The data an actuary values the gratuity liability from (Excel)' })
  @RequirePermission(RUN.view)
  actuary(@ReqCtx() ctx: RequestContext, @Query() q: AsOfDto) {
    return this.annual.actuaryFile(ctx, q.asOf);
  }

  @Get('bonus/:fy')
  @ApiOperation({ summary: 'The year’s bonus rule (and the statutory formula as a start)' })
  @RequirePermission(RUN.view)
  bonusRule(@ReqCtx() ctx: RequestContext, @Param('fy') fy: string) {
    return this.annual.rule(ctx, fyOf(fy));
  }

  @Put('bonus/:fy')
  @ApiOperation({ summary: 'Set the year’s bonus rule (until it is posted)' })
  @RequirePermission(RUN.manage)
  saveBonusRule(@ReqCtx() ctx: RequestContext, @Param('fy') fy: string, @Body() dto: BonusRuleDto) {
    return this.annual.saveRule(ctx, fyOf(fy), dto);
  }

  @Post('bonus/:fy/post')
  @ApiOperation({
    summary: 'Post the year’s bonus to a month as one-off items (a checker; a dry run first)',
  })
  @RequirePermission(RUN.approve)
  postBonus(@ReqCtx() ctx: RequestContext, @Param('fy') fy: string, @Body() dto: BonusPostDto) {
    return this.annual.post(ctx, fyOf(fy), dto.month, dto.dryRun);
  }

  @Get('audit')
  @ApiOperation({ summary: 'The payroll audit trail' })
  @RequirePermission(AUDIT_VIEW)
  auditList(@ReqCtx() ctx: RequestContext, @Query() q: AuditQueryDto) {
    return this.auditTrail.list(ctx, q);
  }

  @Get('audit/export')
  @ApiOperation({ summary: 'The payroll audit trail as Excel, with the fields before and after' })
  @RequirePermission(AUDIT_VIEW)
  auditExport(@ReqCtx() ctx: RequestContext, @Query() q: AuditQueryDto) {
    return this.auditTrail.exportXlsx(ctx, q);
  }

  @Get('audit/pack')
  @ApiOperation({ summary: 'The auditor pack of a financial year (ZIP; a checker)' })
  @RequirePermission(RUN.approve)
  auditorPack(@ReqCtx() ctx: RequestContext, @Query() q: FyOnlyDto) {
    return this.auditTrail.auditorPack(ctx, q.fy);
  }

  @Get('audit/:id')
  @ApiOperation({ summary: 'One audit entry, field by field' })
  @RequirePermission(AUDIT_VIEW)
  auditEntry(@ReqCtx() ctx: RequestContext, @Param('id') aid: string) {
    return this.auditTrail.get(ctx, id(aid));
  }
}
