import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../../common/auth/decorators';
import { DomainError } from '../../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../../common/http/request-context';
import { PEOPLE } from '../people.permissions';
import { ExitSetupService } from './exit-setup.service';
import {
  EMPLOYEE_TYPES,
  ExitApprovalDto,
  ExitCreateDto,
  ExitDecisionDto,
  ExitEditDto,
  ExitListDto,
  ExitSetupDto,
  ExitWithdrawDto,
  MyExitDto,
  type EmployeeType,
} from './exits.dto';
import { ExitsService } from './exits.service';

const typeOf = (t: string): EmployeeType => {
  if (!(EMPLOYEE_TYPES as readonly string[]).includes(t))
    throw new DomainError('not-found', 'Unknown employee type', { status: 404 });
  return t as EmployeeType;
};

/** Employee exit, part 5 (docs/design/38): set-up, the request and its approval. */
@ApiTags('people')
@ApiBearerAuth()
@Controller()
export class ExitsController {
  constructor(
    private readonly exits: ExitsService,
    private readonly setup: ExitSetupService,
  ) {}

  @Get('people/exits/setup')
  @ApiOperation({ summary: 'Exit types, notice period per employee type, clearance departments' })
  @RequirePermission(PEOPLE.exitView)
  getSetup(@ReqCtx() ctx: RequestContext) {
    return this.setup.get(ctx);
  }

  @Put('people/exits/setup')
  @RequirePermission(PEOPLE.exitManage)
  saveSetup(@ReqCtx() ctx: RequestContext, @Body() dto: ExitSetupDto) {
    return this.setup.save(ctx, dto);
  }

  @Get('people/exits/setup/approval/:type')
  @ApiOperation({ summary: 'Who approves the exit of an employee type, level by level' })
  @RequirePermission(PEOPLE.exitView)
  approval(@ReqCtx() ctx: RequestContext, @Param('type') type: string) {
    return this.setup.approval(ctx, typeOf(type));
  }

  @Put('people/exits/setup/approval/:type')
  @ApiOperation({
    summary: 'Set who approves; the exits of that type waiting move to the new people',
  })
  @RequirePermission(PEOPLE.exitManage)
  saveApproval(
    @ReqCtx() ctx: RequestContext,
    @Param('type') type: string,
    @Body() dto: ExitApprovalDto,
  ) {
    return this.setup.saveApproval(ctx, typeOf(type), dto);
  }

  @Get('people/exits')
  @RequirePermission(PEOPLE.exitView)
  list(@ReqCtx() ctx: RequestContext, @Query() q: ExitListDto) {
    return this.exits.list(ctx, q);
  }

  @Post('people/exits')
  @ApiOperation({ summary: 'Record an exit on an employee’s behalf (any type); goes for approval' })
  @RequirePermission(PEOPLE.exitManage)
  create(@ReqCtx() ctx: RequestContext, @Body() dto: ExitCreateDto) {
    return this.exits.create(ctx, dto);
  }

  @Get('people/exits/to-approve')
  @ApiOperation({ summary: 'Exits waiting at my approval level' })
  // anybody may sit at a level: empty for those who do not
  @AuthenticatedOnly()
  toApprove(@ReqCtx() ctx: RequestContext) {
    return this.exits.toApprove(ctx);
  }

  @Get('people/exits/:id')
  @ApiOperation({ summary: 'One exit: its timeline, approval steps and what I may do' })
  // the office, the employee, or an approver (checked in the service)
  @AuthenticatedOnly()
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.exits.get(ctx, id);
  }

  @Get('people/exits/:id/letter')
  @ApiOperation({ summary: 'A signed link to the exit’s letter' })
  // the office, the employee, or an approver (checked in the service)
  @AuthenticatedOnly()
  letter(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.exits.letter(ctx, id);
  }

  @Post('people/exits/:id/approve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve the exit waiting with me (may set the last day, waive notice)',
  })
  @AuthenticatedOnly()
  approve(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ExitDecisionDto) {
    return this.exits.decide(ctx, id, 'approve', dto);
  }

  @Post('people/exits/:id/send-back')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send the exit back with a remark, to be changed and sent again' })
  @AuthenticatedOnly()
  sendBack(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ExitDecisionDto) {
    return this.exits.decide(ctx, id, 'send_back', dto);
  }

  @Post('people/exits/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject the exit waiting with me, with the reason' })
  @AuthenticatedOnly()
  reject(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ExitDecisionDto) {
    return this.exits.decide(ctx, id, 'reject', dto);
  }

  @Post('people/exits/:id/withdraw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw a request not yet accepted (the employee or the office)' })
  @AuthenticatedOnly()
  withdraw(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ExitWithdrawDto) {
    return this.exits.withdraw(ctx, id, dto.reason);
  }

  @Post('people/exits/:id/resubmit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change a request sent back and send it again' })
  @AuthenticatedOnly()
  resubmit(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ExitEditDto) {
    return this.exits.resubmit(ctx, id, dto);
  }

  @Get('me/exits')
  @ApiOperation({
    summary: 'My resignation (and earlier exits), the types I may ask for, my notice',
  })
  @AuthenticatedOnly()
  mine(@ReqCtx() ctx: RequestContext) {
    return this.exits.mine(ctx);
  }

  @Post('me/exits')
  @ApiOperation({ summary: 'Ask for my resignation; it goes for approval' })
  @AuthenticatedOnly()
  applyMine(@ReqCtx() ctx: RequestContext, @Body() dto: MyExitDto) {
    return this.exits.applyMine(ctx, dto);
  }
}
