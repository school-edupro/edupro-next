import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
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
import { LIBRARY } from './library.dto';

/** The book master (docs/design/36-library.md, part 2): titles and their copies. */
@ApiTags('library')
@ApiBearerAuth()
@Controller('library')
export class LibraryBooksController {
  constructor(private readonly books: LibraryBooksService) {}

  @Get('books')
  @ApiOperation({ summary: 'The book master: titles with their copies on the shelf and out' })
  @RequirePermission(LIBRARY.view)
  list(@ReqCtx() ctx: RequestContext, @Query() q: BookListDto) {
    return this.books.list(ctx, q);
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
