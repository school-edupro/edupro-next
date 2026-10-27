import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { CounterCollectDto, CounterQueryDto } from './counter.dto';
import { AdmissionCounterService } from './counter.service';
import { ADMISSION_FEE } from './desk.controller';

/**
 * Fees → Cashier, Admission fees (docs/design/52): Accounts take registration and admission fees
 * offline with `admissions.fee.collect` alone, without the Admissions module.
 */
@ApiTags('fees')
@ApiBearerAuth()
@Controller('fees/admission-counter')
export class AdmissionCounterController {
  constructor(private readonly svc: AdmissionCounterService) {}

  @Get()
  @ApiOperation({
    summary: 'Registrations with a fee due (or any), by number, name, mobile or email',
  })
  @RequirePermission(ADMISSION_FEE)
  find(@ReqCtx() ctx: RequestContext, @Query() q: CounterQueryDto) {
    return this.svc.find(ctx, q.q, q.due === '1');
  }

  @Get('today')
  @ApiOperation({ summary: 'The admission receipts I took today' })
  @RequirePermission(ADMISSION_FEE)
  today(@ReqCtx() ctx: RequestContext) {
    return this.svc.today(ctx);
  }

  @Post(':id/collect')
  @ApiOperation({ summary: 'Take the registration or admission fee due, in full: the receipt' })
  @RequirePermission(ADMISSION_FEE)
  collect(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CounterCollectDto) {
    return this.svc.collect(ctx, id, dto);
  }

  @Get(':id/receipts/:receiptId/pdf')
  @ApiOperation({ summary: 'A receipt of the registration (download=1 saves it)' })
  @RequirePermission(ADMISSION_FEE)
  async receipt(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('receiptId') receiptId: string,
    @Query('download') download: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.svc.receiptPdf(ctx, id, receiptId);
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
