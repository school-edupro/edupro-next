import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { CancelDto, SaveDepartmentsDto } from '../people/lifecycle/lifecycle.dto';
import { WithdrawalsService } from '../people/lifecycle/withdrawals.service';
import {
  CompleteHostelWithdrawalDto,
  DecideHostelWithdrawalDto,
  HOSTEL_WD,
  HostelWithdrawalSettingsDto,
  HostelWithdrawalsFileDto,
  ListHostelWithdrawalsDto,
  StartHostelWithdrawalDto,
  DecideRevokeDto,
  RevokeHostelWithdrawalDto,
} from './hostel-withdrawal.dto';
import { HostelWithdrawalsService } from './hostel-withdrawals.service';
import { HOSTEL } from './hostel.dto';

/** Hostel withdrawal (docs/design/27-hostel-withdrawal.md): leaving the hostel, staying in school. */
@ApiTags('hostel')
@ApiBearerAuth()
@Controller('hostel')
export class HostelWithdrawalController {
  constructor(
    private readonly hw: HostelWithdrawalsService,
    private readonly withdrawals: WithdrawalsService,
  ) {}

  @Get('withdrawals/file')
  @ApiOperation({ summary: 'The hostel withdrawal register as filtered, as Excel or PDF' })
  @RequirePermission(HOSTEL_WD.view)
  async file(@ReqCtx() ctx: RequestContext, @Query() q: HostelWithdrawalsFileDto) {
    const { format, ...filters } = q;
    const f = await this.hw.listFile(ctx, filters, format);
    return { filename: f.filename, contentType: f.contentType, base64: f.bytes.toString('base64') };
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'Hostel withdrawals with their steps' })
  @RequirePermission(HOSTEL_WD.view, { description: 'See hostel withdrawals and their register' })
  async list(@ReqCtx() ctx: RequestContext, @Query() q: ListHostelWithdrawalsDto) {
    const { rows, total } = await this.hw.list(ctx, q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Get('withdrawal-settings')
  @ApiOperation({ summary: 'Hostel withdrawal steps, approvers and the notice period' })
  @RequirePermission(HOSTEL.setup)
  settings(@ReqCtx() ctx: RequestContext) {
    return this.hw.settings(ctx);
  }

  @Put('withdrawal-settings/departments')
  @ApiOperation({ summary: 'Save the hostel withdrawal steps (left-out codes are switched off)' })
  @RequirePermission(HOSTEL.setup)
  saveDepartments(@ReqCtx() ctx: RequestContext, @Body() body: SaveDepartmentsDto) {
    return this.withdrawals.saveDepartments(ctx, body, 'hostel');
  }

  @Put('withdrawal-settings/notice')
  @ApiOperation({ summary: 'Notice period and whether a short notice keeps the next month' })
  @RequirePermission(HOSTEL.setup)
  saveNotice(@ReqCtx() ctx: RequestContext, @Body() body: HostelWithdrawalSettingsDto) {
    return this.hw.saveSettings(ctx, body);
  }

  @Get('students/:id/withdrawals')
  @ApiOperation({ summary: "A pupil's hostel withdrawals" })
  @RequirePermission(HOSTEL_WD.view)
  forStudent(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.hw.forStudent(ctx, id);
  }

  @Post('students/:id/withdrawal')
  @ApiOperation({
    summary: 'Start a hostel withdrawal (the pupil leaves the hostel, stays in school)',
  })
  @RequirePermission(HOSTEL_WD.manage, {
    description: 'Start, complete and cancel hostel withdrawals; set their steps',
  })
  start(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: StartHostelWithdrawalDto,
  ) {
    return this.hw.start(ctx, id, body);
  }

  @Get('withdrawals/:id')
  @RequirePermission(HOSTEL_WD.view)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.hw.get(ctx, id);
  }

  @Post('withdrawals/:id/decide')
  @ApiOperation({
    summary:
      'The approver of the current level approves or rejects (the last one picks carry or refund)',
  })
  @AuthenticatedOnly()
  decide(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: DecideHostelWithdrawalDto,
  ) {
    return this.hw.decide(ctx, id, body);
  }

  @Post('withdrawals/:id/revoke')
  @ApiOperation({
    summary:
      'Ask to revoke a completed hostel withdrawal (as if never left, or back from a day); it goes through the same approval levels',
  })
  @RequirePermission(HOSTEL_WD.manage)
  revoke(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: RevokeHostelWithdrawalDto,
  ) {
    return this.hw.requestRevoke(ctx, id, dto);
  }

  @Post('withdrawals/:id/revoke/decide')
  @ApiOperation({ summary: "The approver of the revoke's current level approves or rejects" })
  @AuthenticatedOnly()
  decideRevoke(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: DecideRevokeDto,
  ) {
    return this.hw.decideRevoke(ctx, id, dto);
  }

  @Get('withdrawal-approval')
  @ApiOperation({ summary: 'Makes sure the hostel withdrawal approval levels exist' })
  @RequirePermission('workflow.definition.view')
  approval(@ReqCtx() ctx: RequestContext) {
    return this.hw.approvalFlow(ctx);
  }

  @Post('withdrawals/:id/complete')
  @ApiOperation({
    summary: 'With the approval levels switched off: vacate the bed and settle the hostel fee',
  })
  @RequirePermission(HOSTEL_WD.manage)
  complete(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: CompleteHostelWithdrawalDto,
  ) {
    return this.hw.complete(ctx, id, body.feeChoice);
  }

  @Post('withdrawals/:id/cancel')
  @RequirePermission(HOSTEL_WD.manage)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: CancelDto) {
    return this.hw.cancel(ctx, id, body.reason);
  }
}
