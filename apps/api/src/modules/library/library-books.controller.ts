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
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  BookExportDto,
  BookLayoutDto,
  BookListDto,
  BookMatchDto,
  CopiesDto,
  CopyEditDto,
  CopyStatusChangeDto,
  NewBookDto,
  SuggestDto,
  TitleDto,
} from './library-books.dto';
import { LibraryBooksService } from './library-books.service';
import { LibraryExportService } from './library-export.service';
import { LibraryImportService } from './library-import.service';
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
  ) {}

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
