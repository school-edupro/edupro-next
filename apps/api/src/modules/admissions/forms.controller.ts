import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ADMISSIONS } from './admissions.dto';
import { CopyFormDto, SaveFormDto, UpdateFormDto } from './forms.dto';
import { AdmissionFormsService } from './forms.service';

/** The admission form builder (docs/design/39, part 1). */
@ApiTags('admissions')
@ApiBearerAuth()
@Controller('admissions/forms')
export class AdmissionFormsController {
  constructor(private readonly forms: AdmissionFormsService) {}

  @Get()
  @RequirePermission(ADMISSIONS.cycleView)
  async list(@ReqCtx() ctx: RequestContext) {
    return { data: await this.forms.list(ctx) };
  }

  @Get('meta')
  @ApiOperation({
    summary: 'Ready forms, option lists and masters, student-master fields for mapping',
  })
  @RequirePermission(ADMISSIONS.cycleView)
  meta(@ReqCtx() ctx: RequestContext) {
    return this.forms.meta(ctx);
  }

  @Get(':id')
  @RequirePermission(ADMISSIONS.cycleView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.forms.get(ctx, id);
  }

  @Post()
  @ApiOperation({ summary: 'A new form, from a ready form or from scratch' })
  @RequirePermission(ADMISSIONS.cycleManage)
  create(@ReqCtx() ctx: RequestContext, @Body() dto: SaveFormDto) {
    return this.forms.create(ctx, dto);
  }

  @Put(':id')
  @RequirePermission(ADMISSIONS.cycleManage)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateFormDto) {
    return this.forms.update(ctx, id, dto);
  }

  @Post(':id/copy')
  @RequirePermission(ADMISSIONS.cycleManage)
  copy(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CopyFormDto) {
    return this.forms.copy(ctx, id, dto);
  }

  @Post(':id/archive')
  @RequirePermission(ADMISSIONS.cycleManage)
  archive(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.forms.setStatus(ctx, id, 'archived');
  }

  @Post(':id/restore')
  @RequirePermission(ADMISSIONS.cycleManage)
  restore(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.forms.setStatus(ctx, id, 'active');
  }
}
