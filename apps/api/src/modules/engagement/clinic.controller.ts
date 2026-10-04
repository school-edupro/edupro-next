import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  CLINIC as P,
  CampDto,
  CheckupDto,
  ClinicDashboardDto,
  ClinicSettingsDto,
  ExportVisitsDto,
  FieldDto,
  ImportDto,
  MineHealthDto,
  SETUP_KINDS,
  SetupExportDto,
  SetupListDto,
  StockExportDto,
  StockListDto,
  ListVisitsDto,
  MasterDto,
  MedicineDto,
  PeopleQueryDto,
  StockInDto,
  VisitDto,
  WriteOffDto,
} from './clinic.dto';
import { ClinicService } from './clinic.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const file = (reply: FastifyReply, type: string, out: { bytes: Buffer; filename: string }) =>
  void reply
    .header('content-type', type)
    .header('content-disposition', `attachment; filename="${out.filename}"`)
    .send(out.bytes);

/**
 * Clinic management (0075): set-up, medicine stock, visits of pupils and staff, health check-up camps
 * with the health card, the dashboard, and the family's own view.
 */
@ApiTags('clinic')
@ApiBearerAuth()
@Controller('clinic')
export class ClinicController {
  constructor(private readonly svc: ClinicService) {}

  // ---- the family ------------------------------------------------------------------------------------
  @Get('mine')
  @RequirePermission(P.family)
  @ApiOperation({ summary: "My children's clinic visits and published health cards" })
  mine(@ReqCtx() ctx: RequestContext) {
    return this.svc.mine(ctx);
  }

  @Get('mine/list')
  @RequirePermission(P.family)
  @ApiOperation({
    summary: 'Clinic visits and health cards of my children together, with filters and pages',
  })
  mineList(@ReqCtx() ctx: RequestContext, @Query() q: MineHealthDto) {
    return this.svc.mineList(ctx, q);
  }

  @Get('mine/visits/:id')
  @RequirePermission(P.family)
  mineVisit(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.mineVisit(ctx, id);
  }

  @Get('mine/cards/:id/detail')
  @RequirePermission(P.family)
  mineCardDetail(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.mineCardDetail(ctx, id);
  }

  @Get('mine/cards/:id')
  @RequirePermission(P.family)
  @ApiOperation({ summary: 'A published health card as base64 (the portal speaks JSON)' })
  async mineCard(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    const out = await this.svc.mineCard(ctx, id);
    return { filename: out.filename, base64: out.bytes.toString('base64') };
  }

  // ---- set-up ----------------------------------------------------------------------------------------
  @Get('setup')
  @RequirePermission(P.setup, {
    description: 'Clinic set-up: clinics, doctors, nurses, diseases, medicines, check-up form',
  })
  setup(@ReqCtx() ctx: RequestContext) {
    return this.svc.setup(ctx);
  }

  @Get('setup/list')
  @RequirePermission(P.setup)
  @ApiOperation({
    summary: 'One set-up list (clinics, doctors, nurses, diseases, medicines) a page at a time',
  })
  setupList(@ReqCtx() ctx: RequestContext, @Query() q: SetupListDto) {
    return this.svc.setupList(ctx, q);
  }

  @Get('setup/export.xlsx')
  @RequirePermission(P.setup)
  async setupExcel(
    @ReqCtx() ctx: RequestContext,
    @Query() q: SetupExportDto,
    @Res() reply: FastifyReply,
  ) {
    file(reply, XLSX, await this.svc.setupExport(ctx, q, 'xlsx'));
  }

  @Get('setup/export.pdf')
  @RequirePermission(P.setup)
  async setupPdf(
    @ReqCtx() ctx: RequestContext,
    @Query() q: SetupExportDto,
    @Res() reply: FastifyReply,
  ) {
    file(reply, 'application/pdf', await this.svc.setupExport(ctx, q, 'pdf'));
  }

  @Get('setup/sample.xlsx')
  @RequirePermission(P.view)
  @ApiOperation({ summary: 'An Excel with the headings and one example row, to fill and upload' })
  async sample(@Query('kind') kind: string, @Res() reply: FastifyReply) {
    const k = ([...SETUP_KINDS, 'stock'] as string[]).includes(kind) ? kind : 'disease';
    file(reply, XLSX, await this.svc.sample(k));
  }

