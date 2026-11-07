import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PurchaseIndentsService } from './purchase-indents.service';
import { PurchaseSetupService } from './purchase-setup.service';
import { PurchaseVendorsService } from './purchase-vendors.service';
import {
  CommitteeMemberDto,
  CopyFromDto,
  CreateVendorDto,
  DecisionDto,
  DepartmentLevelsDto,
  DepartmentRulesDto,
  IndentDecisionDto,
  IndentDto,
  IndentExportQueryDto,
  IndentListQueryDto,
  IndentSheetDto,
  PURCHASE,
  PurchaseDelegationDto,
  ReasonDto,
  PaymentTermDto,
  TermListQueryDto,
  VendorApproverDto,
  SettingsDto,
  UpdateVendorDto,
  VendorDocumentDto,
  VendorImportDto,
  VendorListQueryDto,
  VendorStatusDto,
} from './purchase.dto';

/** Purchase, part 1 (docs/design/83): vendors, payment terms, settings, committee, department approvals. */
@ApiTags('purchase')
@ApiBearerAuth()
@Controller('purchase')
export class PurchaseController {
  constructor(
    private readonly vendors: PurchaseVendorsService,
    private readonly setup: PurchaseSetupService,
    private readonly indents: PurchaseIndentsService,
  ) {}

  // ---- Purchase Indents (part 2) ------------------------------------------------------------------
  @Get('indents')
  @ApiOperation({
    summary: 'Indents I may see: mine, my department’s, those I approve (all with the view right)',
  })
  @AuthenticatedOnly()
  listIndents(@ReqCtx() ctx: RequestContext, @Query() q: IndentListQueryDto) {
    return this.indents.list(ctx, q);
  }

  @Get('indents/export')
  @ApiOperation({ summary: 'The indents list as on screen (its filters), as Excel or PDF' })
  @AuthenticatedOnly()
  exportIndents(@ReqCtx() ctx: RequestContext, @Query() q: IndentExportQueryDto) {
    return this.indents.exportList(ctx, q);
  }

  @Get('list-filters')
  @ApiOperation({ summary: 'What the purchase lists filter by: departments, and vendors (office)' })
  @AuthenticatedOnly()
  listFilters(@ReqCtx() ctx: RequestContext) {
    return this.indents.listFilters(ctx);
  }

  @Get('indent-sheet')
  @ApiOperation({ summary: 'The indent item sheet to fill (items as a drop-down)' })
  @RequirePermission(PURCHASE.indentRaise)
  indentSheet(@ReqCtx() ctx: RequestContext) {
    return this.indents.itemSheet(ctx);
  }

  @Post('indent-sheet')
  @ApiOperation({ summary: 'Read a filled item sheet into indent lines (nothing is saved)' })
  @RequirePermission(PURCHASE.indentRaise)
  readIndentSheet(@ReqCtx() ctx: RequestContext, @Body() body: IndentSheetDto) {
    return this.indents.readItemSheet(ctx, body);
  }

  @Post('indent-files')
  @ApiOperation({
    summary: 'A document for an indent line: the PDF or photo as the request body (?name=)',
  })
  @RequirePermission(PURCHASE.indentRaise)
  uploadIndentFile(
    @ReqCtx() ctx: RequestContext,
    @Req() req: FastifyRequest,
    @Query('name') name: string | undefined,
  ) {
    return this.indents.uploadLineFile(
      ctx,
      req.body,
      String(req.headers['content-type'] ?? ''),
      name ?? 'document',
    );
  }

  @Get('indents/:id/lines/:lineId/file')
  @ApiOperation({ summary: 'An indent line’s document' })
  @AuthenticatedOnly()
  async indentLineFile(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.indents.lineFile(ctx, id, lineId);
    void reply
      .header('content-type', f.contentType)
      .header(
        'content-disposition',
        `${save === '1' ? 'attachment' : 'inline'}; filename="${f.filename.replace(/[^\w.\- ]+/g, '_')}"`,
      )
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(f.bytes);
  }

  @Get('indent-form')
  @RequirePermission(PURCHASE.indentRaise)
  indentForm(@ReqCtx() ctx: RequestContext) {
    return this.indents.formLists(ctx);
  }

  @Get('indents/:id')
  @AuthenticatedOnly()
  indent(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.indents.get(ctx, id);
  }

