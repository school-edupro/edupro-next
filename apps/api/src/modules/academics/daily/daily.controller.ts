import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../../common/http/request-context';
import { CalendarService } from './calendar.service';
import {
  AddAlbumItemsDto,
  CalendarQueryDto,
  CreateAlbumDto,
  CreateAlmanacEventDto,
  CreateDailyWorkDto,
  CreateHolidayDto,
  CreateNoticeDto,
  ListDailyWorkQueryDto,
  ListNoticesQueryDto,
  UpdateDailyWorkDto,
  UpdateNoticeDto,
  AckDto,
  AckStatusQueryDto,
  CreateDocumentDto,
  ListDocumentsQueryDto,
  NoticeReachDto,
  NoticeReportQueryDto,
  SaveSheetDto,
  SheetQueryDto,
  UpdateAcademicSettingsDto,
} from './daily.dto';
import { DAILY } from './daily.permissions';
import { AcademicSettingsService } from './academic-settings.service';
import { DailyWorkService } from './daily-work.service';
import { WorkSheetService } from './work-sheet.service';
import { DocumentsService } from './documents.service';
import { GalleryService } from './gallery.service';
import { NoticesService } from './notices.service';
import { ViewerService } from './viewer.service';

@ApiTags('academics')
@ApiBearerAuth()
@Controller('academics/daily-work')
export class DailyWorkController {
  constructor(
    private readonly work: DailyWorkService,
    private readonly viewer: ViewerService,
    private readonly sheets: WorkSheetService,
  ) {}

  @Get('sheet/options')
  @ApiOperation({ summary: 'The sections the caller posts for, each with its subjects' })
  @RequirePermission(DAILY.workPost)
  async sheetOptions(@ReqCtx() ctx: RequestContext) {
    return { data: await this.sheets.options(ctx) };
  }

  @Get('sheet')
  @ApiOperation({ summary: "The day's sheet: a row per subject for the chosen sections" })
  @RequirePermission(DAILY.workPost)
  sheet(@ReqCtx() ctx: RequestContext, @Query() q: SheetQueryDto) {
    return this.sheets.sheet(ctx, q);
  }

  @Post('sheet')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Save the sheet: homework and classwork (or assignments) of many subjects',
  })
  @RequirePermission(DAILY.workPost)
  saveSheet(@ReqCtx() ctx: RequestContext, @Body() body: SaveSheetDto) {
    return this.sheets.save(ctx, body);
  }

  @Get()
  @ApiOperation({
    summary: 'Homework, classwork and assignments (scoped: teachers by section, families by child)',
  })
  @RequirePermission(DAILY.workView, { description: 'View homework, classwork and assignments' })
  async list(@ReqCtx() ctx: RequestContext, @Query() q: ListDailyWorkQueryDto) {
    const { rows, total } = await this.work.list(ctx, q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Get('viewer')
  @ApiOperation({
    summary: 'Who is reading: the sections a teacher covers or the children of a guardian',
  })
  @RequirePermission(DAILY.workView)
  viewerInfo(@ReqCtx() ctx: RequestContext) {
    return this.viewer.resolve(ctx, DAILY.workView);
  }

  @Get(':id')
  @RequirePermission(DAILY.workView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.work.get(ctx, id);
  }

  @Get(':id/files/:fileId')
  @RequirePermission(DAILY.workView)
  file(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.work.fileUrl(ctx, id, fileId);
  }

  @Post()
  @ApiOperation({ summary: 'Post homework, classwork or an assignment with optional files' })
  @RequirePermission(DAILY.workPost, {
    description: 'Post and edit homework, classwork and assignments (scope: class_section)',
  })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateDailyWorkDto) {
    return this.work.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission(DAILY.workPost)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UpdateDailyWorkDto) {
    return this.work.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(DAILY.workPost)
  async remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string): Promise<void> {
    await this.work.remove(ctx, id);
  }
}

@ApiTags('academics')
@ApiBearerAuth()
@Controller('academics')
export class AcademicSettingsController {
  constructor(
    private readonly settings: AcademicSettingsService,
    private readonly sheets: WorkSheetService,
  ) {}