  @Post('setup/import')
  @HttpCode(200)
  @RequirePermission(P.setup)
  @ApiOperation({ summary: 'Upload a set-up list from Excel (existing names are updated)' })
  importSetup(@ReqCtx() ctx: RequestContext, @Body() dto: ImportDto) {
    return this.svc.importExcel(ctx, dto.kind === 'stock' ? { ...dto, kind: 'medicine' } : dto);
  }

  @Post('setup/fields')
  @RequirePermission(P.setup)
  @ApiOperation({
    summary: 'Add a field (in an existing or a new section) to the health check-up form',
  })
  addField(@ReqCtx() ctx: RequestContext, @Body() dto: FieldDto) {
    return this.svc.saveField(ctx, null, dto);
  }

  @Put('setup/fields/:id')
  @RequirePermission(P.setup)
  saveField(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: FieldDto) {
    return this.svc.saveField(ctx, id, dto);
  }

  @Put('setup/settings')
  @RequirePermission(P.setup)
  saveSettings(@ReqCtx() ctx: RequestContext, @Body() dto: ClinicSettingsDto) {
    return this.svc.saveSettings(ctx, dto);
  }

  @Post('setup/masters')
  @RequirePermission(P.setup)
  addMaster(@ReqCtx() ctx: RequestContext, @Body() dto: MasterDto) {
    return this.svc.saveMaster(ctx, null, dto);
  }

  @Put('setup/masters/:id')
  @RequirePermission(P.setup)
  saveMaster(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: MasterDto) {
    return this.svc.saveMaster(ctx, id, dto);
  }

  @Post('setup/medicines')
  @RequirePermission(P.setup)
  addMedicine(@ReqCtx() ctx: RequestContext, @Body() dto: MedicineDto) {
    return this.svc.saveMedicine(ctx, null, dto);
  }

  @Put('setup/medicines/:id')
  @RequirePermission(P.setup)
  saveMedicine(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: MedicineDto) {
    return this.svc.saveMedicine(ctx, id, dto);
  }

  // ---- reading (doctor, nurse, admin) ----------------------------------------------------------------
  @Get('options')
  @RequirePermission(P.view, {
    description: 'Read clinic visits, health check-ups, reports and the clinic dashboard',
  })
  options(@ReqCtx() ctx: RequestContext) {
    return this.svc.options(ctx);
  }

  @Get('dashboard')
  @RequirePermission(P.view)
  dashboard(@ReqCtx() ctx: RequestContext, @Query() q: ClinicDashboardDto) {
    return this.svc.dashboard(ctx, q);
  }

  @Get('stock')
  @RequirePermission(P.view)
  stock(@ReqCtx() ctx: RequestContext) {
    return this.svc.stock(ctx);
  }

  @Get('stock/list')
  @RequirePermission(P.view)
  @ApiOperation({ summary: 'In stock, batches or movements: filters and pages' })
  stockList(@ReqCtx() ctx: RequestContext, @Query() q: StockListDto) {
    return this.svc.stockList(ctx, q);
  }

  @Get('stock/export.xlsx')
  @RequirePermission(P.view)
  async stockExcel(
    @ReqCtx() ctx: RequestContext,
    @Query() q: StockExportDto,
    @Res() reply: FastifyReply,
  ) {
    file(reply, XLSX, await this.svc.stockExport(ctx, q, 'xlsx'));
  }

  @Get('stock/export.pdf')
  @RequirePermission(P.view)
  async stockPdf(
    @ReqCtx() ctx: RequestContext,
    @Query() q: StockExportDto,
    @Res() reply: FastifyReply,
  ) {
    file(reply, 'application/pdf', await this.svc.stockExport(ctx, q, 'pdf'));
  }

  @Get('visits')
  @RequirePermission(P.view)
  visits(@ReqCtx() ctx: RequestContext, @Query() q: ListVisitsDto) {
    return this.svc.visits(ctx, q);
  }

