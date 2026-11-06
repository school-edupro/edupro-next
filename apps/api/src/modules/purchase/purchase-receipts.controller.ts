import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PurchaseReceiptsService } from './purchase-receipts.service';
import { InspectionDto, ReasonDto, ReceiptDto, ReceiptListQueryDto } from './purchase.dto';

const disposition = (save: string | undefined, name: string) =>
  `${save === '1' ? 'attachment' : 'inline'}; filename="${name.replace(/[^\w.\- ]+/g, '_')}"`;

/**
 * Purchase phase 2, part 7 (docs/design/84): goods receipts and completion certificates, their
 * inspection and acceptance. Receiving needs a store or purchase right (checked in the service); the
 * inspectors are the PO department's Inspection levels or the purchase committee, so seeing and
 * inspecting a receipt follows those, not a right of its own.
 */
@ApiTags('purchase')
@ApiBearerAuth()
@Controller('purchase')
export class PurchaseReceiptsController {
  constructor(private readonly receipts: PurchaseReceiptsService) {}

  @Get('receipts')
  @AuthenticatedOnly()
  list(@ReqCtx() ctx: RequestContext, @Query() q: ReceiptListQueryDto) {
    return this.receipts.list(ctx, q);
  }

  @Get('receipts-waiting')
  @ApiOperation({ summary: 'How many receipts wait for me to inspect or sign' })
  @AuthenticatedOnly()
  waiting(@ReqCtx() ctx: RequestContext) {
    return this.receipts.waitingCount(ctx);
  }

  @Get('to-receive')
  @ApiOperation({ summary: 'Placed POs with something still to come' })
  @AuthenticatedOnly()
  toReceive(@ReqCtx() ctx: RequestContext, @Query('q') q: string | undefined) {
    return this.receipts.toReceive(ctx, { q: q?.trim().slice(0, 80) || undefined });
  }

  @Get('receipt-form/:orderId')
  @AuthenticatedOnly()
  form(@ReqCtx() ctx: RequestContext, @Param('orderId') orderId: string) {
    return this.receipts.form(ctx, orderId);
  }

  @Post('receipts')
  @ApiOperation({ summary: 'Record what came against a PO (goods) or the work done (a service)' })
  @AuthenticatedOnly()
  create(@ReqCtx() ctx: RequestContext, @Body() body: ReceiptDto) {
    return this.receipts.create(ctx, body);
  }

  @Get('receipts/:id')
  @AuthenticatedOnly()
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.receipts.get(ctx, id);
  }

  @Post('receipts/:id/inspect')
  @ApiOperation({ summary: 'Accept (line by line, rejecting some) or reject a receipt' })
  @AuthenticatedOnly()
  inspect(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: InspectionDto) {
    return this.receipts.inspect(ctx, id, body);
  }

  @Post('receipts/:id/cancel')
  @AuthenticatedOnly()
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.receipts.cancel(ctx, id, body);
  }

  @Get('receipts/:id/pdf')
  @ApiOperation({ summary: 'The goods received and inspection note (or completion certificate)' })
  @AuthenticatedOnly()
  async pdf(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.receipts.pdf(ctx, id);
    void reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', disposition(save, f.filename))
      .header('cache-control', 'private, no-store')
      .send(f.bytes);
  }

  @Get('receipts/:id/file')
  @ApiOperation({ summary: 'The challan / invoice kept with the receipt' })
  @AuthenticatedOnly()
  async file(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.receipts.file(ctx, id);
    void reply
      .header('content-type', f.contentType)
      .header('content-disposition', disposition(save, f.filename))
      .header('cache-control', 'private, no-store')
      .send(f.bytes);
  }
}
