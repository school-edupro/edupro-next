import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ExamDateSheetsService } from './exam-date-sheets.service';
import { EXAMS } from './exams.dto';
import { REPORT_CARDS } from './report-cards.dto';

/** Date sheets in the teacher and parent apps (docs/design/66). */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
export class ExamDateSheetsController {
  constructor(private readonly sheets: ExamDateSheetsService) {}

  @Get('date-sheets')
  @ApiOperation({ summary: 'Date sheets of the classes I may read marks of (the working year)' })
  @RequirePermission(EXAMS.marksView)
  staff(@ReqCtx() ctx: RequestContext) {
    return this.sheets.staff(ctx);
  }

  @Get('mine/date-sheets')
  @ApiOperation({ summary: "My children's date sheets: their papers of the exams on the portal" })
  @RequirePermission(REPORT_CARDS.familyView)
  family(@ReqCtx() ctx: RequestContext) {
    return this.sheets.family(ctx);
  }
}
