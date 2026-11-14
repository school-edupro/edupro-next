import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { RUN } from './payroll-inputs.dto';
import { CollectedDto, ComputeDto, ReasonDto, SettlementListDto } from './payroll-settlement.dto';
import { PayrollSettlementService } from './payroll-settlement.service';

const id = (v: string) => {
  if (!/^\d{1,18}$/.test(v))
    throw new DomainError('validation-failed', 'Not a valid id', { status: 400 });
  return v;
};

/** Full and final settlements (docs/design/86, phase E step 4): worked out, approved, paid through payroll or dues. */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll/settlements')
export class PayrollSettlementController {
  constructor(private readonly fnf: PayrollSettlementService) {}

  @Get()
  @ApiOperation({ summary: 'The leavers’ settlements' })
  @RequirePermission(RUN.view)
  list(@ReqCtx() ctx: RequestContext, @Query() q: SettlementListDto) {
    return this.fnf.list(ctx, q.status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A settlement with its working' })
  @RequirePermission(RUN.view)
  get(@ReqCtx() ctx: RequestContext, @Param('id') sid: string) {
    return this.fnf.get(ctx, id(sid));
  }

  @Post(':id/compute')
  @ApiOperation({ summary: 'Work out gratuity, leave encashment, notice and recoveries (a maker)' })
  @RequirePermission(RUN.manage)
  compute(@ReqCtx() ctx: RequestContext, @Param('id') sid: string, @Body() dto: ComputeDto) {
    return this.fnf.compute(ctx, id(sid), dto);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a worked-out settlement (a checker who did not work it out)' })
  @RequirePermission(RUN.approve)
  approve(@ReqCtx() ctx: RequestContext, @Param('id') sid: string) {
    return this.fnf.approve(ctx, id(sid));
  }

  @Post(':id/stage')
  @ApiOperation({ summary: 'Send it to be paid in the month’s run, or note the dues (a checker)' })
  @RequirePermission(RUN.approve)
  stage(@ReqCtx() ctx: RequestContext, @Param('id') sid: string) {
    return this.fnf.stage(ctx, id(sid));
  }

  @Post(':id/run')
  @ApiOperation({ summary: 'Make the full-and-final run once the month’s regular run is locked' })
  @RequirePermission(RUN.manage)
  run(@ReqCtx() ctx: RequestContext, @Param('id') sid: string) {
    return this.fnf.run(ctx, id(sid));
  }

  @Post(':id/collected')
  @ApiOperation({ summary: 'Record the dues collected' })
  @RequirePermission(RUN.approve)
  collected(@ReqCtx() ctx: RequestContext, @Param('id') sid: string, @Body() dto: CollectedDto) {
    return this.fnf.collected(ctx, id(sid), dto.reference);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a settlement not yet paid (a checker, with a reason)' })
  @RequirePermission(RUN.approve)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') sid: string, @Body() dto: ReasonDto) {
    return this.fnf.cancel(ctx, id(sid), dto.reason);
  }
}
