import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  BreachDto,
  BreachUpdateDto,
  DsrListDto,
  DsrStatusDto,
  EraseDto,
  MyDsrDto,
  OfficeDsrDto,
  PRIVACY,
} from './dsr.dto';
import { DsrService } from './dsr.service';

/** Sprint 20: DPDP tooling. Design note 17 section 2. */
@ApiTags('privacy')
@ApiBearerAuth()
@Controller('privacy')
export class DsrController {
  constructor(private readonly dsr: DsrService) {}

  // ---- self-service ----
  @Get('requests/mine')
  @ApiOperation({ summary: 'My data-principal requests (family or staff)' })
  @RequirePermission(PRIVACY.request, {
    description: "Raise a data-principal request for oneself or one's children",
  })
  async mine(@ReqCtx() ctx: RequestContext) {
    return { data: await this.dsr.mine(ctx) };
  }

  @Post('requests/mine')
  @ApiOperation({ summary: 'Raise an access, correction or grievance request' })
  @RequirePermission(PRIVACY.request)
  createMine(@ReqCtx() ctx: RequestContext, @Body() body: MyDsrDto) {
    return this.dsr.createMine(ctx, body);
  }

  @Get('requests/mine/:id/export')
  @ApiOperation({ summary: 'Status and download of the access report of my completed request' })
  @RequirePermission(PRIVACY.request)
  myExport(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.dsr.myExport(ctx, id);
  }

  // ---- office ----
  @Get('requests')
  @ApiOperation({ summary: 'The request queue, overdue first' })
  @RequirePermission(PRIVACY.manage, { description: 'Work data-principal requests' })
  list(@ReqCtx() ctx: RequestContext, @Query() q: DsrListDto) {
    return this.dsr.list(ctx, q);
  }

  @Post('requests')
  @ApiOperation({ summary: 'Record a request received at the office, by email or by letter' })
  @RequirePermission(PRIVACY.manage)
  createOffice(@ReqCtx() ctx: RequestContext, @Body() body: OfficeDsrDto) {
    return this.dsr.createOffice(ctx, body);
  }

  @Put('requests/:id/status')
  @ApiOperation({
    summary: 'Move a request along; completing an access request queues the access report',
  })
  @RequirePermission(PRIVACY.manage)
  setStatus(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: DsrStatusDto) {
    return this.dsr.setStatus(ctx, id, body);
  }

  @Post('requests/:id/erase')
  @ApiOperation({ summary: 'Complete an erasure request (anonymises the person; second factor)' })
  @RequirePermission(PRIVACY.erase, {
    description: 'Complete an erasure request (anonymises the person)',
    mfa: true,
  })
  erase(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: EraseDto) {
    return this.dsr.erase(ctx, id, body);
  }

  @Get('retention')
  @ApiOperation({ summary: 'Latest retention purge per policy and the 30-day totals' })
  @RequirePermission(PRIVACY.manage)
  async retention(@ReqCtx() ctx: RequestContext) {
    return { data: await this.dsr.retentionRuns(ctx) };
  }

  // ---- breach log ----
  @Get('breaches')
  @ApiOperation({ summary: 'The breach log, open incidents first' })
  @RequirePermission(PRIVACY.breach, { description: 'Record and work personal-data breaches' })
  async breaches(@ReqCtx() ctx: RequestContext) {
    return { data: await this.dsr.breaches(ctx) };
  }

  @Post('breaches')
  @ApiOperation({ summary: 'Record a suspected or confirmed personal-data breach' })
  @RequirePermission(PRIVACY.breach)
  recordBreach(@ReqCtx() ctx: RequestContext, @Body() body: BreachDto) {
    return this.dsr.recordBreach(ctx, body);
  }

  @Put('breaches/:id')
  @ApiOperation({ summary: 'Update status, actions and the notification timestamps' })
  @RequirePermission(PRIVACY.breach)
  updateBreach(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: BreachUpdateDto,
  ) {
    return this.dsr.updateBreach(ctx, id, body);
  }
}
