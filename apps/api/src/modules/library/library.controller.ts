import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  AccessionDto,
  BorrowerHistoryDto,
  BorrowerHistoryExportDto,
  BorrowersExportDto,
  BorrowersQueryDto,
  CatalogueQueryDto,
  ChargeDto,
  ChargeExportDto,
  ChargeListDto,
  ChargePreviewDto,
  CirculationExportDto,
  CirculationQueryDto,
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
  BookSaleDto,
  SalesExportDto,
  SalesQueryDto,
  StockCancelDto,
  StockCloseDto,
  StockCycleDto,
  StockItemsExportDto,
  StockItemsQueryDto,
  StockVerifyDto,
  WaiveRequestDto,
} from './library.dto';
import { LibraryFinesService } from './library-fines.service';
import { LibraryHistoryService } from './library-history.service';
import { LibraryStockService } from './library-stock.service';
import { LibrarySalesService } from './library-sales.service';
import { LibraryChargesService } from './library-charges.service';
import { LibraryDeskService } from './library-desk.service';
import { DomainError } from '../../common/errors/domain-error';
import { LibraryService } from './library.service';

/** Stock verification is its own right (the Librarian role has it). */
const STOCK = 'library.stock.verify';

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
    private readonly history: LibraryHistoryService,
    private readonly stock: LibraryStockService,
    private readonly sales: LibrarySalesService,
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

  // ---- library reports: circulation and borrowers' history (part 2) ---------------------------------
  @Get('history/circulation')
  @ApiOperation({
    summary: 'Issues, returns and renewals between two days; the books out or overdue now',
  })
  @RequirePermission(LIBRARY.circulate)
  circulationHistory(@ReqCtx() ctx: RequestContext, @Query() q: CirculationQueryDto) {
    return this.history.circulation(ctx, q);
  }

  @Get('history/circulation/export')
  @ApiOperation({ summary: 'The circulation list as filtered, as Excel or PDF' })
  @RequirePermission(LIBRARY.circulate)
  circulationExport(@ReqCtx() ctx: RequestContext, @Query() q: CirculationExportDto) {
    return this.history.circulationExport(ctx, q);
  }

  @Get('history/borrowers')
  @ApiOperation({ summary: 'Pupils or staff with what they borrowed and returned, and hold now' })
  @RequirePermission(LIBRARY.circulate)
  borrowersHistory(@ReqCtx() ctx: RequestContext, @Query() q: BorrowersQueryDto) {
    return this.history.borrowers(ctx, q);
  }

  @Get('history/borrowers/export')
  @ApiOperation({ summary: 'The borrowers list as filtered, as Excel or PDF' })
  @RequirePermission(LIBRARY.circulate)
  borrowersExport(@ReqCtx() ctx: RequestContext, @Query() q: BorrowersExportDto) {
    return this.history.borrowersExport(ctx, q);
  }

  @Get('history/borrowers/:kind/:id')
  @ApiOperation({ summary: 'One borrower’s books held between two days, with fines and charges' })
  @RequirePermission(LIBRARY.circulate)
  borrowerHistory(
    @ReqCtx() ctx: RequestContext,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query() q: BorrowerHistoryDto,
  ) {
    return this.history.borrower(ctx, kind, id, q);
  }

  @Get('history/borrowers/:kind/:id/export')
  @ApiOperation({ summary: 'One borrower’s history as Excel or PDF' })
  @RequirePermission(LIBRARY.circulate)
  borrowerHistoryExport(
    @ReqCtx() ctx: RequestContext,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query() q: BorrowerHistoryExportDto,
  ) {
    return this.history.borrowerExport(ctx, kind, id, q);
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

  // ---- books sold (library reports, part 4) ---------------------------------------------------------
  @Post('sales')
  @ApiOperation({
    summary:
      'Books sold to one buyer: a pupil or staff member owes a misc fee, someone outside pays on a misc receipt',
  })
  @RequirePermission(STOCK, { description: 'Run stock verification and record sales' })
  sell(@ReqCtx() ctx: RequestContext, @Body() body: BookSaleDto) {
    return this.sales.sell(ctx, body);
  }

  @Get('sales')
  @ApiOperation({ summary: 'The books sold between two days, with what is paid' })
  @RequirePermission(STOCK)
  salesReport(@ReqCtx() ctx: RequestContext, @Query() q: SalesQueryDto) {
    return this.sales.report(ctx, q);
  }

  @Get('sales/export')
  @ApiOperation({ summary: 'The books sold as filtered, as Excel or PDF' })
  @RequirePermission(STOCK)
  salesExport(@ReqCtx() ctx: RequestContext, @Query() q: SalesExportDto) {
    return this.sales.export(ctx, q);
  }

  @Get('sales/book')
  @ApiOperation({ summary: 'A book as the sale desk sees it: can it be sold, its price as bought' })
  @RequirePermission(STOCK)
  saleBook(@ReqCtx() ctx: RequestContext, @Query('accessionNo') accessionNo: string) {
    return this.sales.book(ctx, accessionNo);
  }

  @Get('sales/template')
  @ApiOperation({ summary: 'The sales upload layout (base64 .xlsx)' })
  @RequirePermission(STOCK)
  salesTemplate() {
    return this.sales.template();
  }

  @Get('sales/orders/:id')
  @RequirePermission(STOCK)
  saleOrder(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.sales.order(ctx, id);
  }

  @Get('sales/orders/:id/receipt')
  @ApiOperation({ summary: 'The misc receipt of a sale to someone outside, as it prints' })
  @RequirePermission(STOCK)
  saleReceipt(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.sales.receipt(ctx, id);
  }

  @Post('sales/uploads')
  @ApiOperation({
    summary: 'A file of sales (.xlsx or .csv as the body) checked; nothing sold yet',
  })
  @RequirePermission(STOCK)
  salesUpload(
    @ReqCtx() ctx: RequestContext,
    @Query('fileName') fileName: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    return this.sales.upload(ctx, (fileName ?? 'sales.xlsx').slice(0, 200), req.body);
  }

  @Get('sales/uploads/:id')
  @RequirePermission(STOCK)
  salesUploadOne(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.sales.getUpload(ctx, id);
  }

  @Post('sales/uploads/:id/apply')
  @ApiOperation({
    summary: 'A checked file of sales applied: its good rows sold, one sale a buyer',
  })
  @RequirePermission(STOCK)
  salesUploadApply(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.sales.applyUpload(ctx, id);
  }

  @Post('sales/uploads/:id/discard')
  @RequirePermission(STOCK)
  salesUploadDiscard(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.sales.discardUpload(ctx, id);
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

  // ---- stock verification in cycles (library reports, part 3) -----------------------------------------
  @Get('stock/cycles')
  @ApiOperation({
    summary: 'The stock cycles, open first, with what is verified, pending and missing',
  })
  @RequirePermission(STOCK)
  async stockCycles(@ReqCtx() ctx: RequestContext) {
    return { data: await this.stock.cycles(ctx) };
  }

  @Post('stock/cycles')
  @ApiOperation({ summary: 'A stock cycle over the libraries, shelves and material types chosen' })
  @RequirePermission(STOCK)
  stockCycle(@ReqCtx() ctx: RequestContext, @Body() body: StockCycleDto) {
    return this.stock.create(ctx, body);
  }

  @Get('stock/template')
  @ApiOperation({ summary: 'The stock check upload layout (base64 .xlsx)' })
  @RequirePermission(STOCK)
  stockTemplate() {
    return this.stock.template();
  }

  @Get('stock/cycles/:id')
  @RequirePermission(STOCK)
  stockCycleOne(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.stock.get(ctx, id);
  }

  @Get('stock/cycles/:id/items')
  @ApiOperation({
    summary:
      'A cycle’s copies by state (verified, pending, on loan, missing), or the numbers outside it',
  })
  @RequirePermission(STOCK)
  stockItems(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: StockItemsQueryDto,
  ) {
    return this.stock.items(ctx, id, q);
  }

  @Get('stock/cycles/:id/items/export')
  @ApiOperation({ summary: 'A cycle’s list as Excel or PDF' })
  @RequirePermission(STOCK)
  stockItemsExport(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: StockItemsExportDto,
  ) {
    return this.stock.itemsExport(ctx, id, q);
  }

  @Post('stock/cycles/:id/verify')
  @ApiOperation({
    summary: 'Book numbers scanned or typed: verified, or kept as outside the cycle',
  })
  @RequirePermission(STOCK)
  stockVerify(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: StockVerifyDto,
  ) {
    return this.stock.verify(ctx, id, body.accessionNos, body.remark);
  }

  @Post('stock/cycles/:id/items/:copyId/verify')
  @ApiOperation({ summary: 'One copy verified by hand' })
  @RequirePermission(STOCK)
  stockMark(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('copyId') copyId: string,
    @Body() body: { remark?: string },
  ) {
    const remark = typeof body?.remark === 'string' ? body.remark.trim().slice(0, 200) : undefined;
    return this.stock.mark(ctx, id, copyId, true, remark || undefined);
  }

  @Post('stock/cycles/:id/items/:copyId/unverify')
  @ApiOperation({ summary: 'A copy verified by mistake taken back to pending' })
  @RequirePermission(STOCK)
  stockUnmark(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('copyId') copyId: string,
  ) {
    return this.stock.mark(ctx, id, copyId, false);
  }

  @Post('stock/cycles/:id/uploads')
  @ApiOperation({
    summary: 'A file of book numbers (.xlsx, .csv or .txt as the body) checked against the cycle',
  })
  @RequirePermission(STOCK)
  stockUpload(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('fileName') fileName: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    return this.stock.upload(ctx, id, (fileName ?? 'stock.xlsx').slice(0, 200), req.body);
  }

  @Get('stock/uploads/:id')
  @RequirePermission(STOCK)
  stockUploadOne(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.stock.getUpload(ctx, id);
  }

  @Post('stock/uploads/:id/apply')
  @ApiOperation({ summary: 'A checked file applied: its copies verified' })
  @RequirePermission(STOCK)
  stockUploadApply(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.stock.applyUpload(ctx, id);
  }

  @Post('stock/uploads/:id/discard')
  @RequirePermission(STOCK)
  stockUploadDiscard(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.stock.discardUpload(ctx, id);
  }

  @Post('stock/cycles/:id/close')
  @ApiOperation({ summary: 'A cycle closed: copies not found are missing (marked lost if asked)' })
  @RequirePermission(STOCK)
  stockClose(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: StockCloseDto) {
    return this.stock.close(ctx, id, body);
  }

  @Post('stock/cycles/:id/cancel')
  @ApiOperation({ summary: 'An open cycle made by mistake cancelled, with the reason' })
  @RequirePermission(STOCK)
  stockCancel(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: StockCancelDto,
  ) {
    return this.stock.cancel(ctx, id, body);
  }
}
