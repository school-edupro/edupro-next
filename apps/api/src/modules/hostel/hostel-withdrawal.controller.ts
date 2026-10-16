import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  BypassDto,
  CancelDto,
  ClearanceDto,
  SaveDepartmentsDto,
} from '../people/lifecycle/lifecycle.dto';
import { WithdrawalsService } from '../people/lifecycle/withdrawals.service';
import {
  HOSTEL_WD,
  HostelWithdrawalSettingsDto,
  HostelWithdrawalsFileDto,
  ListHostelWithdrawalsDto,
  StartHostelWithdrawalDto,
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

  @Post('withdrawals/:id/clearances/:department')
  @ApiOperation({ summary: 'Clear, hold or reopen a step; a charge becomes a misc fee' })
  @RequirePermission(HOSTEL_WD.clear, { description: 'Clear a hostel withdrawal for a department' })
  clear(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('department') department: string,
    @Body() body: ClearanceDto,
  ) {
    return this.hw.clearance(ctx, id, department, body);
  }

  @Post('withdrawals/:id/clearances/:department/bypass')
  @RequirePermission(HOSTEL_WD.clear)
  bypass(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('department') department: string,
    @Body() body: BypassDto,
  ) {
    return this.hw.bypass(ctx, id, department, body);
  }

  @Post('withdrawals/:id/complete')
  @ApiOperation({ summary: 'Vacate the bed and settle the hostel fee' })
  @RequirePermission(HOSTEL_WD.manage)
  complete(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.hw.complete(ctx, id);
  }

  @Post('withdrawals/:id/cancel')
  @RequirePermission(HOSTEL_WD.manage)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: CancelDto) {
    return this.hw.cancel(ctx, id, body.reason);
  }
}
