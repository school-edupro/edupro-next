import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PayrollHeadsService } from './payroll-heads.service';
import { PayrollPeopleService } from './payroll-people.service';
import { PayrollSetupService } from './payroll-setup.service';
import {
  ConfigKindSchema,
  ConfigListDto,
  DraftsQueryDto,
  EmployeesDto,
  EndRowDto,
  FormulaCheckDto,
  FormulaTestDto,
  HeadDto,
  HeadUpdateDto,
  MatrixCellDto,
  MatrixQueryDto,
  NomineesDto,
  PAYROLL,
  PayrollSettingsDto,
  ProfileDto,
  ProfileListDto,
  RevealDto,
  StructureDto,
  StructureImportDto,
  SyncDto,
  TaxQueryDto,
  TaxYearDto,
  TemplateDto,
  VersionDto,
} from './payroll.dto';

/** a path or query value checked: a wrong one is a 400, never a 500 */
function valid<T>(schema: z.ZodType<T>, v: unknown, what: string): T {
  const r = schema.safeParse(v);
  if (!r.success)
    throw new DomainError('validation-failed', `Not a valid ${what}`, { status: 400 });
  return r.data;
}
const id = (v: string) => valid(z.string().regex(/^\d{1,18}$/), v, 'id');
const kindOf = (v: string) =>
  valid(ConfigKindSchema, v, 'kind of set-up row (rates, pf, esi, pt, lwf, ot)');
