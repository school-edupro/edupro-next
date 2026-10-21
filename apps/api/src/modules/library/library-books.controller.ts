import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  AccessionApplyDto,
  AccessionChangeDto,
  BookExportDto,
  BookLayoutDto,
  BookListDto,
  CancelSubscriptionDto,
  DueIssuesDto,
  LabelsDto,
  MissingIssueDto,
  ReceiveIssueDto,
  ReceiveManyDto,
  SpecialIssueDto,
  SubscriptionDto,
  SubscriptionListDto,
  BookMatchDto,
  CopiesDto,
  CopyEditDto,
  CopyStatusChangeDto,
  NewBookDto,
  RegisterExportDto,
  RegisterGridDto,
  SuggestDto,
  TitleDto,
} from './library-books.dto';
import { LibraryBooksService } from './library-books.service';
import { LibraryExportService } from './library-export.service';
import { LibraryImportService } from './library-import.service';
import { LibraryLabelsService } from './library-labels.service';
import { LibraryPeriodicalsService } from './library-periodicals.service';
import { LibraryRegisterService } from './library-register.service';
import { LibraryAccessionService } from './library-accession.service';
import { LIBRARY } from './library.dto';

/** The book master (docs/design/36-library.md, part 2): titles and their copies. */
@ApiTags('library')
@ApiBearerAuth()
@Controller('library')
export class LibraryBooksController {
  constructor(
    private readonly books: LibraryBooksService,
    private readonly exporter: LibraryExportService,
    private readonly importer: LibraryImportService,
    private readonly labeller: LibraryLabelsService,
    private readonly periodicals: LibraryPeriodicalsService,
    private readonly lists: LibraryRegisterService,
    private readonly accessions: LibraryAccessionService,
  ) {}

  // ---- part 6: periodical subscriptions --------------------------------------------------------------

