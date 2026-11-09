import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { LeaveDashboardService } from './leave-dashboard.service';
import { LeaveReportsService } from './leave-reports.service';
import { LeaveReportQueryDto, ReportAccessDto } from './leave.dto';

/** Staff leave & attendance: the dashboard and the reports (docs/design/85, phase D). */
@ApiTags('leave')
@ApiBearerAuth()
@Controller('leave-reports')
export class LeaveReportsController {
  constructor(
    private readonly dash: LeaveDashboardService,
    private readonly reports: LeaveReportsService,
  ) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Today and the month: figures, departments, on leave, late, waiting, charts',
  })
  // the reports right or the leave office (checked in the service)
  @AuthenticatedOnly()
  dashboard(@ReqCtx() ctx: RequestContext) {
    return this.dash.dashboard(ctx);
  }

  @Get('mine')
  @ApiOperation({ summary: 'How many reports I may open' })
  @AuthenticatedOnly()
  mine(@ReqCtx() ctx: RequestContext) {
    return this.reports.count(ctx);
  }

  @Get('catalogue')
  @ApiOperation({
    summary: 'The reports I may open, what each filters by, and the lists to filter with',
  })
  // every report with the reports right; one given to a person (checked in the service)
  @AuthenticatedOnly()
  catalogue(@ReqCtx() ctx: RequestContext) {
    return this.reports.catalogue(ctx);
  }

  @Get('access')
  @ApiOperation({ summary: 'Each report and the people it is given to' })
  @RequirePermission('leave.setup.view')
  access(@ReqCtx() ctx: RequestContext) {
    return this.reports.access(ctx);
  }

  @Put('access/:report')
  @ApiOperation({ summary: 'Give a report to these people (and nobody else)' })
  @RequirePermission('leave.setup.manage')
  setAccess(
    @ReqCtx() ctx: RequestContext,
    @Param('report') report: string,
    @Body() body: ReportAccessDto,
  ) {
    return this.reports.setAccess(ctx, report, body);
  }

  @Get('reports/:report')
  @ApiOperation({ summary: 'A report as filtered: on screen, or with ?format=xlsx|pdf a file' })
  // the reports right, the leave office, or the report given to me (checked in the service)
  @AuthenticatedOnly()
  report(
    @ReqCtx() ctx: RequestContext,
    @Param('report') report: string,
    @Query() q: LeaveReportQueryDto,
  ) {
    return this.reports.report(ctx, report, q);
  }
}
