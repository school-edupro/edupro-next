import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  RecruitmentStagesDto,
  VacancyDto,
  VacancyListDto,
  VacancyNoteDto,
  VacancyPublishDto,
} from './recruitment.dto';
import {
  ApplicationBulkDto,
  ApplicationListDto,
  ApplicationNoteDto,
  RecruitmentNoticesDto,
  StageResultDto,
  WalkInDto,
} from './recruitment-screening.dto';
import { RecruitmentScreeningService } from './recruitment-screening.service';
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
  @RequirePermission(PEOPLE.recruitmentView)
  view(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.view(ctx, id);
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
}
