import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthenticatedOnly, Public } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { WebHopService } from './web-hop.service';

const HopApp = z.enum(['parent', 'teacher', 'admin']);
const WebHopSchema = z.object({
  /** the website to open: the family website (My children), or back to the staff or admin website */
  app: HopApp.default('parent'),
  /** the website asking, for the family website's way back */
  from: z.enum(['teacher', 'admin']).optional(),
  /** the page there: a path (e.g. / or /fees) */
  to: z.string().trim().min(1).max(500).default('/'),
});
class WebHopDto extends createZodDto(WebHopSchema) {}
const WebHopRedeemSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{40,100}$/),
  /** the website turning it in */
  app: HopApp.default('parent'),
});
class WebHopRedeemDto extends createZodDto(WebHopRedeemSchema) {}

/** My children on the staff and admin websites, and the family website's way back (0424, 0425). */
@ApiTags('identity')
@Controller('auth/web-hop')
export class WebHopController {
  constructor(private readonly hop: WebHopService) {}

  @Post()
  @AuthenticatedOnly()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'A one-time link (60 s) that opens another website signed in: the family website for a staff member who is also a parent (from the staff or admin website), or back from a family session opened that way',
  })
  issue(@ReqCtx() ctx: RequestContext, @Body() body: WebHopDto) {
    return this.hop.issue(ctx, body.app, body.from, body.to);
  }

  @Post('redeem')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'The website opened turns the one-time link in for its session' })
  redeem(@Body() body: WebHopRedeemDto) {
    return this.hop.redeem(body.code, body.app);
  }
}
