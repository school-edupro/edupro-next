import { randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { Public } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  ApiDecideDto,
  ApiKeyDto,
  ApiListQueryDto,
  CONSENT,
  WebhookDto,
  WebhookPatchDto,
} from './consent-forms.dto';
import { ConsentIntegrationsService } from './consent-integrations.service';

/** Webhooks and API keys of a consent form (school admin; docs/design/28-consent-forms.md part 4). */
@ApiTags('engagement')
@ApiBearerAuth()
@Controller('engagement/consent-forms/:id/integrations')
export class ConsentIntegrationsController {
  constructor(private readonly svc: ConsentIntegrationsService) {}

  @Get()
  @RequirePermission(CONSENT.integrate, {
    description: 'Connect consent forms to other systems (webhooks and API keys)',
  })
  overview(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.overview(ctx, id);
  }

  @Post('webhooks')
  @ApiOperation({ summary: 'A new webhook; its signing secret is returned this once' })
  @RequirePermission(CONSENT.integrate)
  addWebhook(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: WebhookDto) {
    return this.svc.addWebhook(ctx, id, body);
  }

  @Patch('webhooks/:hookId')
  @RequirePermission(CONSENT.integrate)
  updateWebhook(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('hookId') hookId: string,
    @Body() body: WebhookPatchDto,
  ) {
    return this.svc.updateWebhook(ctx, id, hookId, body);
  }

  @Post('webhooks/:hookId/secret')
  @RequirePermission(CONSENT.integrate)
  rotate(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('hookId') hookId: string) {
    return this.svc.rotateSecret(ctx, id, hookId);
  }

  @Post('webhooks/:hookId/test')
  @RequirePermission(CONSENT.integrate)
  test(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('hookId') hookId: string) {
    return this.svc.test(ctx, id, hookId);
  }

  @Delete('webhooks/:hookId')
  @RequirePermission(CONSENT.integrate)
  remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('hookId') hookId: string) {
    return this.svc.removeWebhook(ctx, id, hookId);
  }

  @Post('deliveries/:deliveryId/retry')
  @RequirePermission(CONSENT.integrate)
  retry(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.svc.redeliver(ctx, id, deliveryId);
  }

  @Post('keys')
  @ApiOperation({ summary: 'A new API key for the form; the key is returned this once' })
  @RequirePermission(CONSENT.integrate)
  addKey(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ApiKeyDto) {
    return this.svc.addKey(ctx, id, body);
  }

  @Delete('keys/:keyId')
  @RequirePermission(CONSENT.integrate)
  revoke(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('keyId') keyId: string) {
    return this.svc.revokeKey(ctx, id, keyId);
  }
}

/**
 * The consent form API for other systems (an API key per form, `Authorization: Bearer cfk_…`): read the
 * answers, one by number, and with the wider scope approve or reject. 60 calls a minute per key.
 */
@ApiTags('consent-api')
@Controller('consent-api/v1')
export class ConsentApiController {
  constructor(private readonly svc: ConsentIntegrationsService) {}

  @Get('responses')
  @Public()
  @ApiOperation({
    summary: 'The answers of the key’s form, newest first (since a time, page by page)',
  })
  async list(@Headers('authorization') auth: string | undefined, @Query() q: ApiListQueryDto) {
    return this.svc.apiList(await this.svc.caller(auth), q);
  }

  @Get('responses/:ref')
  @Public()
  async one(@Headers('authorization') auth: string | undefined, @Param('ref') ref: string) {
    return this.svc.apiOne(await this.svc.caller(auth), decodeURIComponent(ref));
  }

  @Post('responses/:ref/decision')
  @Public()
  @ApiOperation({
    summary: 'Approve or reject an answer waiting for approval (scope read_approve)',
  })
  async decide(
    @Headers('authorization') auth: string | undefined,
    @Param('ref') ref: string,
    @Body() body: ApiDecideDto,
  ) {
    return this.svc.apiDecide(
      await this.svc.caller(auth),
      decodeURIComponent(ref),
      body,
      randomUUID(),
    );
  }
}
