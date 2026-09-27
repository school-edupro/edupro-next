import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/access/require-permission.decorator';
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
} from './daily.dto';
import { DAILY } from './daily.permissions';
import { DailyWorkService } from './daily-work.service';
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
  ) {}

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
@Controller('academics/notices')
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

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
