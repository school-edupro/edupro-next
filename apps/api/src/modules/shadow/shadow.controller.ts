import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { Public } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ServiceKeysService } from './service-keys.service';
import {
  CreateServiceKeyDto,
  DecideVarianceDto,
  FeedDto,
  ReconcileDto,
  SHADOW,
  VariancesQueryDto,
} from './shadow.dto';
import { ShadowService } from './shadow.service';

/** Sprint 16: the shadow run — legacy feed, dual posting, daily reconciliation, variance workbench. */
@ApiTags('shadow')
@ApiBearerAuth()
@Controller('shadow')
export class ShadowController {
  constructor(
    private readonly shadow: ShadowService,
    private readonly keys: ServiceKeysService,
  ) {}

  @Post('feeds')
  @ApiOperation({ summary: 'Feed legacy receipts or balances (staff upload)' })
  @RequirePermission(SHADOW.manage, {
    description: 'Feed legacy receipts, run the reconciliation, explain and resolve variances',
  })
  feed(@ReqCtx() ctx: RequestContext, @Body() body: FeedDto) {
    return this.shadow.feed(ctx, body);
  }

  @Post('feeds/ingest')
  @Public()
  @ApiOperation({
    summary: 'Machine feed from the legacy cron (X-Service-Key with scope shadow.feed)',
  })
  async ingest(@Body() body: FeedDto, @Headers('x-service-key') key?: string) {
    const lookup = await this.keys.authenticate(key, 'shadow.feed');
    const ctx = this.keys.machineContext(lookup.schoolId, lookup.name);
    return this.shadow.feed(ctx, body, { serviceKeyId: lookup.id });
  }

  @Get('feeds')
  @RequirePermission(SHADOW.view, { description: 'View the shadow run: feeds, runs and variances' })
  async feeds(@ReqCtx() ctx: RequestContext) {
    return { data: await this.shadow.feeds(ctx) };
  }

  @Post('reconcile')
  @ApiOperation({ summary: 'Run the reconciliation now for a window (default yesterday to today)' })
  @RequirePermission(SHADOW.manage)
  reconcile(@ReqCtx() ctx: RequestContext, @Body() body: ReconcileDto) {
    return this.shadow.reconcile(ctx, body.from, body.to);
  }

  @Get('runs')
  @RequirePermission(SHADOW.view)
  async runs(@ReqCtx() ctx: RequestContext) {
    return { data: await this.shadow.runs(ctx) };
  }

  @Get('variances')
  @RequirePermission(SHADOW.view)
  async variances(@ReqCtx() ctx: RequestContext, @Query() q: VariancesQueryDto) {
    const { rows, total } = await this.shadow.variances(ctx, q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Post('variances/:id')
  @ApiOperation({ summary: 'Explain or resolve a variance (or reopen it)' })
  @RequirePermission(SHADOW.manage)
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: DecideVarianceDto) {
    return this.shadow.decide(ctx, id, body);
  }
}

@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/service-keys')
export class ServiceKeysController {
  constructor(private readonly keys: ServiceKeysService) {}

  @Get()
  @RequirePermission(SHADOW.serviceKeys, { description: 'Issue and revoke machine service keys' })
  async list(@ReqCtx() ctx: RequestContext) {
    return { data: await this.keys.list(ctx) };
  }

  @Post()
  @ApiOperation({ summary: 'Issue a service key (returned once)' })
  @RequirePermission(SHADOW.serviceKeys)
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateServiceKeyDto) {
    return this.keys.create(ctx, body);
  }

  @Post(':id/revoke')
  @RequirePermission(SHADOW.serviceKeys)
  revoke(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.keys.revoke(ctx, id);
  }
}
