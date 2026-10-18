import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { AcrCycleDto, AcrLevelsDto, AcrQuestionDto, AcrSettingsDto } from './acr.dto';
import { AcrSetupService } from './acr-setup.service';
import { PEOPLE } from './people.permissions';

/** Employee ACR (docs/design/32-employee-acr.md). */
@ApiTags('people')
@ApiBearerAuth()
@Controller('people/acr')
export class AcrController {
  constructor(private readonly setup: AcrSetupService) {}

  @Get('setup')
  @ApiOperation({ summary: 'ACR set-up: rating words, grade bands, levels, questions, cycles' })
  @RequirePermission(PEOPLE.acrView)
  view(@ReqCtx() ctx: RequestContext) {
    return this.setup.view(ctx);
  }

  @Put('setup/settings')
  @ApiOperation({ summary: 'Rating words, days to object, grade bands' })
  @RequirePermission(PEOPLE.acrManage)
  settings(@ReqCtx() ctx: RequestContext, @Body() body: AcrSettingsDto) {
    return this.setup.saveSettings(ctx, body);
  }

  @Put('setup/levels')
  @ApiOperation({ summary: 'The levels of teaching or non-teaching ACRs, in order' })
  @RequirePermission(PEOPLE.acrManage)
  levels(@ReqCtx() ctx: RequestContext, @Body() body: AcrLevelsDto) {
    return this.setup.saveLevels(ctx, body);
  }

  @Post('setup/questions')
  @ApiOperation({ summary: 'Add a question to the bank' })
  @RequirePermission(PEOPLE.acrManage)
  addQuestion(@ReqCtx() ctx: RequestContext, @Body() body: AcrQuestionDto) {
    return this.setup.saveQuestion(ctx, null, body);
  }

  @Put('setup/questions/:id')
  @ApiOperation({ summary: 'Change a question (or switch it off)' })
  @RequirePermission(PEOPLE.acrManage)
  editQuestion(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: AcrQuestionDto,
  ) {
    return this.setup.saveQuestion(ctx, id, body);
  }

  @Post('cycles')
  @ApiOperation({ summary: 'A cycle for a year with its self-appraisal window' })
  @RequirePermission(PEOPLE.acrManage)
  addCycle(@ReqCtx() ctx: RequestContext, @Body() body: AcrCycleDto) {
    return this.setup.saveCycle(ctx, null, body);
  }

  @Put('cycles/:id')
  @ApiOperation({ summary: 'Change a cycle’s name or dates' })
  @RequirePermission(PEOPLE.acrManage)
  editCycle(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AcrCycleDto) {
    return this.setup.saveCycle(ctx, id, body);
  }
}
