import { Body, Controller, Get, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { ADMISSIONS } from './admissions.dto';
import {
  AdmissionSettingsDto,
  FeeCategoriesDto,
  PasscodeDto,
  SessionClassesDto,
  SessionFeesDto,
  SessionPointsDto,
  SessionSettingsDto,
} from './setup.dto';
import { AdmissionLateEntryService } from './late-entry.service';
import { AdmissionPointsService } from './points.service';
import { AdmissionSetupService } from './setup.service';

export const ADMISSION_SETUP = 'admissions.setup.manage';

/** Admission set-up and the session's classes, fees and sharing (docs/design/39, part 2). */
@ApiTags('admissions')
@ApiBearerAuth()
@Controller('admissions')
export class AdmissionSetupController {
  constructor(
    private readonly svc: AdmissionSetupService,
    private readonly points: AdmissionPointsService,
    private readonly late: AdmissionLateEntryService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('setup')
  @ApiOperation({ summary: 'Sign-in channels, receipt series and fee categories' })
  @RequirePermission(ADMISSIONS.cycleView)
  setup(@ReqCtx() ctx: RequestContext) {
    return this.svc.setup(ctx);
  }

  @Put('setup/settings')
  @RequirePermission(ADMISSION_SETUP, {
    description:
      'Admission set-up: sign-in channels, receipt series, fee categories, stages and approval processes',
  })
  saveSettings(@ReqCtx() ctx: RequestContext, @Body() dto: AdmissionSettingsDto) {
    return this.svc.saveSettings(ctx, dto);
  }

  @Put('setup/categories')
  @RequirePermission(ADMISSION_SETUP)
  saveCategories(@ReqCtx() ctx: RequestContext, @Body() dto: FeeCategoriesDto) {
    return this.svc.saveCategories(ctx, dto);
  }

  @Get('cycles/:id/plan')
  @ApiOperation({
    summary: 'The session: classes with form, seats, window, eligibility, and the fee table',
  })
  @RequirePermission(ADMISSIONS.cycleView)
  plan(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.plan(ctx, id, this.env.PUBLIC_APP_URL);
  }

  @Put('cycles/:id/classes')
  @RequirePermission(ADMISSIONS.cycleManage)
  async saveClasses(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: SessionClassesDto,
  ) {
    await this.svc.saveClasses(ctx, id, dto);
    return this.svc.plan(ctx, id, this.env.PUBLIC_APP_URL);
  }

  @Put('cycles/:id/fees')
  @RequirePermission(ADMISSIONS.cycleManage)
  async saveFees(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: SessionFeesDto,
  ) {
    await this.svc.saveFees(ctx, id, dto);
    return this.svc.plan(ctx, id, this.env.PUBLIC_APP_URL);
  }

  @Put('cycles/:id/settings')
  @RequirePermission(ADMISSIONS.cycleManage)
  async saveSessionSettings(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: SessionSettingsDto,
  ) {
    await this.svc.saveSessionSettings(ctx, id, dto);
    return this.svc.plan(ctx, id, this.env.PUBLIC_APP_URL);
  }

  @Get('cycles/:id/points')
  @ApiOperation({
    summary: "The session's merit points: its list, each class's own, and the forms' questions",
  })
  @RequirePermission(ADMISSIONS.cycleView)
  getPoints(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.points.get(ctx, id);
  }

  @Put('cycles/:id/points')
  @RequirePermission(ADMISSIONS.cycleManage)
  savePoints(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: SessionPointsDto,
  ) {
    return this.points.save(ctx, id, dto);
  }

  @Get('cycles/:id/passcodes')
  @ApiOperation({
    summary: 'Late-entry passcodes of the session (closed classes opened for a family)',
  })
  @RequirePermission(ADMISSION_SETUP)
  passcodes(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.late.list(ctx, id);
  }

  @Post('cycles/:id/passcodes')
  @ApiOperation({
    summary: 'Open a closed class for one family until a date: a passcode mailed to them',
  })
  @RequirePermission(ADMISSION_SETUP)
  givePasscode(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: PasscodeDto) {
    return this.late.create(ctx, id, dto);
  }

  @Post('passcodes/:id/resend')
  @RequirePermission(ADMISSION_SETUP)
  resendPasscode(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.late.resend(ctx, id);
  }

  @Post('passcodes/:id/revoke')
  @RequirePermission(ADMISSION_SETUP)
  revokePasscode(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.late.revoke(ctx, id);
  }

  @Get('cycles/:id/qr')
  @ApiOperation({ summary: 'The public registration link of the session and its QR (PNG)' })
  @RequirePermission(ADMISSIONS.cycleView)
  qr(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.share(ctx, id, this.env.PUBLIC_APP_URL);
  }

  @Get('cycles/:id/poster')
  @ApiOperation({ summary: 'The A4 admission poster with classes, last date and the QR (PDF)' })
  @RequirePermission(ADMISSIONS.cycleView)
  poster(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.poster(ctx, id, this.env.PUBLIC_APP_URL);
  }
}
