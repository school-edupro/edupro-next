import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { EntryStatusActionDto, EntryStatusNoteDto, EntryStatusQueryDto, EXAMS } from './exams.dto';
import { ExamStatusService } from './exam-status.service';

/**
 * Submit, verify, publish (docs/design/65, part 2): the marks of a subject in a section go open →
 * submitted → verified; who verifies is checked by the service (the class teacher, a coordinator of
 * the section, or the verify right).
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
export class ExamStatusController {
  constructor(private readonly svc: ExamStatusService) {}

  @Get('entry-status/waiting')
  @ApiOperation({ summary: 'Submitted marks the caller verifies, across the year' })
  @RequirePermission(EXAMS.marksView)
  waiting(@ReqCtx() ctx: RequestContext) {
    return this.svc.waiting(ctx);
  }

  @Get(':id/entry-status')
  @ApiOperation({ summary: 'Each section × subject of an exam: takers, entered, status' })
  @RequirePermission(EXAMS.marksView)
  overview(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: EntryStatusQueryDto,
  ) {
    return this.svc.overview(ctx, id, q.classId);
  }

  @Post(':id/entry-status/submit')
  @ApiOperation({ summary: 'Submit a section’s marks of a subject for verification' })
  @RequirePermission(EXAMS.marksEnter)
  submit(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: EntryStatusActionDto,
  ) {
    return this.svc.submit(ctx, id, dto);
  }

  @Post(':id/entry-status/verify')
  @ApiOperation({
    summary: 'Verify submitted marks (locks them; the results are worked out again)',
  })
  @RequirePermission(EXAMS.marksView)
  verify(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: EntryStatusActionDto,
  ) {
    return this.svc.verify(ctx, id, dto);
  }

  @Post(':id/entry-status/send-back')
  @ApiOperation({ summary: 'Send submitted marks back to the teacher with a remark' })
  @RequirePermission(EXAMS.marksView)
  sendBack(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: EntryStatusNoteDto,
  ) {
    return this.svc.sendBack(ctx, id, dto);
  }

  @Post(':id/entry-status/reopen')
  @ApiOperation({ summary: 'Reopen submitted or verified marks, with a reason' })
  @RequirePermission(EXAMS.marksUnlock)
  reopen(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: EntryStatusNoteDto) {
    return this.svc.reopen(ctx, id, dto);
  }
}
