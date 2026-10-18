import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { IdSchema } from '../academics/classes/classes.dto';
import { FeeDashboardService } from './fee-dashboard.service';
import { FEES } from './fees.dto';
import { TRANSPORT } from '../transport/transport.dto';

const FeeDashboardQuerySchema = z.object({
  ledger: z.enum(['all', 'school', 'hostel', 'misc']).default('all'),
  yearId: IdSchema.optional(),
  by: z.enum(['quarter', 'month', 'term']).default('quarter'),
});
const TransportFeeQuerySchema = z.object({
  by: z.enum(['quarter', 'month', 'term']).default('quarter'),
});
class TransportFeeQueryDto extends createZodDto(TransportFeeQuerySchema) {}
class FeeDashboardQueryDto extends createZodDto(FeeDashboardQuerySchema) {}

/** The fee dashboard: school, hostel and misc fees together or one at a time. */
@ApiTags('fees')
@ApiBearerAuth()
@Controller('fees/dashboard')
export class FeeDashboardController {
  constructor(private readonly svc: FeeDashboardService) {}

  @Get()
  @ApiOperation({
    summary:
      'Collected vs due, ageing, modes and cheques, trend, defaulters, refunds, online payments, counters',
  })
  @RequirePermission(FEES.ledgerView)
  dashboard(@ReqCtx() ctx: RequestContext, @Query() q: FeeDashboardQueryDto) {
    return this.svc.dashboard(ctx, q.ledger, q.yearId, q.by);
  }

  @Get('transport')
  @ApiOperation({
    summary:
      'Transport fee by quarter / month / term: projection, realised, received, bus list vs billed',
  })
  // the transport desk sees its own fee figures (as on the transport dashboard)
  @RequirePermission(TRANSPORT.requestView)
  transport(@ReqCtx() ctx: RequestContext, @Query() q: TransportFeeQueryDto) {
    return this.svc.transport(ctx, q.by);
  }
}
