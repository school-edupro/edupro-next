import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { FeeAdjustmentsService } from './fee-adjustments.service';
import { FeeDemandsService } from './fee-demands.service';
import { FeeLedgerService } from './fee-ledger.service';
import { FeeMastersService } from './fee-masters.service';
import { FeeReportsService } from './fee-reports.service';
import {
  ClassSummaryQueryDto,
  CreateDiscountDto,
  DecideAdjustmentDto,
  ListAdjustmentsQueryDto,
  ListMiscReceiptsQueryDto,
  MiscEmployeeLookupQueryDto,
  NotifyDefaultersDto,
  ListProfileChangesQueryDto,
  PostMiscReceiptDto,
  RequestAdjustmentDto,
  RequestProfileChangeDto,
  CreateHeadDto,
  CreateSlabDto,
  FEES,
  GenerateClassDemandDto,
  GeneratePeriodsDto,
  LedgerQueryDto,
  ListDemandsQueryDto,
  SetLateFeeOverrideDto,
  SetPeriodLateFeeDto,
  SetProfileDto,
  SetReceiptSequenceDto,
  SetStructureDto,
  UpdateHeadDto,
} from './fees.dto';

@ApiTags('fees')
@ApiBearerAuth()
@Controller('fees')
export class FeesController {
  constructor(
    private readonly masters: FeeMastersService,
    private readonly demands: FeeDemandsService,
    private readonly ledger: FeeLedgerService,
    private readonly adj: FeeAdjustmentsService,
    private readonly feeReports: FeeReportsService,
  ) {}

  // ---- masters ------------------------------------------------------------------------------------
  @Get('heads')
  @RequirePermission(FEES.masterView, {
    description: 'View fee heads, periods, structures, slabs and discounts',
  })
  async heads(@ReqCtx() ctx: RequestContext) {
    return { data: await this.masters.heads(ctx) };
  }

  @Post('heads')
  @RequirePermission(FEES.masterManage, {
    description: 'Edit fee heads, periods, structures, slabs and discounts',
  })
  createHead(@ReqCtx() ctx: RequestContext, @Body() body: CreateHeadDto) {
    return this.masters.createHead(ctx, body);
  }

  @Patch('heads/:id')
  @RequirePermission(FEES.masterManage)
  updateHead(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UpdateHeadDto) {
    return this.masters.updateHead(ctx, id, body);
  }

  @Get('periods')
  @ApiOperation({
    summary: 'Fee periods (months) of the working year with instalments and due dates',
  })
  @RequirePermission(FEES.masterView)
  async periods(@ReqCtx() ctx: RequestContext) {
    return { data: await this.masters.periods(ctx) };
  }

  @Post('periods/generate')
  @ApiOperation({ summary: 'Generate the twelve periods of the working year' })
  @RequirePermission(FEES.masterManage)
  async generatePeriods(@ReqCtx() ctx: RequestContext, @Body() body: GeneratePeriodsDto) {
    return { data: await this.masters.generatePeriods(ctx, body) };
  }

  @Get('structures')
  @RequirePermission(FEES.masterView)
  async structures(@ReqCtx() ctx: RequestContext, @Query('classId') classId?: string) {
    return {
      data: await this.masters.structures(
        ctx,
        classId && /^\d{1,18}$/.test(classId) ? classId : undefined,
      ),
    };
  }

  @Put('structures/:classId')
  @ApiOperation({
    summary: 'Replace the fee structure of a class and fee group for the working year',
  })
  @RequirePermission(FEES.masterManage)
  async setStructure(
    @ReqCtx() ctx: RequestContext,
    @Param('classId') classId: string,
    @Body() body: SetStructureDto,
  ) {
    return { data: await this.masters.setStructure(ctx, classId, body) };
  }

  @Get('slabs')
  @RequirePermission(FEES.masterView)
  async slabs(@ReqCtx() ctx: RequestContext) {
    return { data: await this.masters.slabs(ctx) };
  }

  @Post('slabs')
  @RequirePermission(FEES.masterManage)
  createSlab(@ReqCtx() ctx: RequestContext, @Body() body: CreateSlabDto) {
    return this.masters.createSlab(ctx, body);
  }

  @Get('discounts')
  @RequirePermission(FEES.masterView)
  async discounts(@ReqCtx() ctx: RequestContext) {
    return { data: await this.masters.discounts(ctx) };
  }

  @Post('discounts')
  @RequirePermission(FEES.masterManage)
  createDiscount(@ReqCtx() ctx: RequestContext, @Body() body: CreateDiscountDto) {
    return this.masters.createDiscount(ctx, body);
  }

  // ---- students -------------------------------------------------------------------------------------
  @Get('students/:id/profile')
  @RequirePermission(FEES.demandView, { description: 'View fee demands and dues' })
  profile(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.demands.profile(ctx, id);
  }

