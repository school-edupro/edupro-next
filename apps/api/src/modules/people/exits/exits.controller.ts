import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../../common/auth/decorators';
import { DomainError } from '../../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../../common/http/request-context';
import { PEOPLE } from '../people.permissions';
import { ExitClearanceService } from './exit-clearance.service';
import { ExitSetupService } from './exit-setup.service';
import { ExitSettleService, type LetterKind } from './exit-settle.service';
import {
  EMPLOYEE_TYPES,
  ClearDto,
  CloseDto,
  ExitApprovalDto,
  ExitCreateDto,
  ExitDecisionDto,
  ExitEditDto,
  ExitListDto,
  ExitSetupDto,
  ExitWithdrawDto,
  FnfDecisionDto,
  FnfLinesDto,
  FnfPaidDto,
  RegisterDto,
  MyExitDto,
  ReopenDto,
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
    private readonly clearance: ExitClearanceService,
    private readonly settle: ExitSettleService,
  ) {}

  private static send(
    reply: FastifyReply,
    file: { filename: string; bytes: Buffer },
    type: string,
    inline: boolean,
  ) {
    void reply
      .header('content-type', type)
      .header(
        'content-disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${file.filename.replace(/[^\w.\- ]+/g, '_')}"`,
      )
      .header('cache-control', 'private, no-store')
      .send(file.bytes);
  }

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

  @Get('people/exits/clearance')
  @ApiOperation({ summary: 'The no-dues board: accepted exits and their departments' })
  @RequirePermission(PEOPLE.exitView)
  board(@ReqCtx() ctx: RequestContext) {
    return this.clearance.board(ctx, { mine: false });
  }

  @Get('people/exits/clearance/mine')
  @ApiOperation({ summary: 'Exits with a department waiting for my clearance' })
  // anybody may clear a department (the HOD, the librarian): empty for those who do not
  @AuthenticatedOnly()
  myBoard(@ReqCtx() ctx: RequestContext) {
    return this.clearance.board(ctx, { mine: true });
  }

  @Post('people/exits/:id/clearance/:department')
  @HttpCode(200)
  @ApiOperation({ summary: 'Clear the exit for a department, noting any dues' })
  // the department's approvers (checked in the service)
  @AuthenticatedOnly()
  clear(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('department') department: string,
    @Body() dto: ClearDto,
  ) {
    return this.clearance.clear(ctx, id, department, dto);
  }

  @Post('people/exits/:id/clearance/:department/reopen')
  @HttpCode(200)
  @ApiOperation({ summary: 'Open a department’s clearance again (the office)' })
  @RequirePermission(PEOPLE.exitManage)
  reopen(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('department') department: string,
    @Body() dto: ReopenDto,
  ) {
    return this.clearance.reopen(ctx, id, department, dto.reason);
  }

  @Get('people/exits/register')
  @ApiOperation({ summary: 'The exit register: who left or is leaving, with the settlement' })
  @RequirePermission(PEOPLE.exitView)
  register(@ReqCtx() ctx: RequestContext, @Query() q: RegisterDto) {
    return this.settle.register(ctx, q);
  }

  @Get('people/exits/register.xlsx')
  @RequirePermission(PEOPLE.exitView)
  async registerFile(
    @ReqCtx() ctx: RequestContext,
    @Query() q: RegisterDto,
    @Res() reply: FastifyReply,
  ) {
    ExitsController.send(
      reply,
      await this.settle.registerFile(ctx, q),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      false,
    );
  }

  @Get('people/exits/:id/fnf')
  @ApiOperation({
    summary: 'The full and final statement (made for accounts once the exit is accepted)',
  })
  // the office, accounts, the employee, an approver (checked in the service)
  @AuthenticatedOnly()
  fnf(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.settle.fnf(ctx, id);
  }

  @Put('people/exits/:id/fnf')
  @ApiOperation({ summary: 'Save the earnings and deductions of the statement (a draft)' })
  @RequirePermission(PEOPLE.exitFnf)
  saveFnf(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: FnfLinesDto) {
    return this.settle.saveLines(ctx, id, dto);
  }

  @Post('people/exits/:id/fnf/submit')
  @HttpCode(200)
  @RequirePermission(PEOPLE.exitFnf)
  submitFnf(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.settle.submit(ctx, id);
  }

  @Post('people/exits/:id/fnf/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve the statement (the approvers set up)' })
  @AuthenticatedOnly()
  approveFnf(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: FnfDecisionDto) {
    return this.settle.decide(ctx, id, 'approve', dto);
  }

  @Post('people/exits/:id/fnf/return')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send the statement back to accounts with a remark' })
  @AuthenticatedOnly()
  returnFnf(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: FnfDecisionDto) {
    return this.settle.decide(ctx, id, 'reject', dto);
  }

  @Post('people/exits/:id/fnf/paid')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark the approved statement paid (or recovered)' })
  @RequirePermission(PEOPLE.exitFnf)
  paidFnf(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: FnfPaidDto) {
    return this.settle.paid(ctx, id, dto);
  }

  @Get('people/exits/:id/fnf.pdf')
  @AuthenticatedOnly()
  async fnfFile(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    ExitsController.send(
      reply,
      await this.settle.fnfFile(ctx, id),
      'application/pdf',
      save !== '1',
    );
  }

  @Get('people/exits/:id/letters/:kind.pdf')
  @ApiOperation({
    summary: 'Acceptance of resignation, relieving letter or experience certificate',
  })
  @AuthenticatedOnly()
  async letterFile(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    if (!['acceptance', 'relieving', 'experience'].includes(kind))
      throw new DomainError('not-found', 'No such letter', { status: 404 });
    ExitsController.send(
      reply,
      await this.settle.letter(ctx, id, kind as LetterKind),
      'application/pdf',
      save !== '1',
    );
  }

  @Get('people/exits/:id/close')
  @ApiOperation({ summary: 'What closing the exit still needs' })
  @AuthenticatedOnly()
  closeCheck(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.settle.closeCheck(ctx, id);
  }

  @Post('people/exits/:id/close')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Close the exit: inactive with the leaving date, sign-ins stopped, assignments ended',
  })
  @RequirePermission(PEOPLE.exitManage)
  close(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CloseDto) {
    return this.settle.close(ctx, id, dto);
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
