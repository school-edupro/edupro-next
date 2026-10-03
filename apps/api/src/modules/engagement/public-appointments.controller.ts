import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Public } from '../../common/auth/decorators';
import { ApplicantGuard, type ApplicantRequest } from '../admissions/public/applicant.guard';
import { PublicThrottle, PublicThrottleGuard } from '../admissions/public/public-throttle.guard';
import { CancelDto, DaysQueryDto, PublicBookDto, SlotsQueryDto } from './appointments.dto';
import { AppointmentsService } from './appointments.service';

/**
 * Appointments for outside visitors (0059): the page behind the school's QR code. Anyone may read the
 * desks and free slots; booking, the visitor's own list and cancelling need the mobile-OTP token the
 * public admissions sign-in issues (the same person, the same cookie) for this very school. No EduPro
 * user is involved.
 */
@ApiTags('public')
@Controller('public/appointments')
@UseGuards(PublicThrottleGuard)
export class PublicAppointmentsController {
  constructor(private readonly svc: AppointmentsService) {}

  @Get(':schoolCode/mine')
  @Public()
  @UseGuards(ApplicantGuard)
  @PublicThrottle(60)
  @ApiOperation({ summary: "The visitor's own appointments with the pass of the confirmed ones" })
  mine(@Req() req: ApplicantRequest, @Param('schoolCode') schoolCode: string) {
    return this.svc.publicMine(schoolCode, req.applicant!);
  }

  @Get(':schoolCode/mine/:id')
  @Public()
  @UseGuards(ApplicantGuard)
  @PublicThrottle(60)
  @ApiOperation({ summary: "One of the visitor's own appointments with everything they filled in" })
  mineGet(
    @Req() req: ApplicantRequest,
    @Param('schoolCode') schoolCode: string,
    @Param('id') id: string,
  ) {
    return this.svc.publicGet(schoolCode, req.applicant!, id);
  }

  @Get(':schoolCode/mine/:id/photo')
  @Public()
  @UseGuards(ApplicantGuard)
  @PublicThrottle(60)
  async minePhoto(
    @Req() req: ApplicantRequest,
    @Param('schoolCode') schoolCode: string,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const { bytes, contentType } = await this.svc.publicPhoto(schoolCode, req.applicant!, id);
    void reply
      .header('content-type', contentType)
      .header('cache-control', 'private, max-age=300')
      .send(bytes);
  }

  @Get(':schoolCode/mine/:id/card.pdf')
  @Public()
  @UseGuards(ApplicantGuard)
  @PublicThrottle(30)
  async mineCard(
    @Req() req: ApplicantRequest,
    @Param('schoolCode') schoolCode: string,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const { bytes, filename } = await this.svc.publicCardPdf(schoolCode, req.applicant!, id);
    void reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(bytes);
  }

  @Get(':schoolCode/pass/:code/card.pdf')
  @Public()
  @PublicThrottle(20)
  @ApiOperation({ summary: 'The pass behind the link as a PDF card (no photo or ID proof)' })
  async passCard(
    @Param('schoolCode') schoolCode: string,
    @Param('code') code: string,
    @Res() reply: FastifyReply,
  ) {
    const { bytes, filename } = await this.svc.publicPassPdf(schoolCode, code);
    void reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(bytes);
  }

  @Post(':schoolCode')
  @Public()
  @UseGuards(ApplicantGuard)
  @PublicThrottle(10)
  @ApiOperation({ summary: 'An OTP-verified visitor asks for a slot' })
  book(
    @Req() req: ApplicantRequest,
    @Param('schoolCode') schoolCode: string,
    @Body() dto: PublicBookDto,
  ) {
    return this.svc.publicBook(schoolCode, req.applicant!, dto);
  }

  @Post(':schoolCode/:id/cancel')
  @HttpCode(200)
  @Public()
  @UseGuards(ApplicantGuard)
  @PublicThrottle(20)
  cancel(
    @Req() req: ApplicantRequest,
    @Param('schoolCode') schoolCode: string,
    @Param('id') id: string,
    @Body() dto: CancelDto,
  ) {
    return this.svc.publicCancel(schoolCode, req.applicant!, id, dto);
  }

  @Get(':schoolCode')
  @Public()
  @PublicThrottle(60)
  @ApiOperation({ summary: 'Whom an outside visitor can meet, the purposes and what is asked' })
  info(@Param('schoolCode') schoolCode: string) {
    return this.svc.publicInfo(schoolCode);
  }

  @Get(':schoolCode/days')
  @Public()
  @PublicThrottle(120)
  @ApiOperation({ summary: 'The next days a desk has a free time' })
  days(@Param('schoolCode') schoolCode: string, @Query() q: DaysQueryDto) {
    return this.svc.publicDays(schoolCode, q.hostId);
  }

  @Get(':schoolCode/slots')
  @Public()
  @PublicThrottle(120)
  @ApiOperation({ summary: 'Slots of a desk on a day (free or not)' })
  slots(@Param('schoolCode') schoolCode: string, @Query() q: SlotsQueryDto) {
    return this.svc.publicSlots(schoolCode, q);
  }

  @Get(':schoolCode/pass/:code')
  @Public()
  @PublicThrottle(30)
  @ApiOperation({ summary: 'The pass behind the link of a confirmation message' })
  pass(@Param('schoolCode') schoolCode: string, @Param('code') code: string) {
    return this.svc.publicPass(schoolCode, code);
  }
}
