import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthenticatedOnly, Public } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { WebHopService } from './web-hop.service';

const WebHopSchema = z.object({
  /** the family website's page: a path (e.g. / or /fees) */
  to: z.string().trim().min(1).max(500).default('/'),
});
class WebHopDto extends createZodDto(WebHopSchema) {}
const WebHopRedeemSchema = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{40,100}$/) });
class WebHopRedeemDto extends createZodDto(WebHopRedeemSchema) {}

/** The staff website's My children: open the family website signed in (0424). */
@ApiTags('identity')
@Controller('auth/web-hop')
export class WebHopController {
  constructor(private readonly hop: WebHopService) {}

  @Post()
  @AuthenticatedOnly()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Staff website: a one-time link (60 s) that opens the family website signed in, for a staff member who is also a parent in the school',
  })
  issue(@ReqCtx() ctx: RequestContext, @Body() body: WebHopDto) {
    return this.hop.issue(ctx, body.to);
  }

  @Post('redeem')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'The family website turns the one-time link in for its session' })
  redeem(@Body() body: WebHopRedeemDto) {
    return this.hop.redeem(body.code);
  }
}
