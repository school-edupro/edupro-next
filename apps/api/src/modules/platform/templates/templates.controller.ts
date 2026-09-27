import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../../common/http/request-context';
import {
  CreateTemplateDto,
  PreviewTemplateDto,
  RenderTemplateDto,
  TEMPLATES,
  UpdateTemplateDto,
} from './templates.dto';
import { TemplatesService } from './templates.service';

@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'Document templates of the school' })
  @RequirePermission(TEMPLATES.view, { description: 'View document templates' })
  async list(@ReqCtx() ctx: RequestContext) {
    return { data: await this.templates.list(ctx) };
  }

  @Post('defaults')
  @ApiOperation({ summary: 'Install the default templates the school does not have yet' })
  @RequirePermission(TEMPLATES.manage, { description: 'Edit document templates' })
  async defaults(@ReqCtx() ctx: RequestContext) {
    return { data: await this.templates.installDefaults(ctx) };
  }

  @Get(':id')
  @RequirePermission(TEMPLATES.view)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.templates.get(ctx, id);
  }

  @Post()
  @RequirePermission(TEMPLATES.manage)
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateTemplateDto) {
    return this.templates.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission(TEMPLATES.manage)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UpdateTemplateDto) {
    return this.templates.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(TEMPLATES.manage)
  async remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string): Promise<void> {
    await this.templates.remove(ctx, id);
  }

  @Post(':id/preview')
  @ApiOperation({ summary: 'HTML preview with sample data or a real entity' })
  @RequirePermission(TEMPLATES.view)
  preview(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: PreviewTemplateDto,
  ) {
    return this.templates.preview(ctx, id, body);
  }

  @Post(':id/render')
  @ApiOperation({ summary: 'Queue a PDF of the template for one entity (export centre)' })
  @RequirePermission(TEMPLATES.view)
  render(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: RenderTemplateDto) {
    return this.templates.render(ctx, id, body);
  }
}
