import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  APPOINTMENTS as P,
  AppointmentSettingsDto,
  ApproveDto,
  CalendarQueryDto,
  CancelDto,
  CheckInDto,
  DaysQueryDto,
  DeskBookDto,
  ExportAppointmentsDto,
  FamilyBookDto,
  GateFindDto,
  HostDto,
  ListAppointmentsDto,
  MineQueryDto,
  RejectDto,
  RescheduleDto,
  SlotsQueryDto,
} from './appointments.dto';
import { AppointmentsService } from './appointments.service';

/**
 * Appointments v2 (0059): the front-desk queue (approve, reject, reschedule, book for walk-ins), the gate
 * (check in and out from the pass), the calendar, the dashboard, the Excel, the set-up, and the parent
 * app's own bookings. Outside visitors use the public controller.
 */
@ApiTags('appointments')
@ApiBearerAuth()
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly svc: AppointmentsService) {}

  // ---- parents ----------------------------------------------------------------------------------------
  @Get('mine')
  @RequirePermission(P.family)
  @ApiOperation({ summary: "My children's appointments, latest first" })
  mine(@ReqCtx() ctx: RequestContext, @Query() q: MineQueryDto) {
    return this.svc.familyList(ctx, q);
  }

  @Get('mine/hosts')
  @RequirePermission(P.family)
  @ApiOperation({ summary: 'Whom a parent can meet, with visiting hours' })
  mineHosts(@ReqCtx() ctx: RequestContext) {
    return this.svc.familyHosts(ctx);
  }

  @Get('mine/days')
  @RequirePermission(P.family)
  @ApiOperation({ summary: 'The next days a person or desk has free times for a parent' })
  mineDays(@ReqCtx() ctx: RequestContext, @Query() q: DaysQueryDto) {
    return this.svc.familyDays(ctx, q);
  }

  @Get('mine/slots')
  @RequirePermission(P.family)
  @ApiOperation({ summary: 'Free slots of a person or desk on a day' })
  mineSlots(@ReqCtx() ctx: RequestContext, @Query() q: SlotsQueryDto) {
    return this.svc.familySlots(ctx, q);
  }

  @Post('mine')
  @RequirePermission(P.family)
  @ApiOperation({ summary: 'A parent asks for a slot' })
  mineBook(@ReqCtx() ctx: RequestContext, @Body() dto: FamilyBookDto) {
    return this.svc.familyBook(ctx, dto);
  }

  @Get('mine/:id')
  @RequirePermission(P.family)
  @ApiOperation({ summary: "One of my children's appointments with its history" })
  mineGet(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.familyGet(ctx, id);
  }

  @Get('mine/:id/card')
  @RequirePermission(P.family)
  @ApiOperation({ summary: 'The same card for the parent app (the bytes as base64)' })
  async mineCardData(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    const { bytes, filename } = await this.svc.familyCardPdf(ctx, id);
    return { filename, base64: bytes.toString('base64') };
  }

  @Get('mine/:id/card.pdf')
  @RequirePermission(P.family)
  @ApiOperation({ summary: 'The gate pass card of my confirmed appointment as a PDF' })
  async mineCard(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const { bytes, filename } = await this.svc.familyCardPdf(ctx, id);
    void reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(bytes);
  }

  @Post('mine/:id/cancel')
  @HttpCode(200)
  @RequirePermission(P.family)
  mineCancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CancelDto) {
    return this.svc.familyCancel(ctx, id, dto);
  }

  // ---- the person to be met ----------------------------------------------------------------------------
  @Get('with-me')
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Appointments with me today and in the next 30 days (no visitor contact details)',
  })
  withMe(@ReqCtx() ctx: RequestContext) {
    return this.svc.withMe(ctx);
  }

  // ---- set-up (admin) ---------------------------------------------------------------------------------
  @Get('setup')
  @RequirePermission(P.setup, {
    description:
      'Appointment set-up: who can be met, visiting hours, slots, visitor details, messages',
  })
  setup(@ReqCtx() ctx: RequestContext) {
    return this.svc.setup(ctx);
  }

  @Put('setup/settings')
  @RequirePermission(P.setup)
  saveSettings(@ReqCtx() ctx: RequestContext, @Body() dto: AppointmentSettingsDto) {
    return this.svc.saveSettings(ctx, dto);
  }

  @Post('setup/hosts')
  @RequirePermission(P.setup)
  createHost(@ReqCtx() ctx: RequestContext, @Body() dto: HostDto) {
    return this.svc.saveHost(ctx, null, dto);
  }

  @Put('setup/hosts/:id')
  @RequirePermission(P.setup)
  updateHost(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: HostDto) {
    return this.svc.saveHost(ctx, id, dto);
  }

  // ---- front desk -------------------------------------------------------------------------------------
  @Get()
  @RequirePermission(P.view)
  @ApiOperation({ summary: 'The appointment queue with filters, pages and tab counts' })
  list(@ReqCtx() ctx: RequestContext, @Query() q: ListAppointmentsDto) {
    return this.svc.list(ctx, q);
  }

  @Get('report.xlsx')
  @RequirePermission(P.view)
  async report(
    @ReqCtx() ctx: RequestContext,
    @Query() q: ExportAppointmentsDto,
    @Res() reply: FastifyReply,
  ) {
    const { bytes, filename } = await this.svc.report(ctx, q);
    void reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(bytes);
  }

  @Get('hosts')
  @RequirePermission(P.view)
  hosts(@ReqCtx() ctx: RequestContext) {
    return this.svc.deskHosts(ctx);
  }

  @Get('slots')
  @RequirePermission(P.view)
  slots(
    @ReqCtx() ctx: RequestContext,
    @Query() q: SlotsQueryDto,
    @Query('except') except?: string,
  ) {
    return this.svc.deskSlots(ctx, q, except && /^\d{1,18}$/.test(except) ? except : undefined);
  }

  @Get('students')
  @RequirePermission(P.decide)
  @ApiOperation({ summary: 'Pupils by name or admission number, to book about one of them' })
  students(@ReqCtx() ctx: RequestContext, @Query('q') q?: string) {
    return this.svc.students(ctx, (q ?? '').slice(0, 80));
  }

  @Get('calendar')
  @RequirePermission(P.view)
  @ApiOperation({ summary: 'Appointments between two dates for the calendar' })
  calendar(@ReqCtx() ctx: RequestContext, @Query() q: CalendarQueryDto) {
    return this.svc.calendar(ctx, q);
  }

  @Get('dashboard')
  @RequirePermission(P.view)
  dashboard(@ReqCtx() ctx: RequestContext) {
    return this.svc.dashboard(ctx);
  }

  @Post()
  @RequirePermission(P.decide)
  @ApiOperation({ summary: 'The front desk books for a walk-in, a caller or a parent' })
  book(@ReqCtx() ctx: RequestContext, @Body() dto: DeskBookDto) {
    return this.svc.deskBook(ctx, dto);
  }

  @Post('gate/find')
  @HttpCode(200)
  @RequirePermission(P.checkin, {
    description: 'Check appointment visitors in and out at the gate',
  })
  @ApiOperation({ summary: 'Find an appointment from a scanned pass, its number or a mobile' })
  gateFind(@ReqCtx() ctx: RequestContext, @Body() dto: GateFindDto) {
    return this.svc.gateFind(ctx, dto.code);
  }

  @Get('gate/board')
  @RequirePermission(P.checkin)
  @ApiOperation({ summary: 'The gate screen: appointments just found, inside now, expected today' })
  gateBoard(@ReqCtx() ctx: RequestContext, @Query('found') found?: string) {
    const ids = (found ?? '').split(',').filter((x) => /^\d{1,18}$/.test(x));
    return this.svc.gateBoard(ctx, ids.slice(0, 10));
  }

  @Get(':id/card')
  @RequirePermission(P.checkin)
  @ApiOperation({ summary: 'The visitor card to print at the gate, with barcode and QR' })
  card(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.card(ctx, id);
  }

  @Get(':id/card.pdf')
  @RequirePermission(P.checkin)
  @ApiOperation({ summary: 'The visitor card as a PDF (ID-card size)' })
  async cardPdf(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const { bytes, filename } = await this.svc.cardPdfFor(ctx, id);
    void reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(bytes);
  }

  @Get(':id/gate-photo')
  @RequirePermission(P.checkin)
  @ApiOperation({ summary: "The visitor's photo, for the gate" })
  async gatePhoto(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const { bytes, contentType } = await this.svc.photo(ctx, id);
    void reply
      .header('content-type', contentType)
      .header('cache-control', 'private, max-age=300')
      .send(bytes);
  }

  @Get(':id')
  @RequirePermission(P.view)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }

  @Get(':id/photo')
  @RequirePermission(P.view)
  async photo(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Res() reply: FastifyReply) {
    const { bytes, contentType } = await this.svc.photo(ctx, id);
    void reply
      .header('content-type', contentType)
      .header('cache-control', 'private, max-age=300')
      .send(bytes);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission(P.decide)
  approve(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ApproveDto) {
    return this.svc.approve(ctx, id, dto);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission(P.decide)
  reject(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.svc.reject(ctx, id, dto);
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  @RequirePermission(P.decide)
  reschedule(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: RescheduleDto) {
    return this.svc.reschedule(ctx, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission(P.decide)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CancelDto) {
    return this.svc.cancel(ctx, id, dto);
  }

  @Post(':id/check-in')
  @HttpCode(200)
  @RequirePermission(P.checkin)
  checkIn(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CheckInDto) {
    return this.svc.checkIn(ctx, id, dto);
  }

  @Post(':id/check-out')
  @HttpCode(200)
  @RequirePermission(P.checkin)
  checkOut(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.checkOut(ctx, id);
  }

  @Post(':id/no-show')
  @HttpCode(200)
  @RequirePermission(P.checkin)
  noShow(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.noShow(ctx, id);
  }
}
