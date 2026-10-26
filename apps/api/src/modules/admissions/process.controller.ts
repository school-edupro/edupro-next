import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ADMISSIONS } from './admissions.dto';
import {
  AllotDto,
  BulkDecideDto,
  DecideDto,
  OfficeCorrectDto,
  PointsCheckDto,
  ProcessDto,
  RegistrationsQueryDto,
  SelectIdsDto,
  SelectionDrawDto,
  SelectionNextDto,
  SendBackDto,
  SlotDto,
  SlotResultsDto,
  StagesDto,
  UndoDto,
  WaitingQueryDto,
} from './process.dto';
import {
  ADMISSION_DECIDE,
  ADMISSION_SCHEDULE,
  ADMISSION_SETUP_MANAGE,
  AdmissionProcessService,
} from './process.service';
import { AdmissionGridExportDto, AdmissionGridDto } from './grid.dto';
import { AdmissionGridService } from './grid.service';
import { AdmissionScheduleService } from './schedule.service';

/**
 * The approval process of online admission (docs/design/39, part 4): stages and processes in Admission
 * set-up; the registrations with their steps; decisions, corrections and undo; test / interview slots;
 * selection with offers and the waiting list.
 */
@ApiTags('admissions')
@ApiBearerAuth()
@Controller('admissions')
export class AdmissionProcessController {
  constructor(
    private readonly process: AdmissionProcessService,
    private readonly schedule: AdmissionScheduleService,
    private readonly gridSvc: AdmissionGridService,
  ) {}

  // ---- the admissions list (part 7) -----------------------------------------------------------------
  @Get('overview')
  @ApiOperation({
    summary: 'The admissions dashboard of a session: figures, funnel per class, last 30 days',
  })
  @RequirePermission(ADMISSIONS.applicationView)
  overview(@ReqCtx() ctx: RequestContext, @Query('cycleId') cycleId?: string) {
    return this.gridSvc.overview(ctx, cycleId && /^\d{1,18}$/.test(cycleId) ? cycleId : undefined);
  }

  @Get('registrations/grid/fields')
  @ApiOperation({
    summary: 'Columns and filters of the admissions list (the Admissions report dataset)',
  })
  @RequirePermission(ADMISSIONS.applicationView)
  gridFields(@ReqCtx() ctx: RequestContext) {
    return this.gridSvc.fields(ctx);
  }

  @Post('registrations/grid')
  @RequirePermission(ADMISSIONS.applicationView)
  grid(@ReqCtx() ctx: RequestContext, @Body() dto: AdmissionGridDto) {
    return this.gridSvc.grid(ctx, dto);
  }

  @Post('registrations/grid/export')
  @RequirePermission(ADMISSIONS.applicationView)
  gridExport(@ReqCtx() ctx: RequestContext, @Body() dto: AdmissionGridExportDto) {
    return this.gridSvc.export(ctx, dto);
  }

  // ---- set-up -----------------------------------------------------------------------------------
  @Get('process-setup')
  @ApiOperation({
    summary:
      'Stages, processes with their classes, and who can approve (roles, designations, staff)',
  })
  @RequirePermission(ADMISSIONS.cycleView)
  setup(@ReqCtx() ctx: RequestContext) {
    return this.process.setup(ctx);
  }

  @Put('stages')
  @RequirePermission(ADMISSION_SETUP_MANAGE)
  saveStages(@ReqCtx() ctx: RequestContext, @Body() dto: StagesDto) {
    return this.process.saveStages(ctx, dto);
  }

  @Post('processes')
  @RequirePermission(ADMISSION_SETUP_MANAGE)
  createProcess(@ReqCtx() ctx: RequestContext, @Body() dto: ProcessDto) {
    return this.process.saveProcess(ctx, null, dto);
  }

  @Put('processes/:id')
  @ApiOperation({
    summary:
      'Change a process; reaching registrations in progress needs confirm: true (409 tells how many)',
  })
  @RequirePermission(ADMISSION_SETUP_MANAGE)
  updateProcess(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ProcessDto) {
    return this.process.saveProcess(ctx, id, dto);
  }

  @Delete('processes/:id')
  @RequirePermission(ADMISSION_SETUP_MANAGE)
  archiveProcess(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.process.archiveProcess(ctx, id);
  }

  // ---- registrations ----------------------------------------------------------------------------
  @Get('registrations')
  @ApiOperation({
    summary: 'Registrations of online admission with their stage, category and merit',
  })
  @RequirePermission(ADMISSIONS.applicationView)
  list(@ReqCtx() ctx: RequestContext, @Query() q: RegistrationsQueryDto) {
    return this.process.list(ctx, q);
  }

  @Get('registrations/mine')
  @ApiOperation({
    summary: 'Registrations waiting at a level this user may decide (oldest first; overdue count)',
  })
  @RequirePermission(ADMISSIONS.applicationView)
  waiting(@ReqCtx() ctx: RequestContext, @Query() q: WaitingQueryDto) {
    return this.process.waiting(ctx, q);
  }

  @Post('registrations/bulk-decide')
  @ApiOperation({
    summary: 'Approve, reject or hold several registrations waiting at the same stage and level',
  })
  @RequirePermission(ADMISSION_DECIDE)
  bulkDecide(@ReqCtx() ctx: RequestContext, @Body() dto: BulkDecideDto) {
    return this.process.bulkDecide(ctx, dto);
  }

