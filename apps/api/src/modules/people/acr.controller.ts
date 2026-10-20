import {
  Delete,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  AcrFormLevelsDto,
  AcrSectionDto,
  AcrFormDto,
  AcrFormCopyDto,
  AcrAssessorsQueryDto,
  AcrAssessorsSaveDto,
  AcrCycleDto,
  AcrDecideDto,
  AcrLevelDto,
  AcrLevelsDto,
  AcrOfficeFactsDto,
  AcrQuestionDto,
  AcrReasonDto,
  AcrRepresentDto,
  AcrReviewersDto,
  AcrSelfDto,
  AcrSettingsDto,
  AcrPdfDto,
} from './acr.dto';
import { CreateUploadDto } from '../files/files.dto';
import { AcrFlowService } from './acr-flow.service';
import { AcrSetupService } from './acr-setup.service';
import { PEOPLE } from './people.permissions';

/** Employee ACR (docs/design/32-employee-acr.md). */
@ApiTags('people')
@ApiBearerAuth()
@Controller('people/acr')
export class AcrController {
  constructor(
    private readonly setup: AcrSetupService,
    private readonly flow: AcrFlowService,
  ) {}

  @Get('setup')
  @ApiOperation({ summary: 'ACR set-up: rating words, grade bands, levels, questions, cycles' })
  @RequirePermission(PEOPLE.acrView)
  view(@ReqCtx() ctx: RequestContext) {
    return this.setup.view(ctx);
  }

  @Put('setup/settings')
  @ApiOperation({ summary: 'Rating words, days to object, grade bands' })
  @RequirePermission(PEOPLE.acrManage)
  settings(@ReqCtx() ctx: RequestContext, @Body() body: AcrSettingsDto) {
    return this.setup.saveSettings(ctx, body);
  }

  @Get('setup/assessors')
  @ApiOperation({
    summary: 'Who assesses each employee (the employee-wise levels), and who is missing',
  })
  @RequirePermission(PEOPLE.acrView)
  assessors(@ReqCtx() ctx: RequestContext, @Query() q: AcrAssessorsQueryDto) {
    return this.setup.assessors(ctx, q);
  }

  @Put('setup/assessors')
  @ApiOperation({ summary: 'Assign assessors on the employees’ records (by id or employee code)' })
  @RequirePermission(PEOPLE.acrManage)
  async saveAssessors(@ReqCtx() ctx: RequestContext, @Body() body: AcrAssessorsSaveDto) {
    const saved = await this.setup.saveAssessors(ctx, body);
    // the ACRs of the open cycles follow the records at once (levels not yet done)
    const openAcrs = await this.flow.refreshEmployees(ctx, saved.employeeIds);
    return { changed: saved.changed, errors: saved.errors, openAcrs };
  }

  @Put('setup/levels')
  @ApiOperation({ summary: 'The levels of teaching or non-teaching ACRs, in order' })
  @RequirePermission(PEOPLE.acrManage)
  async levels(@ReqCtx() ctx: RequestContext, @Body() body: AcrLevelsDto) {
    const out = await this.setup.saveLevels(ctx, body);
    // the ACRs of the open cycles follow the set-up at once (chains still at the self-appraisal)
    await this.flow.refreshOpenCycles(ctx);
    return out;
  }

  @Post('setup/forms')
  @ApiOperation({
    summary: 'Add a form: a self-appraisal of a staff category, or a level’s questionnaire',
  })
  @RequirePermission(PEOPLE.acrManage)
  async addForm(@ReqCtx() ctx: RequestContext, @Body() body: AcrFormDto) {
    const out = await this.setup.saveForm(ctx, null, body);
    await this.flow.refreshOpenCycles(ctx);
    return out;
  }

  @Put('setup/forms/:id')
  @ApiOperation({ summary: 'Change a form (name, who it is for, on or off)' })
  @RequirePermission(PEOPLE.acrManage)
  async editForm(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AcrFormDto) {
    const out = await this.setup.saveForm(ctx, id, body);
    await this.flow.refreshOpenCycles(ctx);
    return out;
  }

