import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { HOSTEL, HOSTEL_H3 } from './hostel.dto';
import {
  DietFileDto,
  DietListDto,
  DietTypesDto,
  DietUploadDto,
  FeedbackDto,
  FeedbackQueryDto,
  HeadcountDto,
  HeadcountFileDto,
  MealOrderDto,
  MealRegisterDto,
  MealRegisterFileDto,
  MenuCloneDto,
  MenuCopyDto,
  MenuCycleDto,
  MenuFileDto,
  MenuTemplateQueryDto,
  MessMealDto,
} from './hostel-mess.dto';
import { HostelDietsService } from './hostel-diets.service';
import { HostelMealReportsService } from './hostel-meal-reports.service';
import { HostelMessService } from './hostel-mess.service';

const json = (f: { filename: string; contentType: string; bytes: Buffer }) => ({
  filename: f.filename,
  contentType: f.contentType,
  base64: f.bytes.toString('base64'),
});

/**
 * The rebuilt mess (0161): the school's meals and the hostels that serve them, the rotating menu (clone,
 * copy, export), diet types and the diet list (upload, export), the meal register, the kitchen head count
 * and the families' feedback.
 */
@ApiTags('hostel')
@ApiBearerAuth()
@Controller('hostel')
export class HostelMessController {
  constructor(
    private readonly mess: HostelMessService,
    private readonly diets: HostelDietsService,
    private readonly reports: HostelMealReportsService,
  ) {}

  // ---- meals of the school ----------------------------------------------------------------------------
  @Get('mess/meals')
  @ApiOperation({ summary: "The school's meals, each with the hostels that serve it" })
  @RequirePermission(HOSTEL.view)
  messMeals(@ReqCtx() ctx: RequestContext) {
    return this.mess.messMeals(ctx);
  }

  @Post('mess/meals')
  @RequirePermission(HOSTEL.setup)
  createMessMeal(@ReqCtx() ctx: RequestContext, @Body() dto: MessMealDto) {
    return this.mess.saveMessMeal(ctx, dto);
  }

  @Put('mess/meals/order')
  @RequirePermission(HOSTEL.setup)
  orderMeals(@ReqCtx() ctx: RequestContext, @Body() dto: MealOrderDto) {
    return this.mess.orderMeals(ctx, dto);
  }

  @Put('mess/meals/:id')
  @RequirePermission(HOSTEL.setup)
  updateMessMeal(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: MessMealDto) {
    return this.mess.saveMessMeal(ctx, dto, id);
  }

  @Delete('mess/meals/:id')
  @ApiOperation({ summary: 'Delete a meal never served (else switch it off)' })
  @RequirePermission(HOSTEL.setup)
  deleteMessMeal(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.mess.deleteMessMeal(ctx, id);
  }

  // ---- the rotating menu --------------------------------------------------------------------------------
  @Get('menu/template')
  @ApiOperation({ summary: 'One week of the menu cycle as it repeats (Monday first)' })
  @RequirePermission(HOSTEL_H3.mess)
  template(@ReqCtx() ctx: RequestContext, @Query() q: MenuTemplateQueryDto) {
    return this.mess.template(ctx, q);
  }

  @Put('menu/cycle')
  @ApiOperation({ summary: 'The menu repeats every 1 to 4 weeks from a Monday' })
  @RequirePermission(HOSTEL_H3.mess)
  saveCycle(@ReqCtx() ctx: RequestContext, @Body() dto: MenuCycleDto) {
    return this.mess.saveCycle(ctx, dto);
  }

  @Post('menu/clone')
  @ApiOperation({
    summary: "Copy a hostel's menu to other hostels (replace, or fill the empty cells)",
  })
  @RequirePermission(HOSTEL_H3.mess)
  cloneMenu(@ReqCtx() ctx: RequestContext, @Body() dto: MenuCloneDto) {
    return this.mess.cloneMenu(ctx, dto);
  }

  @Post('menu/copy')
  @ApiOperation({ summary: 'Copy a day to other days, or a cycle week to other weeks' })
  @RequirePermission(HOSTEL_H3.mess)
  copyMenu(@ReqCtx() ctx: RequestContext, @Body() dto: MenuCopyDto) {
    return this.mess.copyMenu(ctx, dto);
  }

  @Get('menu/file')
  @ApiOperation({ summary: 'The menu of a week as Excel or PDF' })
  @RequirePermission(HOSTEL.view)
  async menuFile(@ReqCtx() ctx: RequestContext, @Query() q: MenuFileDto) {
    return json(await this.mess.menuFile(ctx, q));
  }