  @Get('indents/:id/pdf')
  @ApiOperation({
    summary: 'The printed Purchase Indent, once sent (rates only for those who see them)',
  })
  @AuthenticatedOnly()
  async indentPdf(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.indents.pdf(ctx, id);
    void reply
      .header('content-type', 'application/pdf')
      .header(
        'content-disposition',
        `${save === '1' ? 'attachment' : 'inline'}; filename="${f.filename.replace(/[^\w.\- ]+/g, '_')}"`,
      )
      .header('cache-control', 'private, no-store')
      .send(f.bytes);
  }

  @Post('indents')
  @ApiOperation({ summary: 'Raise a Purchase Indent (a draft until submitted)' })
  @RequirePermission(PURCHASE.indentRaise)
  createIndent(@ReqCtx() ctx: RequestContext, @Body() body: IndentDto) {
    return this.indents.create(ctx, body);
  }

  @Put('indents/:id')
  @RequirePermission(PURCHASE.indentRaise)
  updateIndent(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: IndentDto) {
    return this.indents.update(ctx, id, body);
  }

  @Post('indents/:id/submit')
  @ApiOperation({ summary: 'Send a draft (or one sent back) to the department’s approval levels' })
  @RequirePermission(PURCHASE.indentRaise)
  submitIndent(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.indents.submit(ctx, id);
  }

  @Post('indents/:id/decide')
  @ApiOperation({
    summary: 'Approve, reject or send back (the current level’s approver or their delegate)',
  })
  @AuthenticatedOnly()
  decideIndent(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: IndentDecisionDto,
  ) {
    return this.indents.decide(ctx, id, body);
  }

  @Post('indents/:id/cancel')
  @RequirePermission(PURCHASE.indentRaise)
  cancelIndent(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.indents.cancel(ctx, id, body);
  }

  @Get('delegations')
  @AuthenticatedOnly()
  delegations(@ReqCtx() ctx: RequestContext) {
    return this.indents.delegations(ctx);
  }

  @Post('delegations')
  @ApiOperation({
    summary:
      'Hand my purchase approvals (or, school admin, someone’s) to a colleague for some days',
  })
  @AuthenticatedOnly()
  delegate(@ReqCtx() ctx: RequestContext, @Body() body: PurchaseDelegationDto) {
    return this.indents.delegate(ctx, body);
  }

  @Delete('delegations/:id')
  @AuthenticatedOnly()
  revokeDelegation(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.indents.revokeDelegation(ctx, id);
  }

  @Get('overview')
  @ApiOperation({ summary: 'What the purchase set-up has: counts and what is waiting' })
  @RequirePermission(PURCHASE.masterView)
  overview(@ReqCtx() ctx: RequestContext) {
    return this.setup.overview(ctx);
  }

  // ---- vendors ------------------------------------------------------------------------------------
  @Get('vendors')
  @RequirePermission(PURCHASE.masterView)
  listVendors(@ReqCtx() ctx: RequestContext, @Query() q: VendorListQueryDto) {
    return this.vendors.list(ctx, q);
  }

  @Get('vendors/form-lists')
  @ApiOperation({
    summary: 'What the vendor form picks from: countries, states, cities, banks, the next code',
  })
  @RequirePermission(PURCHASE.masterView)
  vendorFormLists(@ReqCtx() ctx: RequestContext) {
    return this.vendors.formLists(ctx);
  }

  @Get('vendors/template')
  @ApiOperation({ summary: 'The Excel format for importing vendors' })
  @RequirePermission(PURCHASE.masterManage)
  vendorTemplate(@ReqCtx() ctx: RequestContext) {
    return this.vendors.template(ctx);
  }

  @Post('vendors/import')
  @ApiOperation({ summary: 'Import vendors from Excel (checked first; they arrive pending)' })
  @RequirePermission(PURCHASE.masterManage)
  importVendors(@ReqCtx() ctx: RequestContext, @Body() body: VendorImportDto) {
    return this.vendors.import(ctx, body);
  }

  @Get('vendor-approvals')
  @ApiOperation({
    summary:
      'New vendors and bank / GSTIN / PAN changes waiting for a second person (mine=1: only what I may decide)',
  })
  // the purchase view right, or a vendor approver named in the settings (checked in the service)
  @AuthenticatedOnly()
  vendorApprovals(@ReqCtx() ctx: RequestContext, @Query('mine') mine?: string) {
    return mine === '1' ? this.vendors.approvalsMine(ctx) : this.vendors.approvals(ctx);
  }

