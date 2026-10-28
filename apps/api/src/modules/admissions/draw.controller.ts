import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ADMISSIONS } from './admissions.dto';
import {
  DrawGroupDto,
  DrawPlaceDto,
  DrawRecordDto,
  DrawRecordsQueryDto,
  DrawSettingsDto,
  DrawSettingsQueryDto,
  DrawTwinsDto,
} from './draw.dto';
import { AdmissionDrawService } from './draw.service';
import { ADMISSION_SCHEDULE } from './process.service';

/**
 * Draw of lots (docs/design/60): the candidates sharing a points total, their slips, the slips'
 * settings and twins. Reading and printing need the registrations; settings and twins are the
 * admission office's (the tests, interviews and selection right).
 */
@ApiTags('admissions')
@ApiBearerAuth()
@Controller('admissions/draw')
export class AdmissionDrawController {
  constructor(private readonly svc: AdmissionDrawService) {}

  @Get('options')
  @ApiOperation({ summary: 'Sessions with their classes, and the categories' })
  @RequirePermission(ADMISSIONS.applicationView)
  options(@ReqCtx() ctx: RequestContext) {
    return this.svc.options(ctx);
  }

  @Get('totals')
  @ApiOperation({ summary: 'Each points total of a class: candidates confirmed and not yet' })
  @RequirePermission(ADMISSIONS.applicationView)
  totals(@ReqCtx() ctx: RequestContext, @Query() q: DrawPlaceDto) {
    return this.svc.totals(ctx, q);
  }

  @Get('group')
  @ApiOperation({ summary: 'The candidates of a points total, twins and the slips they make' })
  @RequirePermission(ADMISSIONS.applicationView)
  group(@ReqCtx() ctx: RequestContext, @Query() q: DrawGroupDto) {
    return this.svc.group(ctx, q);
  }

  @Get('slips')
  @ApiOperation({ summary: 'The draw slips of a points total (PDF, base64)' })
  @RequirePermission(ADMISSIONS.applicationView)
  slips(@ReqCtx() ctx: RequestContext, @Query() q: DrawGroupDto) {
    return this.svc.slips(ctx, q);
  }

  @Put('twins')
  @ApiOperation({ summary: 'Twins confirmed on one slip, or split onto a slip each' })
  @RequirePermission(ADMISSION_SCHEDULE)
  twins(@ReqCtx() ctx: RequestContext, @Body() dto: DrawTwinsDto) {
    return this.svc.setTwins(ctx, dto);
  }

  @Get('settings')
  @ApiOperation({ summary: "The slips' settings of a session, or as a class prints them" })
  @RequirePermission(ADMISSIONS.applicationView)
  settings(@ReqCtx() ctx: RequestContext, @Query() q: DrawSettingsQueryDto) {
    return this.svc.settings(ctx, q);
  }

  @Put('settings')
  @ApiOperation({ summary: "The slips' settings of a session, or a class's own" })
  @RequirePermission(ADMISSION_SCHEDULE)
  saveSettings(@ReqCtx() ctx: RequestContext, @Body() dto: DrawSettingsDto) {
    return this.svc.saveSettings(ctx, dto);
  }

  @Delete('settings')
  @ApiOperation({ summary: "A class's own settings removed (the session's apply again)" })
  @RequirePermission(ADMISSION_SCHEDULE)
  clearSettings(@ReqCtx() ctx: RequestContext, @Query() q: DrawSettingsQueryDto) {
    return this.svc.clearSettings(ctx, q);
  }

  @Post('check')
  @ApiOperation({
    summary: 'The drawn order checked: who would be offered, who waits (nothing changes)',
  })
  @RequirePermission(ADMISSION_SCHEDULE)
  check(@ReqCtx() ctx: RequestContext, @Body() dto: DrawRecordDto) {
    return this.svc.check(ctx, dto);
  }

  @Post('record')
  @ApiOperation({
    summary: 'The hand draw recorded: the first seats offered, the rest wait-listed',
  })
  @RequirePermission(ADMISSION_SCHEDULE)
  record(@ReqCtx() ctx: RequestContext, @Body() dto: DrawRecordDto) {
    return this.svc.record(ctx, dto);
  }

  @Get('records')
  @ApiOperation({ summary: 'The hand draws recorded for a class' })
  @RequirePermission(ADMISSIONS.applicationView)
  records(@ReqCtx() ctx: RequestContext, @Query() q: DrawRecordsQueryDto) {
    return this.svc.records(ctx, q);
  }

  @Get('records/:id/pdf')
  @ApiOperation({ summary: "A recorded draw's result (PDF, base64)" })
  @RequirePermission(ADMISSIONS.applicationView)
  recordPdf(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.recordPdf(ctx, id);
  }
}
