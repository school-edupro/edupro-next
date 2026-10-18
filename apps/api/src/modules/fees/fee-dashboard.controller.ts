import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { IdSchema } from '../academics/classes/classes.dto';
import { FeeDashboardService } from './fee-dashboard.service';
import { FEES } from './fees.dto';

const FeeDashboardQuerySchema = z.object({
  ledger: z.enum(['all', 'school', 'hostel', 'misc']).default('all'),
  yearId: IdSchema.optional(),
});
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
    return this.svc.dashboard(ctx, q.ledger, q.yearId);
  }
}
