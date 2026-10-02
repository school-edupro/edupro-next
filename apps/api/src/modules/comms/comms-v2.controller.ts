import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { CommsReportsService } from './comms-reports.service';
import { CommsSettingsService, type ProviderChannel } from './comms-settings.service';
import {
  ApproversDto,
  CommsSettingsDto,
  CreditDto,
  InboxQueryDto,
  InboxReadDto,
  PushDeviceDto,
  ProviderDto,
  ProviderTestDto,
} from './comms.dto';
import { InboxService } from './inbox.service';
import { PushService } from './push.service';
import { COMMS_V2 } from './comms.permissions';

const channelOf = (v: string): ProviderChannel => {
  if (v === 'sms' || v === 'whatsapp' || v === 'email') return v;
  throw new DomainError('not-found', 'Unknown channel', { status: 404 });
};

/** Communication v2: providers and keys, the approval rule and other policy, credits. */
@ApiTags('comms')
@ApiBearerAuth()
@Controller('comms')
export class CommsSettingsController {
  constructor(
    private readonly settings: CommsSettingsService,
    private readonly reports: CommsReportsService,
    private readonly push: PushService,
  ) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'This month by channel, the trend, balances, recent requests, failures',
  })
  @RequirePermission(COMMS_V2.reportView)
  dashboard(@ReqCtx() ctx: RequestContext, @Query('month') month?: string) {
    return this.reports.dashboard(ctx, month);
  }

  @Get('reports/:id/xlsx')
  @ApiOperation({ summary: 'The report as an Excel file now (no export queue)' })
  @RequirePermission(COMMS_V2.reportView)
  async reportXlsx(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: Record<string, string>,
    @Res() reply: FastifyReply,
  ) {
    const { bytes, filename } = await this.reports.xlsx(ctx, id, q);
    void reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(bytes);
  }

  @Get('reports/:id')
  @ApiOperation({
    summary: 'Monthly usage statement, failures or the delivery log (the export rows)',
  })
  @RequirePermission(COMMS_V2.reportView)
  report(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: Record<string, string>,
  ) {
    return this.reports.table(ctx, id, q);
  }

  @Get('settings')
  @ApiOperation({
    summary: 'Providers (keys shown only as saved), approval rule, quiet hours, rates',
  })
  @RequirePermission(COMMS_V2.settingsManage, {
    description: 'Communication settings: providers and keys, approval rule, quiet hours, rates',
  })
  get(@ReqCtx() ctx: RequestContext) {
    return this.settings.get(ctx);
  }

  @Put('settings')
  @RequirePermission(COMMS_V2.settingsManage)
  save(@ReqCtx() ctx: RequestContext, @Body() dto: CommsSettingsDto) {
    return this.settings.savePolicy(ctx, dto);
  }

  @Put('approvers')
  @ApiOperation({ summary: 'Who approves bulk messages: roles and / or named employees (any one)' })
  @RequirePermission(COMMS_V2.settingsManage)
  saveApprovers(@ReqCtx() ctx: RequestContext, @Body() dto: ApproversDto) {
    return this.settings.saveApprovers(ctx, dto);
  }

  @Put('providers/:channel')
  @ApiOperation({ summary: 'Save the SMS, WhatsApp, email or push (Firebase) provider' })
  @RequirePermission(COMMS_V2.settingsManage)
  saveProvider(
    @ReqCtx() ctx: RequestContext,
    @Param('channel') channel: string,
    @Body() dto: ProviderDto,
  ) {
    return this.settings.saveProvider(ctx, channel === 'push' ? 'push' : channelOf(channel), dto);
  }

  @Post('push/test')
  @HttpCode(200)
  @ApiOperation({ summary: 'A test push to my own registered devices' })
  @RequirePermission(COMMS_V2.settingsManage)
  pushTest(@ReqCtx() ctx: RequestContext) {
    return this.push.testMe(ctx);
  }

  @Post('providers/:channel/test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Queue a test message through the saved provider' })
  @RequirePermission(COMMS_V2.settingsManage)
  test(
    @ReqCtx() ctx: RequestContext,
    @Param('channel') channel: string,
    @Body() dto: ProviderTestDto,
  ) {
    return this.settings.test(ctx, channelOf(channel), dto);
  }

  @Get('credits')
  @ApiOperation({ summary: 'Credit balance per channel and the top-up ledger' })
  @RequirePermission(COMMS_V2.reportView, {
    description: 'Communication dashboard, delivery reports and the monthly usage statement',
  })
  credits(@ReqCtx() ctx: RequestContext) {
    return this.settings.credits(ctx);
  }

  @Post('credits')
  @RequirePermission(COMMS_V2.creditManage, { description: 'Record credit top-ups' })
  addCredit(@ReqCtx() ctx: RequestContext, @Body() dto: CreditDto) {
    return this.settings.addCredit(ctx, dto);
  }
}

/** The Messages inbox of the parent, student and teacher apps: the signed-in person's own messages. */
@ApiTags('comms')
@ApiBearerAuth()
@Controller('comms/inbox')
export class CommsInboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Messages the school sent me (parents: also about each child)' })
  list(@ReqCtx() ctx: RequestContext, @Query() q: InboxQueryDto) {
    return this.inbox.list(ctx, q);
  }

  @Get('unread')
  @AuthenticatedOnly()
  unread(@ReqCtx() ctx: RequestContext) {
    return this.inbox.unread(ctx);
  }

  @Post('read')
  @HttpCode(200)
  @AuthenticatedOnly()
  read(@ReqCtx() ctx: RequestContext, @Body() dto: InboxReadDto) {
    return this.inbox.markRead(ctx, dto.ids);
  }
}

/** Push notifications for the parent / student and teacher apps (Firebase). */
@ApiTags('comms')
@ApiBearerAuth()
@Controller('comms/push')
export class CommsPushController {
  constructor(private readonly push: PushService) {}

  @Get('config')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Firebase web config and VAPID key for the apps (no secrets)' })
  config(@ReqCtx() ctx: RequestContext) {
    return this.push.config(ctx);
  }

  @Post('devices')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Register this device for push notifications' })
  register(@ReqCtx() ctx: RequestContext, @Body() dto: PushDeviceDto) {
    return this.push.register(ctx, dto);
  }

  @Post('devices/remove')
  @HttpCode(200)
  @AuthenticatedOnly()
  unregister(@ReqCtx() ctx: RequestContext, @Body() dto: PushDeviceDto) {
    return this.push.unregister(ctx, dto.token);
  }
}