  @Put('setup/forms/:id/levels')
  @ApiOperation({ summary: 'Which approval levels answer this questionnaire (set from the form)' })
  @RequirePermission(PEOPLE.acrManage)
  async formLevels(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: AcrFormLevelsDto,
  ) {
    const out = await this.setup.setFormLevels(ctx, id, body);
    await this.flow.refreshOpenCycles(ctx);
    return out;
  }

  @Post('setup/forms/:id/copy')
  @ApiOperation({ summary: 'Copy a form with its sections and questions as the start of another' })
  @RequirePermission(PEOPLE.acrManage)
  copyForm(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AcrFormCopyDto) {
    return this.setup.copyForm(ctx, id, body);
  }

  @Post('setup/sections')
  @ApiOperation({ summary: 'Add a section to a form' })
  @RequirePermission(PEOPLE.acrManage)
  addSection(@ReqCtx() ctx: RequestContext, @Body() body: AcrSectionDto) {
    return this.setup.saveSection(ctx, null, body);
  }

  @Put('setup/sections/:id')
  @ApiOperation({ summary: 'Change a section (title, help, weight, order)' })
  @RequirePermission(PEOPLE.acrManage)
  editSection(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AcrSectionDto) {
    return this.setup.saveSection(ctx, id, body);
  }

