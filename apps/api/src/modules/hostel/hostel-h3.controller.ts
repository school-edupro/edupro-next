import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  DecideDto,
  DietDto,
  HOSTEL,
  HOSTEL_H3,
  MealDto,
  MealRollQueryDto,
  MealRollSaveDto,
  MenuChangeDto,
  MenuQueryDto,
  MenuWeekDto,
  VisitCheckDto,
  VisitDecideDto,
  VisitDto,
  VisitHoursDto,
  VisitorAddDto,
  VisitorsQueryDto,
  VisitsQueryDto,
} from './hostel.dto';
import { HostelMessService } from './hostel-mess.service';
import { HostelVisitsService } from './hostel-visits.service';

const send = (reply: FastifyReply, p: { contentType: string; bytes: Buffer }) =>
  void reply
    .header('content-type', p.contentType)
    .header('cache-control', 'private, max-age=300')
    .send(p.bytes);

/** Hostel module H3: approved visitors, visiting hours, hostel visits at the gate, and the mess. */
@ApiTags('hostel')
@ApiBearerAuth()
@Controller('hostel')
export class HostelH3Controller {
  constructor(
    private readonly visits: HostelVisitsService,
    private readonly mess: HostelMessService,
  ) {}

  // ---- the family -------------------------------------------------------------------------------------
  @Get('mine/visitors')
  @ApiOperation({
    summary: "A child's approved-visitor list: parents on record and the people added",
  })
  @RequirePermission(HOSTEL_H3.family)
  familyVisitors(@ReqCtx() ctx: RequestContext, @Query('studentId') studentId: string) {
    return this.visits.familyList(ctx, studentId);
  }

  @Post('mine/visitors')
  @ApiOperation({ summary: 'A parent adds a visitor; a warden approves' })
  @RequirePermission(HOSTEL_H3.family)
  familyAdd(@ReqCtx() ctx: RequestContext, @Body() dto: VisitorAddDto) {
    return this.visits.familyAdd(ctx, dto);
  }

  @Delete('mine/visitors/:id')
  @RequirePermission(HOSTEL_H3.family)
  familyRemove(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.visits.familyRemove(ctx, id);
  }

  @Get('mine/visitors/:id/photo')
  @RequirePermission(HOSTEL_H3.family)
  async familyPhoto(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    send(reply, await this.visits.photo(ctx, id, true));
  }

  @Get('mine/menu')
  @ApiOperation({
    summary: "The week's mess menu of the hostel a child boards in, with the child's diet",
  })
  @RequirePermission(HOSTEL_H3.family)
  familyMenu(
    @ReqCtx() ctx: RequestContext,
    @Query('studentId') studentId: string,
    @Query('weekOf') weekOf?: string,
  ) {
    return this.mess.familyMenu(
      ctx,
      studentId,
      /^\d{4}-\d{2}-\d{2}$/.test(weekOf ?? '') ? weekOf : undefined,
    );
  }

  // ---- approved visitors (office, wardens) ------------------------------------------------------------------
  @Get('visitors')
  @RequirePermission(HOSTEL_H3.visitView)
  async visitorList(@ReqCtx() ctx: RequestContext, @Query() q: VisitorsQueryDto) {
    return { data: await this.visits.visitors(ctx, q) };
  }

  @Post('visitors')
  @ApiOperation({ summary: 'The office or a warden adds an approved visitor directly' })
  @RequirePermission(HOSTEL_H3.visitDecide)
  officeAdd(@ReqCtx() ctx: RequestContext, @Body() dto: VisitorAddDto) {
    return this.visits.officeAdd(ctx, dto);
  }

  @Post('visitors/:id/decide')
  @RequirePermission(HOSTEL_H3.visitDecide)
  decideVisitor(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: DecideDto) {
    return this.visits.decideVisitor(ctx, id, dto);
  }

  @Get('visitors/:id/photo')
  @RequirePermission(HOSTEL_H3.visitView)
  async visitorPhoto(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    send(reply, await this.visits.photo(ctx, id, false));
  }

