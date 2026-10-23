import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AdmissionAnswers } from '@edupro/db';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ADMISSIONS } from './admissions.dto';
import { DeskFeeDto, DeskSlotDto, DeskStartDto, DeskStepDto, DeskSubmitDto } from './desk.dto';
import { AdmissionDeskService } from './desk.service';

export const ADMISSION_ENTER = 'admissions.application.enter';
export const ADMISSION_FEE = 'admissions.fee.collect';

/** The school desk and the office's view of a registration form (docs/design/39, part 3). */
@ApiTags('admissions')
@ApiBearerAuth()
@Controller('admissions')
export class AdmissionDeskController {
  constructor(private readonly desk: AdmissionDeskService) {}

  @Get('desk')
  @ApiOperation({
    summary:
      'The open sessions with their classes and fees, and the latest forms filled at the desk',
  })
  @RequirePermission(ADMISSION_ENTER)
  overview(@ReqCtx() ctx: RequestContext) {
    return this.desk.overview(ctx);
  }

  @Post('desk/applications')
  @ApiOperation({ summary: 'Register a walk-in parent: a new registration form for the class' })
  @RequirePermission(ADMISSION_ENTER, {
    description:
      'Register a walk-in parent: fill the registration form for them at the school desk',
  })
  start(@ReqCtx() ctx: RequestContext, @Body() dto: DeskStartDto) {
    return this.desk.start(ctx, dto);
  }

  @Get('applications/:id/form')
  @ApiOperation({
    summary: 'The registration form of an application with its answers, files and receipts',
  })
  @RequirePermission(ADMISSIONS.applicationView)
  form(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.desk.form(ctx, id);
  }

  @Put('applications/:id/form/step')
  @RequirePermission(ADMISSION_ENTER)
  saveStep(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: DeskStepDto) {
    return this.desk.saveStep(ctx, id, dto.answers as AdmissionAnswers, dto.step);
  }

  @Post('applications/:id/form/submit')
  @RequirePermission(ADMISSION_ENTER)
  submit(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: DeskSubmitDto) {
    return this.desk.submit(ctx, id, dto.answers as AdmissionAnswers);
  }

  @Post('applications/:id/form/slot')
  @RequirePermission(ADMISSION_ENTER)
  slot(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: DeskSlotDto) {
    return this.desk.slot(ctx, id, dto);
  }

  @Post('applications/:id/registration-fee')
  @ApiOperation({
    summary: 'Take the registration fee at the desk: receipt, then the registration number',
  })
  @RequirePermission(ADMISSION_FEE, {
    description: 'Take registration and admission fees at the school desk and print receipts',
  })
  collect(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: DeskFeeDto) {
    return this.desk.collect(ctx, id, dto);
  }

  @Get('applications/:id/pdf')
  @RequirePermission(ADMISSIONS.applicationView)
  pdf(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.desk.pdf(ctx, id);
  }

  @Get('applications/:id/files/:fileId')
  @RequirePermission(ADMISSIONS.applicationView)
  file(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.desk.file(ctx, id, fileId);
  }

  @Get('receipts/:receiptId/pdf')
  @RequirePermission(ADMISSIONS.applicationView)
  receipt(@ReqCtx() ctx: RequestContext, @Param('receiptId') receiptId: string) {
    return this.desk.receiptPdf(ctx, receiptId);
  }
}
