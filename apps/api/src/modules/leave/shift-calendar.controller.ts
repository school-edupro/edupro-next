import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  ShiftAssignDto,
  ShiftCalendarDto,
  ShiftClearDayDto,
  ShiftCopyDto,
  ShiftLogDto,
} from './leave.dto';
import { ShiftCalendarService } from './shift-calendar.service';

/** The shift calendar: a month of who works which shift; posting, copying, the change log. */
@ApiTags('leave')
@ApiBearerAuth()
@Controller('staff-attendance/shift-calendar')
export class ShiftCalendarController {
  constructor(private readonly svc: ShiftCalendarService) {}

  @Get()
  @ApiOperation({
    summary: 'A month of who works which shift, a page of employees at a time; Excel or PDF',
  })
  @RequirePermission('leave.setup.view')
  calendar(@ReqCtx() ctx: RequestContext, @Query() q: ShiftCalendarDto) {
    return this.svc.calendar(ctx, q);
  }

  @Post('assign')
  @ApiOperation({
    summary:
      'Post a shift to employees for days (one day: that day only); dryRun shows the changes',
  })
  @RequirePermission('leave.setup.manage')
  assign(@ReqCtx() ctx: RequestContext, @Body() dto: ShiftAssignDto) {
    return this.svc.assign(ctx, dto);
  }

  @Post('clear-day')
  @ApiOperation({
    summary: "Take a day back to the shift around it (remove that day's own posting)",
  })
  @RequirePermission('leave.setup.manage')
  clearDay(@ReqCtx() ctx: RequestContext, @Body() dto: ShiftClearDayDto) {
    return this.svc.clearDay(ctx, dto);
  }

  @Post('copy')
  @ApiOperation({
    summary: "Copy a month's posted shifts onto another month; dryRun shows what it does",
  })
  @RequirePermission('leave.setup.manage')
  copy(@ReqCtx() ctx: RequestContext, @Body() dto: ShiftCopyDto) {
    return this.svc.copy(ctx, dto);
  }

  @Get('log')
  @ApiOperation({ summary: 'The shift posting change log; Excel or PDF' })
  @RequirePermission('leave.setup.view')
  log(@ReqCtx() ctx: RequestContext, @Query() q: ShiftLogDto) {
    return this.svc.log(ctx, q);
  }
}
