import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { LeaveOfficeService } from './leave-office.service';
import { LeaveService } from './leave.service';
import {
  AdjustDto,
  ApplyDto,
  BalanceImportDto,
  BalanceQueryDto,
  DecideDto,
  LEAVE_OFFICE,
  LEAVE_OWN,
  MineQueryDto,
  OnBehalfDto,
  OverrideDto,
  ReasonDto,
  RegisterQueryDto,
  TrimDto,
  WithdrawDto,
} from './leave.dto';

/** Staff leave (docs/design/85, phase B). */
@ApiTags('leave')
@ApiBearerAuth()
@Controller('leave')
export class LeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly office: LeaveOfficeService,
  ) {}

  @Get('mine')
  @ApiOperation({ summary: 'My balances, the types I may apply for, my leave, what waits for me' })
  @AuthenticatedOnly()
  mine(@ReqCtx() ctx: RequestContext, @Query() q: MineQueryDto) {
    return this.leave.mine(ctx, q);
  }

  @Post('apply')
  @ApiOperation({
    summary: 'Apply for my leave (may answer with a question: the sandwich, the split)',
  })
  @RequirePermission(LEAVE_OWN)
  apply(@ReqCtx() ctx: RequestContext, @Body() body: ApplyDto) {
    return this.leave.apply(ctx, body);
  }

  @Post('on-behalf')
  @ApiOperation({ summary: 'The office enters leave for an employee: approved at once' })
  @RequirePermission(LEAVE_OFFICE)
  onBehalf(@ReqCtx() ctx: RequestContext, @Body() body: OnBehalfDto) {
    return this.leave.onBehalf(ctx, body);
  }

  @Get('approvals')
  @ApiOperation({ summary: 'Leave and cancellations waiting for my decision (or decided by me)' })
  @AuthenticatedOnly()
  approvals(@ReqCtx() ctx: RequestContext, @Query('view') view: string | undefined) {
    return this.leave.approvals(ctx, view === 'decided' ? 'decided' : 'waiting');
  }

  @Get('register')
  @ApiOperation({
    summary: 'The leave register: nine figures, filters, a page at a time; Excel / PDF',
  })
  @RequirePermission(LEAVE_OFFICE)
  register(@ReqCtx() ctx: RequestContext, @Query() q: RegisterQueryDto) {
    return q.format ? this.office.registerFile(ctx, q) : this.office.register(ctx, q);
  }

  @Get('balances')
  @RequirePermission(LEAVE_OFFICE)
  balances(@ReqCtx() ctx: RequestContext, @Query() q: BalanceQueryDto) {
    return this.office.balances(ctx, q);
  }

  @Post('balances/adjust')
  @RequirePermission(LEAVE_OFFICE)
  adjust(@ReqCtx() ctx: RequestContext, @Body() body: AdjustDto) {
    return this.office.adjust(ctx, body);
  }

  @Get('balances/format')
  @RequirePermission(LEAVE_OFFICE)
  balanceFormat(@ReqCtx() ctx: RequestContext) {
    return this.office.balanceFormat(ctx);
  }

  @Post('balances/import')
  @RequirePermission(LEAVE_OFFICE)
  balanceImport(@ReqCtx() ctx: RequestContext, @Body() body: BalanceImportDto) {
    return this.office.balanceImport(ctx, body);
  }

  @Post('balances/run-month')
  @ApiOperation({ summary: 'Close past months, open this month and credit it now' })
  @RequirePermission(LEAVE_OFFICE)
  runMonth(@ReqCtx() ctx: RequestContext) {
    return this.office.runMonth(ctx);
  }

  @Get('requests/:id')
  @AuthenticatedOnly()
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.leave.get(ctx, id);
  }

  @Post('requests/:id/decide')
  @AuthenticatedOnly()
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: DecideDto) {
    return this.leave.decide(ctx, id, body);
  }

  @Post('requests/:id/withdraw')
  @AuthenticatedOnly()
  withdraw(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: WithdrawDto) {
    return this.leave.withdraw(ctx, id, body);
  }

  @Post('requests/:id/cancel')
  @RequirePermission(LEAVE_OFFICE)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.leave.cancel(ctx, id, body);
  }

  @Post('requests/:id/cancel-request')
  @AuthenticatedOnly()
  requestCancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.leave.requestCancel(ctx, id, body);
  }

  @Post('requests/:id/cancel-decide')
  @AuthenticatedOnly()
  decideCancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: DecideDto) {
    return this.leave.decideCancel(ctx, id, body);
  }

  @Post('requests/:id/override')
  @RequirePermission(LEAVE_OFFICE)
  override(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: OverrideDto) {
    return this.leave.override(ctx, id, body);
  }

  @Post('requests/:id/trim')
  @RequirePermission(LEAVE_OFFICE)
  trim(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: TrimDto) {
    return this.leave.trim(ctx, id, body);
  }
}
