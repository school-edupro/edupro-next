import { Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { FeeMisService, type MisReportId } from './fee-mis.service';
import {
  FEES,
  FeeMisColumnsDto,
  FeeMisFileQueryDto,
  FeeMisQueryDto,
  FeeMisReportSchema,
} from './fees.dto';

/** The fee MIS reports with a column per head, payment mode or month. */
@ApiTags('fees')
@ApiBearerAuth()
@Controller('fees/mis')
export class FeeMisController {
  constructor(private readonly mis: FeeMisService) {}

  private id(report: string): MisReportId {
    const r = FeeMisReportSchema.safeParse(report);
    if (!r.success) throw new DomainError('not-found', 'Unknown report', { status: 404 });
    return r.data;
  }

  @Get(':report')
  @ApiOperation({ summary: 'A fee MIS report as a table: columns, rows, subtotals and totals' })
  @RequirePermission(FEES.ledgerView)
  report(
    @ReqCtx() ctx: RequestContext,
    @Param('report') report: string,
    @Query() q: FeeMisQueryDto,
  ) {
    return this.mis.report(ctx, this.id(report), q);
  }

  @Put(':report/columns')
  @ApiOperation({ summary: 'Choose the columns of a report: my own, or the school default' })
  @RequirePermission(FEES.ledgerView)
  saveColumns(
    @ReqCtx() ctx: RequestContext,
    @Param('report') report: string,
    @Body() body: FeeMisColumnsDto,
  ) {
    return this.mis.saveColumns(ctx, this.id(report), body);
  }

  @Delete(':report/columns')
  @ApiOperation({ summary: 'Drop my own choice of columns: the school default applies again' })
  @RequirePermission(FEES.ledgerView)
  resetColumns(@ReqCtx() ctx: RequestContext, @Param('report') report: string) {
    return this.mis.resetColumns(ctx, this.id(report));
  }

  @Get(':report/file')
  @ApiOperation({ summary: 'The same report as Excel or PDF, made at once' })
  @RequirePermission(FEES.ledgerView)
  async file(
    @ReqCtx() ctx: RequestContext,
    @Param('report') report: string,
    @Query() q: FeeMisFileQueryDto,
  ) {
    const { format, ...filters } = q;
    const f = await this.mis.file(ctx, this.id(report), filters, format);
    return { filename: f.filename, contentType: f.contentType, base64: f.bytes.toString('base64') };
  }
}
