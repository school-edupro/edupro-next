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
}
