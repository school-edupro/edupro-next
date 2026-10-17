import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { HOSTEL, HOSTEL_H3 } from './hostel.dto';
import {
  CheckoutDto,
  CheckoutItemsDto,
  DeclineExitDto,
  ExitRequestDto,
  ExitRequestsQueryDto,
  HOSTEL_WD,
} from './hostel-withdrawal.dto';
import { HostelExitService } from './hostel-exit.service';

const json = (f: { filename: string; contentType: string; bytes: Buffer }) => ({
  filename: f.filename,
  contentType: f.contentType,
  base64: f.bytes.toString('base64'),
});

/** Hostel withdrawal, part 4 (0163): the parent's request, the room check-out list, the clearance certificate. */
@ApiTags('hostel')
@ApiBearerAuth()
@Controller('hostel')
export class HostelExitController {
  constructor(private readonly exit: HostelExitService) {}

  // ---- the family ---------------------------------------------------------------------------------------
  @Get('mine/exit')
  @ApiOperation({ summary: "The child's requests to leave the hostel and hostel withdrawals" })
  @RequirePermission(HOSTEL_H3.family)
  familyList(@ReqCtx() ctx: RequestContext, @Query('studentId') studentId: string) {
    return this.exit.familyList(ctx, studentId);
  }

  @Post('mine/exit')
  @ApiOperation({ summary: 'A parent asks for the child to leave the hostel' })
  @RequirePermission(HOSTEL_H3.family)
  familyRequest(@ReqCtx() ctx: RequestContext, @Body() dto: ExitRequestDto) {
    return this.exit.familyRequest(ctx, dto);
  }

  @Post('mine/exit/:id/withdraw')
  @RequirePermission(HOSTEL_H3.family)
  familyWithdraw(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.exit.familyWithdraw(ctx, id);
  }

  @Get('mine/withdrawals/:id/certificate')
  @ApiOperation({ summary: "The family's copy of the hostel clearance certificate (PDF as JSON)" })
  @RequirePermission(HOSTEL_H3.family)
  async familyCertificate(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return json(await this.exit.familyCertificate(ctx, id));
  }

  // ---- the office -----------------------------------------------------------------------------------------
  @Get('exit-requests')
  @ApiOperation({ summary: "Parents' requests to take a child out of the hostel" })
  @RequirePermission(HOSTEL_WD.view)
  async requests(@ReqCtx() ctx: RequestContext, @Query() q: ExitRequestsQueryDto) {
    return { data: await this.exit.requests(ctx, q) };
  }

  @Post('exit-requests/:id/decline')
  @RequirePermission(HOSTEL_WD.manage)
  decline(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: DeclineExitDto) {
    return this.exit.decline(ctx, id, dto);
  }

  @Get('checkout-items')
  @RequirePermission(HOSTEL_WD.view)
  checkoutItems(@ReqCtx() ctx: RequestContext) {
    return this.exit.checkoutItems(ctx);
  }

  @Put('checkout-items')
  @ApiOperation({
    summary: "The school's room check-out items, each with the charge if missing or damaged",
  })
  @RequirePermission(HOSTEL.setup)
  saveCheckoutItems(@ReqCtx() ctx: RequestContext, @Body() dto: CheckoutItemsDto) {
    return this.exit.saveCheckoutItems(ctx, dto);
  }

  @Get('withdrawals/:id/checkout')
  @RequirePermission(HOSTEL_WD.view)
  checkout(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.exit.checkout(ctx, id);
  }

  @Put('withdrawals/:id/checkout')
  @ApiOperation({
    summary: 'Mark the room check-out; the total of missing or damaged items is the damage charge',
  })
  @RequirePermission(HOSTEL_WD.manage)
  saveCheckout(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CheckoutDto) {
    return this.exit.saveCheckout(ctx, id, dto);
  }

  @Get('withdrawals/:id/certificate')
  @ApiOperation({
    summary: 'The hostel clearance certificate of a completed withdrawal (PDF as JSON)',
  })
  @RequirePermission(HOSTEL_WD.view)
  async certificate(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return json(await this.exit.certificate(ctx, id));
  }
}
