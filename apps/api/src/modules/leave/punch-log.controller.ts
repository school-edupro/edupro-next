import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  AssignPunchIdDto,
  DayVersionsDto,
  LEAVE_OFFICE,
  PUNCH_LOG,
  PunchLogDto,
  UnmatchedDto,
} from './leave.dto';
import { PunchLogService } from './punch-log.service';

/** The staff punch log (docs/design/85): the old Employee / Attendance Details. */
@ApiTags('leave')
@ApiBearerAuth()
@Controller('staff-punches')
export class PunchLogController {
  constructor(private readonly punches: PunchLogService) {}

  @Get('overview')
  @ApiOperation({ summary: 'The biometric machines and the other punch sources at a glance' })
  @RequirePermission(PUNCH_LOG, {
    description:
      'See the staff punch log: raw punches, the versions of each day, unmatched punches',
  })
  overview(@ReqCtx() ctx: RequestContext) {
    return this.punches.overview(ctx);
  }

  @Get('log')
  @ApiOperation({
    summary: 'Raw punches of a department (31 days) or an employee (92 days); Excel / PDF',
  })
  @RequirePermission(PUNCH_LOG)
  log(@ReqCtx() ctx: RequestContext, @Query() q: PunchLogDto) {
    return this.punches.log(ctx, q);
  }

  @Get('versions')
  @ApiOperation({
    summary: 'Every version of an employee’s days, Active and InActive; Excel / PDF',
  })
  @RequirePermission(PUNCH_LOG)
  versions(@ReqCtx() ctx: RequestContext, @Query() q: DayVersionsDto) {
    return this.punches.versions(ctx, q);
  }

  @Get('unmatched')
  @ApiOperation({ summary: 'Punches of an unknown ID and the double taps, in a period' })
  @RequirePermission(PUNCH_LOG)
  unmatched(@ReqCtx() ctx: RequestContext, @Query() q: UnmatchedDto) {
    return this.punches.unmatched(ctx, q);
  }

  @Post('unmatched/assign')
  @ApiOperation({
    summary: 'Give an unknown ID to an employee: match its punches, work out the days',
  })
  @RequirePermission(LEAVE_OFFICE)
  assign(@ReqCtx() ctx: RequestContext, @Body() body: AssignPunchIdDto) {
    return this.punches.assign(ctx, body);
  }
}
