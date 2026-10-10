import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { FeeAdjustmentsService } from './fee-adjustments.service';
import { FeeDemandsService } from './fee-demands.service';
import { FeeLedgerService } from './fee-ledger.service';
import { FeeMastersService } from './fee-masters.service';
import { FeeReportsService } from './fee-reports.service';
import { FeeSetupService } from './fee-setup.service';
import { FeeCarryService } from './fee-carry.service';
import { FeeDepositService } from './fee-deposit.service';
import { FeeDocumentsService } from './fee-documents.service';
import {
  ClassSummaryQueryDto,
  SetSchoolPayPlanDto,
  SetTransportMonthsDto,
  AddPaymentModeDto,
  CloneClassRulesDto,
  BillQueryDto,
  ClassBillsQueryDto,
  TaxCertificateQueryDto,
  MyTaxCertificateQueryDto,
  FnfQueryDto,
  CreateDepositSlipDto,
  PendingInstrumentsQueryDto,
  CarryPreviewQueryDto,
  RunCarryForwardDto,
  UndoCarryForwardDto,
  SetClassRulesDto,
  SetPaymentModeDto,
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
    private readonly setup: FeeSetupService,
    private readonly carry: FeeCarryService,
    private readonly deposits: FeeDepositService,
    private readonly papers: FeeDocumentsService,
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

  // ---- set-up, second pass: class rules, payment modes, a pupil's discounts -------------------------
  @Get('class-rules/:classId')
  @ApiOperation({
    summary: "A class's own last dates, late fee and bounce charge beside the school's",
  })
  @RequirePermission(FEES.masterView)
  async classRules(@ReqCtx() ctx: RequestContext, @Param('classId') classId: string) {
    return { data: await this.setup.classRules(ctx, classId) };
  }

  @Put('class-rules/:classId')
  @ApiOperation({ summary: "Set a class's own last dates, late fee and bounce charge" })
  @RequirePermission(FEES.masterManage)
  async setClassRules(
    @ReqCtx() ctx: RequestContext,
    @Param('classId') classId: string,
    @Body() body: SetClassRulesDto,
  ) {
    return { data: await this.setup.setClassRules(ctx, classId, body) };
  }

  @Post('class-rules/:classId/clone')
  @ApiOperation({ summary: "Copy a class's fee calendar onto other classes" })
  @RequirePermission(FEES.masterManage)
  cloneClassRules(
    @ReqCtx() ctx: RequestContext,
    @Param('classId') classId: string,
    @Body() body: CloneClassRulesDto,
  ) {
    return this.setup.cloneClassRules(ctx, classId, body.toClassIds);
  }

  @Get('payment-modes')
  @ApiOperation({ summary: 'Payment modes and the fields each one demands' })
  @RequirePermission(FEES.demandView)
  async paymentModes(@ReqCtx() ctx: RequestContext) {
    return { data: await this.setup.paymentModes(ctx) };
  }

  @Get('students/:id/optional-heads')
  @ApiOperation({
    summary: "The school's optional heads and the months this pupil has opted in for",
  })
  @RequirePermission(FEES.demandView)
  async studentOptionalHeads(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.setup.studentOptionalHeads(ctx, id) };
  }

  @Get('cashier/search')
  @ApiOperation({ summary: 'Pupils by name or admission number, with class and father' })
  @RequirePermission(FEES.ledgerView)
  async cashierSearch(@ReqCtx() ctx: RequestContext, @Query('q') q?: string) {
    return { data: await this.setup.cashierSearch(ctx, String(q ?? '').slice(0, 60)) };
  }

  @Get('cashier/options')
  @ApiOperation({ summary: 'Bank names and school accounts for the receipt form' })
  @RequirePermission(FEES.ledgerView)
  cashierOptions(@ReqCtx() ctx: RequestContext) {
    return this.setup.cashierOptions(ctx);
  }

  @Get('payments/:id/receipt-view')
  @ApiOperation({ summary: 'One receipt as it prints: pupil, lines, mode, amount in words' })
  @RequirePermission(FEES.ledgerView)
  receiptView(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.papers.receiptView(ctx, id);
  }

  @Get('pay-plan')
  @ApiOperation({ summary: "The school's pay plan" })
  @RequirePermission(FEES.masterView)
  schoolPayPlan(@ReqCtx() ctx: RequestContext) {
    return this.setup.schoolPayPlan(ctx);
  }

  @Put('pay-plan')
  @ApiOperation({ summary: "Set the school's pay plan (monthly, quarterly, half-yearly, yearly)" })
  @RequirePermission(FEES.masterManage)
  setSchoolPayPlan(@ReqCtx() ctx: RequestContext, @Body() body: SetSchoolPayPlanDto) {
    return this.setup.setSchoolPayPlan(ctx, body.payPlan);
  }

  @Get('transport-months')
  @ApiOperation({ summary: 'The months of the year in which transport is charged' })
  @RequirePermission(FEES.masterView)
  async transportMonths(@ReqCtx() ctx: RequestContext) {
    return { data: await this.setup.transportMonths(ctx) };
  }

  @Put('transport-months')
  @ApiOperation({ summary: 'Set the months in which transport is charged' })
  @RequirePermission(FEES.masterManage)
  setTransportMonths(@ReqCtx() ctx: RequestContext, @Body() body: SetTransportMonthsDto) {
    return this.setup.setTransportMonths(ctx, body.charged);
  }

  @Post('payment-modes')
  @ApiOperation({ summary: "Add the school's own payment mode" })
  @RequirePermission(FEES.masterManage)
  async addPaymentMode(@ReqCtx() ctx: RequestContext, @Body() body: AddPaymentModeDto) {
    return { data: await this.setup.addPaymentMode(ctx, body) };
  }

  @Delete('payment-modes/:code')
  @ApiOperation({ summary: 'Remove a payment mode the school added' })
  @RequirePermission(FEES.masterManage)
  async removePaymentMode(@ReqCtx() ctx: RequestContext, @Param('code') code: string) {
    return { data: await this.setup.removePaymentMode(ctx, code) };
  }

  @Put('payment-modes/:code')
  @ApiOperation({ summary: 'Set a payment mode: offered at the counter, mandatory fields' })
  @RequirePermission(FEES.masterManage)
  async setPaymentMode(
    @ReqCtx() ctx: RequestContext,
    @Param('code') code: string,
    @Body() body: SetPaymentModeDto,
  ) {
    return { data: await this.setup.setPaymentMode(ctx, code, body) };
  }

  @Get('students/:id/discounts')
  @ApiOperation({ summary: "A pupil's discounts month by month" })
  @RequirePermission(FEES.demandView)
  async studentDiscounts(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.setup.studentDiscounts(ctx, id) };
  }

  // ---- year-end carry-forward ---------------------------------------------------------------------
  @Get('carry-forward')
  @ApiOperation({ summary: 'What every pupil of the working year would carry to the new year' })
  @RequirePermission(FEES.carryForward, {
    description: 'Carry unpaid fee, late fine and advance to the new year, and undo it',
  })
  async carryPreview(@ReqCtx() ctx: RequestContext, @Query() q: CarryPreviewQueryDto) {
    return { data: await this.carry.preview(ctx, q.toYearId, q.fromYearId) };
  }

  @Post('carry-forward')
  @ApiOperation({ summary: 'Carry the chosen pupils (or all) to the new year' })
  @RequirePermission(FEES.carryForward)
  runCarry(@ReqCtx() ctx: RequestContext, @Body() body: RunCarryForwardDto) {
    return this.carry.run(ctx, body);
  }

  @Post('carry-forward/undo')
  @ApiOperation({ summary: "Take one pupil's carry back while nothing is paid against it" })
  @RequirePermission(FEES.carryForward)
  undoCarry(@ReqCtx() ctx: RequestContext, @Body() body: UndoCarryForwardDto) {
    return this.carry.undo(ctx, body.toYearId, body.studentId, body.fromYearId);
  }

  // ---- bank deposit slips --------------------------------------------------------------------------
  @Get('deposit-slips')
  @ApiOperation({ summary: 'Deposit slips of the working year' })
  @RequirePermission(FEES.ledgerView)
  async depositSlips(@ReqCtx() ctx: RequestContext) {
    return { data: await this.deposits.list(ctx) };
  }

  @Get('deposit-slips/pending')
  @ApiOperation({
    summary: 'Cheques and drafts in hand that are on no slip yet, and the bank accounts',
  })
  @RequirePermission(FEES.ledgerView)
  async pendingInstruments(@ReqCtx() ctx: RequestContext, @Query() q: PendingInstrumentsQueryDto) {
    const [data, accounts] = await Promise.all([
      this.deposits.pending(ctx, q),
      this.deposits.accounts(ctx),
    ]);
    return { data, accounts };
  }

  @Get('deposit-slips/:id')
  @ApiOperation({ summary: 'One deposit slip with its cheques, for printing' })
  @RequirePermission(FEES.ledgerView)
  depositSlip(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.deposits.get(ctx, id);
  }

  @Post('deposit-slips')
  @ApiOperation({ summary: 'Make a deposit slip from the chosen cheques and drafts' })
  @RequirePermission(FEES.depositSlip, {
    description: 'Make and cancel bank deposit slips for cheques and drafts',
  })
  createDepositSlip(@ReqCtx() ctx: RequestContext, @Body() body: CreateDepositSlipDto) {
    return this.deposits.create(ctx, body);
  }

  @Post('deposit-slips/:id/cancel')
  @ApiOperation({ summary: 'Cancel a slip and free its cheques' })
  @RequirePermission(FEES.depositSlip)
  cancelDepositSlip(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.deposits.cancel(ctx, id);
  }

  // ---- printed papers: fee bill, tax certificate, provisional bill of a withdrawal -----------------
  @Get('students/:id/bill')
  @ApiOperation({ summary: 'The fee bill of one pupil: what is payable now, head by head' })
  @RequirePermission(FEES.ledgerView)
  studentBill(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: BillQueryDto) {
    return this.papers.bill(ctx, id, q.upTo);
  }

  @Get('bills')
  @ApiOperation({ summary: 'The fee bills of a class or a section, for printing' })
  @RequirePermission(FEES.ledgerView)
  async classBills(@ReqCtx() ctx: RequestContext, @Query() q: ClassBillsQueryDto) {
    return { data: await this.papers.bills(ctx, q) };
  }

  @Get('students/:id/tax-certificate')
  @ApiOperation({ summary: 'Fee paid in a financial year on the heads that count for income tax' })
  @RequirePermission(FEES.ledgerView)
  taxCertificate(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: TaxCertificateQueryDto,
  ) {
    return this.papers.taxCertificate(ctx, id, q.financialYearId);
  }

  @Get('mine/tax-certificate')
  @ApiOperation({ summary: "A parent's tax certificate for one of their children" })
  @RequirePermission(FEES.familyView)
  myTaxCertificate(@ReqCtx() ctx: RequestContext, @Query() q: MyTaxCertificateQueryDto) {
    return this.papers.myTaxCertificate(ctx, q.studentId, q.financialYearId);
  }

  @Get('students/:id/fnf')
  @ApiOperation({ summary: 'Provisional bill of a withdrawal: payable and refundable' })
  @RequirePermission(FEES.ledgerView)
  fnf(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: FnfQueryDto) {
    return this.papers.fnf(ctx, id, q.lastSeq);
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
