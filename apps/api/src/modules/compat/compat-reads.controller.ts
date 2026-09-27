import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { CompatReadsService } from './compat-reads.service';

/** Read endpoints of the current apps (S5-07), legacy paths and envelopes, behind the compat session. */
@ApiTags('compat')
@Controller('compat/v1')
export class CompatReadsController {
  constructor(private readonly reads: CompatReadsService) {}

  @Get('student/GetDirectory')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Staff directory (live from employees)' })
  directory(@ReqCtx() ctx: RequestContext) {
    return this.reads.directory(ctx);
  }

  @Get('student/GetHolidays')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Holiday list (school setting compat.holidays)' })
  holidays(@ReqCtx() ctx: RequestContext) {
    return this.reads.holidays(ctx);
  }

  @Get('student/GetNotice')
  @AuthenticatedOnly()
  notices(@ReqCtx() ctx: RequestContext) {
    return this.reads.notices(ctx);
  }

  @Get('student/GetHomework')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Homework (legacy shape; live data arrives with the academics module)' })
  homework() {
    return this.reads.homework();
  }

  @Get('student/GetClasswork')
  @AuthenticatedOnly()
  classwork() {
    return this.reads.classwork();
  }

  @Get('student/GetTimetable')
  @AuthenticatedOnly()
  timetable() {
    return this.reads.timetable();
  }

  @Get('student/GetAttendance')
  @AuthenticatedOnly()
  attendance(@ReqCtx() ctx: RequestContext) {
    return this.reads.attendance(ctx);
  }
}
