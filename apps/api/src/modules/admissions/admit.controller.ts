import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { AdmissionRefundsService } from './refunds.service';
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
import { ADMISSION_ADMIT, ADMISSION_CANCEL, AdmissionAdmitService } from './admit.service';
import { ADMISSION_FEE } from './desk.controller';
import { DeskFeeDto } from './desk.dto';

/** Admission fee, Admit and cancellation of online admission (docs/design/39, part 6). */
@ApiTags('admissions')
@ApiBearerAuth()
@Controller('admissions')
export class AdmissionAdmitController {
  constructor(
    private readonly svc: AdmissionAdmitService,
    private readonly refundsSvc: AdmissionRefundsService,
  ) {}

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

  // admission fee refunds (docs/design/54): the levels of Fees → Approval decide; Accounts pay
  @Get('refunds')
  @AuthenticatedOnly()
  refunds(@ReqCtx() ctx: RequestContext, @Query() q: RefundsQueryDto) {
    return this.refundsSvc.list(ctx, q);
  }

  @Get('refunds/approval-levels')
  @ApiOperation({ summary: 'Makes sure the refund approval levels exist (Fees → Approval edits them)' })
  @AuthenticatedOnly()
  refundLevels(@ReqCtx() ctx: RequestContext) {
    return this.refundsSvc.approvalFlow(ctx);
  }

  @Post('refunds/:id/decide')
  @ApiOperation({
    summary: 'The level waiting (or, levels off, a refund approver) decides a refund',
  })
  @AuthenticatedOnly()
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: RefundDecisionDto) {
    return this.refundsSvc.decide(ctx, id, dto);
  }

  @Post('refunds/:id/pay')
  @ApiOperation({ summary: 'Accounts pay an approved refund out: the voucher' })
  @AuthenticatedOnly()
  pay(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: RefundPayDto) {
    return this.refundsSvc.pay(ctx, id, dto);
  }

  @Get('refunds/:id/voucher.pdf')
  @ApiOperation({ summary: 'The refund voucher (download=1 saves it)' })
  @AuthenticatedOnly()
  async voucher(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.refundsSvc.voucher(ctx, id);
    void reply
      .header('content-type', f.contentType)
      .header(
        'content-disposition',
        `${download === '1' ? 'attachment' : 'inline'}; filename="${f.filename}"`,
      )
      .header('cache-control', 'private, no-store')
      .send(Buffer.from(f.base64, 'base64'));
  }
}