  @Get('hostels/:id/visit-hours')
  @RequirePermission(HOSTEL.view)
  async hours(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.visits.hours(ctx, id) };
  }

  @Put('hostels/:id/visit-hours')
  @ApiOperation({ summary: 'Visiting days and times of a hostel (none = any time)' })
  @RequirePermission(HOSTEL.setup)
  saveHours(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: VisitHoursDto) {
    return this.visits.saveHours(ctx, id, dto);
  }

  // ---- visits at the gate -----------------------------------------------------------------------------------
  @Get('visits/boarders')
  @ApiOperation({ summary: 'The gate: find a boarder by name or admission no.' })
  @RequirePermission(HOSTEL_H3.visitGate)
  async boarders(@ReqCtx() ctx: RequestContext, @Query('q') q?: string) {
    const term = (q ?? '').trim().slice(0, 60);
    return { data: term.length < 2 ? [] : await this.visits.boarders(ctx, term) };
  }

  @Get('visits/check')
  @ApiOperation({
    summary: "The gate: a boarder's hostel, approved list and whether visiting hours are on",
  })
  @RequirePermission(HOSTEL_H3.visitGate)
  check(@ReqCtx() ctx: RequestContext, @Query() q: VisitCheckDto) {
    return this.visits.check(ctx, q);
  }

  @Post('visits')
  @ApiOperation({
    summary: 'Register a hostel visitor: in when listed and in hours, else waits for a warden',
  })
  @RequirePermission(HOSTEL_H3.visitGate)
  register(@ReqCtx() ctx: RequestContext, @Body() dto: VisitDto) {
    return this.visits.register(ctx, dto);
  }

  @Get('visits')
  @RequirePermission(HOSTEL_H3.visitView)
  async visitList(@ReqCtx() ctx: RequestContext, @Query() q: VisitsQueryDto) {
    return { data: await this.visits.visits(ctx, q) };
  }

  @Post('visits/:id/decide')
  @ApiOperation({
    summary: 'A warden allows or refuses a waiting hostel visit; the parent is told',
  })
  @RequirePermission(HOSTEL_H3.visitDecide)
  decideVisit(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: VisitDecideDto) {
    return this.visits.decideVisit(ctx, id, dto);
  }

  @Get('visits/:id/photo')
  @RequirePermission(HOSTEL_H3.visitView)
  async visitPhoto(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    send(reply, await this.visits.visitPhoto(ctx, id));
  }

  // ---- mess -----------------------------------------------------------------------------------------------
  @Get('meals')
  @RequirePermission(HOSTEL.view)
  async meals(@ReqCtx() ctx: RequestContext, @Query('hostelId') hostelId?: string) {
    return {
      data: await this.mess.meals(ctx, /^\d{1,18}$/.test(hostelId ?? '') ? hostelId : undefined),
    };
  }

  @Post('meals')
  @RequirePermission(HOSTEL.setup)
  createMeal(@ReqCtx() ctx: RequestContext, @Body() dto: MealDto) {
    return this.mess.saveMeal(ctx, dto);
  }

  @Put('meals/:id')
  @RequirePermission(HOSTEL.setup)
  updateMeal(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: MealDto) {
    return this.mess.saveMeal(ctx, dto, id);
  }

  @Get('menu')
  @ApiOperation({
    summary: 'The week of a hostel (Monday on): each meal of each day, changes marked',
  })
  @RequirePermission(HOSTEL.view)
  menu(@ReqCtx() ctx: RequestContext, @Query() q: MenuQueryDto) {
    return this.mess.menu(ctx, q);
  }

  @Put('menu')
  @ApiOperation({ summary: 'Save the repeating weekly menu (empty items clear a cell)' })
  @RequirePermission(HOSTEL_H3.mess)
  saveWeek(@ReqCtx() ctx: RequestContext, @Body() dto: MenuWeekDto) {
    return this.mess.saveWeek(ctx, dto);
  }

  @Put('menu/change')
  @ApiOperation({
    summary: 'A one-off change of a meal on a day (empty items go back to the weekly menu)',
  })
  @RequirePermission(HOSTEL_H3.mess)
  saveChange(@ReqCtx() ctx: RequestContext, @Body() dto: MenuChangeDto) {
    return this.mess.saveChange(ctx, dto);
  }

  @Get('meal-roll')
  @ApiOperation({ summary: 'Boarders of a meal on a day: away, skipped, diet and allergy' })
  @RequirePermission(HOSTEL_H3.mess)
  mealRoll(@ReqCtx() ctx: RequestContext, @Query() q: MealRollQueryDto) {
    return this.mess.mealRoll(ctx, q);
  }

  @Post('meal-roll')
  @ApiOperation({ summary: 'Save who skipped a meal (everyone else not away had it)' })
  @RequirePermission(HOSTEL_H3.mess)
  saveMealRoll(@ReqCtx() ctx: RequestContext, @Body() dto: MealRollSaveDto) {
    return this.mess.saveMealRoll(ctx, dto);
  }

  @Put('diets/:studentId')
  @RequirePermission(HOSTEL_H3.mess)
  saveDiet(
    @ReqCtx() ctx: RequestContext,
    @Param('studentId') studentId: string,
    @Body() dto: DietDto,
  ) {
    return this.mess.saveDiet(ctx, studentId, dto);
  }
}
