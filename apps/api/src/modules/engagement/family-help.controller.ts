import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  FamilyHelpHeadingDto,
  FamilyHelpListDto,
  FamilyHelpMoveDto,
  FamilyHelpQuestionDto,
  FamilyHelpVoteDto,
} from './family-help.dto';
import { FamilyHelpService } from './family-help.service';
import { HELPDESK } from './helpdesk.dto';

/**
 * The Help pages kept by the school: the families' (0406, docs/design/89 "Help kept by the school"), read by parents
 * and students (`engagement/help`), and the staff's (0422), read by staff (`engagement/staff-help`); both edited on
 * Helpdesk set-up (`helpdesk/family-help`, `helpdesk/staff-help`, with the helpdesk set-up right).
 */
@ApiTags('helpdesk')
@ApiBearerAuth()
@Controller()
export class FamilyHelpController {
  constructor(private readonly help: FamilyHelpService) {}

  // ---- parents and students
  @Get('engagement/help')
  @ApiOperation({
    summary: "The school's Help for me: questions for parents or students, under headings",
  })
  @AuthenticatedOnly()
  mine(@ReqCtx() ctx: RequestContext, @Query() q: FamilyHelpListDto) {
    return this.help.family(ctx, q.for);
  }

  @Post('engagement/help/:id/vote')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Was this answer helpful? (once per question; a second answer replaces it)',
  })
  @AuthenticatedOnly()
  vote(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: FamilyHelpVoteDto) {
    return this.help.vote(ctx, id, dto.helpful);
  }

  // ---- staff (0422)
  @Get('engagement/staff-help')
  @ApiOperation({
    summary:
      "The school's Help for staff: its questions under headings (those about a screen I cannot open left out)",
  })
  @AuthenticatedOnly()
  staff(@ReqCtx() ctx: RequestContext) {
    return this.help.staff(ctx);
  }

  // ---- Helpdesk set-up (the families' Help; the routes by id serve a staff heading or question too)
  @Get('helpdesk/family-help')
  @ApiOperation({ summary: "The families' Help as the office edits it, with the Yes / No counts" })
  @RequirePermission(HELPDESK.settingsManage)
  setup(@ReqCtx() ctx: RequestContext) {
    return this.help.setup(ctx);
  }

  @Post('helpdesk/family-help/headings')
  @RequirePermission(HELPDESK.settingsManage)
  addHeading(@ReqCtx() ctx: RequestContext, @Body() dto: FamilyHelpHeadingDto) {
    return this.help.addHeading(ctx, dto);
  }

  @Put('helpdesk/family-help/headings/:id')
  @RequirePermission(HELPDESK.settingsManage)
  editHeading(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: FamilyHelpHeadingDto,
  ) {
    return this.help.editHeading(ctx, id, dto);
  }

  @Delete('helpdesk/family-help/headings/:id')
  @ApiOperation({ summary: 'Delete a heading; its questions move to "Other questions"' })
  @RequirePermission(HELPDESK.settingsManage)
  deleteHeading(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.help.deleteHeading(ctx, id);
  }

  @Post('helpdesk/family-help/headings/:id/move')
  @HttpCode(200)
  @RequirePermission(HELPDESK.settingsManage)
  moveHeading(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: FamilyHelpMoveDto,
  ) {
    return this.help.moveHeading(ctx, id, dto.direction);
  }

  @Post('helpdesk/family-help/questions')
  @RequirePermission(HELPDESK.settingsManage)
  addQuestion(@ReqCtx() ctx: RequestContext, @Body() dto: FamilyHelpQuestionDto) {
    return this.help.addQuestion(ctx, dto);
  }

  @Put('helpdesk/family-help/questions/:id')
  @ApiOperation({ summary: 'Change a question; a new answer starts its Yes / No counts again' })
  @RequirePermission(HELPDESK.settingsManage)
  editQuestion(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: FamilyHelpQuestionDto,
  ) {
    return this.help.editQuestion(ctx, id, dto);
  }

  @Delete('helpdesk/family-help/questions/:id')
  @RequirePermission(HELPDESK.settingsManage)
  deleteQuestion(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.help.deleteQuestion(ctx, id);
  }

  @Post('helpdesk/family-help/questions/:id/move')
  @HttpCode(200)
  @RequirePermission(HELPDESK.settingsManage)
  moveQuestion(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: FamilyHelpMoveDto,
  ) {
    return this.help.moveQuestion(ctx, id, dto.direction);
  }

  @Post('helpdesk/family-help/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Put back the standard headings and questions the school deleted' })
  @RequirePermission(HELPDESK.settingsManage)
  restore(@ReqCtx() ctx: RequestContext) {
    return this.help.restore(ctx);
  }

  // ---- Helpdesk set-up: Help for staff (0422); a staff heading or question is changed, moved and deleted by the
  // routes by id above
  @Get('helpdesk/staff-help')
  @ApiOperation({ summary: "The staff's Help as the office edits it, with the Yes / No counts" })
  @RequirePermission(HELPDESK.settingsManage)
  staffSetup(@ReqCtx() ctx: RequestContext) {
    return this.help.setup(ctx, 'staff');
  }

  @Post('helpdesk/staff-help/headings')
  @RequirePermission(HELPDESK.settingsManage)
  addStaffHeading(@ReqCtx() ctx: RequestContext, @Body() dto: FamilyHelpHeadingDto) {
    return this.help.addHeading(ctx, dto, 'staff');
  }

  @Post('helpdesk/staff-help/questions')
  @RequirePermission(HELPDESK.settingsManage)
  addStaffQuestion(@ReqCtx() ctx: RequestContext, @Body() dto: FamilyHelpQuestionDto) {
    return this.help.addQuestion(ctx, dto, 'staff');
  }

  @Post('helpdesk/staff-help/restore')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Put back the standard staff headings and questions the school deleted',
  })
  @RequirePermission(HELPDESK.settingsManage)
  restoreStaff(@ReqCtx() ctx: RequestContext) {
    return this.help.restore(ctx, 'staff');
  }
}
