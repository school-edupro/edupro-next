import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { RUN } from './payroll-inputs.dto';
import {
  CancelDto,
  LopDto,
  LopListDto,
  LopPreviewDto,
  PayrollReviewService,
  ReconcileDto,
} from './payroll-review.service';

const id = (v: string) => {
  if (!/^\d{1,18}$/.test(v))
    throw new DomainError('validation-failed', 'Not a valid id', { status: 400 });
  return v;
};

/** Review tools (docs/design/86, phase B step 4): loss-of-pay reversal and salary reconciliation. */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollReviewController {
  constructor(private readonly review: PayrollReviewService) {}

  @Get('lop-reversals')
  @ApiOperation({ summary: 'Loss-of-pay reversals' })
  @RequirePermission(RUN.view)
  list(@ReqCtx() ctx: RequestContext, @Query() q: LopListDto) {
    return this.review.lopList(ctx, q);
  }

  @Post('lop-reversals/preview')
  @ApiOperation({ summary: 'What a reversal of days of a locked month is worth (nothing saved)' })
  @RequirePermission(RUN.view)
  preview(@ReqCtx() ctx: RequestContext, @Body() dto: LopPreviewDto) {
    return this.review.lopPreview(ctx, dto);
  }

  @Post('lop-reversals')
  @ApiOperation({ summary: 'Stage a loss-of-pay reversal (a maker)' })
  @RequirePermission(RUN.manage)
  add(@ReqCtx() ctx: RequestContext, @Body() dto: LopDto) {
    return this.review.lopAdd(ctx, dto);
  }

  @Post('lop-reversals/:id/approve')
  @ApiOperation({ summary: 'Approve a reversal (a checker who did not stage it): two arrears' })
  @RequirePermission(RUN.approve)
  approve(@ReqCtx() ctx: RequestContext, @Param('id') lid: string) {
    return this.review.lopApprove(ctx, id(lid));
  }

  @Post('lop-reversals/:id/cancel')
  @ApiOperation({ summary: 'Cancel a reversal (an approved one: a checker, while unpaid)' })
  @RequirePermission(RUN.manage)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') lid: string, @Body() dto: CancelDto) {
    return this.review.lopCancel(ctx, id(lid), dto);
  }

  @Get('reconcile')
  @ApiOperation({
    summary: 'One employee’s month worked out again beside what was paid (saves nothing)',
  })
  @RequirePermission(RUN.approve)
  reconcile(@ReqCtx() ctx: RequestContext, @Query() q: ReconcileDto) {
    return this.review.reconcile(ctx, q);
  }
}
