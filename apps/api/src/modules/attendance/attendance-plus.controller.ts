import { Body, Controller, Get, HttpCode, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { AttendanceDeskService } from './attendance-desk.service';
import {
  AttendanceSetupDto,
  BusRegisterFileDto,
  BusRegisterQueryDto,
  BusRollMarkDto,
  BusRollQueryDto,
  ClassRegisterFileDto,
  ClassRegisterQueryDto,
  DayQueryDto,
  MonthQueryDto,
  ReopenDto,
} from './attendance-plus.dto';
import { ATTENDANCE } from './attendance.dto';
import { BusRollService } from './bus-roll.service';

const send = (reply: FastifyReply, f: { bytes: Buffer; filename: string; contentType: string }) =>
  reply
    .header('content-type', f.contentType)
    .header('content-disposition', `attachment; filename="${f.filename}"`)
    .send(f.bytes);

/** Attendance set-up, registers and dashboards (0083). */
@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance/desk')
export class AttendanceDeskController {
  constructor(private readonly desk: AttendanceDeskService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Class and bus attendance of a day, what is not marked, and 14 days' })
  @RequirePermission(ATTENDANCE.view)
  dashboard(@ReqCtx() ctx: RequestContext, @Query() q: DayQueryDto) {
    return this.desk.dashboard(ctx, q.date);
  }

  @Get('mine/today')
  @ApiOperation({
    summary: 'A family’s home card: the month so far, today in class and on the bus',
  })
  @RequirePermission(ATTENDANCE.view)
  familyToday(@ReqCtx() ctx: RequestContext) {
    return this.desk.familyToday(ctx);
  }

  @Get('setup')
  @RequirePermission(ATTENDANCE.setup, {
    description: 'Attendance set-up: marking windows, route teachers, reopening a day',
  })
  setup(@ReqCtx() ctx: RequestContext) {
    return this.desk.setup(ctx);
  }

  @Put('setup')
  @RequirePermission(ATTENDANCE.setup)
  saveSetup(@ReqCtx() ctx: RequestContext, @Body() dto: AttendanceSetupDto) {
    return this.desk.saveSetup(ctx, dto);
  }

  @Post('reopen')
  @HttpCode(200)
  @ApiOperation({ summary: 'Open a closed day again for the teacher of a class or a route' })
  @RequirePermission(ATTENDANCE.setup)
  reopen(@ReqCtx() ctx: RequestContext, @Body() dto: ReopenDto) {
    return this.desk.reopen(ctx, dto);
  }

  @Get('class-register')
  @ApiOperation({ summary: 'The month’s register of a class (scoped to the teacher’s sections)' })
  @RequirePermission(ATTENDANCE.view)
  classRegister(@ReqCtx() ctx: RequestContext, @Query() q: ClassRegisterQueryDto) {
    return this.desk.classRegister(ctx, q.classSectionId, q.month);
  }

  @Get('class-register/file')
  @ApiOperation({
    summary: 'The class register as a file in JSON (for the teacher app’s own download route)',
  })
  @RequirePermission(ATTENDANCE.view)
  async classRegisterJson(@ReqCtx() ctx: RequestContext, @Query() q: ClassRegisterFileDto) {
    const f = await this.desk.classRegisterFile(ctx, q.classSectionId, q.month, q.format);
    return { filename: f.filename, contentType: f.contentType, base64: f.bytes.toString('base64') };
  }

  @Get('class-register.xlsx')
  @RequirePermission(ATTENDANCE.view)
  async classRegisterXlsx(
    @ReqCtx() ctx: RequestContext,
    @Query() q: ClassRegisterQueryDto,
    @Res() reply: FastifyReply,
  ) {
    send(reply, await this.desk.classRegisterFile(ctx, q.classSectionId, q.month, 'xlsx'));
  }

  @Get('class-register.pdf')
  @RequirePermission(ATTENDANCE.view)
  async classRegisterPdf(
    @ReqCtx() ctx: RequestContext,
    @Query() q: ClassRegisterQueryDto,
    @Res() reply: FastifyReply,
  ) {
    send(reply, await this.desk.classRegisterFile(ctx, q.classSectionId, q.month, 'pdf'));
  }
}

/** Bus attendance marked by the route's teacher, morning and afternoon (0083). */
@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance/bus-roll')
export class BusRollController {
  constructor(private readonly roll: BusRollService) {}

  @Get('routes')
  @ApiOperation({ summary: 'The routes and trips I mark' })
  @RequirePermission(ATTENDANCE.busMark, { description: 'Mark bus attendance of a route' })
  routes(@ReqCtx() ctx: RequestContext) {
    return this.roll.myRoutes(ctx);
  }

  @Get()
  @ApiOperation({
    summary: 'The roll of a route and trip for a date, with leave and gate pass hints',
  })
  @AuthenticatedOnly()
  get(@ReqCtx() ctx: RequestContext, @Query() q: BusRollQueryDto) {
    return this.roll.roll(ctx, q);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission(ATTENDANCE.busMark)
  mark(@ReqCtx() ctx: RequestContext, @Body() dto: BusRollMarkDto) {
    return this.roll.mark(ctx, dto);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Every route and trip of a date: riders, on the bus, not marked' })
  @AuthenticatedOnly()
  summary(@ReqCtx() ctx: RequestContext, @Query() q: DayQueryDto) {
    return this.roll.summary(ctx, q.date);
  }

  @Get('mine')
  @ApiOperation({ summary: 'My children’s bus attendance of a month' })
  @RequirePermission(ATTENDANCE.busView)
  mine(@ReqCtx() ctx: RequestContext, @Query() q: MonthQueryDto) {
    return this.roll.mine(ctx, q.month);
  }

  @Get('register')
  @AuthenticatedOnly()
  register(@ReqCtx() ctx: RequestContext, @Query() q: BusRegisterQueryDto) {
    return this.roll.register(ctx, q);
  }

  @Get('register/file')
  @AuthenticatedOnly()
  async registerJson(@ReqCtx() ctx: RequestContext, @Query() q: BusRegisterFileDto) {
    const f = await this.roll.registerFile(ctx, q, q.format);
    return { filename: f.filename, contentType: f.contentType, base64: f.bytes.toString('base64') };
  }

  @Get('register.xlsx')
  @AuthenticatedOnly()
  async registerXlsx(
    @ReqCtx() ctx: RequestContext,
    @Query() q: BusRegisterQueryDto,
    @Res() reply: FastifyReply,
  ) {
    send(reply, await this.roll.registerFile(ctx, q, 'xlsx'));
  }

  @Get('register.pdf')
  @AuthenticatedOnly()
  async registerPdf(
    @ReqCtx() ctx: RequestContext,
    @Query() q: BusRegisterQueryDto,
    @Res() reply: FastifyReply,
  ) {
    send(reply, await this.roll.registerFile(ctx, q, 'pdf'));
  }
}
