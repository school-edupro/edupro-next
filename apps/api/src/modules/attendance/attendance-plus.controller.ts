import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { AttendanceBulkService } from './attendance-bulk.service';
import { AttendanceDeskService } from './attendance-desk.service';
import {
  AttendanceSetupDto,
  BulkCommitDto,
  BulkVerifyDto,
  BusRegisterFileDto,
  BusRegisterQueryDto,
  BusRollMarkDto,
  BusRollQueryDto,
  ClassRegisterFileDto,
  ClassRegisterQueryDto,
  DayQueryDto,
  LeaveApplyDto,
  LeaveDecideDto,
  LeaveListDto,
  LeaveSetupDto,
  MonthQueryDto,
  ReopenDto,
  RouteTeacherRemoveDto,
  RouteTeachersDto,
  RouteTeachersImportDto,
} from './attendance-plus.dto';
import { ATTENDANCE } from './attendance.dto';
import { BusRollService } from './bus-roll.service';
import { LeaveService } from './leave.service';

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

  @Get('absent-templates')
  @ApiOperation({ summary: 'The absence message of each channel (WhatsApp, SMS, e-mail)' })
  @RequirePermission(ATTENDANCE.view)
  absentTemplates(@ReqCtx() ctx: RequestContext) {
    return this.desk.absentTemplates(ctx);
  }

  @Get('mine/today')
  @ApiOperation({
    summary: 'A family’s home card: the month so far, today in class and on the bus',
  })
  @RequirePermission(ATTENDANCE.view)
  familyToday(@ReqCtx() ctx: RequestContext) {
    return this.desk.familyToday(ctx);
  }

  @Get('mine/year')
  @ApiOperation({ summary: 'A family’s children month by month over the session' })
  @RequirePermission(ATTENDANCE.view)
  familyYear(@ReqCtx() ctx: RequestContext) {
    return this.desk.familyYear(ctx);
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

  @Post('route-teachers')
  @HttpCode(200)
  @ApiOperation({
    summary: 'A teacher for bus attendance on some routes: morning, afternoon or both',
  })
  @RequirePermission(ATTENDANCE.setup)
  addRouteTeachers(@ReqCtx() ctx: RequestContext, @Body() dto: RouteTeachersDto) {
    return this.desk.addRouteTeachers(ctx, dto);
  }

  @Post('route-teachers/remove')
  @HttpCode(200)
  @RequirePermission(ATTENDANCE.setup)
  async removeRouteTeacher(@ReqCtx() ctx: RequestContext, @Body() dto: RouteTeacherRemoveDto) {
    await this.desk.removeRouteTeacher(ctx, dto);
    return { ok: true };
  }

  @Get('route-teachers/template.xlsx')
  @RequirePermission(ATTENDANCE.setup)
  async routeTeacherTemplate(@ReqCtx() ctx: RequestContext, @Res() reply: FastifyReply) {
    send(reply, await this.desk.routeTeacherTemplate(ctx));
  }

  @Post('route-teachers/import')
  @HttpCode(200)
  @RequirePermission(ATTENDANCE.setup)
  importRouteTeachers(@ReqCtx() ctx: RequestContext, @Body() dto: RouteTeachersImportDto) {
    return this.desk.importRouteTeachers(ctx, dto.fileBase64);
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

/**
 * Student leave (0088): the family applies and follows it; the approvers decide level by level; the
 * school sets the long-leave limit and the levels. The service checks what the person holds.
 */
@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance/leaves')
export class LeaveController {
  constructor(private readonly leaves: LeaveService) {}

  @Get('mine')
  @ApiOperation({ summary: 'My children’s leave of the session, with what the form needs' })
  @AuthenticatedOnly()
  mine(@ReqCtx() ctx: RequestContext) {
    return this.leaves.mine(ctx);
  }

  @Post('mine')
  @ApiOperation({ summary: 'Apply for leave for my child' })
  @AuthenticatedOnly()
  apply(@ReqCtx() ctx: RequestContext, @Body() dto: LeaveApplyDto) {
    return this.leaves.apply(ctx, dto);
  }

  @Get('mine/:id')
  @AuthenticatedOnly()
  myLeave(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.leaves.myLeave(ctx, id);
  }

  @Post('mine/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw a leave that waits, or end an approved one from today' })
  @AuthenticatedOnly()
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.leaves.cancel(ctx, id);
  }

  @Get('mine/:id/files/:fileId')
  @AuthenticatedOnly()
  myFile(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.leaves.fileUrl(ctx, id, fileId, true);
  }

  @Get('setup')
  @AuthenticatedOnly()
  setup(@ReqCtx() ctx: RequestContext) {
    return this.leaves.setup(ctx);
  }

  @Put('setup')
  @AuthenticatedOnly()
  saveSetup(@ReqCtx() ctx: RequestContext, @Body() dto: LeaveSetupDto) {
    return this.leaves.saveSetup(ctx, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Student leave that came to me (or all of it, for the coordinator’s office)',
  })
  @AuthenticatedOnly()
  list(@ReqCtx() ctx: RequestContext, @Query() q: LeaveListDto) {
    return this.leaves.list(ctx, q);
  }

  @Get(':id')
  @AuthenticatedOnly()
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.leaves.get(ctx, id);
  }

  @Post(':id/decide')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve or reject a leave at my level' })
  @AuthenticatedOnly()
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: LeaveDecideDto) {
    return this.leaves.decide(ctx, id, dto);
  }

  @Get(':id/files/:fileId')
  @AuthenticatedOnly()
  file(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.leaves.fileUrl(ctx, id, fileId, false);
  }
}

const BULK = 'attendance.bulk.upload';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance/bulk')
export class AttendanceBulkController {
  constructor(private readonly bulk: AttendanceBulkService) {}

  @Get()
  @ApiOperation({ summary: 'The log of attendance uploads of the working year' })
  @RequirePermission(BULK, {
    description: 'Mark attendance from an Excel list of admission numbers',
  })
  async list(@ReqCtx() ctx: RequestContext) {
    return { data: await this.bulk.list(ctx) };
  }

  @Get('template.xlsx')
  @ApiOperation({ summary: 'The Excel format: one column of admission numbers' })
  @RequirePermission(BULK)
  async template(@Res() reply: FastifyReply) {
    const f = await this.bulk.template();
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${f.filename}"`)
      .send(f.bytes);
  }

  @Post('verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Read the file and check every admission number; nothing is marked yet',
  })
  @RequirePermission(BULK)
  verify(@ReqCtx() ctx: RequestContext, @Body() body: BulkVerifyDto) {
    return this.bulk.verify(ctx, body);
  }

  @Get(':id')
  @RequirePermission(BULK)
  detail(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.bulk.detail(ctx, id);
  }

  @Post(':id/commit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark the checked list and tell the parents of the absent, as ticked' })
  @RequirePermission(BULK)
  commit(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: BulkCommitDto) {
    return this.bulk.commit(ctx, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission(BULK)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.bulk.cancel(ctx, id);
  }
}
