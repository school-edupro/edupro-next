import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  CreateTemplateDto,
  CustomVariableDto,
  ListMessagesQueryDto,
  ListTemplatesQueryDto,
  PreviewTemplateDto,
  SendMessageDto,
  UpdateTemplateDto,
} from './comms.dto';
import { COMMS } from './comms.permissions';
import { MessagesService } from './messages.service';
import { TemplatesService } from './templates.service';

@ApiTags('comms')
@ApiBearerAuth()
@Controller('comms')
export class CommsController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly messages: MessagesService,
  ) {}

  // ---- templates -----------------------------------------------------------------------------------
  @Get('templates')
  @ApiOperation({ summary: 'List notification templates' })
  @RequirePermission(COMMS.templateView, { description: 'View notification templates' })
  async listTemplates(@ReqCtx() ctx: RequestContext, @Query() q: ListTemplatesQueryDto) {
    return { data: await this.templates.list(requireTenant(ctx), q) };
  }

  @Get('templates/variables')
  @ApiOperation({ summary: 'Variables templates can use, with what they hold' })
  @RequirePermission(COMMS.templateView)
  async templateVariables(@ReqCtx() ctx: RequestContext) {
    return { data: await this.templates.variables(ctx) };
  }

  @Get('variables')
  @ApiOperation({ summary: 'The school’s own variables ({{principal_name}}, {{fee_pay_link}}...)' })
  @RequirePermission(COMMS.templateView)
  async customVariables(@ReqCtx() ctx: RequestContext) {
    return { data: await this.templates.customVariables(ctx) };
  }

  @Put('variables')
  @RequirePermission(COMMS.templateManage)
  saveVariable(@ReqCtx() ctx: RequestContext, @Body() body: CustomVariableDto) {
    return this.templates.saveCustomVariable(ctx, body);
  }

  @Delete('variables/:key')
  @RequirePermission(COMMS.templateManage)
  deleteVariable(@ReqCtx() ctx: RequestContext, @Param('key') key: string) {
    return this.templates.deleteCustomVariable(ctx, key);
  }

  @Post('templates/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'A template with sample values: SMS units, the framed HTML email' })
  @RequirePermission(COMMS.templateView)
  previewTemplate(@ReqCtx() ctx: RequestContext, @Body() body: PreviewTemplateDto) {
    return this.templates.preview(ctx, body);
  }

  @Delete('templates/:id')
  @RequirePermission(COMMS.templateManage)
  removeTemplate(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.templates.remove(ctx, id);
  }

  @Get('templates/:id')
  @RequirePermission(COMMS.templateView)
  getTemplate(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.templates.get(requireTenant(ctx), id);
  }

  @Post('templates')
  @ApiOperation({ summary: 'Create a template (SMS templates carry their DLT ids)' })
  @RequirePermission(COMMS.templateManage, {
    description: 'Create and edit notification templates',
  })
  createTemplate(@ReqCtx() ctx: RequestContext, @Body() body: CreateTemplateDto) {
    return this.templates.create(ctx, body);
  }

  @Patch('templates/:id')
  @RequirePermission(COMMS.templateManage)
  updateTemplate(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: UpdateTemplateDto,
  ) {
    return this.templates.update(ctx, id, body);
  }

  // ---- messages ------------------------------------------------------------------------------------
  @Get('messages')
  @ApiOperation({ summary: 'Delivery log' })
  @RequirePermission(COMMS.messageView, { description: 'View the delivery log' })
  async listMessages(@ReqCtx() ctx: RequestContext, @Query() q: ListMessagesQueryDto) {
    const { rows, total } = await this.messages.list(requireTenant(ctx), q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Get('messages/:id')
  @RequirePermission(COMMS.messageView)
  getMessage(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.messages.get(requireTenant(ctx), id);
  }

  @Post('messages')
  @ApiOperation({ summary: 'Render a template for a recipient and queue the delivery' })
  @RequirePermission(COMMS.messageSend, { description: 'Send notifications' })
  send(@ReqCtx() ctx: RequestContext, @Body() body: SendMessageDto) {
    return this.messages.send(ctx, body);
  }

  @Post('messages/:id/cancel')
  @HttpCode(200)
  @RequirePermission(COMMS.messageSend)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.messages.cancel(ctx, id);
  }
}
