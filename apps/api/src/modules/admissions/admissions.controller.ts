import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  ADMISSIONS,
  CreateCycleDto,
  ListApplicationsQueryDto,
  ScoreApplicationDto,
  SetApplicationStatusDto,
  UpdateCycleDto,
} from './admissions.dto';
import { AdmissionsService } from './admissions.service';

@ApiTags('admissions')
@ApiBearerAuth()
@Controller('admissions')
export class AdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  @Get('cycles')
  @ApiOperation({ summary: 'Admission cycles with criteria and scoring masters' })
  @RequirePermission(ADMISSIONS.cycleView, {
    description: 'View admission cycles, criteria and scoring masters',
  })
  async listCycles(@ReqCtx() ctx: RequestContext) {
    return { data: await this.admissions.listCycles(ctx) };
  }

  @Get('cycles/:id')
  @RequirePermission(ADMISSIONS.cycleView)
  getCycle(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.admissions.getCycle(ctx, id);
  }

  @Post('cycles')
  @ApiOperation({ summary: 'Create a cycle (default form unless a schema is given)' })
  @RequirePermission(ADMISSIONS.cycleManage, {
    description: 'Create and edit admission cycles, forms, criteria and scoring masters',
  })
  createCycle(@ReqCtx() ctx: RequestContext, @Body() body: CreateCycleDto) {
    return this.admissions.createCycle(ctx, body);
  }

  @Patch('cycles/:id')
  @RequirePermission(ADMISSIONS.cycleManage)
  updateCycle(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: UpdateCycleDto,
  ) {
    return this.admissions.updateCycle(ctx, id, body);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Counts by status and class, seats and possible duplicates' })
  @RequirePermission(ADMISSIONS.applicationView, {
    description: 'View applications and the admissions dashboard',
  })
  dashboard(@ReqCtx() ctx: RequestContext, @Query('cycleId') cycleId?: string) {
    return this.admissions.dashboard(
      ctx,
      cycleId && /^\d{1,18}$/.test(cycleId) ? cycleId : undefined,
    );
  }

  @Get('applications')
  @RequirePermission(ADMISSIONS.applicationView)
  async listApplications(@ReqCtx() ctx: RequestContext, @Query() q: ListApplicationsQueryDto) {
    const { rows, total } = await this.admissions.listApplications(ctx, q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Get('applications/:id')
  @RequirePermission(ADMISSIONS.applicationView)
  getApplication(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.admissions.getApplication(ctx, id);
  }

  @Post('applications/:id/status')
  @ApiOperation({
    summary:
      'Move an application (under review, shortlisted, selected, waitlisted, rejected, withdrawn)',
  })
  @RequirePermission(ADMISSIONS.applicationReview, {
    description: 'Change application status, score and remarks',
  })
  setStatus(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: SetApplicationStatusDto,
  ) {
    return this.admissions.setStatus(ctx, id, body);
  }

  @Post('applications/:id/score')
  @ApiOperation({
    summary: 'Recompute the score: automatic rules plus the manual criteria awarded',
  })
  @RequirePermission(ADMISSIONS.applicationReview)
  score(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ScoreApplicationDto) {
    return this.admissions.score(ctx, id, body);
  }
}
