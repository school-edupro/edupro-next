import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { BoardGazetteService } from './board-gazette.service';
import {
  BOARD_RESULTS,
  BoardListQueryDto,
  BoardUploadDto,
  GazetteUploadDto,
  LayoutActiveDto,
} from './board-results.dto';
import { BoardResultsService } from './board-results.service';

const ID = /^[0-9]{1,18}$/;
const id = (v: string) => {
  if (!ID.test(v)) throw new DomainError('not-found', 'Not found', { status: 404 });
  return v;
};

/**
 * Board results: Sprint 18's import of a CSV / Excel file, and CBSE's result gazette (.TXT) read with a layout —
 * built in, kept, or learned by Claude from masked lines (docs/design/88).
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams/board-results')
export class BoardResultsController {
  constructor(
    private readonly boards: BoardResultsService,
    private readonly gazettes: BoardGazetteService,
  ) {}

  @Get()
  @RequirePermission(BOARD_RESULTS.view, {
    description: 'View imported board results and their analysis',
  })
  list(@ReqCtx() ctx: RequestContext, @Query() q: BoardListQueryDto) {
    return this.boards.list(ctx, q);
  }

  @Get('imports')
  @RequirePermission(BOARD_RESULTS.view)
  async imports(@ReqCtx() ctx: RequestContext) {
    return { data: await this.boards.imports(ctx) };
  }

  @Post('imports/validate')
  @ApiOperation({
    summary: 'Dry run: parse a CBSE result file (csv or xlsx), match pupils, keep the report',
  })
  @RequirePermission(BOARD_RESULTS.import, { description: 'Import board result files' })
  validate(@ReqCtx() ctx: RequestContext, @Body() body: BoardUploadDto) {
    return this.boards.validate(ctx, body);
  }

  @Post('gazette')
  @ApiOperation({
    summary:
      "Upload CBSE's result gazette (.TXT): read with a known layout or one Claude learns from masked lines; a preview, nothing saved",
  })
  @RequirePermission(BOARD_RESULTS.import)
  gazette(@ReqCtx() ctx: RequestContext, @Body() body: GazetteUploadDto) {
    return this.gazettes.upload(ctx, body);
  }

  @Get('imports/:id')
  @ApiOperation({
    summary: 'One upload: figures, problems, candidates, the layout, what it replaces',
  })
  @RequirePermission(BOARD_RESULTS.view)
  detail(@ReqCtx() ctx: RequestContext, @Param('id') importId: string) {
    return this.gazettes.detail(ctx, id(importId));
  }

  @Get('imports/:id/file')
  @ApiOperation({ summary: 'The uploaded result file as sent' })
  @RequirePermission(BOARD_RESULTS.view)
  file(@ReqCtx() ctx: RequestContext, @Param('id') importId: string) {
    return this.gazettes.file(ctx, id(importId));
  }

  @Post('imports/:id/relearn')
  @ApiOperation({
    summary: 'Ask Claude again for the layout (told which checks failed) and read the file anew',
  })
  @RequirePermission(BOARD_RESULTS.import)
  relearn(@ReqCtx() ctx: RequestContext, @Param('id') importId: string) {
    return this.gazettes.relearn(ctx, id(importId));
  }

  @Post('imports/:id/commit')
  @RequirePermission(BOARD_RESULTS.import)
  async commit(@ReqCtx() ctx: RequestContext, @Param('id') importId: string) {
    const kind = await this.boards.kindOf(ctx, id(importId));
    if (kind === 'gazette') return this.gazettes.commit(ctx, importId);
    return this.boards.commit(ctx, importId);
  }

  @Get('years')
  @ApiOperation({
    summary: 'Academic years with the year of their board examination (the upload form)',
  })
  @RequirePermission(BOARD_RESULTS.view)
  async years(@ReqCtx() ctx: RequestContext) {
    return { data: await this.gazettes.academicYears(ctx) };
  }

  @Get('layouts')
  @ApiOperation({
    summary: 'The layouts the school reads gazettes with: built in, and learned and kept',
  })
  @RequirePermission(BOARD_RESULTS.view)
  async layouts(@ReqCtx() ctx: RequestContext) {
    return { data: await this.gazettes.layouts(ctx) };
  }

  @Post('layouts/:id/active')
  @ApiOperation({
    summary: 'Switch a learned layout off (the next such file is learned again) or back on',
  })
  @RequirePermission(BOARD_RESULTS.import)
  setActive(
    @ReqCtx() ctx: RequestContext,
    @Param('id') layoutId: string,
    @Body() body: LayoutActiveDto,
  ) {
    return this.gazettes.setLayoutActive(ctx, id(layoutId), body.active);
  }
}
