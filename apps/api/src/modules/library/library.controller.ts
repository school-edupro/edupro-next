import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  AccessionDto,
  CatalogueQueryDto,
  CopyStatusDto,
  FineDto,
  IssueDto,
  LIBRARY,
  LoansQueryDto,
  RenewDto,
  ReturnDto,
  SaleDto,
  StockCheckCloseDto,
  StockCheckScanDto,
  StockCheckStartDto,
} from './library.dto';
import { LibraryService } from './library.service';

/** Sprint 17: library — catalogue and copies, circulation, fines; the family's loans. */
@ApiTags('library')
@ApiBearerAuth()
@Controller('library')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get('catalogue')
  @RequirePermission(LIBRARY.view, { description: 'Search the catalogue, see copies and loans' })
  catalogue(@ReqCtx() ctx: RequestContext, @Query() q: CatalogueQueryDto) {
    return this.library.catalogue(ctx, q);
  }

  @Get('titles/:id/copies')
  @RequirePermission(LIBRARY.view)
  async copies(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.library.copies(ctx, id) };
  }

  @Post('copies')
  @ApiOperation({ summary: 'Accession: add copies of a title' })
  @RequirePermission(LIBRARY.manage, { description: 'Maintain titles and copies (accession)' })
  accession(@ReqCtx() ctx: RequestContext, @Body() body: AccessionDto) {
    return this.library.accession(ctx, body);
  }

  @Put('copies/:id/status')
  @RequirePermission(LIBRARY.manage)
  copyStatus(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: CopyStatusDto) {
    return this.library.setCopyStatus(ctx, id, body);
  }

  @Get('loans')
  @RequirePermission(LIBRARY.view)
  loans(@ReqCtx() ctx: RequestContext, @Query() q: LoansQueryDto) {
    return this.library.loans(ctx, q);
  }

  @Post('loans/issue')
  @RequirePermission(LIBRARY.circulate, {
    description: 'Issue, renew and return copies; collect or waive fines',
  })
  issue(@ReqCtx() ctx: RequestContext, @Body() body: IssueDto) {
    return this.library.issue(ctx, body);
  }

  @Post('loans/renew')
  @RequirePermission(LIBRARY.circulate)
  renew(@ReqCtx() ctx: RequestContext, @Body() body: RenewDto) {
    return this.library.renew(ctx, body);
  }

  @Post('loans/return')
  @RequirePermission(LIBRARY.circulate)
  returnCopy(@ReqCtx() ctx: RequestContext, @Body() body: ReturnDto) {
    return this.library.returnCopy(ctx, body);
  }

  @Post('loans/:id/fine')
  @RequirePermission(LIBRARY.circulate)
  fine(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: FineDto) {
    return this.library.fine(ctx, id, body);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Loans of my children' })
  @RequirePermission(LIBRARY.familyView, {
    description: 'A family sees the loans of its own children',
  })
  mine(@ReqCtx() ctx: RequestContext) {
    return this.library.mine(ctx);
  }

  // ---- Sprint 18 ----
  @Post('sales')
  @ApiOperation({ summary: 'Sell a withdrawn or damaged copy' })
  @RequirePermission('library.stock.verify', {
    description: 'Run stock verification and record sales',
  })
  sell(@ReqCtx() ctx: RequestContext, @Body() body: SaleDto) {
    return this.library.sell(ctx, body);
  }

  @Get('sales')
  @RequirePermission(LIBRARY.view)
  async sales(@ReqCtx() ctx: RequestContext) {
    return { data: await this.library.sales(ctx) };
  }

  @Get('digital')
  @ApiOperation({ summary: 'Digital library items the caller may open' })
  @RequirePermission(LIBRARY.view)
  async digital(@ReqCtx() ctx: RequestContext) {
    return { data: await this.library.digital(ctx, LIBRARY.view) };
  }

  @Get('mine/digital')
  @RequirePermission(LIBRARY.familyView)
  async myDigital(@ReqCtx() ctx: RequestContext) {
    return { data: await this.library.digital(ctx, LIBRARY.familyView) };
  }

  @Get('stock-checks')
  @RequirePermission(LIBRARY.view)
  async stockChecks(@ReqCtx() ctx: RequestContext) {
    return { data: await this.library.stockChecks(ctx) };
  }

  @Post('stock-checks')
  @RequirePermission('library.stock.verify')
  startStockCheck(@ReqCtx() ctx: RequestContext, @Body() body: StockCheckStartDto) {
    return this.library.startStockCheck(ctx, body);
  }

  @Post('stock-checks/:id/scan')
  @ApiOperation({ summary: 'Record scanned accession numbers as found' })
  @RequirePermission('library.stock.verify')
  scanStockCheck(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: StockCheckScanDto,
  ) {
    return this.library.scanStockCheck(ctx, id, body);
  }

  @Post('stock-checks/:id/close')
  @RequirePermission('library.stock.verify')
  closeStockCheck(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: StockCheckCloseDto,
  ) {
    return this.library.closeStockCheck(ctx, id, body);
  }
}
