import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ExamEntryService } from './exam-entry.service';
import {
  EntryQueryDto,
  EXAMS,
  PutExamAttendanceDto,
  PutHealthDto,
  PutIndicatorsDto,
  PutMarksDto,
  PutRemarksDto,
  SetExamIndicatorSetDto,
  UpsertIndicatorSetDto,
  UpsertRemarkBankDto,
} from './exams.dto';

/** Sprint 15: mark entry with scopes and locks; indicators, remarks, exam attendance, health records. */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
export class ExamEntryController {
  constructor(private readonly entry: ExamEntryService) {}

  // ---- masters -----------------------------------------------------------------------------------
  @Get('indicator-sets')
  @RequirePermission(EXAMS.masterView)
  async indicatorSets(@ReqCtx() ctx: RequestContext) {
    return { data: await this.entry.indicatorSets(ctx) };
  }

  @Put('indicator-sets')
  @ApiOperation({ summary: 'Create or replace an indicator set (co-scholastic / HPC descriptors)' })
  @RequirePermission(EXAMS.masterManage)
  upsertIndicatorSet(@ReqCtx() ctx: RequestContext, @Body() dto: UpsertIndicatorSetDto) {
    return this.entry.upsertIndicatorSet(ctx, dto);
  }

  @Get('remark-bank')
  @RequirePermission(EXAMS.masterView)
  async remarkBank(@ReqCtx() ctx: RequestContext) {
    return { data: await this.entry.remarkBank(ctx) };
  }

  @Put('remark-bank')
  @RequirePermission(EXAMS.masterManage)
  upsertRemarkBank(@ReqCtx() ctx: RequestContext, @Body() dto: UpsertRemarkBankDto) {
    return this.entry.upsertRemarkBank(ctx, dto);
  }

  @Put(':id/indicator-sets')
  @ApiOperation({ summary: 'Assign the indicator set a class uses in this exam' })
  @RequirePermission(EXAMS.masterManage)
  setExamIndicatorSet(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: SetExamIndicatorSetDto,
  ) {
    return this.entry.setExamIndicatorSet(ctx, id, dto);
  }

  // ---- entry -------------------------------------------------------------------------------------
  @Get(':id/entry/sections')
  @ApiOperation({ summary: 'Sections and subjects of this exam the caller may enter' })
  @RequirePermission(EXAMS.marksView, { description: 'View marks and exam registers' })
  async sections(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.entry.sections(ctx, id) };
  }

  @Get(':id/marks')
  @RequirePermission(EXAMS.marksView)
  marks(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: EntryQueryDto) {
    return this.entry.marks(ctx, id, q);
  }

  @Put(':id/marks')
  @ApiOperation({ summary: 'Enter marks for one section and subject (app.enter_marks)' })
  @RequirePermission(EXAMS.marksEnter, {
    description: 'Enter marks for the sections and subjects assigned',
  })
  putMarks(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: PutMarksDto) {
    return this.entry.putMarks(ctx, id, dto);
  }

  @Get(':id/indicators')
  @RequirePermission(EXAMS.marksView)
  indicators(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: EntryQueryDto) {
    return this.entry.indicators(ctx, id, q);
  }

  @Put(':id/indicators')
  @RequirePermission(EXAMS.indicatorEnter, {
    description: 'Enter co-scholastic and HPC indicators',
  })
  putIndicators(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PutIndicatorsDto,
  ) {
    return this.entry.putIndicators(ctx, id, dto);
  }

  @Get(':id/register')
  @ApiOperation({ summary: 'Class register of the exam: remarks, exam attendance, latest health' })
  @RequirePermission(EXAMS.marksView)
  register(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: EntryQueryDto) {
    return this.entry.register(ctx, id, q);
  }

  @Put(':id/remarks')
  @RequirePermission(EXAMS.remarkEnter, { description: 'Enter exam remarks' })
  putRemarks(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: PutRemarksDto) {
    return this.entry.putRemarks(ctx, id, dto);
  }

  @Put(':id/attendance')
  @RequirePermission(EXAMS.attendanceEnter, { description: 'Enter exam attendance days' })
  putAttendance(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PutExamAttendanceDto,
  ) {
    return this.entry.putAttendance(ctx, id, dto);
  }

  @Put(':id/health')
  @RequirePermission(EXAMS.healthEnter, {
    description: 'Record height, weight and health notes',
  })
  putHealth(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: PutHealthDto) {
    return this.entry.putHealth(ctx, id, dto);
  }
}