  @Get('registrations/:id')
  @RequirePermission(ADMISSIONS.applicationView)
  detail(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.process.detail(ctx, id);
  }

  @Post('registrations/:id/decide')
  @ApiOperation({
    summary: 'Approve, reject, hold, offer or wait-list at the level the registration waits at',
  })
  @RequirePermission(ADMISSION_DECIDE, {
    description:
      'Decide on registrations at the approval levels: approve, send back, reject, record marks',
  })
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: DecideDto) {
    return this.process.decide(ctx, id, dto);
  }

  @Post('registrations/:id/send-back')
  @ApiOperation({
    summary: 'Send the form back to the family to correct the marked answers (emailed)',
  })
  @RequirePermission(ADMISSION_DECIDE)
  sendBack(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: SendBackDto) {
    return this.process.sendBack(ctx, id, dto);
  }

  @Post('registrations/:id/correct')
  @ApiOperation({
    summary:
      'Correct answers of a submitted application before Admit; each change kept with its old and new value',
  })
  @RequirePermission(ADMISSIONS.applicationReview)
  correct(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: OfficeCorrectDto) {
    return this.process.officeCorrect(ctx, id, dto);
  }

  @Post('registrations/:id/points')
  @ApiOperation({
    summary:
      'Confirm the merit points of a registration (a criterion awarded differently needs a reason), or work them out again',
  })
  @RequirePermission(ADMISSIONS.applicationReview)
  points(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: PointsCheckDto) {
    return this.process.checkPoints(ctx, id, dto);
  }

  @Post('registrations/:id/undo')
  @RequirePermission(ADMISSION_DECIDE)
  undo(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UndoDto) {
    return this.process.undo(ctx, id, dto);
  }

  @Get('registrations/:id/admit-card')
  @RequirePermission(ADMISSIONS.applicationView)
  admitCard(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.schedule.admitCard(ctx, id);
  }

  // ---- slots ------------------------------------------------------------------------------------
  @Get('cycles/:id/slots')
  @RequirePermission(ADMISSIONS.applicationView)
  slots(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.schedule.slots(ctx, id);
  }

  @Post('cycles/:id/slots')
  @RequirePermission(ADMISSION_SCHEDULE, {
    description:
      'Set test and interview slots, allot candidates, make offers and keep the waiting list',
  })
  createSlot(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: SlotDto) {
    return this.schedule.createSlot(ctx, id, dto);
  }

  @Get('slots/:id')
  @RequirePermission(ADMISSIONS.applicationView)
  slot(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.schedule.slot(ctx, id);
  }

  @Put('slots/:id')
  @RequirePermission(ADMISSION_SCHEDULE)
  updateSlot(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: SlotDto) {
    return this.schedule.updateSlot(ctx, id, dto);
  }

  @Delete('slots/:id')
  @RequirePermission(ADMISSION_SCHEDULE)
  deleteSlot(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.schedule.deleteSlot(ctx, id);
  }

  @Post('slots/:id/allot')
  @RequirePermission(ADMISSION_SCHEDULE)
  allot(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: AllotDto) {
    return this.schedule.allot(ctx, id, dto);
  }

  @Delete('slots/:id/candidates/:applicationId')
  @RequirePermission(ADMISSION_SCHEDULE)
  unallot(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('applicationId') applicationId: string,
  ) {
    return this.schedule.unallot(ctx, id, applicationId);
  }

  @Put('slots/:id/results')
  @ApiOperation({ summary: 'Attendance, marks and the decision of the candidates of a slot' })
  @RequirePermission(ADMISSION_DECIDE)
  results(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: SlotResultsDto) {
    return this.schedule.results(ctx, id, dto);
  }

  // ---- selection --------------------------------------------------------------------------------
  @Get('cycles/:id/selection/:classId')
  @ApiOperation({ summary: 'Merit list, seats per category, offers and waiting list of a class' })
  @RequirePermission(ADMISSIONS.applicationView)
  selection(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('classId') classId: string,
  ) {
    return this.schedule.selection(ctx, id, classId);
  }

  @Get('cycles/:id/selection/:classId/merit-list')
  @ApiOperation({
    summary:
      'The merit list of a class (PDF): criteria, the tie-break rule and its seed, the ranks',
  })
  @RequirePermission(ADMISSIONS.applicationView)
  meritList(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('classId') classId: string,
  ) {
    return this.schedule.meritList(ctx, id, classId);
  }

  @Post('cycles/:id/selection/offer')
  @RequirePermission(ADMISSION_SCHEDULE)
  offer(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: SelectIdsDto) {
    return this.schedule.offer(ctx, id, dto);
  }

  @Post('cycles/:id/selection/waitlist')
  @RequirePermission(ADMISSION_SCHEDULE)
  waitlist(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: SelectIdsDto) {
    return this.schedule.waitlist(ctx, id, dto);
  }

  @Post('cycles/:id/selection/draw')
  @ApiOperation({
    summary: 'A replayable draw: the first seats offered, the rest wait-listed in draw order',
  })
  @RequirePermission(ADMISSION_SCHEDULE)
  draw(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: SelectionDrawDto) {
    return this.schedule.draw(ctx, id, dto);
  }

  @Post('cycles/:id/selection/next')
  @RequirePermission(ADMISSION_SCHEDULE)
  next(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: SelectionNextDto) {
    return this.schedule.next(ctx, id, dto);
  }
}
