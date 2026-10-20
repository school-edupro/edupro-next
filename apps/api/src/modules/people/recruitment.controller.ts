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
import { PEOPLE } from './people.permissions';
import { RecruitmentService } from './recruitment.service';

/** Recruitment, part 1 (docs/design/34-recruitment.md): vacancies, their approval and the stages. */
@ApiTags('people')
@ApiBearerAuth()
@Controller('people/recruitment')
export class RecruitmentController {
  constructor(private readonly svc: RecruitmentService) {}

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
}
