import { Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { HOSTEL } from './hostel.dto';
import {
  HostelReportColumnsDto,
  HostelReportFileDto,
  HostelReportIdSchema,
  HostelReportQueryDto,
} from './hostel-reports.dto';
import { HostelReportsService } from './hostel-reports.service';
import { DomainError } from '../../common/errors/domain-error';

const reportId = (v: string) => {
  const r = HostelReportIdSchema.safeParse(v);
  if (!r.success) throw new DomainError('not-found', 'No such hostel report', { status: 404 });
  return r.data;
};

/** Hostel registers as reports with a column choice, Excel and PDF (parents' contacts included). */
@ApiTags('hostel')
@ApiBearerAuth()
@Controller('hostel/reports')
export class HostelReportsController {
  constructor(private readonly reports: HostelReportsService) {}

  @Get(':report/file')
  @ApiOperation({
    summary: 'A hostel report as filtered, with the chosen columns, as Excel or PDF',
  })
  @RequirePermission(HOSTEL.view)
  async file(
    @ReqCtx() ctx: RequestContext,
    @Param('report') report: string,
    @Query() q: HostelReportFileDto,
  ) {
    const { format, ...filters } = q;
    const f = await this.reports.file(ctx, reportId(report), filters, format);
    return { filename: f.filename, contentType: f.contentType, base64: f.bytes.toString('base64') };
  }

  @Get(':report')
  @ApiOperation({
    summary: 'A hostel report (register, occupancy, withdrawals, leave) with parents and address',
  })
  @RequirePermission(HOSTEL.view)
  report(
    @ReqCtx() ctx: RequestContext,
    @Param('report') report: string,
    @Query() q: HostelReportQueryDto,
  ) {
    return this.reports.report(ctx, reportId(report), q);
  }

  @Put(':report/columns')
  @ApiOperation({
    summary: "The user's own columns, or the school's default (hostel set-up right)",
  })
  @RequirePermission(HOSTEL.view)
  saveColumns(
    @ReqCtx() ctx: RequestContext,
    @Param('report') report: string,
    @Body() body: HostelReportColumnsDto,
  ) {
    return this.reports.saveColumns(ctx, reportId(report), body);
  }

  @Delete(':report/columns')
  @RequirePermission(HOSTEL.view)
  resetColumns(@ReqCtx() ctx: RequestContext, @Param('report') report: string) {
    return this.reports.resetColumns(ctx, reportId(report));
  }
}
