import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  CreateTemplateDto,
  ListMessagesQueryDto,
  ListTemplatesQueryDto,
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
