import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  HOSTEL,
  HOSTEL_H2,
  HostelSettingsDto,
  LeavesQueryDto,
  RollcallQueryDto,
  RollcallRegisterDto,
  RollcallRegisterFileDto,
  RollcallReportDto,
  RollcallSaveDto,
  SessionDto,
} from './hostel.dto';
import { HostelLifeService } from './hostel-life.service';

/** Hostel module H2: rules, roll-call sessions and rolls, and hostel leave seen from the hostel. */
@ApiTags('hostel')
@ApiBearerAuth()
@Controller('hostel')
export class HostelLifeController {
  constructor(private readonly life: HostelLifeService) {}

  @Get('settings')
  @ApiOperation({
    summary:
      "The school's hostel rules: late grace, escalation hours, outing return time, absent alerts",
  })
  @RequirePermission(HOSTEL.view)
  settings(@ReqCtx() ctx: RequestContext) {
    return this.life.settings(ctx);
  }

  @Put('settings')
  @RequirePermission(HOSTEL.setup)
  saveSettings(@ReqCtx() ctx: RequestContext, @Body() dto: HostelSettingsDto) {
    return this.life.saveSettings(ctx, dto);
  }

  @Get('today')
  @ApiOperation({
    summary: 'Hostel desk today: boarders, away, overdue, to hand over, waiting, rolls taken',
  })
  @RequirePermission(HOSTEL.view)
  today(@ReqCtx() ctx: RequestContext) {
    return this.life.today(ctx);
  }

  @Get('sessions')
  @RequirePermission(HOSTEL.view)
  async sessions(@ReqCtx() ctx: RequestContext, @Query('hostelId') hostelId?: string) {
    return {
      data: await this.life.sessions(ctx, /^\d{1,18}$/.test(hostelId ?? '') ? hostelId : undefined),
    };
  }

  @Post('sessions')
  @ApiOperation({ summary: 'A roll-call session of a hostel (name and time)' })
  @RequirePermission(HOSTEL.setup)
  createSession(@ReqCtx() ctx: RequestContext, @Body() dto: SessionDto) {
    return this.life.saveSession(ctx, dto);
  }

  @Put('sessions/:id')
  @RequirePermission(HOSTEL.setup)
  updateSession(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: SessionDto) {
    return this.life.saveSession(ctx, dto, id);
  }

  @Get('rollcall')
  @ApiOperation({
    summary: 'The roll of a session on a day: every pupil holding a bed, away on leave marked so',
  })
  @RequirePermission(HOSTEL_H2.rollcall)
  rollcall(@ReqCtx() ctx: RequestContext, @Query() q: RollcallQueryDto) {
    return this.life.rollcall(ctx, q);
  }

  @Post('rollcall')
  @ApiOperation({
    summary: 'Save the roll; a new absence tells the head warden and (by the rule) the parent',
  })
  @RequirePermission(HOSTEL_H2.rollcall)
  saveRollcall(@ReqCtx() ctx: RequestContext, @Body() dto: RollcallSaveDto) {
    return this.life.saveRollcall(ctx, dto);
  }

  @Get('rollcall/report')
  @ApiOperation({ summary: 'Roll-calls of a period with counts and the absentees' })
  @RequirePermission(HOSTEL.view)
  async rollcallReport(@ReqCtx() ctx: RequestContext, @Query() q: RollcallReportDto) {
    return { data: await this.life.rollcallReport(ctx, q) };
  }

  @Get('rollcall/register')
  @ApiOperation({
    summary:
      'The roll-call register of a hostel for a month: pupils down, each day a column per session, totals',
  })
  @RequirePermission(HOSTEL.view)
  rollcallRegister(@ReqCtx() ctx: RequestContext, @Query() q: RollcallRegisterDto) {
    return this.life.rollcallRegister(ctx, q);
  }

  @Get('rollcall/register/file')
  @ApiOperation({ summary: 'The roll-call register as Excel or PDF' })
  @RequirePermission(HOSTEL.view)
  async rollcallRegisterFile(@ReqCtx() ctx: RequestContext, @Query() q: RollcallRegisterFileDto) {
    const f = await this.life.rollcallRegisterFile(ctx, q, q.format);
    return { filename: f.filename, contentType: f.contentType, base64: f.bytes.toString('base64') };
  }

  @Get('leaves')
  @ApiOperation({
    summary: 'Hostel leave and outings: away now, overdue, to hand over today, waiting, all',
  })
  @RequirePermission(HOSTEL_H2.leave)
  async leaves(@ReqCtx() ctx: RequestContext, @Query() q: LeavesQueryDto) {
    return { data: await this.life.leaves(ctx, q) };
  }
}
