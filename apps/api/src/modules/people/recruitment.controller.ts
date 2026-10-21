import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import {
  RecruitmentApprovalDto,
  RecruitmentStagesDto,
  VacancyApproveDto,
  VacancyDto,
  VacancyListDto,
  VacancyNoteDto,
  VacancyPublishDto,
  VacancySendBackDto,
} from './recruitment.dto';
import { RecruitmentApprovalService } from './recruitment-approval.service';
import {
  CancelCorrectionDto,
  CorrectionSettingsDto,
  MoveStageDto,
  SendBackDto,
  UndoDto,
} from './recruitment-corrections.dto';
import { RecruitmentCorrectionsService } from './recruitment-corrections.service';
import {
  ApplicationBulkDto,
  ApplicationExportDto,
  ApplicationListDto,
  ExportLayoutDto,
  ApplicationNoteDto,
  RecruitmentNoticesDto,
  StageResultDto,
  WalkInDto,
} from './recruitment-screening.dto';
import { RecruitmentScreeningService } from './recruitment-screening.service';
import { RecruitmentExportService } from './recruitment-export.service';
import { JoinDto } from './recruitment-join.dto';
import { RecruitmentJoinService } from './recruitment-join.service';
import { PEOPLE } from './people.permissions';
import { RecruitmentService } from './recruitment.service';

/** Recruitment, part 1 (docs/design/34-recruitment.md): vacancies, their approval and the stages. */
@ApiTags('people')
@ApiBearerAuth()
@Controller('people/recruitment')
export class RecruitmentController {
  constructor(
    private readonly svc: RecruitmentService,
    private readonly screening: RecruitmentScreeningService,
    private readonly joining: RecruitmentJoinService,
    private readonly approval: RecruitmentApprovalService,
    private readonly corrections: RecruitmentCorrectionsService,
    private readonly exporter: RecruitmentExportService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('setup')
  @ApiOperation({
    summary: 'Recruitment set-up: the screening stages and the lists a vacancy picks from',
  })
  @RequirePermission(PEOPLE.recruitmentView)
  setup(@ReqCtx() ctx: RequestContext) {
    return this.svc.setup(ctx);
  }

  @Put('setup/stages')
  @ApiOperation({ summary: 'The school’s screening stages, the whole list at once' })
  @RequirePermission(PEOPLE.recruitmentManage)
  stages(@ReqCtx() ctx: RequestContext, @Body() body: RecruitmentStagesDto) {
    return this.svc.saveStages(ctx, body);
  }

  @Get('vacancies')
  @ApiOperation({ summary: 'Vacancies, newest first, with the count per status' })
  @RequirePermission(PEOPLE.recruitmentView)
  list(@ReqCtx() ctx: RequestContext, @Query() q: VacancyListDto) {
    return this.svc.list(ctx, q);
  }

  @Post('vacancies')
  @ApiOperation({ summary: 'Raise a vacancy (a draft until it is sent for approval)' })
  @RequirePermission(PEOPLE.recruitmentRaise)
  create(@ReqCtx() ctx: RequestContext, @Body() body: VacancyDto) {
    return this.svc.create(ctx, body);
  }

  @Get('vacancies/:id')
  @ApiOperation({ summary: 'One vacancy with its steps and what the signed-in person may do' })
  // the recruitment rights, or a part in the vacancy's approval (checked in the service)
  @AuthenticatedOnly()
  view(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.view(ctx, id, this.env.PUBLIC_APP_URL);
  }

  @Put('vacancies/:id')
  @ApiOperation({ summary: 'Change a draft vacancy or one sent back' })
  @RequirePermission(PEOPLE.recruitmentRaise)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: VacancyDto) {
    return this.svc.update(ctx, id, body);
  }