  @Get('subscriptions/setup')
  @ApiOperation({ summary: 'The periodicals, libraries and vendors a subscription picks from' })
  @RequirePermission(LIBRARY.view)
  subscriptionSetup(@ReqCtx() ctx: RequestContext) {
    return this.periodicals.setup(ctx);
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'Periodical subscriptions with their issues so far, and the figures' })
  @RequirePermission(LIBRARY.view)
  subscriptions(@ReqCtx() ctx: RequestContext, @Query() q: SubscriptionListDto) {
    return this.periodicals.list(ctx, q);
  }

  @Get('subscriptions/claims')
  @ApiOperation({ summary: 'Late and missing issues by vendor, to claim (base64 .xlsx)' })
  @RequirePermission(LIBRARY.view)
  claims(@ReqCtx() ctx: RequestContext, @Query('vendorId') vendorId: string | undefined) {
    return this.periodicals.claims(ctx, vendorId);
  }

  @Get('subscriptions/:id')
  @ApiOperation({ summary: 'A subscription and its issues' })
  @RequirePermission(LIBRARY.view)
  subscription(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.periodicals.view(ctx, id);
  }

  @Post('subscriptions')
  @ApiOperation({ summary: 'A subscription, its issues expected from the frequency' })
  @RequirePermission(LIBRARY.manage)
  subscribe(@ReqCtx() ctx: RequestContext, @Body() body: SubscriptionDto) {
    return this.periodicals.create(ctx, body);
  }

  @Put('subscriptions/:id')
  @ApiOperation({ summary: 'A subscription changed (the expected issues follow)' })
  @RequirePermission(LIBRARY.manage)
  updateSubscription(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: SubscriptionDto,
  ) {
    return this.periodicals.update(ctx, id, body);
  }

  @Post('subscriptions/:id/renew')
  @ApiOperation({
    summary: 'The next period of a subscription, as long, from the day after it ends',
  })
  @RequirePermission(LIBRARY.manage)
  renew(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.periodicals.renew(ctx, id);
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'A subscription cancelled from a day' })
  @RequirePermission(LIBRARY.manage)
  cancelSubscription(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: CancelSubscriptionDto,
  ) {
    return this.periodicals.cancel(ctx, id, body);
  }

  @Post('subscriptions/:id/issues')
  @ApiOperation({ summary: 'A special issue of a subscription' })
  @RequirePermission(LIBRARY.manage)
  specialIssue(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: SpecialIssueDto,
  ) {
    return this.periodicals.special(ctx, id, body);
  }

  @Get('issues/due')
  @ApiOperation({
    summary: 'Issues to receive: expected by today (or a few days ahead), late first',
  })
  @RequirePermission(LIBRARY.view)
  dueIssues(@ReqCtx() ctx: RequestContext, @Query() q: DueIssuesDto) {
    return this.periodicals.due(ctx, q);
  }

  @Post('issues/receive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Many issues received on one day' })
  @RequirePermission(LIBRARY.manage)
  receiveMany(@ReqCtx() ctx: RequestContext, @Body() body: ReceiveManyDto) {
    return this.periodicals.receiveMany(ctx, body);
  }

  @Post('issues/:id/receive')
  @HttpCode(200)
  @ApiOperation({ summary: 'An issue received' })
  @RequirePermission(LIBRARY.manage)
  receive(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReceiveIssueDto) {
    return this.periodicals.receive(ctx, id, body);
  }

  @Post('issues/:id/missing')
  @HttpCode(200)
  @ApiOperation({ summary: 'An issue marked missing (to claim)' })
  @RequirePermission(LIBRARY.manage)
  missing(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: MissingIssueDto) {
    return this.periodicals.missing(ctx, id, body);
  }

  @Post('issues/:id/undo')
  @HttpCode(200)
  @ApiOperation({ summary: 'A receipt or a missing mark undone' })
  @RequirePermission(LIBRARY.manage)
  undoIssue(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.periodicals.undo(ctx, id);
  }

  // ---- part 5: barcode and spine labels -------------------------------------------------------------

  @Get('labels/setup')
  @ApiOperation({ summary: 'Label sheets, libraries and my last label settings' })
  @RequirePermission(LIBRARY.manage)
  labelSetup(@ReqCtx() ctx: RequestContext) {
    return this.labeller.setup(ctx);
  }

  @Post('labels')
  @HttpCode(200)
  @ApiOperation({ summary: 'Barcode and spine labels as a PDF (base64), or their count (dry)' })
  @RequirePermission(LIBRARY.manage)
  labels(@ReqCtx() ctx: RequestContext, @Body() body: LabelsDto) {
    return this.labeller.print(ctx, body);
  }

  // ---- part 4: books from Excel ---------------------------------------------------------------------

  @Get('imports')
  @ApiOperation({ summary: 'The book uploads of the school, latest first' })
  @RequirePermission(LIBRARY.manage)
  imports(@ReqCtx() ctx: RequestContext) {
    return this.importer.list(ctx);
  }

  @Get('imports/template')
  @ApiOperation({ summary: 'The book upload template (base64 .xlsx)' })
  @RequirePermission(LIBRARY.manage)
  template(@ReqCtx() ctx: RequestContext) {
    return this.importer.template(ctx);
  }

  @Post('imports')
  @ApiOperation({
    summary:
      'Check an .xlsx or .csv of books (the file as the body; ours or the legacy layout); nothing saved yet',
  })
  @RequirePermission(LIBRARY.manage)
  check(
    @ReqCtx() ctx: RequestContext,
    @Query('fileName') fileName: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    return this.importer.check(
      ctx,
      (fileName ?? 'books.xlsx').slice(0, 200),
      req.body,
      String(req.headers['content-type'] ?? ''),
    );
  }

  @Get('imports/:id')
  @ApiOperation({
    summary: 'A checked upload: what each row does, the masters it adds, its progress',
  })
  @RequirePermission(LIBRARY.manage)
  importView(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('kind') kind: string | undefined,
    @Query('page') page: string | undefined,
  ) {
    return this.importer.view(ctx, id, kind, Math.max(1, Number(page) || 1));
  }

  @Post('imports/:id/run')
  @HttpCode(200)
  @ApiOperation({ summary: 'Import the next batch of rows (call again until nothing is pending)' })
  @RequirePermission(LIBRARY.manage)
  run(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.importer.run(ctx, id);
  }

  @Post('imports/:id/discard')
  @HttpCode(200)
  @ApiOperation({ summary: 'Leave a checked upload unimported' })
  @RequirePermission(LIBRARY.manage)
  discard(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.importer.discard(ctx, id);
  }

  @Get('imports/:id/problems')
  @ApiOperation({ summary: 'The rows not imported and why (base64 .xlsx)' })
  @RequirePermission(LIBRARY.manage)
  problems(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.importer.problems(ctx, id);
  }

  @Get('books')
  @ApiOperation({ summary: 'The book master: titles with their copies on the shelf and out' })
  @RequirePermission(LIBRARY.view)
  list(@ReqCtx() ctx: RequestContext, @Query() q: BookListDto) {
    return this.books.list(ctx, q);
  }

  @Get('books/copies')
  @ApiOperation({
    summary: 'The accession register: copies with their title, place, status and borrower',
  })
  @RequirePermission(LIBRARY.view)
  register(@ReqCtx() ctx: RequestContext, @Query() q: BookListDto) {
    return this.books.register(ctx, q);
  }

  @Get('books/export/setup')
  @ApiOperation({ summary: 'The export picker: fields by group, the row levels, layouts, my last' })
  @RequirePermission(LIBRARY.view)
  exportSetup(@ReqCtx() ctx: RequestContext) {
    return this.exporter.setup(ctx);
  }

  // ---- correcting accession numbers (part 2 of the register work) ---------------------------------------
  @Post('accession/preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'What a correction of accession numbers would do: each copy, old and new',
  })
  @RequirePermission(LIBRARY.manage)
  accessionPreview(@ReqCtx() ctx: RequestContext, @Body() body: AccessionChangeDto) {
    return this.accessions.preview(ctx, body);
  }

  @Post('accession/apply')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Correct accession numbers (one copy or a range); the old ones retired',
  })
  @RequirePermission(LIBRARY.manage)
  accessionApply(@ReqCtx() ctx: RequestContext, @Body() body: AccessionApplyDto) {
    return this.accessions.apply(ctx, body);
  }

  @Get('accession/changes')
  @ApiOperation({ summary: 'The latest accession number corrections' })
  @RequirePermission(LIBRARY.view)
  accessionChanges(@ReqCtx() ctx: RequestContext) {
    return this.accessions.changes(ctx);
  }

  // ---- the Books page's lists, as the Employees list ---------------------------------------------------
  @Get('register/:level/fields')
  @ApiOperation({
    summary: 'Every field of the titles or the copies that can be a column or a filter',
  })
  @RequirePermission(LIBRARY.view)
  registerFields(@ReqCtx() ctx: RequestContext, @Param('level') level: string) {
    return this.lists.fields(ctx, levelOf(level));
  }

  @Post('register/:level')
  @HttpCode(200)
  @ApiOperation({
    summary: 'A page of the titles or the copies: columns, filters, search, status, sort',
  })
  @RequirePermission(LIBRARY.view)
  registerGrid(
    @ReqCtx() ctx: RequestContext,
    @Param('level') level: string,
    @Body() body: RegisterGridDto,
  ) {
    return this.lists.grid(ctx, levelOf(level), body);
  }

  @Post('register/:level/export')
  @HttpCode(200)
  @ApiOperation({ summary: 'The list as on screen, as Excel or PDF (base64)' })
  @RequirePermission(LIBRARY.view)
  registerExport(
    @ReqCtx() ctx: RequestContext,
    @Param('level') level: string,
    @Body() body: RegisterExportDto,
  ) {
    return this.lists.export(ctx, levelOf(level), body);
  }

  @Post('books/export')
  @HttpCode(200)
  @ApiOperation({
    summary: 'The book list as Excel (base64): per copy or per title; every field or those picked',
  })
  @RequirePermission(LIBRARY.view)
  exportBooks(@ReqCtx() ctx: RequestContext, @Body() body: BookExportDto) {
    return this.exporter.export(ctx, body);
  }

  @Post('books/export/layouts')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Save a named export layout of the book list (the same name changes it)',
  })
  @RequirePermission(LIBRARY.view)
  saveLayout(@ReqCtx() ctx: RequestContext, @Body() body: BookLayoutDto) {
    return this.exporter.saveLayout(ctx, body);
  }

  @Delete('books/export/layouts/:id')
  @ApiOperation({ summary: 'Remove an export layout (its maker or the library manager)' })
  @RequirePermission(LIBRARY.view)
  deleteLayout(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.exporter.deleteLayout(ctx, id);
  }

  @Get('books/setup')
  @ApiOperation({ summary: 'What the book form picks from, and the next accession numbers' })
  @RequirePermission(LIBRARY.view)
  setup(@ReqCtx() ctx: RequestContext) {
    return this.books.setup(ctx);
  }

  @Get('books/suggest')
  @ApiOperation({ summary: 'Author or publisher names as one types' })
  @RequirePermission(LIBRARY.view)
  suggest(@ReqCtx() ctx: RequestContext, @Query() q: SuggestDto) {
    return this.books.suggest(ctx, q);
  }

  @Get('books/match')
  @ApiOperation({ summary: 'Titles already there with the same ISBN or title' })
  @RequirePermission(LIBRARY.view)
  match(@ReqCtx() ctx: RequestContext, @Query() q: BookMatchDto) {
    return this.books.match(ctx, q);
  }

  @Get('books/:id')
  @ApiOperation({ summary: 'A title: details, people, copies, loans and history' })
  @RequirePermission(LIBRARY.view)
  view(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.books.view(ctx, id);
  }

  @Post('books')
  @ApiOperation({ summary: 'A new title with its first copies' })
  @RequirePermission(LIBRARY.manage)
  create(@ReqCtx() ctx: RequestContext, @Body() body: NewBookDto) {
    return this.books.create(ctx, body);
  }

  @Put('books/:id')
  @ApiOperation({ summary: 'A title changed (every copy shows it)' })
  @RequirePermission(LIBRARY.manage)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: TitleDto) {
    return this.books.update(ctx, id, body);
  }

  @Post('books/:id/copies')
  @ApiOperation({ summary: 'More copies of a title, numbered from the series or typed' })
  @RequirePermission(LIBRARY.manage)
  copies(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: CopiesDto) {
    return this.books.copies(ctx, id, body);
  }

  @Put('copies/:id')
  @ApiOperation({ summary: 'A copy’s library, shelf, rack, barcode and source' })
  @RequirePermission(LIBRARY.manage)
  editCopy(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: CopyEditDto) {
    return this.books.editCopy(ctx, id, body);
  }

  @Post('copies/:id/status')
  @HttpCode(200)
  @ApiOperation({
    summary: 'A copy withdrawn, lost, lost and paid, found again, damaged or back in use',
  })
  @RequirePermission(LIBRARY.manage)
  changeStatus(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: CopyStatusChangeDto,
  ) {
    return this.books.changeStatus(ctx, id, body);
  }
}

/** The list a path names: the copies (the accession register) or the titles. */
function levelOf(level: string): 'copy' | 'title' {
  if (level === 'copies') return 'copy';
  if (level === 'titles') return 'title';
  throw new DomainError('not-found', 'No such list', { status: 404 });
}
