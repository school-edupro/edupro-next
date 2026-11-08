import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PurchaseOrdersService } from './purchase-orders.service';
import {
  CloseToOrderDto,
  CreateOrderDto,
  EmergencyDto,
  IndentDecisionDto,
  OrderExportQueryDto,
  OrderListQueryDto,
  PURCHASE,
  ReasonDto,
  SendOrderDto,
  UpdateOrderDto,
} from './purchase.dto';

/**
 * Purchase, part 4 (docs/design/83): the Purchase Order and the emergency purchase. Approvers reach
 * theirs without a right of their own (the department's PO levels, the ratifier, decide).
 */
@ApiTags('purchase')
@ApiBearerAuth()
@Controller('purchase')
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @Get('orders/export')
  @ApiOperation({ summary: 'The orders list as on screen (its filters), as Excel or PDF' })
  @AuthenticatedOnly()
  exportList(@ReqCtx() ctx: RequestContext, @Query() q: OrderExportQueryDto) {
    return this.orders.exportList(ctx, q);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Purchase orders: all (purchase office), or waiting for my approval' })
  @AuthenticatedOnly()
  list(@ReqCtx() ctx: RequestContext, @Query() q: OrderListQueryDto) {
    return this.orders.list(ctx, q);
  }

  @Get('to-order')
  @ApiOperation({
    summary: 'Approved requisition lines not yet on a PO, by requisition and vendor',
  })
  @RequirePermission(PURCHASE.orderManage)
  toOrder(@ReqCtx() ctx: RequestContext) {
    return this.orders.toOrder(ctx);
  }

  @Post('to-order/close')
  @ApiOperation({
    summary: 'Close lines waiting on To order: not to be ordered (with the reason)',
  })
  @RequirePermission(PURCHASE.orderManage)
  closeToOrder(@ReqCtx() ctx: RequestContext, @Body() body: CloseToOrderDto) {
    return this.orders.closeToOrder(ctx, body);
  }

  @Get('order-form')
  @AuthenticatedOnly()
  form(@ReqCtx() ctx: RequestContext) {
    return this.orders.formLists(ctx);
  }

  @Post('orders')
  @RequirePermission(PURCHASE.orderManage)
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateOrderDto) {
    return this.orders.create(ctx, body);
  }

  @Post('emergency-purchases')
  @ApiOperation({ summary: 'Record an emergency purchase after the fact (for ratification)' })
  @RequirePermission(PURCHASE.emergencyRecord)
  emergency(@ReqCtx() ctx: RequestContext, @Body() body: EmergencyDto) {
    return this.orders.emergency(ctx, body);
  }

  @Get('orders/:id')
  @AuthenticatedOnly()
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.orders.get(ctx, id);
  }

  @Get('orders/:id/quotes/:quoteId/file')
  @ApiOperation({ summary: 'A quote document of the PO’s requisition (for its approvers)' })
  @AuthenticatedOnly()
  async quoteFile(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('quoteId') quoteId: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.orders.quoteFile(ctx, id, quoteId);
    void reply
      .header('content-type', f.contentType)
      .header(
        'content-disposition',
        `${save === '1' ? 'attachment' : 'inline'}; filename="${f.filename.replace(/[^\w.\- ]+/g, '_')}"`,
      )
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(f.bytes);
  }

  @Get('orders/:id/pdf')
  @ApiOperation({ summary: 'The PO as a PDF (DRAFT across it until approved)' })
  @AuthenticatedOnly()
  async pdf(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.orders.pdf(ctx, id);
    void reply
      .header('content-type', 'application/pdf')
      .header(
        'content-disposition',
        `${save === '1' ? 'attachment' : 'inline'}; filename="${f.filename.replace(/[^\w.\- ]+/g, '_')}"`,
      )
      .header('cache-control', 'private, no-store')
      .send(f.bytes);
  }

  @Put('orders/:id')
  @RequirePermission(PURCHASE.orderManage)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UpdateOrderDto) {
    return this.orders.update(ctx, id, body);
  }

  @Post('orders/:id/submit')
  @AuthenticatedOnly()
  submit(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.orders.submit(ctx, id);
  }

  @Post('orders/:id/decide')
  @AuthenticatedOnly()
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: IndentDecisionDto) {
    return this.orders.decide(ctx, id, body);
  }

  @Post('orders/:id/send')
  @ApiOperation({ summary: 'E-mail the PO (PDF attached) to the vendor; logged' })
  @RequirePermission(PURCHASE.orderManage)
  send(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: SendOrderDto) {
    return this.orders.send(ctx, id, body);
  }

  @Post('orders/:id/close')
  @RequirePermission(PURCHASE.orderManage)
  close(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.orders.close(ctx, id, body);
  }

  @Post('orders/:id/cancel')
  @AuthenticatedOnly()
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.orders.cancel(ctx, id, body);
  }

  @Post('orders/:id/amend')
  @ApiOperation({ summary: 'The next revision of an approved PO, to change and approve again' })
  @RequirePermission(PURCHASE.orderManage)
  amend(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.orders.amend(ctx, id, body);
  }
}
