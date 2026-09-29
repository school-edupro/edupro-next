import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { BOARD_RESULTS, BoardListQueryDto, BoardUploadDto } from './board-results.dto';
import { BoardResultsService } from './board-results.service';

/** Sprint 18: board result import (CBSE files) with subject-wise analysis. */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams/board-results')
export class BoardResultsController {
  constructor(private readonly boards: BoardResultsService) {}

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

  @Post('imports/:id/commit')
  @RequirePermission(BOARD_RESULTS.import)
  commit(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.boards.commit(ctx, id);
  }
}