const AsOf = z.object({
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Payroll set-up (docs/design/86, phase A). Rights are checked again in the services (maker / checker / admin). */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly setup: PayrollSetupService,
    private readonly heads: PayrollHeadsService,
    private readonly people: PayrollPeopleService,
  ) {}

  // ---- overview and settings ----------------------------------------------------------------------------
  @Get('setup')
  @ApiOperation({ summary: 'Payroll set-up: what is set, what is missing, the drafts waiting' })
  @RequirePermission(PAYROLL.view)
  overview(@ReqCtx() ctx: RequestContext) {
    return this.setup.overview(ctx);
  }

  @Get('settings')
  @ApiOperation({ summary: 'The payroll settings' })
  @RequirePermission(PAYROLL.view)
  settings(@ReqCtx() ctx: RequestContext) {
    return this.setup.settings(ctx);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Change the payroll settings (payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  saveSettings(@ReqCtx() ctx: RequestContext, @Body() dto: PayrollSettingsDto) {
    return this.setup.saveSettings(ctx, dto);
  }

  // ---- the dated rate registry (kind: rates, pf, esi, pt, lwf, ot) ------------------------------------------
  @Get('config/:kind')
  @ApiOperation({ summary: 'Dated set-up rows of a kind: rates, PF, ESI, PT slabs, LWF, OT rates' })
  @RequirePermission(PAYROLL.view)
  listConfig(
    @ReqCtx() ctx: RequestContext,
    @Param('kind') kind: string,
    @Query() q: ConfigListDto,
  ) {
    return this.setup.listConfig(ctx, kindOf(kind), q);
  }

  @Post('config/:kind')
  @ApiOperation({ summary: 'A new dated row, as a draft' })
  @RequirePermission(PAYROLL.manage)
  addConfig(@ReqCtx() ctx: RequestContext, @Param('kind') kind: string, @Body() body: unknown) {
    return this.setup.addConfig(ctx, kindOf(kind), body);
  }

  @Put('config/:kind/:id')
  @ApiOperation({ summary: 'Change a draft (its maker or a checker)' })
  @RequirePermission(PAYROLL.manage)
  editConfig(
    @ReqCtx() ctx: RequestContext,
    @Param('kind') kind: string,
    @Param('id') rowId: string,
    @Body() body: unknown,
  ) {
    return this.setup.editConfig(ctx, kindOf(kind), id(rowId), body);
  }

  @Delete('config/:kind/:id')
  @ApiOperation({ summary: 'Delete a draft (ACTIVE history is never removed)' })
  @RequirePermission(PAYROLL.manage)
  deleteConfig(
    @ReqCtx() ctx: RequestContext,
    @Param('kind') kind: string,
    @Param('id') rowId: string,
  ) {
    return this.setup.deleteConfig(ctx, kindOf(kind), id(rowId));
  }

  @Post('config/:kind/:id/approve')
  @ApiOperation({
    summary: 'Approve a draft (a checker who did not make it); the previous row gets an end date',
  })
  @RequirePermission(PAYROLL.approve)
  approveConfig(
    @ReqCtx() ctx: RequestContext,
    @Param('kind') kind: string,
    @Param('id') rowId: string,
  ) {
    return this.setup.approveConfig(ctx, kindOf(kind), id(rowId));
  }

  @Post('config/:kind/:id/end')
  @ApiOperation({ summary: 'End an ACTIVE row by hand (no month reads it after the date)' })
  @RequirePermission(PAYROLL.approve)
  endConfig(
    @ReqCtx() ctx: RequestContext,
    @Param('kind') kind: string,
    @Param('id') rowId: string,
    @Body() dto: EndRowDto,
  ) {
    return this.setup.endConfig(ctx, kindOf(kind), id(rowId), dto);
  }

  // ---- income tax by financial year ----------------------------------------------------------------------
  @Get('tax')
  @ApiOperation({ summary: 'Income-tax slabs, config, surcharge and labels of a financial year' })
  @RequirePermission(PAYROLL.view)
  tax(@ReqCtx() ctx: RequestContext, @Query() q: TaxQueryDto) {
    return this.setup.tax(ctx, q);
  }

  @Post('tax/years')
  @ApiOperation({ summary: 'Add a financial year copied from an earlier one (payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  addTaxYear(@ReqCtx() ctx: RequestContext, @Body() dto: TaxYearDto) {
    return this.setup.addTaxYear(ctx, dto);
  }

  // ---- pay heads ---------------------------------------------------------------------------------------------
  @Get('heads')
  @ApiOperation({ summary: 'Pay heads with the version in force today' })
  @RequirePermission(PAYROLL.view)
  listHeads(@ReqCtx() ctx: RequestContext) {
    return this.heads.heads(ctx);
  }

  @Post('heads')
  @ApiOperation({ summary: 'A new pay head with its first version (a draft)' })
  @RequirePermission(PAYROLL.manage)
  addHead(@ReqCtx() ctx: RequestContext, @Body() dto: HeadDto) {
    return this.heads.addHead(ctx, dto);
  }

  @Get('heads/:id')
  @ApiOperation({ summary: 'A pay head: its versions, slabs and saved tests' })
  @RequirePermission(PAYROLL.view)
  head(@ReqCtx() ctx: RequestContext, @Param('id') headId: string) {
    return this.heads.head(ctx, id(headId));
  }

  @Put('heads/:id')
  @ApiOperation({ summary: 'Change a head’s name, category, print order or status' })
  @RequirePermission(PAYROLL.manage)
  updateHead(
    @ReqCtx() ctx: RequestContext,
    @Param('id') headId: string,
    @Body() dto: HeadUpdateDto,
  ) {
    return this.heads.updateHead(ctx, id(headId), dto);
  }

  @Post('heads/:id/versions')
  @ApiOperation({ summary: 'A new version of a head, as a draft (its saved tests must pass)' })
  @RequirePermission(PAYROLL.manage)
  addVersion(@ReqCtx() ctx: RequestContext, @Param('id') headId: string, @Body() dto: VersionDto) {
    return this.heads.addVersion(ctx, id(headId), dto);
  }

  @Put('head-versions/:id')
  @ApiOperation({ summary: 'Change a draft version' })
  @RequirePermission(PAYROLL.manage)
  editVersion(
    @ReqCtx() ctx: RequestContext,
    @Param('id') versionId: string,
    @Body() dto: VersionDto,
  ) {
    return this.heads.editVersion(ctx, id(versionId), dto);
  }

  @Delete('head-versions/:id')
  @ApiOperation({ summary: 'Delete a draft version' })
  @RequirePermission(PAYROLL.manage)
  deleteVersion(@ReqCtx() ctx: RequestContext, @Param('id') versionId: string) {
    return this.heads.deleteVersion(ctx, id(versionId));
  }

  @Post('head-versions/:id/approve')
  @ApiOperation({
    summary: 'Approve a draft version (a checker who did not make it; its tests must pass)',
  })
  @RequirePermission(PAYROLL.approve)
  approveVersion(@ReqCtx() ctx: RequestContext, @Param('id') versionId: string) {
    return this.heads.approveVersion(ctx, id(versionId));
  }

  @Post('head-versions/:id/end')
  @ApiOperation({ summary: 'End an ACTIVE version by hand' })
  @RequirePermission(PAYROLL.approve)
  endVersion(
    @ReqCtx() ctx: RequestContext,
    @Param('id') versionId: string,
    @Body() dto: EndRowDto,
  ) {
    return this.heads.endVersion(ctx, id(versionId), dto);
  }

  @Post('formula/check')
  @ApiOperation({ summary: 'Check a formula as typed, and try it with values' })
  @RequirePermission(PAYROLL.view)
  checkFormula(@ReqCtx() ctx: RequestContext, @Body() dto: FormulaCheckDto) {
    return this.heads.checkFormula(ctx, dto);
  }

  @Post('heads/:id/tests')
  @ApiOperation({ summary: 'Save a formula test for a head' })
  @RequirePermission(PAYROLL.manage)
  addTest(@ReqCtx() ctx: RequestContext, @Param('id') headId: string, @Body() dto: FormulaTestDto) {
    return this.heads.addTest(ctx, id(headId), dto);
  }

  @Post('heads/:id/tests/run')
  @ApiOperation({
    summary: 'Run a head’s saved tests against its newest draft, else the version in force',
  })
  @RequirePermission(PAYROLL.view)
  runTests(@ReqCtx() ctx: RequestContext, @Param('id') headId: string) {
    return this.heads.runHeadTests(ctx, id(headId));
  }

  @Delete('formula-tests/:id')
  @ApiOperation({ summary: 'Delete a saved formula test' })
  @RequirePermission(PAYROLL.manage)
  deleteTest(@ReqCtx() ctx: RequestContext, @Param('id') testId: string) {
    return this.heads.deleteTest(ctx, id(testId));
  }

  // ---- the pay matrix ----------------------------------------------------------------------------------------
  @Get('matrix')
  @ApiOperation({ summary: 'The pay matrix: levels × cells of basic pay' })
  @RequirePermission(PAYROLL.view)
  matrix(@ReqCtx() ctx: RequestContext, @Query() q: MatrixQueryDto) {
    return this.heads.matrix(ctx, q);
  }

  @Put('matrix/cell')
  @ApiOperation({ summary: 'Add or correct a cell (a checker)' })
  @RequirePermission(PAYROLL.approve)
  saveCell(@ReqCtx() ctx: RequestContext, @Body() dto: MatrixCellDto) {
    return this.heads.saveCell(ctx, dto);
  }

  @Delete('matrix/:code/:level')
  @ApiOperation({
    summary: 'Remove a cell (?cell=) or a whole level; refused while a profile uses it',
  })
  @RequirePermission(PAYROLL.approve)
  deleteCell(
    @ReqCtx() ctx: RequestContext,
    @Param('code') code: string,
    @Param('level') level: string,
    @Query('cell') cell?: string,
  ) {
    const cellNo = cell ? valid(z.coerce.number().int().min(1).max(60), cell, 'cell') : null;
    return this.heads.deleteCell(
      ctx,
      valid(z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/), code, 'matrix code'),
      valid(z.string().min(1).max(20), level, 'pay level'),
      cellNo,
    );
  }

  // ---- profiles ---------------------------------------------------------------------------------------------
  @Get('profiles')
  @ApiOperation({
    summary: 'Payroll profiles of the active staff (masked PAN and bank), with figures',
  })
  @RequirePermission(PAYROLL.view)
  profiles(@ReqCtx() ctx: RequestContext, @Query() q: ProfileListDto) {
    return this.people.profiles(ctx, q);
  }

  @Post('profiles/sync')
  @ApiOperation({ summary: 'Profiles for the active staff who have none (dryRun lists them)' })
  @RequirePermission(PAYROLL.manage)
  sync(@ReqCtx() ctx: RequestContext, @Body() dto: SyncDto) {
    return this.people.sync(ctx, dto);
  }

  @Get('profiles/:employeeId')
  @ApiOperation({ summary: 'An employee’s payroll profile, nominees and change history' })
  @RequirePermission(PAYROLL.view)
  profile(@ReqCtx() ctx: RequestContext, @Param('employeeId') employeeId: string) {
    return this.people.profile(ctx, id(employeeId));
  }

  @Put('profiles/:employeeId')
  @ApiOperation({ summary: 'Make or change a payroll profile (each change kept with its date)' })
  @RequirePermission(PAYROLL.manage)
  saveProfile(
    @ReqCtx() ctx: RequestContext,
    @Param('employeeId') employeeId: string,
    @Body() dto: ProfileDto,
  ) {
    return this.people.saveProfile(ctx, id(employeeId), dto);
  }

  @Put('profiles/:employeeId/nominees')
  @ApiOperation({ summary: 'Replace the nominees (each purpose’s shares make 100 %)' })
  @RequirePermission(PAYROLL.manage)
  saveNominees(
    @ReqCtx() ctx: RequestContext,
    @Param('employeeId') employeeId: string,
    @Body() dto: NomineesDto,
  ) {
    return this.people.saveNominees(ctx, id(employeeId), dto);
  }

  @Post('profiles/:employeeId/reveal')
  @ApiOperation({ summary: 'The full PAN, Aadhaar or bank account, with a reason (logged)' })
  @RequirePermission(PAYROLL.reveal)
  reveal(
    @ReqCtx() ctx: RequestContext,
    @Param('employeeId') employeeId: string,
    @Body() dto: RevealDto,
  ) {
    return this.people.reveal(ctx, id(employeeId), dto);
  }

  // ---- salary structures and templates ------------------------------------------------------------------------
  @Get('structures/drafts')
  @ApiOperation({ summary: 'The staff whose structure drafts wait for a checker' })
  @RequirePermission(PAYROLL.view)
  drafts(@ReqCtx() ctx: RequestContext, @Query() q: DraftsQueryDto) {
    return this.people.drafts(ctx, q);
  }

  @Post('structures/approve')
  @ApiOperation({
    summary: 'Approve the drafts of the employees named, all or nothing per employee',
  })
  @RequirePermission(PAYROLL.approve)
  approveStructures(@ReqCtx() ctx: RequestContext, @Body() dto: EmployeesDto) {
    return this.people.approveStructures(ctx, dto);
  }

  @Post('structures/drafts/delete')
  @ApiOperation({ summary: 'Delete the structure drafts of the employees named' })
  @RequirePermission(PAYROLL.manage)
  deleteDrafts(@ReqCtx() ctx: RequestContext, @Body() dto: EmployeesDto) {
    return this.people.deleteStructureDrafts(ctx, dto);
  }

  @Get('structures/format')
  @ApiOperation({ summary: 'The structure sheet to fill, with the amounts in force' })
  @RequirePermission(PAYROLL.manage)
  structureFormat(@ReqCtx() ctx: RequestContext) {
    return this.people.structureFormat(ctx);
  }

  @Post('structures/import')
  @ApiOperation({ summary: 'Structures from the sheet: checked (dryRun), then saved as drafts' })
  @RequirePermission(PAYROLL.manage)
  importStructures(@ReqCtx() ctx: RequestContext, @Body() dto: StructureImportDto) {
    return this.people.importStructures(ctx, dto);
  }

  @Get('structures/:employeeId')
  @ApiOperation({ summary: 'An employee’s structure: amounts in force, drafts and the timeline' })
  @RequirePermission(PAYROLL.view)
  structure(
    @ReqCtx() ctx: RequestContext,
    @Param('employeeId') employeeId: string,
    @Query() q: Record<string, string>,
  ) {
    return this.people.structure(ctx, id(employeeId), valid(AsOf, q, 'date').asOf);
  }

  @Post('structures/:employeeId')
  @ApiOperation({ summary: 'Save an employee’s structure as drafts from a date' })
  @RequirePermission(PAYROLL.manage)
  saveStructure(
    @ReqCtx() ctx: RequestContext,
    @Param('employeeId') employeeId: string,
    @Body() dto: StructureDto,
  ) {
    return this.people.saveStructure(ctx, id(employeeId), dto);
  }

  @Get('templates')
  @ApiOperation({ summary: 'The salary-structure templates' })
  @RequirePermission(PAYROLL.view)
  templates(@ReqCtx() ctx: RequestContext) {
    return this.people.templates(ctx);
  }

  @Post('templates')
  @ApiOperation({ summary: 'A structure template (payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  addTemplate(@ReqCtx() ctx: RequestContext, @Body() dto: TemplateDto) {
    return this.people.saveTemplate(ctx, null, dto);
  }

  @Put('templates/:id')
  @ApiOperation({ summary: 'Change a structure template (payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  updateTemplate(
    @ReqCtx() ctx: RequestContext,
    @Param('id') templateId: string,
    @Body() dto: TemplateDto,
  ) {
    return this.people.saveTemplate(ctx, id(templateId), dto);
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: 'Delete a structure template (payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  deleteTemplate(@ReqCtx() ctx: RequestContext, @Param('id') templateId: string) {
    return this.people.deleteTemplate(ctx, id(templateId));
  }
}