  @Post('vendor-changes/:id/decide')
  // the named vendor approvers, else the right (checked in the service)
  @AuthenticatedOnly()
  decideChange(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: DecisionDto) {
    return this.vendors.decideChange(ctx, id, body);
  }

  @Post('vendor-changes/:id/withdraw')
  @RequirePermission(PURCHASE.masterManage)
  withdrawChange(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.vendors.withdrawChange(ctx, id);
  }

  @Get('vendors/:id')
  // the purchase view right, or a vendor approver (checked in the service)
  @AuthenticatedOnly()
  vendor(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.vendors.get(ctx, id);
  }

  @Post('vendors')
  @ApiOperation({ summary: 'Add a vendor (it waits for a second person’s approval)' })
  @RequirePermission(PURCHASE.masterManage)
  createVendor(@ReqCtx() ctx: RequestContext, @Body() body: CreateVendorDto) {
    return this.vendors.create(ctx, body);
  }

  @Patch('vendors/:id')
  @ApiOperation({
    summary: 'Change a vendor; on an approved one a bank / GSTIN / PAN change waits for approval',
  })
  @RequirePermission(PURCHASE.masterManage)
  updateVendor(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: UpdateVendorDto,
  ) {
    return this.vendors.update(ctx, id, body);
  }

  @Post('vendors/:id/decide')
  @ApiOperation({ summary: 'Approve or reject a new vendor (never one you entered)' })
  // the named vendor approvers, else the right (checked in the service)
  @AuthenticatedOnly()
  decideVendor(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: DecisionDto) {
    return this.vendors.decideVendor(ctx, id, body);
  }

  @Put('vendors/:id/status')
  @ApiOperation({
    summary: 'Make an approved vendor active, inactive or blacklisted (with a reason)',
  })
  @RequirePermission(PURCHASE.masterManage)
  vendorStatus(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: VendorStatusDto,
  ) {
    return this.vendors.setStatus(ctx, id, body);
  }

  @Post('vendors/:id/documents')
  @RequirePermission(PURCHASE.masterManage)
  addDocument(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: VendorDocumentDto,
  ) {
    return this.vendors.addDocument(ctx, id, body);
  }

  @Get('vendors/:id/documents/:docId/file')
  @ApiOperation({ summary: 'A document kept with a vendor (inline; ?save=1 to save a copy)' })
  // the purchase view right or a vendor approver (checked in the service)
  @AuthenticatedOnly()
  async vendorDocument(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.vendors.documentFile(ctx, id, docId);
    void reply
      .header('content-type', f.contentType)
      .header(
        'content-disposition',
        `${save === '1' ? 'attachment' : 'inline'}; filename="${f.filename.replace(/[^\w.\- ]+/g, '_')}"`,
      )
      .header('cache-control', 'private, no-store')
      .send(f.bytes);
  }

  @Delete('vendors/:id/documents/:docId')
  @RequirePermission(PURCHASE.masterManage)
  removeDocument(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.vendors.removeDocument(ctx, id, docId);
  }

  // ---- payment terms ------------------------------------------------------------------------------
  @Get('payment-terms')
  @ApiOperation({ summary: 'Payment terms (search, status, how paid, longer than 45 days)' })
  @RequirePermission(PURCHASE.masterView)
  terms(@ReqCtx() ctx: RequestContext, @Query() q: TermListQueryDto) {
    return this.setup.listTerms(ctx, q);
  }

  @Get('payment-terms/export')
  @ApiOperation({ summary: 'The payment terms as on screen (filters kept), as Excel or PDF' })
  @RequirePermission(PURCHASE.masterView)
  termsFile(@ReqCtx() ctx: RequestContext, @Query() q: TermListQueryDto) {
    return this.setup.termsFile(ctx, q);
  }

  @Get('payment-terms/template')
  @ApiOperation({ summary: 'The Excel format for payment terms (filled with the school’s terms)' })
  @RequirePermission(PURCHASE.masterManage)
  termsTemplate(@ReqCtx() ctx: RequestContext) {
    return this.setup.termsTemplate(ctx);
  }

