import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PurchaseStoresService } from './purchase-stores.service';
import {
  LedgerQueryDto,
  OpeningDto,
  OpeningFixDto,
  OpeningImportDto,
  OpeningUndoDto,
  PURCHASE,
  RevaluationDecisionDto,
  RevaluationDto,
  StatementQueryDto,
  StockQueryDto,
  StoreDto,
  StoreLevelsDto,
} from './purchase.dto';

/** Purchase phase 2, part 6 (docs/design/84): stores, their keepers, stock in hand, the stock register. */
@ApiTags('purchase')
@ApiBearerAuth()
@Controller('purchase')
export class PurchaseStoresController {
  constructor(private readonly stores: PurchaseStoresService) {}

  @Get('stores')
  @ApiOperation({
    summary: 'The main store and the sub-stores, with keepers, stock value, below reorder',
  })
  @RequirePermission(PURCHASE.storeView)
  list(@ReqCtx() ctx: RequestContext) {
    return this.stores.stores(ctx);
  }

  @Get('store-form')
  @RequirePermission(PURCHASE.storeView)
  form(@ReqCtx() ctx: RequestContext) {
    return this.stores.formLists(ctx);
  }

  @Get('stores/:id')
  @RequirePermission(PURCHASE.storeView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.stores.store(ctx, id);
  }

  @Post('stores')
  @RequirePermission(PURCHASE.storeManage)
  create(@ReqCtx() ctx: RequestContext, @Body() body: StoreDto) {
    return this.stores.saveStore(ctx, null, body);
  }

  @Put('stores/:id')
  @RequirePermission(PURCHASE.storeManage)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: StoreDto) {
    return this.stores.saveStore(ctx, id, body);
  }

  @Put('stores/:id/levels')
  @ApiOperation({ summary: 'Reorder level, reorder quantity and maximum per item in the store' })
  @RequirePermission(PURCHASE.storeManage)
  levels(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: StoreLevelsDto) {
    return this.stores.saveLevels(ctx, id, body);
  }

  @Post('stores/:id/opening')
  @ApiOperation({ summary: 'Opening stock of the store (once per item; later changes by a count)' })
  @RequirePermission(PURCHASE.storeOperate)
  opening(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: OpeningDto) {
    return this.stores.opening(ctx, id, body);
  }

  @Get('stores/:id/opening-template')
  @RequirePermission(PURCHASE.storeOperate)
  template(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.stores.openingTemplate(ctx, id);
  }

  @Post('stores/:id/opening-import')
  @RequirePermission(PURCHASE.storeOperate)
  importOpening(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: OpeningImportDto,
  ) {
    return this.stores.openingImport(ctx, id, body);
  }

  @Get('stores/:id/openings')
  @ApiOperation({
    summary:
      'The opening stock posted (each posting and its lines), what can still be changed, missing assets',
  })
  @RequirePermission(PURCHASE.storeView)
  openings(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.stores.openings(ctx, id);
  }

  @Post('stores/:id/opening-fix')
  @ApiOperation({ summary: "One item's opening changed or removed while it has not moved since" })
  @RequirePermission(PURCHASE.storeOperate)
  fixOpening(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: OpeningFixDto) {
    return this.stores.fixOpening(ctx, id, body);
  }

  @Post('openings/:id/undo')
  @ApiOperation({ summary: 'A whole opening upload undone while none of its items has moved' })
  @RequirePermission(PURCHASE.storeOperate)
  undoOpening(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: OpeningUndoDto,
  ) {
    return this.stores.undoOpening(ctx, id, body);
  }

  @Post('stores/:id/opening-assets')
  @ApiOperation({ summary: "Make the assets an asset item's opening stock should have made" })
  @RequirePermission(PURCHASE.storeOperate)
  openingAssets(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.stores.makeOpeningAssets(ctx, id);
  }

  @Get('stores/:id/opening-statement')
  @ApiOperation({ summary: 'The opening stock statement: PDF (bytes) or ?format=xlsx (a file)' })
  @RequirePermission(PURCHASE.storeView)
  async openingStatement(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: StatementQueryDto,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.stores.openingStatement(ctx, id, q.format);
    if ('bytes' in f)
      void reply
        .header('content-type', 'application/pdf')
        .header(
          'content-disposition',
          `${save === '1' ? 'attachment' : 'inline'}; filename="${f.filename.replace(/[^\w.\- ]+/g, '_')}"`,
        )
        .header('cache-control', 'private, no-store')
        .send(f.bytes);
    else void reply.send(f);
  }

  @Get('revaluations')
  @ApiOperation({ summary: 'Rate corrections (the stores, or the school admin who approves them)' })
  @AuthenticatedOnly()
  revaluations(
    @ReqCtx() ctx: RequestContext,
    @Query('status') status: string | undefined,
    @Query('storeId') storeId: string | undefined,
  ) {
    return this.stores.revaluations(ctx, {
      status: status && /^[a-z]{3,12}$/.test(status) ? status : undefined,
      storeId: storeId && /^\d{1,18}$/.test(storeId) ? storeId : undefined,
    });
  }

  @Post('stores/:id/revaluations')
  @ApiOperation({ summary: 'Ask for a rate correction of what is left of an item in the store' })
  @RequirePermission(PURCHASE.storeOperate)
  revalue(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: RevaluationDto) {
    return this.stores.requestRevaluation(ctx, id, body);
  }

  @Post('revaluations/:id/decide')
  @ApiOperation({
    summary: 'Approve (the school admin, not who asked), reject, or cancel a rate correction',
  })
  @AuthenticatedOnly()
  decideRevaluation(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: RevaluationDecisionDto,
  ) {
    return this.stores.decideRevaluation(ctx, id, body);
  }

  @Get('stock')
  @ApiOperation({
    summary: 'Stock in hand by store and item (value, reserved, below reorder); Excel / PDF',
  })
  @RequirePermission(PURCHASE.storeView)
  stock(@ReqCtx() ctx: RequestContext, @Query() q: StockQueryDto) {
    return this.stores.stock(ctx, q);
  }

  @Get('stock/items/:itemId')
  @ApiOperation({ summary: "An item's stock register (every move with the balance); Excel / PDF" })
  @RequirePermission(PURCHASE.storeView)
  ledger(
    @ReqCtx() ctx: RequestContext,
    @Param('itemId') itemId: string,
    @Query() q: LedgerQueryDto,
  ) {
    return this.stores.ledger(ctx, itemId, q);
  }
}