  @Post('vacancies/:id/submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send the vacancy for approval through the school’s levels' })
  @RequirePermission(PEOPLE.recruitmentRaise)
  submit(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.submit(ctx, id);
  }

  @Post('vacancies/:id/publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish an approved vacancy on the careers page for a period' })
  @RequirePermission(PEOPLE.recruitmentManage)
  publish(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: VacancyPublishDto) {
    return this.svc.publish(ctx, id, body);
  }

  @Post('vacancies/:id/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close a published vacancy (no new applications)' })
  @RequirePermission(PEOPLE.recruitmentManage)
  close(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: VacancyNoteDto) {
    return this.svc.close(ctx, id, body);
  }

  @Post('vacancies/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a vacancy (an approval under way is withdrawn)' })
  @RequirePermission(PEOPLE.recruitmentManage)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: VacancyNoteDto) {
    return this.svc.cancel(ctx, id, body);
  }

  // ---- part 5: who approves, the approver's decision, sharing ----

  @Get('setup/approval')
  @ApiOperation({
    summary: 'Who approves a vacancy, level by level, and what the set-up picks from',
  })
  @RequirePermission(PEOPLE.recruitmentView)
  approvalSetup(@ReqCtx() ctx: RequestContext) {
    return this.approval.setup(ctx);
  }

  @Put('setup/approval')
  @ApiOperation({
    summary: 'Set who approves a vacancy; the vacancies waiting move to the new people',
  })
  @RequirePermission(PEOPLE.recruitmentManage)
  saveApproval(@ReqCtx() ctx: RequestContext, @Body() body: RecruitmentApprovalDto) {
    return this.approval.save(ctx, body);
  }

  @Get('setup/careers')
  @ApiOperation({
    summary: 'The school’s careers page: the link, its QR and how many posts are open',
  })
  @RequirePermission(PEOPLE.recruitmentView)
  careers(@ReqCtx() ctx: RequestContext) {
    return this.svc.careers(ctx, this.env.PUBLIC_APP_URL);
  }

  @Get('to-approve')
  @ApiOperation({ summary: 'Vacancies waiting at my approval level (the header approvals)' })
  // anybody may sit at a level: empty for those who do not
  @AuthenticatedOnly()
  toApprove(@ReqCtx() ctx: RequestContext) {
    return this.approval.toApprove(ctx);
  }

  @Post('vacancies/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve the vacancy waiting with me' })
  // the approver of the waiting level (checked in the service)
  @AuthenticatedOnly()
  approve(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: VacancyApproveDto) {
    return this.approval.decide(ctx, id, 'approved', body.note);
  }

  @Post('vacancies/:id/send-back')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send the vacancy waiting with me back, with the reason' })
  // the approver of the waiting level (checked in the service)
  @AuthenticatedOnly()
  sendBack(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: VacancySendBackDto,
  ) {
    return this.approval.decide(ctx, id, 'rejected', body.note);
  }

  @Get('vacancies/:id/qr')
  @ApiOperation({ summary: 'The QR of a published vacancy’s careers page (PNG)' })
  @RequirePermission(PEOPLE.recruitmentView)
  qr(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.qr(ctx, id, this.env.PUBLIC_APP_URL);
  }

  @Get('vacancies/:id/poster')
  @ApiOperation({ summary: 'The A4 poster of a published vacancy (PDF)' })
  @RequirePermission(PEOPLE.recruitmentView)
  poster(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.poster(ctx, id, this.env.PUBLIC_APP_URL);
  }

  // ---- part 3: candidates and screening ----

  @Get('setup/notices')
  @ApiOperation({ summary: 'Which notices go to candidates, and by which channels' })
  @RequirePermission(PEOPLE.recruitmentView)
  notices(@ReqCtx() ctx: RequestContext) {
    return this.screening.notices(ctx);
  }

  @Put('setup/notices')
  @ApiOperation({ summary: 'Set the notices to candidates' })
  @RequirePermission(PEOPLE.recruitmentManage)
  saveNotices(@ReqCtx() ctx: RequestContext, @Body() body: RecruitmentNoticesDto) {
    return this.screening.saveNotices(ctx, body);
  }

  @Get('vacancies/:id/pipeline')
  @ApiOperation({ summary: 'Candidates of a vacancy at each stage, and how many are selected' })
  @RequirePermission(PEOPLE.recruitmentView)
  pipeline(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.screening.pipeline(ctx, id);
  }

  @Get('applications')
  @ApiOperation({ summary: 'Candidates: the applications, with filters and the count per status' })
  @RequirePermission(PEOPLE.recruitmentView)
  applications(@ReqCtx() ctx: RequestContext, @Query() q: ApplicationListDto) {
    return this.screening.list(ctx, q);
  }

  @Post('applications')
  @ApiOperation({ summary: 'Add a candidate the office met (walk-in, referral) to a vacancy' })
  @RequirePermission(PEOPLE.recruitmentManage)
  walkIn(@ReqCtx() ctx: RequestContext, @Body() body: WalkInDto) {
    return this.screening.walkIn(ctx, body);
  }

  @Post('applications/export')
  @HttpCode(200)
  @ApiOperation({
    summary: 'The candidates as filtered (or the ticked ones) as an Excel workbook (base64)',
  })
  @RequirePermission(PEOPLE.recruitmentView)
  exportApplications(@ReqCtx() ctx: RequestContext, @Body() body: ApplicationExportDto) {
    return this.exporter.export(ctx, body);
  }

  @Get('export/setup')
  @ApiOperation({
    summary: 'The export picker: the fields by group, the list sheets, the layouts, my last choice',
  })
  @RequirePermission(PEOPLE.recruitmentView)
  exportSetup(@ReqCtx() ctx: RequestContext) {
    return this.exporter.setup(ctx);
  }

  @Post('export/layouts')
  @HttpCode(200)
  @ApiOperation({ summary: 'Save a named export layout (the same name changes it)' })
  @RequirePermission(PEOPLE.recruitmentView)
  saveExportLayout(@ReqCtx() ctx: RequestContext, @Body() body: ExportLayoutDto) {
    return this.exporter.saveLayout(ctx, body);
  }

  @Delete('export/layouts/:id')
  @ApiOperation({ summary: 'Remove an export layout (its maker or the recruitment manager)' })
  @RequirePermission(PEOPLE.recruitmentView)
  deleteExportLayout(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.exporter.deleteLayout(ctx, id);
  }

  @Post('applications/bulk')
  @HttpCode(200)
  @ApiOperation({ summary: 'The same result or schedule for several candidates at one stage' })
  @RequirePermission(PEOPLE.recruitmentManage)
  bulk(@ReqCtx() ctx: RequestContext, @Body() body: ApplicationBulkDto) {
    return this.screening.bulk(ctx, body);
  }

  @Get('applications/:id')
  @ApiOperation({ summary: 'One application: the form as submitted, the stages and the steps' })
  @RequirePermission(PEOPLE.recruitmentView)
  application(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.screening.view(ctx, id);
  }

  @Get('applications/:id/pdf')
  @ApiOperation({ summary: 'The application as the candidate sent it, as a PDF (base64)' })
  @RequirePermission(PEOPLE.recruitmentView)
  applicationPdf(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.screening.applicationPdf(ctx, id);
  }

  @Get('applications/:id/files/:fileId')
  @ApiOperation({ summary: 'A document of the application, as a signed address' })
  @RequirePermission(PEOPLE.recruitmentView)
  applicationFile(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.screening.fileUrl(ctx, id, fileId);
  }

  @Post('applications/:id/stages/:stageId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Schedule a stage, or record its marks and result' })
  @RequirePermission(PEOPLE.recruitmentManage)
  stage(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Body() body: StageResultDto,
  ) {
    return this.screening.record(ctx, id, stageId, body);
  }

  @Post('applications/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Do not take the application forward (with the reason)' })
  @RequirePermission(PEOPLE.recruitmentManage)
  reject(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ApplicationNoteDto) {
    return this.screening.reject(ctx, id, body);
  }

  @Post('applications/:id/resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Go on with an application on hold' })
  @RequirePermission(PEOPLE.recruitmentManage)
  resume(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.screening.resume(ctx, id);
  }

  // ---- part 8: putting an application right ----

  @Get('setup/corrections')
  @ApiOperation({ summary: 'Who may undo decisions and change stages; the time to correct' })
  @RequirePermission(PEOPLE.recruitmentView)
  correctionSettings(@ReqCtx() ctx: RequestContext) {
    return this.corrections.settings(ctx);
  }

  @Put('setup/corrections')
  @ApiOperation({
    summary: 'Set who may undo decisions and change stages, and the time to correct',
  })
  @RequirePermission(PEOPLE.recruitmentManage)
  saveCorrectionSettings(@ReqCtx() ctx: RequestContext, @Body() body: CorrectionSettingsDto) {
    return this.corrections.saveSettings(ctx, body);
  }

  @Post('applications/:id/undo')
  @HttpCode(200)
  @ApiOperation({ summary: 'Undo the last decision on an application, with the reason' })
  // who may is set in Recruitment set-up (checked in the service)
  @RequirePermission(PEOPLE.recruitmentView)
  undo(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UndoDto) {
    return this.corrections.undo(ctx, id, body);
  }

  @Post('applications/:id/move')
  @HttpCode(200)
  @ApiOperation({ summary: 'Move an application to another stage of its vacancy, with the reason' })
  // who may is set in Recruitment set-up (checked in the service)
  @RequirePermission(PEOPLE.recruitmentView)
  move(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: MoveStageDto) {
    return this.corrections.move(ctx, id, body);
  }

  @Post('applications/:id/send-back')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send the application back to the candidate to correct the parts marked',
  })
  @RequirePermission(PEOPLE.recruitmentManage)
  sendApplicationBack(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: SendBackDto,
  ) {
    return this.corrections.sendBack(ctx, id, body);
  }

  @Post('applications/:id/send-back/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Take back the request for a correction' })
  @RequirePermission(PEOPLE.recruitmentManage)
  cancelCorrection(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: CancelCorrectionDto,
  ) {
    return this.corrections.cancelCorrection(ctx, id, body);
  }

  // ---- part 4: from selected candidate to employee ----

  @Get('applications/:id/join')
  @ApiOperation({ summary: 'What moving the candidate to the employee master will make' })
  @RequirePermission(PEOPLE.recruitmentManage)
  joinPreview(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.joining.preview(ctx, id);
  }

  @Post('applications/:id/join')
  @ApiOperation({
    summary: 'Make the selected candidate an employee (needs the right to add employees too)',
  })
  @RequirePermission(PEOPLE.recruitmentManage)
  join(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: JoinDto) {
    return this.joining.join(ctx, id, body);
  }
}
