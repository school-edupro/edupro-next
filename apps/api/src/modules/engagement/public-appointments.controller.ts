import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators';
import { ApplicantGuard, type ApplicantRequest } from '../admissions/public/applicant.guard';
import { PublicThrottle, PublicThrottleGuard } from '../admissions/public/public-throttle.guard';
import { CancelDto, PublicBookDto, SlotsQueryDto } from './appointments.dto';
import { AppointmentsService } from './appointments.service';

/**
 * Appointments for outside visitors (0059): the page behind the school's QR code. Anyone may read the
 * desks and free slots; booking, the visitor's own list and cancelling need the mobile-OTP token the
 * public admissions sign-in issues (the same person, the same cookie). No EduPro user is involved.
 */
@ApiTags('public')
@Controller('public/appointments')
@UseGuards(PublicThrottleGuard)
export class PublicAppointmentsController {
  constructor(private readonly svc: AppointmentsService) {}

  @Get('mine')
  @Public()
  @UseGuards(ApplicantGuard)
  @PublicThrottle(60)
  @ApiOperation({ summary: "The visitor's own appointments with the pass of the confirmed ones" })
  mine(@Req() req: ApplicantRequest) {
    return this.svc.publicMine(req.applicant!);
  }

  @Post()
  @Public()
  @UseGuards(ApplicantGuard)
  @PublicThrottle(10)
  @ApiOperation({ summary: 'An OTP-verified visitor asks for a slot' })
  book(@Req() req: ApplicantRequest, @Body() dto: PublicBookDto) {
    return this.svc.publicBook(req.applicant!, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Public()
  @UseGuards(ApplicantGuard)
  @PublicThrottle(20)
  cancel(@Req() req: ApplicantRequest, @Param('id') id: string, @Body() dto: CancelDto) {
    return this.svc.publicCancel(req.applicant!, id, dto);
  }

  @Get(':schoolCode')
  @Public()
  @PublicThrottle(60)
  @ApiOperation({ summary: 'Whom an outside visitor can meet, the purposes and what is asked' })
  info(@Param('schoolCode') schoolCode: string) {
    return this.svc.publicInfo(schoolCode);
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
