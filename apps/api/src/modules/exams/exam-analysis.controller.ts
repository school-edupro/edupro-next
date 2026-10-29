import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ExamAnalysisService } from './exam-analysis.service';
import { DivisionsQueryDto, EXAMS, ExamReportQueryDto } from './exams.dto';

/** docs/design/65 part 6: an exam's analyses and the merit list by division, as screen, Excel, PDF. */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
export class ExamAnalysisController {
  constructor(private readonly analysis: ExamAnalysisService) {}

  @Get('schemes/:id/divisions')
  @ApiOperation({
    summary: "A locked result scheme's merit list by division and count per section",
  })
  @RequirePermission(EXAMS.marksView)
  divisions(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: DivisionsQueryDto) {
    return this.analysis.divisions(ctx, id, q);
  }

  @Get(':id/reports/:kind')
  @ApiOperation({
    summary:
      'An exam analysis: subjects (section-wise), ranges, toppers, teachers, status (upload), missing',
  })
  @RequirePermission(EXAMS.marksView)
  report(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Query() q: ExamReportQueryDto,
  ) {
    return this.analysis.report(ctx, id, kind, q);
  }
}
