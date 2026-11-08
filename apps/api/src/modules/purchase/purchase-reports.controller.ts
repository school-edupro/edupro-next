import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PurchaseReportsService } from './purchase-reports.service';
import { PURCHASE, ReportQueryDto, type PurchaseReport } from './purchase.dto';

/** Purchase, part 5 (docs/design/83): the dashboard and the reports (on screen, Excel, PDF). */
@ApiTags('purchase')
@ApiBearerAuth()
@Controller('purchase')
export class PurchaseReportsController {
  constructor(private readonly reports: PurchaseReportsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Figures, the oldest pending approvals, the largest orders, spend' })
  @RequirePermission(PURCHASE.reportView)
  dashboard(@ReqCtx() ctx: RequestContext) {
    return this.reports.dashboard(ctx);
  }

  @Get('report-filters')
  @ApiOperation({
    summary: 'Report filters; the store registers also for those who see the stores',
  })
  @AuthenticatedOnly()
  filters(@ReqCtx() ctx: RequestContext) {
    return this.reports.filters(ctx);
  }

  @Get('reports/:report')
  @ApiOperation({
    summary: 'A purchase report as filtered: on screen, or with ?format=xlsx|pdf a file',
  })
  // the purchase reports right, or the stores' view for the store registers (checked in the service)
  @AuthenticatedOnly()
  report(
    @ReqCtx() ctx: RequestContext,
    @Param('report') report: string,
    @Query() q: ReportQueryDto,
  ) {
    return this.reports.report(ctx, report as PurchaseReport, q);
  }
}
