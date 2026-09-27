import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { Public } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  ATTENDANCE,
  BusQueryDto,
  SetRuleDto,
  CreateDeviceDto,
  DayQueryDto,
  PunchIngestDto,
  LockDto,
  MarkSessionDto,
  MineQueryDto,
  RfidEventsQueryDto,
  RfidIngestDto,
  SessionQueryDto,
  StudentRangeQueryDto,
  SummaryQueryDto,
} from './attendance.dto';
import { AttendanceService } from './attendance.service';
import { BusService } from './bus.service';
import { PunchService } from './punch.service';
import { RfidService } from './rfid.service';
import { RulesService } from './rules.service';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('session')
  @ApiOperation({ summary: 'Roster of a section for a date with any marks recorded (scoped)' })
  @RequirePermission(ATTENDANCE.view, {
    description: 'View attendance sessions, marks and dashboards',
  })
  session(@ReqCtx() ctx: RequestContext, @Query() q: SessionQueryDto) {
    return this.attendance.session(ctx, q);
  }

  @Post('sessions')
  @ApiOperation({ summary: 'Mark a session (day or subject); absent alerts go to guardians' })
  @RequirePermission(ATTENDANCE.mark, {
    description: 'Mark or edit attendance (scope: class_section)',
  })
  mark(@ReqCtx() ctx: RequestContext, @Body() body: MarkSessionDto) {
    return this.attendance.mark(ctx, body);
  }

  @Put('sessions/:id/lock')
  @RequirePermission(ATTENDANCE.lock, { description: 'Lock or unlock attendance sessions' })
  lock(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: LockDto) {
    return this.attendance.lock(ctx, id, body);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Per-section counts for a day (dashboard)' })
  @RequirePermission(ATTENDANCE.view)
  summary(@ReqCtx() ctx: RequestContext, @Query() q: SummaryQueryDto) {
    return this.attendance.summary(ctx, q);
  }

  @Get('students/:id')
  @RequirePermission(ATTENDANCE.view)
  student(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: StudentRangeQueryDto,
  ) {
    return this.attendance.student(ctx, id, q);
  }

  @Get('mine')
  @ApiOperation({ summary: 'A family’s children for a month (parent app)' })
  @RequirePermission(ATTENDANCE.view)
  mine(@ReqCtx() ctx: RequestContext, @Query() q: MineQueryDto) {
    return this.attendance.mine(ctx, q);
  }
}

@ApiTags('attendance')
@Controller('attendance/rfid')
export class RfidController {
  constructor(private readonly rfid: RfidService) {}

  @Post('events')
  @Public()
  @ApiOperation({ summary: 'Device ingestion: taps with tag, time and direction (X-Device-Key)' })
  ingest(@Body() body: RfidIngestDto, @Headers('x-device-key') key?: string) {
    return this.rfid.ingest(body, key);
  }

  @Get('devices')
  @ApiBearerAuth()
  @RequirePermission(ATTENDANCE.rfid, {
    description: 'Register RFID devices and view the event log',
  })
  async devices(@ReqCtx() ctx: RequestContext) {
    return { data: await this.rfid.devices(ctx) };
  }

  @Post('devices')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register a device; the key is shown once' })
  @RequirePermission(ATTENDANCE.rfid)
  createDevice(@ReqCtx() ctx: RequestContext, @Body() body: CreateDeviceDto) {
    return this.rfid.createDevice(ctx, body);
  }

  @Get('dashboard')
  @ApiOperation({
    summary: 'Reader health, in/out counts, tagged students not yet in, bus counts for a date',
  })
  @RequirePermission(ATTENDANCE.rfid)
  dashboard(@ReqCtx() ctx: RequestContext, @Query() q: DayQueryDto) {
    return this.rfid.dashboard(ctx, q);
  }

  @Get('log')
  @ApiBearerAuth()
  @RequirePermission(ATTENDANCE.rfid)
  async log(@ReqCtx() ctx: RequestContext, @Query() q: RfidEventsQueryDto) {
    return { data: await this.rfid.events(ctx, q) };
  }
}

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance/bus')
export class BusController {
  constructor(private readonly bus: BusService) {}

  @Get('mine')
  @ApiOperation({ summary: 'Bus boarding and alighting of my children over the last week' })
  @RequirePermission(ATTENDANCE.busView)
  mine(@ReqCtx() ctx: RequestContext, @Query() q: BusQueryDto) {
    return this.bus.mine(ctx, q);
  }

  @Get()
  @ApiOperation({ summary: 'Bus taps of a date, by route' })
  @RequirePermission(ATTENDANCE.busView)
  list(@ReqCtx() ctx: RequestContext, @Query() q: BusQueryDto) {
    return this.bus.list(ctx, q);
  }
}

@ApiTags('attendance')
@Controller('attendance/punch')
export class PunchController {
  constructor(private readonly punch: PunchService) {}

  @Post('events')
  @Public()
  @ApiOperation({ summary: 'Biometric device punches (device key in x-device-key)' })
  ingest(@Body() dto: PunchIngestDto, @Headers('x-device-key') key?: string) {
    return this.punch.ingest(dto, key);
  }

  @Get('summary')
  @ApiBearerAuth()
  @RequirePermission(ATTENDANCE.punchView)
  summary(@ReqCtx() ctx: RequestContext, @Query() q: DayQueryDto) {
    return this.punch.summary(ctx, q);
  }

  @Get('log')
  @ApiBearerAuth()
  @RequirePermission(ATTENDANCE.punchView)
  log(@ReqCtx() ctx: RequestContext, @Query() q: DayQueryDto) {
    return this.punch.log(ctx, q);
  }
}

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance/rules')
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Get()
  @ApiOperation({
    summary: 'Per-student attendance rules of the working year (late time, muted alerts)',
  })
  @RequirePermission(ATTENDANCE.ruleManage)
  list(@ReqCtx() ctx: RequestContext) {
    return this.rules.list(ctx);
  }

  @Get(':studentId')
  @RequirePermission(ATTENDANCE.ruleManage)
  get(@ReqCtx() ctx: RequestContext, @Param('studentId') studentId: string) {
    return this.rules.get(ctx, studentId);
  }

  @Put(':studentId')
  @RequirePermission(ATTENDANCE.ruleManage)
  set(
    @ReqCtx() ctx: RequestContext,
    @Param('studentId') studentId: string,
    @Body() dto: SetRuleDto,
  ) {
    return this.rules.set(ctx, studentId, dto);
  }

  @Delete(':studentId')
  @RequirePermission(ATTENDANCE.ruleManage)
  clear(@ReqCtx() ctx: RequestContext, @Param('studentId') studentId: string) {
    return this.rules.clear(ctx, studentId);
  }
}
