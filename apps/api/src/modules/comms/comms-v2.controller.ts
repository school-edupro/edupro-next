import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { CommsReportsService } from './comms-reports.service';
import { CommsSettingsService, type ProviderChannel } from './comms-settings.service';
import { CommsSettingsDto, CreditDto, ProviderDto, ProviderTestDto } from './comms.dto';
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
  ) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'This month by channel, the trend, balances, recent requests, failures',
  })
  @RequirePermission(COMMS_V2.reportView)
  dashboard(@ReqCtx() ctx: RequestContext, @Query('month') month?: string) {
    return this.reports.dashboard(ctx, month);
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

  @Put('providers/:channel')
  @ApiOperation({ summary: 'Save the SMS (MSG91), WhatsApp (Meta) or email (SMTP / SES) provider' })
  @RequirePermission(COMMS_V2.settingsManage)
  saveProvider(
    @ReqCtx() ctx: RequestContext,
    @Param('channel') channel: string,
    @Body() dto: ProviderDto,
  ) {
    return this.settings.saveProvider(ctx, channelOf(channel), dto);
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