  @Get('settings')
  @ApiOperation({
    summary: 'Publish time, teacher contact display and upload sizes of the academics module',
  })
  @RequirePermission(DAILY.workView)
  get(@ReqCtx() ctx: RequestContext) {
    return this.settings.get(ctx);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Change the academics settings' })
  @RequirePermission('academics.subject.manage')
  update(@ReqCtx() ctx: RequestContext, @Body() body: UpdateAcademicSettingsDto) {
    return this.settings.update(ctx, body);
  }

  @Get('my-teachers')
  @ApiOperation({ summary: "The class teacher and subject teachers of the family's children" })
  @RequirePermission(DAILY.workView)
  myTeachers(@ReqCtx() ctx: RequestContext) {
    return this.sheets.myTeachers(ctx);
  }

  @Get('my-teachers/:employeeId/photo')
  @RequirePermission(DAILY.workView)
  teacherPhoto(@ReqCtx() ctx: RequestContext, @Param('employeeId') employeeId: string) {
    return this.sheets.teacherPhoto(ctx, employeeId);
  }
}

@ApiTags('academics')
@ApiBearerAuth()
@Controller('academics/notices')
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Post('reach')
  @HttpCode(200)
  @ApiOperation({ summary: 'How many students and employees an audience reaches' })
  @RequirePermission(DAILY.noticeManage)
  reach(@ReqCtx() ctx: RequestContext, @Body() dto: NoticeReachDto) {
    return this.notices.reach(ctx, dto);
  }

  @Get('report')
  @ApiOperation({ summary: 'Notices and office orders with their reach; also as Excel or PDF' })
  @RequirePermission(DAILY.noticeManage)
  async report(
    @ReqCtx() ctx: RequestContext,
    @Query() q: NoticeReportQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const r = await this.notices.report(ctx, q);
    if (q.format === 'json') return r;
    const f = await this.notices.reportFile(ctx, q, r.data, q.format);
    reply
      .header('content-type', f.contentType)
      .header('content-disposition', `attachment; filename="${f.filename}"`);
    return reply.send(f.bytes);
  }

