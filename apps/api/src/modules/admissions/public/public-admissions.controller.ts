import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/auth/decorators';
import {
  CreateApplicationDto,
  RequestOtpDto,
  UpdateApplicationDto,
  VerifyOtpDto,
} from '../admissions.dto';
import { ApplicantGuard, type ApplicantRequest } from './applicant.guard';
import { OtpService } from './otp.service';
import { PowService } from './pow.service';
import { PublicAdmissionsService } from './public-admissions.service';
import { PublicThrottle, PublicThrottleGuard } from './public-throttle.guard';

/**
 * Anonymous and applicant-authenticated endpoints of the public admissions app (S8-01, S8-05). Every
 * handler is on the reviewed public allow-list; identity comes from applicant tokens, never EduPro users.
 */
@ApiTags('public')
@Controller('public/admissions')
@UseGuards(PublicThrottleGuard)
export class PublicAdmissionsController {
  constructor(
    private readonly admissions: PublicAdmissionsService,
    private readonly pow: PowService,
    private readonly otp: OtpService,
  ) {}

  @Get('schools')
  @Public()
  @PublicThrottle(60)
  @ApiOperation({ summary: 'Schools with open admission cycles' })
  async schools() {
    return { data: await this.admissions.schools() };
  }

  @Get(':schoolCode/cycles')
  @Public()
  @PublicThrottle(60)
  @ApiOperation({ summary: 'Open cycles of a school with classes, criteria and the form' })
  async cycles(@Param('schoolCode') schoolCode: string) {
    return { data: await this.admissions.openCycles(schoolCode) };
  }

  @Post('challenge')
  @Public()
  @PublicThrottle(30)
  @ApiOperation({ summary: 'Proof-of-work challenge to request an OTP' })
  challenge() {
    return this.pow.issue();
  }

  @Post('otp')
  @Public()
  @PublicThrottle(10)
  @ApiOperation({ summary: 'Send a one-time code to the mobile (needs a solved challenge)' })
  async requestOtp(@Body() body: RequestOtpDto, @Req() req: ApplicantRequest) {
    await this.pow.consume(body.challenge, body.nonce);
    const schoolId = await this.admissions.schoolId(body.schoolCode);
    return this.otp.request(schoolId, body.mobile, req.ip);
  }

  @Post('otp/verify')
  @Public()
  @PublicThrottle(20)
  @ApiOperation({ summary: 'Exchange the code for an applicant token' })
  async verifyOtp(@Body() body: VerifyOtpDto) {
    const schoolId = await this.admissions.schoolId(body.schoolCode);
    return this.otp.verify(schoolId, body.mobile, body.code, body.name);
  }

  @Get('me')
  @Public()
  @UseGuards(ApplicantGuard)
  me(@Req() req: ApplicantRequest) {
    return req.applicant;
  }

  @Get('me/applications')
  @Public()
  @UseGuards(ApplicantGuard)
  async myApplications(@Req() req: ApplicantRequest) {
    return { data: await this.admissions.mine(req.applicant!) };
  }

  @Post('applications')
  @Public()
  @UseGuards(ApplicantGuard)
  @PublicThrottle(30)
  @ApiOperation({ summary: 'Create an application (draft, or submitted at once)' })
  createApplication(@Req() req: ApplicantRequest, @Body() body: CreateApplicationDto) {
    return this.admissions.create(
      req.applicant!,
      body,
      req.headers['x-request-id'] as string | undefined,
    );
  }

  @Get('applications/:id')
  @Public()
  @UseGuards(ApplicantGuard)
  getApplication(@Req() req: ApplicantRequest, @Param('id') id: string) {
    return this.admissions.get(req.applicant!, id);
  }

  @Patch('applications/:id')
  @Public()
  @UseGuards(ApplicantGuard)
  @PublicThrottle(60)
  updateApplication(
    @Req() req: ApplicantRequest,
    @Param('id') id: string,
    @Body() body: UpdateApplicationDto,
  ) {
    return this.admissions.update(req.applicant!, id, body);
  }

  @Post('applications/:id/submit')
  @Public()
  @UseGuards(ApplicantGuard)
  @PublicThrottle(30)
  submitApplication(@Req() req: ApplicantRequest, @Param('id') id: string) {
    return this.admissions.submit(req.applicant!, id);
  }
}