  // ---- diet types and the diet list ---------------------------------------------------------------------
  @Get('mess/diet-types')
  @RequirePermission(HOSTEL_H3.mess)
  dietTypes(@ReqCtx() ctx: RequestContext) {
    return this.diets.lists(ctx);
  }

  @Put('mess/diet-types')
  @ApiOperation({ summary: "The school's diet types (one default) and allergy list" })
  @RequirePermission(HOSTEL.setup)
  saveDietTypes(@ReqCtx() ctx: RequestContext, @Body() dto: DietTypesDto) {
    return this.diets.saveLists(ctx, dto);
  }

  @Get('diets')
  @ApiOperation({
    summary:
      "The kitchen's diet list: boarders with diet, no onion-garlic, allergies; filtered, paged",
  })
  @RequirePermission(HOSTEL_H3.mess)
  dietList(@ReqCtx() ctx: RequestContext, @Query() q: DietListDto) {
    return this.diets.list(ctx, q);
  }

  @Get('diets/file')
  @RequirePermission(HOSTEL_H3.mess)
  async dietFile(@ReqCtx() ctx: RequestContext, @Query() q: DietFileDto) {
    return json(await this.diets.file(ctx, q));
  }

  @Get('diets/template')
  @ApiOperation({ summary: 'The upload format with the boarders and what is set now' })
  @RequirePermission(HOSTEL_H3.mess)
  async dietTemplate(@ReqCtx() ctx: RequestContext, @Query('hostelId') hostelId?: string) {
    return json(
      await this.diets.template(ctx, /^\d{1,18}$/.test(hostelId ?? '') ? hostelId : undefined),
    );
  }

  @Post('diets/upload')
  @ApiOperation({ summary: 'Diets from the filled format; nothing is saved when a row is wrong' })
  @RequirePermission(HOSTEL_H3.mess)
  dietUpload(@ReqCtx() ctx: RequestContext, @Body() dto: DietUploadDto) {
    return this.diets.upload(ctx, dto);
  }

  @Delete('diets/:studentId')
  @ApiOperation({ summary: "Back to the school's default diet" })
  @RequirePermission(HOSTEL_H3.mess)
  clearDiet(@ReqCtx() ctx: RequestContext, @Param('studentId') studentId: string) {
    return this.diets.clear(ctx, studentId);
  }

  // ---- the meal register, head count, feedback ------------------------------------------------------------
  @Get('meal-register')
  @ApiOperation({
    summary: 'The month of a hostel: each pupil, each meal of each day (had, skipped, away)',
  })
  @RequirePermission(HOSTEL_H3.mess)
  mealRegister(@ReqCtx() ctx: RequestContext, @Query() q: MealRegisterDto) {
    return this.reports.register(ctx, q);
  }

  @Get('meal-register/file')
  @RequirePermission(HOSTEL_H3.mess)
  async mealRegisterFile(@ReqCtx() ctx: RequestContext, @Query() q: MealRegisterFileDto) {
    return json(await this.reports.registerFile(ctx, q, q.format));
  }

  @Get('headcount')
  @ApiOperation({
    summary: 'The kitchen head count of a day: to cook per meal, by diet, allergies',
  })
  @RequirePermission(HOSTEL_H3.mess)
  headcount(@ReqCtx() ctx: RequestContext, @Query() q: HeadcountDto) {
    return this.reports.headcount(ctx, q);
  }

  @Get('headcount/file')
  @RequirePermission(HOSTEL_H3.mess)
  async headcountFile(@ReqCtx() ctx: RequestContext, @Query() q: HeadcountFileDto) {
    return json(await this.reports.headcountFile(ctx, q, q.format));
  }

  @Get('feedback')
  @ApiOperation({ summary: 'Meal ratings of a period: the average of each meal and the comments' })
  @RequirePermission(HOSTEL_H3.mess)
  feedback(@ReqCtx() ctx: RequestContext, @Query() q: FeedbackQueryDto) {
    return this.reports.feedback(ctx, q);
  }

  @Get('mine/feedback')
  @ApiOperation({ summary: "The child's meals of the last three days with the family's rating" })
  @RequirePermission(HOSTEL_H3.family)
  familyFeedback(@ReqCtx() ctx: RequestContext, @Query('studentId') studentId: string) {
    return this.reports.familyFeedback(ctx, studentId);
  }

  @Post('mine/feedback')
  @ApiOperation({ summary: 'Rate a meal the child had (1 to 5, with a comment)' })
  @RequirePermission(HOSTEL_H3.family)
  saveFeedback(@ReqCtx() ctx: RequestContext, @Body() dto: FeedbackDto) {
    return this.reports.saveFeedback(ctx, dto);
  }
}
