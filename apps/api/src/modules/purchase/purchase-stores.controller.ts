import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PurchaseStoresService } from './purchase-stores.service';
import {
  LedgerQueryDto,
  OpeningDto,
  OpeningImportDto,
  PURCHASE,
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