  @Get('visits.xlsx')
  @RequirePermission(P.view)
  async visitsExcel(
    @ReqCtx() ctx: RequestContext,
    @Query() q: ExportVisitsDto,
    @Res() reply: FastifyReply,
  ) {
    file(reply, XLSX, await this.svc.visitsExcel(ctx, q));
  }

  @Get('visits/:id')
  @RequirePermission(P.view)
  visit(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.visit(ctx, id);
  }

  @Get('people')
  @RequirePermission(P.view)
  people(@ReqCtx() ctx: RequestContext, @Query() q: PeopleQueryDto) {
    return this.svc.people(ctx, q);
  }

  @Get('history/:audience/:id')
  @RequirePermission(P.view)
  history(
    @ReqCtx() ctx: RequestContext,
    @Param('audience') audience: string,
    @Param('id') id: string,
  ) {
    return this.svc.history(ctx, audience === 'staff' ? 'staff' : 'student', id);
  }

  @Get('camps')
  @RequirePermission(P.view)
  camps(@ReqCtx() ctx: RequestContext) {
    return this.svc.camps(ctx);
  }

  @Get('camps/:id')
  @RequirePermission(P.view)
  camp(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.campDetail(ctx, id);
  }

  @Get('camps/:id/report.xlsx')
  @RequirePermission(P.view)
  async campExcel(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    file(reply, XLSX, await this.svc.campExcel(ctx, id));
  }

  @Get('camps/:id/sections/:sectionId')
  @RequirePermission(P.view)
  campSection(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
  ) {
    return this.svc.campSection(ctx, id, sectionId);
  }

  @Get('cards/:id/card.pdf')
  @RequirePermission(P.view)
  async card(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Res() reply: FastifyReply) {
    file(reply, 'application/pdf', await this.svc.card(ctx, id));
  }

  // ---- working (doctor, nurse) -----------------------------------------------------------------------
  @Post('visits')
  @RequirePermission(P.manage)
  @ApiOperation({ summary: 'Record a clinic visit; medicines given come out of stock' })
  createVisit(@ReqCtx() ctx: RequestContext, @Body() dto: VisitDto) {
    return this.svc.createVisit(ctx, dto);
  }

  @Post('visits/:id/out')
  @HttpCode(200)
  @RequirePermission(P.manage)
  closeVisit(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.closeVisit(ctx, id);
  }

  @Post('stock')
  @RequirePermission(P.manage)
  @ApiOperation({ summary: 'Receive a batch of a medicine' })
  receive(@ReqCtx() ctx: RequestContext, @Body() dto: StockInDto) {
    return this.svc.receiveStock(ctx, dto);
  }

  @Post('stock/import')
  @HttpCode(200)
  @RequirePermission(P.manage)
  @ApiOperation({ summary: 'Upload stock batches from Excel (opening stock)' })
  importStock(@ReqCtx() ctx: RequestContext, @Body() dto: ImportDto) {
    return this.svc.importExcel(ctx, { ...dto, kind: 'stock' });
  }

  @Post('stock/write-off')
  @HttpCode(200)
  @RequirePermission(P.manage)
  writeOff(@ReqCtx() ctx: RequestContext, @Body() dto: WriteOffDto) {
    return this.svc.writeOff(ctx, dto);
  }

  @Post('camps')
  @RequirePermission(P.manage)
  addCamp(@ReqCtx() ctx: RequestContext, @Body() dto: CampDto) {
    return this.svc.saveCamp(ctx, null, dto);
  }

  @Put('camps/:id')
  @RequirePermission(P.manage)
  saveCamp(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CampDto) {
    return this.svc.saveCamp(ctx, id, dto);
  }

  @Put('camps/:id/students/:studentId')
  @RequirePermission(P.manage)
  @ApiOperation({ summary: "Save one pupil's check-up in a camp" })
  saveCheckup(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @Body() dto: CheckupDto,
  ) {
    return this.svc.saveCheckup(ctx, id, studentId, dto);
  }

  @Post('camps/:id/sections/:sectionId/publish')
  @HttpCode(200)
  @RequirePermission(P.manage)
  @ApiOperation({ summary: 'Publish the saved cards of a class to the parents' })
  publish(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
  ) {
    return this.svc.publishSection(ctx, id, sectionId);
  }
}