  @Put('students/:id/profile')
  @RequirePermission(FEES.profileManage, {
    description: "Set a student's fee group, transport slab, discount and opening balance",
  })
  setProfile(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: SetProfileDto) {
    return this.demands.setProfile(ctx, id, body);
  }

  @Get('students/:id/demands')
  @ApiOperation({ summary: 'Demand rows of the working year with instalment and year totals' })
  @RequirePermission(FEES.demandView)
  studentDemands(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: ListDemandsQueryDto,
  ) {
    return this.demands.demands(ctx, id, q);
  }

  @Post('students/:id/demands/generate')
  @ApiOperation({ summary: 'Generate or regenerate the demand (legacy GenerateFee rules)' })
  @RequirePermission(FEES.demandGenerate, { description: 'Generate or regenerate fee demands' })
  generate(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.demands.generate(ctx, id);
  }

  @Post('demands/generate')
  @ApiOperation({ summary: 'Generate demands for every active student of a class' })
  @RequirePermission(FEES.demandGenerate)
  generateClass(@ReqCtx() ctx: RequestContext, @Body() body: GenerateClassDemandDto) {
    return this.demands.generateForClass(ctx, body.classId);
  }

  @Get('demands/summary')
  @ApiOperation({ summary: 'Per-student demand totals of a class' })
  @RequirePermission(FEES.demandView)
  async classSummary(@ReqCtx() ctx: RequestContext, @Query() q: ClassSummaryQueryDto) {
    return { data: await this.demands.classSummary(ctx, q.classId) };
  }

  // ---- Sprint 12: ledger, late fee, receipts ------------------------------------------------------
  @Put('periods/:id/late-fee')
  @ApiOperation({ summary: 'Set the late fee slabs and the visible-from date of a period' })
  @RequirePermission(FEES.masterManage)
  setPeriodLateFee(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: SetPeriodLateFeeDto,
  ) {
    return this.ledger.setPeriodLateFee(ctx, id, body);
  }

  @Get('receipt-sequences')
  @ApiOperation({ summary: 'Receipt numbering per ledger and financial year' })
  @RequirePermission(FEES.masterView)
  async receiptSequences(@ReqCtx() ctx: RequestContext) {
    return { data: await this.ledger.receiptSequences(ctx) };
  }

  @Put('receipt-sequences')
  @ApiOperation({
    summary: 'Set prefix, width and start number before the first receipt of the year',
  })
  @RequirePermission(FEES.masterManage)
  setReceiptSequence(@ReqCtx() ctx: RequestContext, @Body() body: SetReceiptSequenceDto) {
    return this.ledger.setReceiptSequence(ctx, body);
  }

  @Get('mine')
  @ApiOperation({
    summary:
      "The family's fee ledgers: visible instalments, receipts, refunds and what is payable now",
  })
  @RequirePermission(FEES.familyView, {
    description: "View the fee ledger and receipts of one's own children",
  })
  mine(@ReqCtx() ctx: RequestContext) {
    return this.ledger.mine(ctx);
  }

  @Get('students/:id/ledger')
  @ApiOperation({
    summary: 'Instalment ledger with late fee, visibility, receipts and the last regeneration diff',
  })
  @RequirePermission(FEES.ledgerView, {
    description: 'View student fee ledgers (dues, late fee, receipts, regeneration history)',
  })
  studentLedger(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: LedgerQueryDto,
  ) {
    return this.ledger.ledger(ctx, id, q.asOf);
  }

  @Post('students/:id/demands/regenerate')
  @ApiOperation({ summary: 'Regenerate the demand and return the diff against the previous rows' })
  @RequirePermission(FEES.demandGenerate)
  regenerate(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.ledger.regenerate(ctx, id);
  }

  @Put('students/:id/late-fee')
  @ApiOperation({ summary: 'Waive or fix the late fee of one instalment (0 waives)' })
  @RequirePermission(FEES.lateFeeManage, {
    description: 'Waive or fix the late fee of an instalment for a student',
  })
  setLateFee(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: SetLateFeeOverrideDto,
  ) {
    return this.ledger.setLateFeeOverride(ctx, id, body);
  }

  @Delete('students/:id/late-fee/:overrideId')
  @RequirePermission(FEES.lateFeeManage)
  revokeLateFee(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('overrideId') overrideId: string,
  ) {
    return this.ledger.revokeLateFeeOverride(ctx, id, overrideId);
  }

  @Post('payments/:id/receipt')
  @ApiOperation({ summary: 'Queue the receipt PDF from the active fee receipt template' })
  @RequirePermission(FEES.ledgerView)
  receipt(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.ledger.receiptPdf(ctx, id);
  }

  // ---- Sprint 14: family receipt PDF ------------------------------------------------------------
  @Post('mine/receipts/:paymentId/pdf')
  @ApiOperation({ summary: "Queue the PDF of one of the family's own receipts" })
  @RequirePermission(FEES.familyView)
  myReceiptPdf(@ReqCtx() ctx: RequestContext, @Param('paymentId') paymentId: string) {
    return this.ledger.myReceiptPdf(ctx, paymentId);
  }

