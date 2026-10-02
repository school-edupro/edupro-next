import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  AssignTicketDto,
  CloseTicketDto,
  CreateTicketDto,
  DeskSchema,
  HELPDESK,
  HeadDto,
  HelpdeskReportDto,
  HelpdeskSettingsDto,
  ListTicketsDto,
  RateTicketDto,
  ReopenTicketDto,
  ReplyDto,
} from './helpdesk.dto';
import { HelpdeskService } from './helpdesk.service';

/**
 * Helpdesk (0056): parent queries, staff queries and tickets to the ERP provider. Reading and answering
 * are open to any signed-in user; the service shows each person only the tickets they raised, own,
 * owned before, handle for their role or section, or (provider support) every provider ticket.
 */
@ApiTags('helpdesk')
@ApiBearerAuth()
@Controller('helpdesk')
export class HelpdeskController {
  constructor(private readonly helpdesk: HelpdeskService) {}

  @Get('tickets')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Tickets I may see (desk, status, mine / assigned, search)' })
  list(@ReqCtx() ctx: RequestContext, @Query() q: ListTicketsDto) {
    this.helpdesk.assertAny(ctx);
    return this.helpdesk.list(ctx, q);
  }

  @Post('tickets')
  @ApiOperation({ summary: 'Raise a staff query or a ticket to the ERP provider' })
  @RequirePermission(HELPDESK.raise, {
    description: 'Raise a staff query or a ticket to the ERP provider',
  })
  create(@ReqCtx() ctx: RequestContext, @Body() dto: CreateTicketDto) {
    return this.helpdesk.create(ctx, dto);
  }

  @Get('tickets/:id')
  @AuthenticatedOnly()
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    this.helpdesk.assertAny(ctx);
    return this.helpdesk.get(ctx, id);
  }

  @Get('tickets/:id/files/:fileId')
  @AuthenticatedOnly()
  file(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('fileId') fileId: string) {
    this.helpdesk.assertAny(ctx);
    return this.helpdesk.fileUrl(ctx, id, fileId);
  }

  @Post('tickets/:id/replies')
  @AuthenticatedOnly()
  reply(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ReplyDto) {
    this.helpdesk.assertAny(ctx);
    return this.helpdesk.reply(ctx, id, dto);
  }

  @Post('tickets/:id/assign')
  @HttpCode(200)
  @AuthenticatedOnly()
  assign(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: AssignTicketDto) {
    this.helpdesk.assertAny(ctx);
    return this.helpdesk.assign(ctx, id, dto);
  }

  @Post('tickets/:id/close')
  @HttpCode(200)
  @AuthenticatedOnly()
  close(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CloseTicketDto) {
    this.helpdesk.assertAny(ctx);
    return this.helpdesk.close(ctx, id, dto);
  }

  @Post('tickets/:id/reopen')
  @HttpCode(200)
  @AuthenticatedOnly()
  reopen(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ReopenTicketDto) {
    this.helpdesk.assertAny(ctx);
    return this.helpdesk.reopen(ctx, id, dto);
  }

  @Post('tickets/:id/rate')
  @HttpCode(200)
  @AuthenticatedOnly()
  rate(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: RateTicketDto) {
    this.helpdesk.assertAny(ctx);
    return this.helpdesk.rate(ctx, id, dto);
  }

  @Get('heads/:desk')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Active query types of a desk' })
  async heads(@ReqCtx() ctx: RequestContext, @Param('desk') desk: string) {
    this.helpdesk.assertAny(ctx);
    return { data: await this.helpdesk.heads(ctx, DeskSchema.parse(desk)) };
  }

  @Get('assignees')
  @RequirePermission(HELPDESK.respond, {
    description: 'Reply to, reassign and close the tickets assigned to me or my role',
  })
  assignees(@ReqCtx() ctx: RequestContext) {
    return this.helpdesk.assignees(ctx);
  }

  @Get('dashboard')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Last six months per desk: raised, resolved, escalated, SLA' })
  dashboard(@ReqCtx() ctx: RequestContext) {
    this.helpdesk.assertAny(ctx);
    return this.helpdesk.dashboard(ctx);
  }

  @Get('report.xlsx')
  @AuthenticatedOnly()
  async report(
    @ReqCtx() ctx: RequestContext,
    @Query() q: HelpdeskReportDto,
    @Res() reply: FastifyReply,
  ) {
    this.helpdesk.assertAny(ctx);
    const { bytes, filename } = await this.helpdesk.report(ctx, q);
    void reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(bytes);
  }

  // ---- set-up (admin) ---------------------------------------------------------------------------------
  @Get('setup')
  @RequirePermission(HELPDESK.settingsManage, {
    description:
      'Helpdesk set-up: query heads, owners, SLA, escalation matrix, working hours, ERP provider',
  })
  setup(@ReqCtx() ctx: RequestContext) {
    return this.helpdesk.setup(ctx);
  }

  @Put('setup/settings')
  @RequirePermission(HELPDESK.settingsManage)
  saveSettings(@ReqCtx() ctx: RequestContext, @Body() dto: HelpdeskSettingsDto) {
    return this.helpdesk.saveSettings(ctx, dto);
  }

  @Post('setup/heads')
  @RequirePermission(HELPDESK.settingsManage)
  createHead(@ReqCtx() ctx: RequestContext, @Body() dto: HeadDto) {
    return this.helpdesk.saveHead(ctx, null, dto);
  }

  @Put('setup/heads/:id')
  @RequirePermission(HELPDESK.settingsManage)
  updateHead(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: HeadDto) {
    return this.helpdesk.saveHead(ctx, id, dto);
  }

  @Post('escalate-now')
  @HttpCode(200)
  @RequirePermission(HELPDESK.settingsManage)
  @ApiOperation({ summary: 'Run the escalation check now (workers run it every 5 minutes)' })
  escalateNow(@ReqCtx() ctx: RequestContext) {
    return this.helpdesk.escalateNow(ctx);
  }
}