  @Post('payment-terms/import')
  @ApiOperation({
    summary: 'Payment terms from Excel (checked first; a code there updates its term)',
  })
  @RequirePermission(PURCHASE.masterManage)
  importTerms(@ReqCtx() ctx: RequestContext, @Body() body: VendorImportDto) {
    return this.setup.importTerms(ctx, body);
  }

  @Get('vendor-approvers')
  @ApiOperation({ summary: 'Who may approve a vendor: the roles with the right and their people' })
  @RequirePermission(PURCHASE.masterView)
  vendorApprovers(@ReqCtx() ctx: RequestContext) {
    return this.setup.vendorApprovers(ctx);
  }

  @Post('vendor-approvers')
  @ApiOperation({ summary: 'Name an employee as a vendor approver' })
  @RequirePermission(PURCHASE.settingsManage)
  addVendorApprover(@ReqCtx() ctx: RequestContext, @Body() body: VendorApproverDto) {
    return this.setup.addVendorApprover(ctx, body.employeeId);
  }

  @Delete('vendor-approvers/:id')
  @ApiOperation({ summary: 'Take an employee off the vendor approvers' })
  @RequirePermission(PURCHASE.settingsManage)
  removeVendorApprover(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.setup.removeVendorApprover(ctx, id);
  }

  @Post('payment-terms')
  @RequirePermission(PURCHASE.masterManage)
  createTerm(@ReqCtx() ctx: RequestContext, @Body() body: PaymentTermDto) {
    return this.setup.saveTerm(ctx, null, body);
  }

  @Put('payment-terms/:id')
  @RequirePermission(PURCHASE.masterManage)
  updateTerm(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: PaymentTermDto) {
    return this.setup.saveTerm(ctx, id, body);
  }

  @Post('steps/:id/pass')
  @ApiOperation({
    summary: 'Pass the level a purchase document waits at for its approvers (with the reason)',
  })
  @RequirePermission(PURCHASE.approvalOverride)
  passStep(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.setup.passStep(ctx, id, body.reason);
  }

  // ---- settings, committee, approvals -------------------------------------------------------------
  @Get('settings')
  @RequirePermission(PURCHASE.masterView)
  settings(@ReqCtx() ctx: RequestContext) {
    return this.setup.settings(ctx);
  }

  @Put('settings')
  @RequirePermission(PURCHASE.settingsManage)
  saveSettings(@ReqCtx() ctx: RequestContext, @Body() body: SettingsDto) {
    return this.setup.saveSettings(ctx, body);
  }

  @Post('committee')
  @RequirePermission(PURCHASE.settingsManage)
  addMember(@ReqCtx() ctx: RequestContext, @Body() body: CommitteeMemberDto) {
    return this.setup.addMember(ctx, body);
  }

  @Delete('committee/:id')
  @RequirePermission(PURCHASE.settingsManage)
  removeMember(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.setup.removeMember(ctx, id);
  }

  @Get('approvals')
  @ApiOperation({
    summary: 'Who approves each department’s PIs, PRs and POs, and its bypass rules',
  })
  @RequirePermission(PURCHASE.masterView)
  approvals(@ReqCtx() ctx: RequestContext) {
    return this.setup.approvals(ctx);
  }

  @Put('approvals/:departmentId/rules')
  @RequirePermission(PURCHASE.settingsManage)
  saveRules(
    @ReqCtx() ctx: RequestContext,
    @Param('departmentId') departmentId: string,
    @Body() body: DepartmentRulesDto,
  ) {
    return this.setup.saveRules(ctx, departmentId, body);
  }

  @Put('approvals/:departmentId/:doc')
  @RequirePermission(PURCHASE.settingsManage)
  saveLevels(
    @ReqCtx() ctx: RequestContext,
    @Param('departmentId') departmentId: string,
    @Param('doc') doc: string,
    @Body() body: DepartmentLevelsDto,
  ) {
    return this.setup.saveLevels(ctx, departmentId, doc, body);
  }

  @Get('copy-sources')
  @RequirePermission(PURCHASE.masterManage)
  copySources(@ReqCtx() ctx: RequestContext) {
    return this.setup.copySources(ctx);
  }

  @Post('copy-from')
  @ApiOperation({
    summary: 'Copy masters from another school of the group (vendors arrive pending)',
  })
  @RequirePermission(PURCHASE.masterManage)
  copyFrom(@ReqCtx() ctx: RequestContext, @Body() body: CopyFromDto) {
    return this.setup.copyFrom(ctx, body);
  }
}