  @Delete('setup/sections/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove an empty section' })
  @RequirePermission(PEOPLE.acrManage)
  removeSection(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.setup.deleteSection(ctx, id);
  }

  @Post('setup/questions')
  @ApiOperation({ summary: 'Add a question to a section of a form' })
  @RequirePermission(PEOPLE.acrManage)
  addQuestion(@ReqCtx() ctx: RequestContext, @Body() body: AcrQuestionDto) {
    return this.setup.saveQuestion(ctx, null, body);
  }

  @Put('setup/questions/:id')
  @ApiOperation({ summary: 'Change a question (or switch it off)' })
  @RequirePermission(PEOPLE.acrManage)
  editQuestion(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: AcrQuestionDto,
  ) {
    return this.setup.saveQuestion(ctx, id, body);
  }

  @Post('cycles')
  @ApiOperation({ summary: 'A cycle for a year with its self-appraisal window' })
  @RequirePermission(PEOPLE.acrManage)
  addCycle(@ReqCtx() ctx: RequestContext, @Body() body: AcrCycleDto) {
    return this.setup.saveCycle(ctx, null, body);
  }

  @Put('cycles/:id')
  @ApiOperation({ summary: 'Change a cycle’s name or dates' })
  @RequirePermission(PEOPLE.acrManage)
  editCycle(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AcrCycleDto) {
    return this.setup.saveCycle(ctx, id, body);
  }

  // ---- the flow (part 2) ----

  @Post('cycles/:id/start')
  @ApiOperation({
    summary: 'Open a cycle: an ACR for every active employee (again for later joiners)',
  })
  @RequirePermission(PEOPLE.acrManage)
  start(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.flow.start(ctx, id);
  }

  @Post('pdf')
  @ApiOperation({ summary: 'The ACR PDF: one ACR, or the ACRs shown on the board, as an export' })
  @RequirePermission(PEOPLE.acrView)
  pdf(@ReqCtx() ctx: RequestContext, @Body() body: AcrPdfDto) {
    return this.flow.requestPdf(ctx, body.ids);
  }

  @Post('cycles/:id/reresolve')
  @ApiOperation({
    summary: 'Read the assessors again for the levels not yet done in an open cycle',
  })
  @RequirePermission(PEOPLE.acrManage)
  reresolve(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.flow.reresolve(ctx, id);
  }

  @Post('cycles/:id/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close a cycle' })
  @RequirePermission(PEOPLE.acrManage)
  close(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.flow.closeCycle(ctx, id);
  }

  @Get('board')
  @ApiOperation({ summary: 'Every ACR of a cycle with where it stands' })
  @RequirePermission(PEOPLE.acrView)
  board(@ReqCtx() ctx: RequestContext, @Query('cycle') cycle?: string) {
    return this.flow.board(ctx, cycle && /^\d{1,18}$/.test(cycle) ? cycle : undefined);
  }

  @Get('employee/:id')
  @ApiOperation({ summary: 'One employee’s ACRs' })
  @RequirePermission(PEOPLE.acrView)
  ofEmployee(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.flow.ofEmployee(ctx, id);
  }

  @Get('mine')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'My ACRs' })
  mine(@ReqCtx() ctx: RequestContext) {
    return this.flow.mine(ctx);
  }

  @Get('to-assess')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'ACRs waiting on me at a level, and those I filled' })
  toAssess(@ReqCtx() ctx: RequestContext) {
    return this.flow.toAssess(ctx);
  }

  @Get('reports/:id')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'One ACR, as far as the viewer may see it' })
  report(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.flow.view(ctx, id);
  }

  @Put('reports/:id/self')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Save my self-appraisal (draft)' })
  saveSelf(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AcrSelfDto) {
    return this.flow.saveSelf(ctx, id, body);
  }

  @Post('reports/:id/files')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'An upload slot for a file to attach to an answer (0194)' })
  upload(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: CreateUploadDto) {
    return this.flow.requestUpload(ctx, id, body);
  }

  @Get('reports/:id/files/:fileId')
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'A file on the employee’s record, for whoever may see the ACR: a signed address',
  })
  file(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.flow.fileUrl(ctx, id, fileId);
  }

  @Post('reports/:id/self/submit')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Submit my self-appraisal to the first level' })
  submitSelf(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AcrSelfDto) {
    return this.flow.submitSelf(ctx, id, body);
  }

  @Put('reports/:id/levels/:seq')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Save my level (draft)' })
  saveLevel(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('seq', ParseIntPipe) seq: number,
    @Body() body: AcrLevelDto,
  ) {
    return this.flow.saveLevel(ctx, id, seq, body);
  }

  @Post('reports/:id/levels/:seq/submit')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Submit my level; the last one shows the ACR to the employee' })
  submitLevel(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('seq', ParseIntPipe) seq: number,
    @Body() body: AcrLevelDto,
  ) {
    return this.flow.submitLevel(ctx, id, seq, body);
  }

  @Post('reports/:id/send-back')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Send it back one step with a reason' })
  sendBack(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AcrReasonDto) {
    return this.flow.sendBack(ctx, id, body);
  }

  @Put('reports/:id/levels/:seq/people')
  @ApiOperation({ summary: 'Who fills a level of this ACR' })
  @RequirePermission(PEOPLE.acrManage)
  people(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('seq', ParseIntPipe) seq: number,
    @Body() body: AcrReviewersDto,
  ) {
    return this.flow.setReviewers(ctx, id, seq, body);
  }

  @Put('reports/:id/office')
  @ApiOperation({ summary: 'The office’s figures for the year (leave taken)' })
  @RequirePermission(PEOPLE.acrManage)
  office(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AcrOfficeFactsDto) {
    return this.flow.officeFacts(ctx, id, body);
  }

  @Post('reports/:id/acknowledge')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'I have seen my ACR' })
  acknowledge(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.flow.acknowledge(ctx, id);
  }

  @Post('reports/:id/represent')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Object to an adverse grade within the days set' })
  represent(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AcrRepresentDto) {
    return this.flow.represent(ctx, id, body);
  }

  @Post('reports/:id/decide')
  @HttpCode(200)
  @ApiOperation({ summary: 'Decide an objection: grade upheld or revised' })
  @RequirePermission(PEOPLE.acrManage)
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AcrDecideDto) {
    return this.flow.decide(ctx, id, body);
  }
}
