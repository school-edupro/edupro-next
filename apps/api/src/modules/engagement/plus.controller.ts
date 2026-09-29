import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  AppointmentDecideDto,
  AppointmentRequestDto,
  CctvRequestDto,
  ClinicVisitDto,
  ConsentFormDto,
  ConsentFormStatusDto,
  ConsentResponseDto,
  DecideDto,
  EmployeeQueryDto,
  ENGAGEMENT_PLUS as P,
  GatePassDecideDto,
  GatePassDto,
  IssueCertificatesDto,
  ListQueryDto,
  VisitorInDto,
} from './plus.dto';
import { EngagementPlusService } from './plus.service';

/** Sprint 19: appointments, visitors, gate passes, consent forms, certificates, clinic, CCTV, employee queries. */
@ApiTags('engagement')
@ApiBearerAuth()
@Controller('engagement')
export class EngagementPlusController {
  constructor(private readonly svc: EngagementPlusService) {}

  // ---- appointments ----
  @Get('appointments')
  @RequirePermission(P.appointmentView, { description: 'View appointment requests' })
  appointments(@ReqCtx() ctx: RequestContext, @Query() q: ListQueryDto) {
    return this.svc.appointments(ctx, q);
  }

  @Post('appointments/:id/decide')
  @RequirePermission(P.appointmentDecide, { description: 'Confirm or decline appointments' })
  decideAppointment(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: AppointmentDecideDto,
  ) {
    return this.svc.decideAppointment(ctx, id, body);
  }

  @Get('mine/appointments')
  @RequirePermission(P.familyView)
  myAppointments(@ReqCtx() ctx: RequestContext) {
    return this.svc.myAppointments(ctx);
  }

  @Post('mine/appointments')
  @ApiOperation({ summary: 'A family asks to meet a teacher, the coordinator or the principal' })
  @RequirePermission(P.familyView)
  requestAppointment(@ReqCtx() ctx: RequestContext, @Body() body: AppointmentRequestDto) {
    return this.svc.requestAppointment(ctx, body);
  }

  // ---- visitors ----
  @Get('visitors')
  @RequirePermission(P.visitorManage, { description: 'Log visitors in and out' })
  async visitors(@ReqCtx() ctx: RequestContext, @Query('onDate') onDate?: string) {
    return {
      data: await this.svc.visitors(
        ctx,
        onDate && /^\d{4}-\d{2}-\d{2}$/.test(onDate) ? onDate : null,
      ),
    };
  }

  @Post('visitors')
  @RequirePermission(P.visitorManage)
  visitorIn(@ReqCtx() ctx: RequestContext, @Body() body: VisitorInDto) {
    return this.svc.visitorIn(ctx, body);
  }

  @Post('visitors/:id/out')
  @RequirePermission(P.visitorManage)
  visitorOut(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.visitorOut(ctx, id);
  }

  // ---- gate passes ----
  @Get('gate-passes')
  @RequirePermission(P.gatePassView, { description: 'View gate passes' })
  gatePasses(@ReqCtx() ctx: RequestContext, @Query() q: ListQueryDto) {
    return this.svc.gatePasses(ctx, q);
  }

  @Post('gate-passes')
  @ApiOperation({ summary: 'The office raises a pass (a family raises its own under mine/)' })
  @RequirePermission(P.gatePassIssue, { description: 'Issue gate passes' })
  officeGatePass(@ReqCtx() ctx: RequestContext, @Body() body: GatePassDto) {
    return this.svc.requestGatePass(ctx, body, false);
  }

  @Post('gate-passes/:id/decide')
  @RequirePermission(P.gatePassIssue)
  decideGatePass(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: GatePassDecideDto,
  ) {
    return this.svc.decideGatePass(ctx, id, body);
  }

  @Get('mine/gate-passes')
  @RequirePermission(P.familyView)
  myGatePasses(@ReqCtx() ctx: RequestContext) {
    return this.svc.myGatePasses(ctx);
  }

  @Post('mine/gate-passes')
  @RequirePermission(P.familyView)
  familyGatePass(@ReqCtx() ctx: RequestContext, @Body() body: GatePassDto) {
    return this.svc.requestGatePass(ctx, body, true);
  }

  // ---- consent forms ----
  @Get('consent-forms')
  @RequirePermission(P.consentFormManage, { description: 'Build consent forms and read responses' })
  async forms(@ReqCtx() ctx: RequestContext) {
    return { data: await this.svc.forms(ctx) };
  }

  @Post('consent-forms')
  @RequirePermission(P.consentFormManage)
  createForm(@ReqCtx() ctx: RequestContext, @Body() body: ConsentFormDto) {
    return this.svc.saveForm(ctx, body);
  }

  @Put('consent-forms/:id')
  @RequirePermission(P.consentFormManage)
  updateForm(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ConsentFormDto) {
    return this.svc.saveForm(ctx, body, id);
  }

