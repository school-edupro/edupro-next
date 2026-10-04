import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  ExportPassesDto,
  GATE as P,
  GateFindPassDto,
  GateInDto,
  GateOutDto,
  GatePassSetupDto,
  HandoverDto,
  ListPassesDto,
  MyPassesDto,
  PassCancelDto,
  PassDecideDto,
  StaffPassDto,
  StudentPassDto,
} from './gatepass.dto';
import { GatePassService } from './gatepass.service';

const pdf = (reply: FastifyReply, out: { bytes: Buffer; filename: string }) =>
  void reply
    .header('content-type', 'application/pdf')
    .header('content-disposition', `attachment; filename="${out.filename}"`)
    .send(out.bytes);

/**
 * Gate pass v2 (0069): pupil passes (family or front desk → approval levels → hand-over at the front desk
 * → gate) and staff passes (RGP / NRGP with items → approval levels → gate out and in).
 */
@ApiTags('gate-passes')
@ApiBearerAuth()
@Controller('gate-passes')
export class GatePassController {
  constructor(private readonly svc: GatePassService) {}

  // ---- the family ------------------------------------------------------------------------------------
  @Get('mine')
  @RequirePermission(P.family)
  @ApiOperation({ summary: "My children's gate passes, latest first (or between two days)" })
  mine(@ReqCtx() ctx: RequestContext, @Query() q: MyPassesDto) {
    return this.svc.familyList(ctx, q);
  }

  @Get('mine/options')
  @RequirePermission(P.family)
  @ApiOperation({ summary: 'My children with the guardians on record (who takes the child)' })
  mineOptions(@ReqCtx() ctx: RequestContext) {
    return this.svc.familyOptions(ctx);
  }

  @Post('mine')
  @RequirePermission(P.family)
  @ApiOperation({ summary: 'A parent asks for a gate pass' })
  mineApply(@ReqCtx() ctx: RequestContext, @Body() dto: StudentPassDto) {
    return this.svc.familyApply(ctx, dto);
  }

  @Get('mine/:id')
  @RequirePermission(P.family)
  mineGet(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.familyGet(ctx, id);
  }

  @Get('mine/:id/card.pdf')
  @RequirePermission(P.family)
  async mineCard(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    pdf(reply, await this.svc.familyCard(ctx, id));
  }

  @Get('mine/:id/card')
  @RequirePermission(P.family)
  @ApiOperation({ summary: 'The pass card as base64 (for the portal, which speaks JSON)' })
  async mineCardJson(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    const out = await this.svc.familyCard(ctx, id);
    return { filename: out.filename, base64: out.bytes.toString('base64') };
  }

