import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PEOPLE } from './people.permissions';
import { CorrectionWithdrawDto } from './student-corrections.dto';
import { StudentMergeDto } from './student-merges.dto';
import { StudentMergesService } from './student-merges.service';

/** Merge duplicates (docs/design/37, part 3): the same child admitted twice. */
@ApiTags('people')
@ApiBearerAuth()
@Controller('people')
export class StudentMergesController {
  constructor(private readonly svc: StudentMergesService) {}

  @Get('student-merges/setup')
  @ApiOperation({ summary: 'Who decides a merge of duplicate records, level by level' })
  @RequirePermission(PEOPLE.studentView)
  setup(@ReqCtx() ctx: RequestContext) {
    return this.svc.setup(ctx);
  }

  @Post('student-merges/preview')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'What merging the duplicate into the kept record would move and settle, or why not now',
  })
  @RequirePermission(PEOPLE.studentMerge)
  preview(@ReqCtx() ctx: RequestContext, @Body() body: StudentMergeDto) {
    return this.svc.preview(ctx, body);
  }

  @Post('student-merges')
  @ApiOperation({
    summary: 'Ask to merge a duplicate record; done when the approval levels approve',
  })
  @RequirePermission(PEOPLE.studentMerge)
  request(@ReqCtx() ctx: RequestContext, @Body() body: StudentMergeDto) {
    return this.svc.request(ctx, body);
  }

  @Post('student-merges/:id/withdraw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Take back a merge still waiting (the requester)' })
  @RequirePermission(PEOPLE.studentMerge)
  withdraw(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: CorrectionWithdrawDto,
  ) {
    return this.svc.withdraw(ctx, id, body.reason);
  }

  @Get('students/:id/merges')
  @ApiOperation({
    summary: 'The merges a record took part in, and the record it was merged into',
  })
  @RequirePermission(PEOPLE.studentView)
  list(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.list(ctx, id);
  }
}
