import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { MyFileDto, TeamLeaveDto } from './leave.dto';
import { LeaveSelfService } from './leave-self.service';

/** My leave as one page: the reporties' leave, and my leave and attendance to download. */
@ApiTags('leave')
@ApiBearerAuth()
@Controller('leave/self')
export class LeaveSelfController {
  constructor(private readonly svc: LeaveSelfService) {}

  @Get('team')
  @ApiOperation({ summary: 'The leave of the staff reporting to me in a month; Excel or PDF' })
  @AuthenticatedOnly()
  team(@ReqCtx() ctx: RequestContext, @Query() q: TeamLeaveDto) {
    return this.svc.team(ctx, q);
  }

  @Get('leave-file')
  @ApiOperation({ summary: 'All my leave as Excel or PDF' })
  @AuthenticatedOnly()
  leaveFile(@ReqCtx() ctx: RequestContext, @Query() q: MyFileDto) {
    return this.svc.myLeaveFile(ctx, q);
  }

  @Get('attendance-file')
  @ApiOperation({ summary: "My month's attendance, every day, as Excel or PDF" })
  @AuthenticatedOnly()
  attendanceFile(@ReqCtx() ctx: RequestContext, @Query() q: MyFileDto) {
    return this.svc.myAttendanceFile(ctx, q);
  }
}
