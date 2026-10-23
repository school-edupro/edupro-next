import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ADMISSIONS } from './admissions.dto';
import {
  AdmitBulkDto,
  AdmitDto,
  CancelDto,
  RefundDecisionDto,
  RefundPayDto,
  RefundsQueryDto,
} from './admit.dto';
import {
  ADMISSION_ADMIT,
  ADMISSION_CANCEL,
  AdmissionAdmitService,
  REFUND_APPROVE,
} from './admit.service';
import { ADMISSION_FEE } from './desk.controller';
import { DeskFeeDto } from './desk.dto';

/** Admission fee, Admit and cancellation of online admission (docs/design/39, part 6). */
@ApiTags('admissions')
@ApiBearerAuth()
@Controller('admissions')
export class AdmissionAdmitController {
  constructor(private readonly svc: AdmissionAdmitService) {}

  @Post('registrations/:id/admission-fee')
  @ApiOperation({
    summary:
      'The admission fee taken at the desk (or confirmed when none is due): the admission number',
  })
  @RequirePermission(ADMISSION_FEE)
  collect(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: DeskFeeDto) {
    return this.svc.collect(ctx, id, dto);
  }

  @Get('registrations/:id/admission-form')
  @RequirePermission(ADMISSIONS.applicationView)
  admissionForm(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.admissionForm(ctx, id);
  }

  @Get('cycles/:id/admit/:classId')
  @ApiOperation({
    summary: 'Who waits to be admitted in a class, and its sections in the session year',
  })
  @RequirePermission(ADMISSIONS.applicationView)
  admitList(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('classId') classId: string,
  ) {
    return this.svc.admitList(ctx, id, classId);
  }

  @Post('registrations/:id/admit')
  @ApiOperation({ summary: 'Admit into the student master with a class-section' })
  @RequirePermission(ADMISSION_ADMIT, {
    description:
      'Admit candidates who paid the admission fee into the student master with a class-section',
  })
  admit(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: AdmitDto) {
    return this.svc.admit(ctx, id, dto);
  }

  @Post('admit-bulk')
  @RequirePermission(ADMISSION_ADMIT)
  admitBulk(@ReqCtx() ctx: RequestContext, @Body() dto: AdmitBulkDto) {
    return this.svc.admitBulk(ctx, dto);
  }

  @Get('registrations/:id/cancel')
  @ApiOperation({ summary: 'What cancelling would refund' })
  @RequirePermission(ADMISSIONS.applicationView)
  cancelPreview(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.cancelPreview(ctx, id);
  }

  @Post('registrations/:id/cancel')
  @RequirePermission(ADMISSION_CANCEL, {
    description:
      'Cancel a registration or an admission (the admission fee refund goes to the refund approvers)',
  })
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CancelDto) {
    return this.svc.cancel(ctx, id, dto);
  }

  @Get('refunds')
  @RequirePermission(ADMISSIONS.applicationView)
  refunds(@ReqCtx() ctx: RequestContext, @Query() q: RefundsQueryDto) {
    return this.svc.refunds(ctx, q);
  }

  @Post('refunds/:id/decide')
  @ApiOperation({ summary: 'The fee refund approvers approve or reject an admission fee refund' })
  @RequirePermission(REFUND_APPROVE)
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: RefundDecisionDto) {
    return this.svc.decideRefund(ctx, id, dto);
  }

  @Post('refunds/:id/pay')
  @RequirePermission(REFUND_APPROVE)
  pay(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: RefundPayDto) {
    return this.svc.payRefund(ctx, id, dto);
  }
}
