import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { GATEWAY_FIELDS, GatewaysService } from './gateways.service';
import { GatewayRoutesDto, SaveGatewayDto } from './payments.dto';

const MANAGE = 'payments.gateway.manage';

/**
 * Fees -> Payment gateways (0142): the school admin sets up the school's gateway accounts with their test or
 * live keys (stored encrypted, never shown again) and which fee each takes. A fresh strong sign-in is asked.
 */
@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments/gateways')
export class GatewaysController {
  constructor(private readonly gateways: GatewaysService) {}

  @Get()
  @ApiOperation({
    summary: "The school's gateway accounts (keys never shown) and the fields each gateway asks",
  })
  @RequirePermission(MANAGE, {
    description: 'Set up payment gateways, their keys and the fees they take',
    mfa: true,
  })
  async list(@ReqCtx() ctx: RequestContext) {
    // the test gateway is offered only off the live system
    const fields =
      process.env.NODE_ENV === 'production'
        ? Object.fromEntries(Object.entries(GATEWAY_FIELDS).filter(([k]) => k !== 'mock'))
        : GATEWAY_FIELDS;
    return { data: await this.gateways.list(ctx), fields };
  }

  @Put()
  @ApiOperation({ summary: 'Add or change a gateway account (an empty key keeps the saved one)' })
  @RequirePermission(MANAGE, { mfa: true })
  async save(@ReqCtx() ctx: RequestContext, @Body() body: SaveGatewayDto) {
    return { data: await this.gateways.save(ctx, body) };
  }

  @Put('routes')
  @ApiOperation({
    summary: 'Which gateways take school, hostel, misc and admission fees, in order',
  })
  @RequirePermission(MANAGE, { mfa: true })
  async routes(@ReqCtx() ctx: RequestContext, @Body() body: GatewayRoutesDto) {
    return { data: await this.gateways.setRoutes(ctx, body) };
  }
}
