import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/auth/decorators';
import type { AdmissionAnswers } from '@edupro/db';
import { PowService } from '../public/pow.service';
import { PublicThrottle, PublicThrottleGuard } from '../public/public-throttle.guard';
import { AdmissionCandidateGuard, type CandidateRequest } from './candidate.guard';
import { CandidatePortalService } from './candidate-portal.service';
import { CandidateSigninService } from './candidate-signin.service';
import {
  CodeRequestDto,
  CodeVerifyDto,
  PayDto,
  SaveStepDto,
  SlotDto,
  StartDto,
  SubmitFormDto,
  WithdrawDto,
} from './portal.dto';

/**
 * The admission portal on the school's public site (docs/design/39, part 3). Anonymous: the open
 * sessions, the sign-in code. Signed in (`adm.` token): the family's registrations and everything on them.
 */
@ApiTags('public')
@Controller('public/admission')
@UseGuards(PublicThrottleGuard)
export class CandidatePortalController {
  constructor(
    private readonly portal: CandidatePortalService,
    private readonly signin: CandidateSigninService,
    private readonly pow: PowService,
  ) {}

  @Get('schools/:schoolCode')
  @Public()
  @PublicThrottle(60)
  @ApiOperation({
    summary: 'Open admission sessions of a school with the classes taking registrations',
  })
  async sessions(@Param('schoolCode') schoolCode: string) {
    return this.portal.sessions(await this.signin.schoolId(schoolCode));
  }

  @Post('code')
  @Public()
  @PublicThrottle(10)
  @ApiOperation({
    summary: 'A sign-in code to the mobile / email of a mobile, an email or a registration no.',
  })
  async code(@Body() body: CodeRequestDto, @Req() req: CandidateRequest) {
    await this.pow.consume(body.challenge, body.nonce);
    return this.signin.request(
      await this.signin.schoolId(body.schoolCode),
      body.identifier,
      req.ip,
    );
  }

  @Post('code/verify')
  @Public()
  @PublicThrottle(20)
  async verify(@Body() body: CodeVerifyDto) {
    return this.signin.verify(
      await this.signin.schoolId(body.schoolCode),
      body.identifier,
      body.code,
      body.name,
    );
  }

  @Get('me')
  @Public()
  @UseGuards(AdmissionCandidateGuard)
  me(@Req() req: CandidateRequest) {
    return this.portal.me(req.candidate!);
  }

  @Post('me/applications')
  @Public()
  @UseGuards(AdmissionCandidateGuard)
  @PublicThrottle(30)
  start(@Req() req: CandidateRequest, @Body() body: StartDto) {
    return this.portal.start(req.candidate!, body.cycleId, body.classId);
  }

  @Get('me/applications/:id')
  @Public()
  @UseGuards(AdmissionCandidateGuard)
  get(@Req() req: CandidateRequest, @Param('id') id: string) {
    return this.portal.get(req.candidate!, id);
  }

  @Put('me/applications/:id/step')
  @Public()
  @UseGuards(AdmissionCandidateGuard)
  @PublicThrottle(120)
  saveStep(@Req() req: CandidateRequest, @Param('id') id: string, @Body() body: SaveStepDto) {
    return this.portal.saveStep(req.candidate!, id, body.answers as AdmissionAnswers, body.step);
  }

  @Post('me/applications/:id/submit')
  @Public()
  @UseGuards(AdmissionCandidateGuard)
  @PublicThrottle(30)
  submit(@Req() req: CandidateRequest, @Param('id') id: string, @Body() body: SubmitFormDto) {
    return this.portal.submit(req.candidate!, id, body.answers as AdmissionAnswers);
  }

  @Get('me/gateways')
  @Public()
  @UseGuards(AdmissionCandidateGuard)
  gateways(@Req() req: CandidateRequest) {
    return this.portal.gateways(req.candidate!);
  }

  @Post('me/applications/:id/pay')
  @Public()
  @UseGuards(AdmissionCandidateGuard)
  @PublicThrottle(20)
  async pay(
    @Req() req: CandidateRequest,
    @Param('id') id: string,
    @Body() body: PayDto,
    @Query('school') school: string,
  ) {
    return this.portal.pay(req.candidate!, id, school || '', body.gatewayId);
  }

  @Post('me/files/slot')
  @Public()
  @UseGuards(AdmissionCandidateGuard)
  @PublicThrottle(60)
  slot(@Req() req: CandidateRequest, @Body() body: SlotDto) {
    return this.portal.slot(req.candidate!, body);
  }

  @Get('me/files/:fileId')
  @Public()
  @UseGuards(AdmissionCandidateGuard)
  file(@Req() req: CandidateRequest, @Param('fileId') fileId: string) {
    return this.portal.file(req.candidate!, fileId);
  }

  @Get('me/applications/:id/pdf')
  @Public()
  @UseGuards(AdmissionCandidateGuard)
  pdf(@Req() req: CandidateRequest, @Param('id') id: string) {
    return this.portal.pdf(req.candidate!, id);
  }

  @Get('me/applications/:id/receipts/:receiptId')
  @Public()
  @UseGuards(AdmissionCandidateGuard)
  receipt(
    @Req() req: CandidateRequest,
    @Param('id') id: string,
    @Param('receiptId') receiptId: string,
  ) {
    return this.portal.receipt(req.candidate!, id, receiptId);
  }

  @Get('me/sibling')
  @Public()
  @UseGuards(AdmissionCandidateGuard)
  @PublicThrottle(30)
  sibling(@Req() req: CandidateRequest, @Query('admissionNo') admissionNo: string) {
    return this.portal.sibling(req.candidate!, admissionNo ?? '');
  }

  @Delete('me/applications/:id')
  @Public()
  @UseGuards(AdmissionCandidateGuard)
  withdraw(@Req() req: CandidateRequest, @Param('id') id: string, @Body() body: WithdrawDto) {
    return this.portal.withdraw(req.candidate!, id, body?.reason);
  }
}