  @Get()
  @ApiOperation({ summary: 'Notices and circulars visible to the caller' })
  @RequirePermission(DAILY.noticeView, { description: 'Read notices and circulars' })
  async list(@ReqCtx() ctx: RequestContext, @Query() q: ListNoticesQueryDto) {
    const { rows, total } = await this.notices.list(ctx, q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Get(':id')
  @RequirePermission(DAILY.noticeView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.notices.get(ctx, id);
  }

  @Get(':id/files/:fileId')
  @RequirePermission(DAILY.noticeView)
  file(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.notices.fileUrl(ctx, id, fileId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a notice or circular, optionally publishing it at once' })
  @RequirePermission(DAILY.noticeManage, {
    description: 'Create, target and publish notices and circulars',
  })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateNoticeDto) {
    return this.notices.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission(DAILY.noticeManage)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UpdateNoticeDto) {
    return this.notices.update(ctx, id, body);
  }

  @Post(':id/publish')
  @RequirePermission(DAILY.noticeManage)
  publish(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.notices.publish(ctx, id, true);
  }

  @Post(':id/unpublish')
  @RequirePermission(DAILY.noticeManage)
  unpublish(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.notices.publish(ctx, id, false);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(DAILY.noticeManage)
  async remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string): Promise<void> {
    await this.notices.remove(ctx, id);
  }
}

@ApiTags('academics')
@ApiBearerAuth()
@Controller('academics/calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @ApiOperation({ summary: 'Holidays and almanac events of the working year (audience-filtered)' })
  @RequirePermission(DAILY.calendarView, { description: 'View holidays and the almanac' })
  read(@ReqCtx() ctx: RequestContext, @Query() q: CalendarQueryDto) {
    return this.calendar.calendar(ctx, q);
  }

  @Post('holidays')
  @RequirePermission(DAILY.calendarManage, { description: 'Maintain holidays and the almanac' })
  createHoliday(@ReqCtx() ctx: RequestContext, @Body() body: CreateHolidayDto) {
    return this.calendar.createHoliday(ctx, body);
  }

  @Delete('holidays/:id')
  @HttpCode(204)
  @RequirePermission(DAILY.calendarManage)
  async removeHoliday(@ReqCtx() ctx: RequestContext, @Param('id') id: string): Promise<void> {
    await this.calendar.removeHoliday(ctx, id);
  }

  @Post('events')
  @RequirePermission(DAILY.calendarManage)
  createEvent(@ReqCtx() ctx: RequestContext, @Body() body: CreateAlmanacEventDto) {
    return this.calendar.createEvent(ctx, body);
  }

  @Delete('events/:id')
  @HttpCode(204)
  @RequirePermission(DAILY.calendarManage)
  async removeEvent(@ReqCtx() ctx: RequestContext, @Param('id') id: string): Promise<void> {
    await this.calendar.removeEvent(ctx, id);
  }
}

@ApiTags('academics')
@ApiBearerAuth()
@Controller('academics/gallery')
export class GalleryController {
  constructor(private readonly gallery: GalleryService) {}

  @Get('albums')
  @RequirePermission(DAILY.galleryView, { description: 'View the gallery' })
  async list(@ReqCtx() ctx: RequestContext) {
    return { data: await this.gallery.list(ctx) };
  }

  @Get('albums/:id')
  @RequirePermission(DAILY.galleryView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.gallery.get(ctx, id);
  }

  @Post('albums')
  @RequirePermission(DAILY.galleryManage, { description: 'Create albums and add photos' })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateAlbumDto) {
    return this.gallery.create(ctx, body);
  }

  @Post('albums/:id/items')
  @RequirePermission(DAILY.galleryManage)
  addItems(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AddAlbumItemsDto) {
    return this.gallery.addItems(ctx, id, body);
  }

  @Delete('albums/:id')
  @HttpCode(204)
  @RequirePermission(DAILY.galleryManage)
  async remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string): Promise<void> {
    await this.gallery.remove(ctx, id);
  }
}

/** Class documents (session plan, curriculum, date sheet, magazine), acknowledgements and the directory (0091). */
@ApiTags('academics')
@ApiBearerAuth()
@Controller('academics')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Get('documents')
  @ApiOperation({ summary: 'Class documents the viewer may see (families from the publish time)' })
  @RequirePermission(DAILY.workView)
  list(@ReqCtx() ctx: RequestContext, @Query() q: ListDocumentsQueryDto) {
    return this.docs.list(ctx, q);
  }

  @Post('documents')
  @ApiOperation({
    summary: 'Upload a session plan, curriculum, date sheet or a school-wide document',
  })
  @RequirePermission(DAILY.workPost)
  create(@ReqCtx() ctx: RequestContext, @Body() dto: CreateDocumentDto) {
    return this.docs.create(ctx, dto);
  }

  @Get('documents/:id/files/:fileId')
  @RequirePermission(DAILY.workView)
  file(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.docs.fileUrl(ctx, id, fileId);
  }

  @Delete('documents/:id')
  @HttpCode(204)
  @RequirePermission(DAILY.workPost)
  async remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    await this.docs.remove(ctx, id);
  }

  @Post('acks')
  @HttpCode(200)
  @ApiOperation({ summary: 'Acknowledge homework, a class document or a notice' })
  @AuthenticatedOnly()
  ack(@ReqCtx() ctx: RequestContext, @Body() dto: AckDto) {
    return this.docs.ack(ctx, dto);
  }

  @Get('acks')
  @ApiOperation({ summary: 'Who acknowledged an item and who has not' })
  @AuthenticatedOnly()
  ackStatus(@ReqCtx() ctx: RequestContext, @Query() q: AckStatusQueryDto) {
    return this.docs.ackStatus(ctx, q);
  }

  @Get('dashboard')
  @ApiOperation({
    summary: 'The academics dashboard: set-up gaps, posts, acknowledgements, what is coming',
  })
  @RequirePermission(DAILY.workView)
  dashboard(@ReqCtx() ctx: RequestContext) {
    return this.docs.dashboard(ctx);
  }

  @Get('directory')
  @ApiOperation({ summary: 'The school directory' })
  @AuthenticatedOnly()
  directory(@ReqCtx() ctx: RequestContext) {
    return this.docs.directory(ctx);
  }
}
