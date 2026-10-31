import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { EXAMS, SetClassesDto, UpsertIndicatorAreaDto, UpsertIndicatorScaleDto } from './exams.dto';
import { IndicatorMastersService } from './indicator-masters.service';

/** docs/design/65: the indicator areas and level scales the set editor picks from. */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
export class IndicatorMastersController {
  constructor(private readonly masters: IndicatorMastersService) {}

  @Get('indicator-areas')
  @RequirePermission(EXAMS.masterView)
  areas(@ReqCtx() ctx: RequestContext) {
    return this.masters.areas(ctx);
  }

  @Put('indicator-areas')
  @ApiOperation({ summary: 'Add or change an indicator area (a rename renames it in every set)' })
  @RequirePermission(EXAMS.masterManage)
  upsertArea(@ReqCtx() ctx: RequestContext, @Body() dto: UpsertIndicatorAreaDto) {
    return this.masters.upsertArea(ctx, dto);
  }

  @Put('indicator-sets/:id/classes')
  @ApiOperation({ summary: 'The classes a set of indicators or a progress card is for' })
  @RequirePermission(EXAMS.masterManage)
  setClasses(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: SetClassesDto) {
    return this.masters.setClasses(ctx, id, dto);
  }

  @Get('indicator-scales')
  @RequirePermission(EXAMS.masterView)
  scales(@ReqCtx() ctx: RequestContext) {
    return this.masters.scales(ctx);
  }

  @Put('indicator-scales')
  @ApiOperation({ summary: "Add or change a level scale (a used scale's levels stay)" })
  @RequirePermission(EXAMS.masterManage)
  upsertScale(@ReqCtx() ctx: RequestContext, @Body() dto: UpsertIndicatorScaleDto) {
    return this.masters.upsertScale(ctx, dto);
  }
}
