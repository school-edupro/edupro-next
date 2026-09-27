import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  CloseYearDto,
  CreateCampusDto,
  CreateYearDto,
  SetSettingDto,
  StageDto,
  UpdateCampusDto,
  UpdateSchoolDto,
} from './platform.dto';
import { PLATFORM } from './platform.permissions';
import { SchoolService } from './school.service';
import { SettingsService } from './settings.service';
import { YearsService, type YearKind } from './years.service';

const kindOf = (value: string): YearKind => {
  if (value === 'academic' || value === 'financial') return value;
  throw new DomainError('validation-failed', 'kind must be academic or financial', { status: 400 });
};

@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly settings: SettingsService,
    private readonly years: YearsService,
    private readonly school: SchoolService,
  ) {}

  // ---- school and campuses -------------------------------------------------------------------------
  @Get('school')
  @ApiOperation({ summary: 'Current school profile and campuses' })
  @RequirePermission(PLATFORM.schoolView, { description: 'View school profile and campuses' })
  getSchool(@ReqCtx() ctx: RequestContext) {
    return this.school.get(requireTenant(ctx));
  }

  @Patch('school')
  @RequirePermission(PLATFORM.schoolManage, {
    description: 'Edit school profile, campuses, branding',
  })
  updateSchool(@ReqCtx() ctx: RequestContext, @Body() body: UpdateSchoolDto) {
    return this.school.update(ctx, body);
  }

  @Post('school/campuses')
  @RequirePermission(PLATFORM.campusManage, { description: 'Create and edit campuses' })
  createCampus(@ReqCtx() ctx: RequestContext, @Body() body: CreateCampusDto) {
    return this.school.createCampus(ctx, body);
  }

  @Patch('school/campuses/:id')
  @RequirePermission(PLATFORM.campusManage)
  updateCampus(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: UpdateCampusDto,
  ) {
    return this.school.updateCampus(ctx, id, body);
  }

  // ---- years ---------------------------------------------------------------------------------------
  @Get('years')
  @ApiOperation({ summary: 'Academic and financial years of the school' })
  @RequirePermission(PLATFORM.yearView, { description: 'View academic and financial years' })
  async listYears(@ReqCtx() ctx: RequestContext) {
    return { data: await this.years.list(requireTenant(ctx)) };
  }

  @Post('years')
  @RequirePermission(PLATFORM.yearManage, { description: 'Create years, set active, edit dates' })
  createYear(@ReqCtx() ctx: RequestContext, @Body() body: CreateYearDto) {
    return this.years.create(ctx, body);
  }

  @Post('years/:kind/:id/activate')
  @ApiOperation({ summary: 'Activate a planned year; the previous active year becomes locked' })
  @RequirePermission(PLATFORM.yearManage)
  activate(@ReqCtx() ctx: RequestContext, @Param('kind') kind: string, @Param('id') id: string) {
    return this.years.activate(ctx, kindOf(kind), id);
  }

  @Post('years/:kind/:id/lock')
  @ApiOperation({ summary: 'Lock a stage (attendance, exams, fees, academics); MFA required' })
  @RequirePermission(PLATFORM.yearLock, { mfa: true, description: 'Lock a stage or close a year' })
  lock(
    @ReqCtx() ctx: RequestContext,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: StageDto,
  ) {
    return this.years.setStage(ctx, kindOf(kind), id, body.stage, true, body.reason);
  }

  @Post('years/:kind/:id/reopen')
  @RequirePermission(PLATFORM.yearReopen, { mfa: true, description: 'Reopen a locked stage' })
  reopen(
    @ReqCtx() ctx: RequestContext,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: StageDto,
  ) {
    return this.years.setStage(ctx, kindOf(kind), id, body.stage, false, body.reason);
  }

  @Post('years/:kind/:id/close')
  @RequirePermission(PLATFORM.yearLock, { mfa: true })
  close(
    @ReqCtx() ctx: RequestContext,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: CloseYearDto,
  ) {
    return this.years.close(ctx, kindOf(kind), id, body.reason);
  }

  // ---- settings ------------------------------------------------------------------------------------
  @Get('settings')
  @ApiOperation({ summary: 'Effective settings for today, with defaults' })
  @RequirePermission(PLATFORM.settingsView, { description: 'View school settings' })
  async listSettings(@ReqCtx() ctx: RequestContext) {
    return { data: await this.settings.current(requireTenant(ctx)) };
  }

  @Get('settings/:key/history')
  @RequirePermission(PLATFORM.settingsView)
  async settingHistory(@ReqCtx() ctx: RequestContext, @Param('key') key: string) {
    return { data: await this.settings.history(requireTenant(ctx), key) };
  }

  @Put('settings/:key')
  @ApiOperation({ summary: 'Set a setting value from a date (default today)' })
  @RequirePermission(PLATFORM.settingsEdit, { description: 'Edit school settings' })
  setSetting(
    @ReqCtx() ctx: RequestContext,
    @Param('key') key: string,
    @Body() body: SetSettingDto,
  ) {
    return this.settings.set(ctx, key, body.value, body.validFrom);
  }
}
