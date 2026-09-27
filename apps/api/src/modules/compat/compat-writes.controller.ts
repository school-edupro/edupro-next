import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { NoticeActionDto, UploadAttendanceDto, UploadDailyworkDto } from './compat.dto';
import { CompatWritesService } from './compat-writes.service';

/** Teacher app write endpoints (S11): legacy paths and envelopes, new rules underneath. */
@ApiTags('compat')
@ApiBearerAuth()
@Controller('compat/v1/teacher')
export class CompatWritesController {
  constructor(private readonly writes: CompatWritesService) {}

  @Post('UploadDailywork')
  @ApiOperation({ summary: 'Homework or classwork for a class (legacy UploadDailywork.php)' })
  @RequirePermission('compat.teacher.write')
  dailywork(@ReqCtx() ctx: RequestContext, @Body() dto: UploadDailyworkDto) {
    return this.writes.uploadDailywork(ctx, dto);
  }

  @Post('UploadAttendance')
  @ApiOperation({ summary: 'Day or subject attendance for a class (legacy UploadAttendance.php)' })
  @RequirePermission('compat.teacher.write')
  attendance(@ReqCtx() ctx: RequestContext, @Body() dto: UploadAttendanceDto) {
    return this.writes.uploadAttendance(ctx, dto);
  }

  @Post('notice_actions')
  @ApiOperation({
    summary: 'Publish a notice to a class or everyone (legacy notice_actions.php action=add)',
  })
  @RequirePermission('compat.teacher.write')
  notice(@ReqCtx() ctx: RequestContext, @Body() dto: NoticeActionDto) {
    return this.writes.noticeAction(ctx, dto);
  }
}
