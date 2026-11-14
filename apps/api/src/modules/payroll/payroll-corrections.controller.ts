import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PayrollCorrectionsService } from './payroll-corrections.service';
import { DATED } from './payroll-dated';
import { PAYROLL } from './payroll.dto';

export const WithdrawSchema = z.object({ reason: z.string().trim().min(10).max(300) });
export class WithdrawDto extends createZodDto(WithdrawSchema) {}

const kindOf = (k: string) => {
  if (!DATED[k])
    throw new DomainError('validation-failed', 'Not a kind of dated set-up', { status: 400 });
  return k;
};
const idOf = (v: string) => {
  if (!/^\d{1,18}$/.test(v))
    throw new DomainError('validation-failed', 'Not an id', { status: 400 });
  return v;
};

/** Withdraw a dated set-up row approved by mistake (rates, PF, ESI, PT, LWF, OT, pay-head versions, structures). */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll/dated')
export class PayrollCorrectionsController {
  constructor(private readonly corrections: PayrollCorrectionsService) {}

  @Post(':kind/:id/withdraw')
  @ApiOperation({
    summary:
      'Withdraw an approved row no approved or locked run has read (kept as WITHDRAWN; the row before it opens again)',
  })
  @RequirePermission(PAYROLL.approve)
  withdraw(
    @ReqCtx() ctx: RequestContext,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: WithdrawDto,
  ) {
    return this.corrections.withdraw(ctx, kindOf(kind), idOf(id), body.reason);
  }
}