  @Get('staff/:id/card')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'My own pass card as base64 (teacher app)' })
  async staffCardJson(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    const out = await this.svc.cardFor(ctx, id);
    return { filename: out.filename, base64: out.bytes.toString('base64') };
  }

  @Post('mine/:id/cancel')
  @HttpCode(200)
  @RequirePermission(P.family)
  mineCancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: PassCancelDto) {
    return this.svc.familyCancel(ctx, id, dto);
  }

  // ---- an employee's own passes ----------------------------------------------------------------------
  @Get('staff')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'My own RGP / NRGP passes' })
  staff(@ReqCtx() ctx: RequestContext, @Query() q: MyPassesDto) {
    return this.svc.staffList(ctx, q);
  }

  @Post('staff')
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'An employee asks for a gate pass (RGP / NRGP) with the items carried out',
  })
  staffApply(@ReqCtx() ctx: RequestContext, @Body() dto: StaffPassDto) {
    return this.svc.staffApply(ctx, dto);
  }

  @Post('staff/:id/cancel')
  @HttpCode(200)
  @AuthenticatedOnly()
  staffCancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: PassCancelDto) {
    return this.svc.staffCancel(ctx, id, dto);
  }

  // ---- approvers -------------------------------------------------------------------------------------
  @Get('inbox')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Gate passes waiting for my approval, and the ones I decided lately' })
  inbox(@ReqCtx() ctx: RequestContext) {
    return this.svc.inbox(ctx);
  }

  @Post(':id/decide')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Approve or reject at my level (only when the pass waits on me)' })
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: PassDecideDto) {
    return this.svc.decide(ctx, id, dto);
  }

  // ---- set-up ----------------------------------------------------------------------------------------
  @Get('setup')
  @RequirePermission(P.setup, { description: 'Gate pass set-up: approval levels and rules' })
  setup(@ReqCtx() ctx: RequestContext) {
    return this.svc.setup(ctx);
  }

  @Put('setup')
  @RequirePermission(P.setup)
  saveSetup(@ReqCtx() ctx: RequestContext, @Body() dto: GatePassSetupDto) {
    return this.svc.saveSetup(ctx, dto);
  }

  // ---- the front desk --------------------------------------------------------------------------------
  @Get()
  @RequirePermission(P.view)
  @ApiOperation({ summary: 'The gate pass register with where each approval stands' })
  list(@ReqCtx() ctx: RequestContext, @Query() q: ListPassesDto) {
    return this.svc.list(ctx, q);
  }

  @Get('report.xlsx')
  @RequirePermission(P.view)
  async excel(
    @ReqCtx() ctx: RequestContext,
    @Query() q: ExportPassesDto,
    @Res() reply: FastifyReply,
  ) {
    const { bytes, filename } = await this.svc.excel(ctx, q);
    void reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(bytes);
  }

  @Get('dashboard')
  @RequirePermission(P.view)
  dashboard(@ReqCtx() ctx: RequestContext) {
    return this.svc.dashboard(ctx);
  }

  @Post()
  @RequirePermission(P.issue)
  @ApiOperation({ summary: 'The front desk makes a pupil pass; it is approved like any other' })
  deskCreate(@ReqCtx() ctx: RequestContext, @Body() dto: StudentPassDto) {
    return this.svc.deskCreate(ctx, dto);
  }

  @Get('students')
  @RequirePermission(P.issue)
  @ApiOperation({ summary: 'Pupils by name or admission number, to make a pass at the desk' })
  students(@ReqCtx() ctx: RequestContext, @Query('q') q?: string) {
    return this.svc.deskStudents(ctx, (q ?? '').slice(0, 80));
  }

  @Get('guardians/:studentId')
  @RequirePermission(P.issue)
  guardians(@ReqCtx() ctx: RequestContext, @Param('studentId') studentId: string) {
    return this.svc.deskGuardians(ctx, studentId);
  }

  @Post(':id/otp')
  @HttpCode(200)
  @RequirePermission(P.handover, {
    description: 'Hand a pupil over at the front desk against an approved gate pass',
  })
  @ApiOperation({ summary: 'Send the one-time code to the parent (an outsider collects)' })
  otp(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.sendOtp(ctx, id);
  }

  @Post(':id/handover')
  @HttpCode(200)
  @RequirePermission(P.handover)
  handover(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: HandoverDto) {
    return this.svc.handover(ctx, id, dto);
  }

  // ---- the gate --------------------------------------------------------------------------------------
  @Get('gate/board')
  @RequirePermission(P.gate, { description: 'Let gate pass holders out and back in at the gate' })
  gateBoard(@ReqCtx() ctx: RequestContext) {
    return this.svc.gateBoard(ctx);
  }

  @Post('gate/find')
  @HttpCode(200)
  @RequirePermission(P.gate)
  gateFind(@ReqCtx() ctx: RequestContext, @Body() dto: GateFindPassDto) {
    return this.svc.gateFind(ctx, dto.code);
  }

  @Post(':id/out')
  @HttpCode(200)
  @RequirePermission(P.gate)
  gateOut(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: GateOutDto) {
    return this.svc.gateOut(ctx, id, dto);
  }

  @Post(':id/in')
  @HttpCode(200)
  @RequirePermission(P.gate)
  gateIn(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: GateInDto) {
    return this.svc.gateIn(ctx, id, dto);
  }

  // ---- one pass (the service checks who may see it) --------------------------------------------------
  @Get(':id')
  @AuthenticatedOnly()
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }

  @Get(':id/card.pdf')
  @AuthenticatedOnly()
  async card(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Res() reply: FastifyReply) {
    pdf(reply, await this.svc.cardFor(ctx, id));
  }

  @Get(':id/photo/collector')
  @AuthenticatedOnly()
  async collector(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const { contentType, bytes } = await this.svc.collectorPhoto(ctx, id);
    void reply
      .header('content-type', contentType)
      .header('cache-control', 'private, max-age=300')
      .send(bytes);
  }

  @Get(':id/photo/:party')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'A photo on the pupil’s record (student, father, mother, guardian)' })
  recordPhoto(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('party') party: string,
  ) {
    return this.svc.recordPhoto(ctx, id, party);
  }
}
