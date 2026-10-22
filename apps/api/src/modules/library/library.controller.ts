import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  AccessionDto,
  CatalogueQueryDto,
  ChargeDto,
  ChargeExportDto,
  ChargeListDto,
  ChargePreviewDto,
  DeskBookDto,
  DeskBorrowerDto,
  DeskClassDto,
  DeskIssueDto,
  DeskReturnDto,
  CopyStatusDto,
  FineDto,
  FinesExportDto,
  FinesQueryDto,
  FinesSendDto,
  IssueDto,
  LIBRARY,
  LoansQueryDto,
  RenewDto,
  ReturnDto,
  SaleDto,
  StockCheckCloseDto,
  StockCheckScanDto,
  StockCheckStartDto,
  WaiveRequestDto,
} from './library.dto';
import { LibraryFinesService } from './library-fines.service';
import { LibraryChargesService } from './library-charges.service';
import { LibraryDeskService } from './library-desk.service';
import { DomainError } from '../../common/errors/domain-error';
import { LibraryService } from './library.service';

/** Sprint 17: library — catalogue and copies, circulation, fines; the family's loans. */
@ApiTags('library')
@ApiBearerAuth()
@Controller('library')
export class LibraryController {
  constructor(
    private readonly library: LibraryService,
    private readonly charges: LibraryChargesService,
    private readonly desk: LibraryDeskService,
    private readonly fines: LibraryFinesService,
  ) {}

  // ---- the circulation desk ------------------------------------------------------------------------
  @Get('desk/borrowers')
  @ApiOperation({
    summary: 'A borrower by admission no. or employee code, else pupils and staff by name',
  })
  @RequirePermission(LIBRARY.circulate)
  deskBorrowers(@ReqCtx() ctx: RequestContext, @Query() q: DeskBorrowerDto) {
    return this.desk.findBorrower(ctx, q.q);
  }

  @Get('desk/borrowers/:kind/:id')
  @ApiOperation({ summary: 'A borrower with their rule, books, fines and charges' })
  @RequirePermission(LIBRARY.circulate)
  deskBorrower(
    @ReqCtx() ctx: RequestContext,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    if ((kind !== 'student' && kind !== 'employee') || !/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Borrower not found', { status: 404 });
    return this.desk.borrower(ctx, kind, id);
  }

  @Get('desk/book')
  @ApiOperation({
    summary: 'A book by its number: for issue, what stands in the way; for return, its loan',
  })
  @RequirePermission(LIBRARY.circulate)
  deskBook(@ReqCtx() ctx: RequestContext, @Query() q: DeskBookDto) {
    return this.desk.book(ctx, q);
  }

  @Post('desk/issue')
  @ApiOperation({ summary: 'Several books issued to one borrower, all or none' })
  @RequirePermission(LIBRARY.circulate)
  deskIssue(@ReqCtx() ctx: RequestContext, @Body() body: DeskIssueDto) {
    return this.desk.issueMany(ctx, body);
  }

  @Post('desk/return')
  @ApiOperation({ summary: 'Several books returned in good condition, all or none' })
  @RequirePermission(LIBRARY.circulate)
  deskReturn(@ReqCtx() ctx: RequestContext, @Body() body: DeskReturnDto) {
    return this.desk.returnMany(ctx, body);
  }

  @Get('desk/sections')
  @ApiOperation({ summary: 'The classes and sections of the working year' })
  @RequirePermission(LIBRARY.circulate)
  deskSections(@ReqCtx() ctx: RequestContext) {
    return this.desk.sections(ctx);
  }

  @Get('desk/class-loans')
  @ApiOperation({ summary: 'The books the pupils of a class or section hold now' })
  @RequirePermission(LIBRARY.circulate)
  deskClassLoans(@ReqCtx() ctx: RequestContext, @Query() q: DeskClassDto) {
    return this.desk.classLoans(ctx, q);
  }

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

  // ---- lost and damaged books, charged to the borrower (part 3 of the register work) -----------------
  @Get('charges/preview')
  @ApiOperation({ summary: 'What a lost or damaged book would be charged' })
  @RequirePermission(LIBRARY.circulate)
  chargePreview(@ReqCtx() ctx: RequestContext, @Query() q: ChargePreviewDto) {
    return this.charges.preview(ctx, q);
  }

  @Post('charges')
  @ApiOperation({
    summary: 'A book reported lost or returned damaged; the charge announced as a misc fee',
  })
  @RequirePermission(LIBRARY.circulate)
  charge(@ReqCtx() ctx: RequestContext, @Body() body: ChargeDto) {
    return this.charges.charge(ctx, body);
  }

  @Get('charges')
  @ApiOperation({ summary: 'Lost and damaged books charged, with what is paid' })
  @RequirePermission(LIBRARY.circulate)
  chargeList(@ReqCtx() ctx: RequestContext, @Query() q: ChargeListDto) {
    return this.charges.list(ctx, q);
  }

  @Get('charges/export')
  @ApiOperation({ summary: 'The charges list as filtered, as Excel or PDF' })
  @RequirePermission(LIBRARY.circulate)
  chargeExport(@ReqCtx() ctx: RequestContext, @Query() q: ChargeExportDto) {
    return this.charges.export(ctx, q);
  }

  @Post('charges/:id/waive-request')
  @ApiOperation({
    summary: 'A late fine at the fees counter waived in part or in full (the fees office approves)',
  })
  @RequirePermission(LIBRARY.circulate)
  waiveRequest(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: WaiveRequestDto,
  ) {
    return this.charges.askWaiver(ctx, id, body);
  }

  // ---- library reports: fines (docs/design/36-library.md, "Library reports") -------------------------
  @Get('fines/report')
  @ApiOperation({ summary: 'Late fines outstanding, collected or waived, between two days' })
  @RequirePermission(LIBRARY.circulate)
  finesReport(@ReqCtx() ctx: RequestContext, @Query() q: FinesQueryDto) {
    return this.fines.report(ctx, q);
  }

  @Get('fines/export')
  @ApiOperation({ summary: 'A fines tab as filtered, as Excel or PDF' })
  @RequirePermission(LIBRARY.circulate)
  finesExport(@ReqCtx() ctx: RequestContext, @Query() q: FinesExportDto) {
    return this.fines.export(ctx, q);
  }

  @Post('fines/send')
  @ApiOperation({ summary: 'Old fines not yet at the fees counter announced there as misc fees' })
  @RequirePermission(LIBRARY.circulate)
  finesSend(@ReqCtx() ctx: RequestContext, @Body() body: FinesSendDto) {
    return this.charges.sendUnsent(ctx, body.loanIds);
  }

  @Post('loans/:id/fine')
  @ApiOperation({ summary: 'An old fine not yet at the fees counter waived (with a reason)' })
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