  @Get('mine/exports/:id')
  @ApiOperation({ summary: 'Status and download link of one of my own exports' })
  @RequirePermission(FEES.familyView)
  myExport(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.ledger.myExportStatus(ctx, id);
  }

  // ---- Sprint 14: adjustments (waiver, reversal, bounce) ------------------------------------------
  @Get('adjustments')
  @RequirePermission(FEES.adjustmentRequest, {
    description: 'Request a waiver, a receipt reversal or a cheque bounce',
  })
  async adjustments(@ReqCtx() ctx: RequestContext, @Query() q: ListAdjustmentsQueryDto) {
    return { data: await this.adj.adjustments(ctx, q) };
  }

  @Post('adjustments')
  @ApiOperation({
    summary: 'Request a waiver of a demand row, a receipt reversal or a cheque bounce',
  })
  @RequirePermission(FEES.adjustmentRequest)
  requestAdjustment(@ReqCtx() ctx: RequestContext, @Body() body: RequestAdjustmentDto) {
    return this.adj.requestAdjustment(ctx, body);
  }

  @Post('adjustments/:id/decide')
  @ApiOperation({
    summary: 'Approve (applies the adjustment) or reject; needs a recent MFA sign-in',
  })
  @RequirePermission(FEES.adjustmentApprove, {
    description: 'Approve or reject fee adjustments (step-up MFA)',
    mfa: true,
  })
  decideAdjustment(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: DecideAdjustmentDto,
  ) {
    return this.adj.decideAdjustment(ctx, id, body);
  }

  // ---- Sprint 14: category, discount and hostel changes through the workflow -----------------------
  @Get('profile-changes')
  @RequirePermission(FEES.profileChangeRequest, {
    description: 'Request a category, discount or hostel change for a student',
  })
  async profileChanges(@ReqCtx() ctx: RequestContext, @Query() q: ListProfileChangesQueryDto) {
    return { data: await this.adj.profileChanges(ctx, q) };
  }

  @Post('students/:id/profile-changes')
  @ApiOperation({
    summary: 'Request a fee category, discount, transport or hostel change (workflow)',
  })
  @RequirePermission(FEES.profileChangeRequest)
  requestProfileChange(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: RequestProfileChangeDto,
  ) {
    return this.adj.requestProfileChange(ctx, id, body);
  }

  @Post('profile-changes/:id/decide')
  @ApiOperation({ summary: 'Decide a change that is not in a workflow' })
  @RequirePermission(FEES.profileManage)
  decideProfileChange(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: DecideAdjustmentDto,
  ) {
    return this.adj.decideProfileChange(ctx, id, body);
  }

  // ---- Sprint 14: misc receipts and reconciliation ------------------------------------------------
  @Get('misc/receipts')
  @RequirePermission(FEES.miscView, { description: 'View misc receipts' })
  async miscReceipts(@ReqCtx() ctx: RequestContext, @Query() q: ListMiscReceiptsQueryDto) {
    const { rows, total } = await this.adj.miscReceipts(ctx, q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Post('misc/receipts')
  @ApiOperation({
    summary: 'Post a misc receipt (student, employee, vendor or other) on the misc ledger',
  })
  @RequirePermission(FEES.miscPost, {
    description: 'Post a misc receipt (students, employees, vendors, others)',
  })
  postMisc(@ReqCtx() ctx: RequestContext, @Body() body: PostMiscReceiptDto) {
    return this.adj.postMiscReceipt(ctx, body);
  }

  @Post('reports/defaulters/notify')
  @ApiOperation({
    summary: 'Send the fee_due reminder to the guardians of the selected defaulters',
  })
  @RequirePermission(FEES.defaulterNotify, {
    description: 'Send fee reminders to defaulters from the reports centre',
  })
  notifyDefaulters(@ReqCtx() ctx: RequestContext, @Body() body: NotifyDefaultersDto) {
    return this.feeReports.notifyDefaulters(ctx, body);
  }

  @Get('misc/employees')
  @ApiOperation({ summary: 'Find an employee payer for a misc receipt by name, code or mobile' })
  @RequirePermission(FEES.miscPost)
  async miscEmployees(@ReqCtx() ctx: RequestContext, @Query() q: MiscEmployeeLookupQueryDto) {
    return { data: await this.adj.lookupEmployees(ctx, q.q, q.limit) };
  }

  @Get('reconciliations')
  @RequirePermission(FEES.reconcileView, {
    description: 'View the daily reconciliation of online receipts against settlements',
  })
  async reconciliations(@ReqCtx() ctx: RequestContext) {
    return { data: await this.adj.reconciliations(ctx) };
  }

  @Post('reconciliations/run')
  @RequirePermission(FEES.reconcileRun, { description: 'Run the reconciliation now' })
  reconcile(@ReqCtx() ctx: RequestContext) {
    return this.adj.reconcileNow(ctx);
  }
}