  @Put('consent-forms/:id/status')
  @RequirePermission(P.consentFormManage)
  formStatus(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: ConsentFormStatusDto,
  ) {
    return this.svc.setFormStatus(ctx, id, body);
  }

  @Get('consent-forms/:id/responses')
  @RequirePermission(P.consentFormManage)
  async responses(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.svc.formResponses(ctx, id) };
  }

  @Get('mine/consent-forms')
  @RequirePermission(P.familyView)
  myForms(@ReqCtx() ctx: RequestContext) {
    return this.svc.myForms(ctx);
  }

  @Post('mine/consent-forms/:id/responses')
  @ApiOperation({
    summary: 'A family signs a form; a fee creates a payment intent for the pay flow',
  })
  @RequirePermission(P.familyView)
  respond(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: ConsentResponseDto,
  ) {
    return this.svc.respond(ctx, id, body);
  }

  // ---- certificates ----
  @Get('certificates')
  @RequirePermission(P.certificateIssue, { description: 'Generate certificates' })
  async certificates(@ReqCtx() ctx: RequestContext) {
    return { data: await this.svc.certificates(ctx, null) };
  }

  @Post('certificates')
  @ApiOperation({
    summary: 'Issue certificates to a section or chosen pupils; one PDF for the batch',
  })
  @RequirePermission(P.certificateIssue)
  issue(@ReqCtx() ctx: RequestContext, @Body() body: IssueCertificatesDto) {
    return this.svc.issueCertificates(ctx, body);
  }

  @Get('mine/certificates')
  @RequirePermission(P.familyView)
  myCertificates(@ReqCtx() ctx: RequestContext) {
    return this.svc.myCertificates(ctx);
  }

  @Post('mine/certificates/:id/pdf')
  @RequirePermission(P.familyView)
  myCertificatePdf(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.myCertificatePdf(ctx, id);
  }

  // ---- clinic ----
  @Get('clinic')
  @RequirePermission(P.clinicManage, { description: 'Record clinic visits' })
  async clinic(@ReqCtx() ctx: RequestContext, @Query('onDate') onDate?: string) {
    return {
      data: await this.svc.clinicVisits(
        ctx,
        onDate && /^\d{4}-\d{2}-\d{2}$/.test(onDate) ? onDate : null,
      ),
    };
  }

  @Post('clinic')
  @RequirePermission(P.clinicManage)
  clinicVisit(@ReqCtx() ctx: RequestContext, @Body() body: ClinicVisitDto) {
    return this.svc.clinicVisit(ctx, body);
  }

  @Post('clinic/:id/out')
  @RequirePermission(P.clinicManage)
  clinicOut(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.clinicOut(ctx, id);
  }

  @Get('mine/health')
  @RequirePermission(P.familyView)
  myHealth(@ReqCtx() ctx: RequestContext) {
    return this.svc.myHealth(ctx);
  }

  // ---- CCTV and employee queries ----
  @Get('cctv')
  @RequirePermission(P.cctvDecide, { description: 'Decide CCTV requests' })
  cctv(@ReqCtx() ctx: RequestContext, @Query() q: ListQueryDto) {
    return this.svc.cctvRequests(ctx, q);
  }

  @Post('cctv')
  @RequirePermission(P.cctvRequest, { description: 'Request CCTV footage' })
  requestCctv(@ReqCtx() ctx: RequestContext, @Body() body: CctvRequestDto) {
    return this.svc.requestCctv(ctx, body);
  }

  @Post('cctv/:id/decide')
  @RequirePermission(P.cctvDecide)
  decideCctv(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: DecideDto) {
    return this.svc.decideCctv(ctx, id, body);
  }

  @Get('employee-queries')
  @RequirePermission(P.employeeQueryAnswer, { description: 'Answer employee queries' })
  employeeQueries(@ReqCtx() ctx: RequestContext, @Query() q: ListQueryDto) {
    return this.svc.employeeQueries(ctx, q, false);
  }

  @Get('employee-queries/mine')
  @RequirePermission(P.employeeQueryCreate, { description: 'Raise an employee query' })
  myEmployeeQueries(@ReqCtx() ctx: RequestContext, @Query() q: ListQueryDto) {
    return this.svc.employeeQueries(ctx, q, true);
  }

  @Post('employee-queries')
  @RequirePermission(P.employeeQueryCreate)
  raiseEmployeeQuery(@ReqCtx() ctx: RequestContext, @Body() body: EmployeeQueryDto) {
    return this.svc.raiseEmployeeQuery(ctx, body);
  }

  @Post('employee-queries/:id/answer')
  @RequirePermission(P.employeeQueryAnswer)
  answerEmployeeQuery(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: DecideDto,
  ) {
    return this.svc.answerEmployeeQuery(ctx, id, body);
  }
}
