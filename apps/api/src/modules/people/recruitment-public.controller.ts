import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators';
import { PowService } from '../admissions/public/pow.service';
import { PublicThrottle, PublicThrottleGuard } from '../admissions/public/public-throttle.guard';
import { CandidateAuthService } from './candidate-auth.service';
import { CandidateGuard, type CandidateRequest } from './candidate.guard';
import {
  CandidateApplyDto,
  CandidateFileDto,
  CandidateFileSlotDto,
  CandidateOtpDto,
  CandidateProfileDto,
  CandidateVerifyDto,
} from './recruitment-public.dto';
import { RecruitmentPublicService } from './recruitment-public.service';

/**
 * The public careers page (docs/design/34-recruitment.md, part 2). Every handler is on the reviewed public
 * allow-list: the vacancy pages are open; the rest needs a candidate token from a code to the candidate's
 * mobile or email (CandidateGuard), never an EduPro user.
 */
@ApiTags('public')
@Controller('public/careers')
@UseGuards(PublicThrottleGuard)
export class RecruitmentPublicController {
  constructor(
    private readonly svc: RecruitmentPublicService,
    private readonly auth: CandidateAuthService,
    private readonly pow: PowService,
  ) {}

  @Post('otp')
  @Public()
  @PublicThrottle(10)
  @ApiOperation({
    summary: 'Send a sign-in code to the mobile or the email (needs a solved challenge)',
  })
  async otp(@Body() body: CandidateOtpDto, @Req() req: CandidateRequest) {
    await this.pow.consume(body.challenge, body.nonce);
    const schoolId = await this.auth.schoolId(body.schoolCode);
    return this.auth.request(schoolId, body.channel, body.to, req.ip);
  }

  @Post('otp/verify')
  @Public()
  @PublicThrottle(20)
  @ApiOperation({ summary: 'Exchange the code for a candidate token' })
  async verify(@Body() body: CandidateVerifyDto) {
    const schoolId = await this.auth.schoolId(body.schoolCode);
    return this.auth.verify(schoolId, body.channel, body.to, body.code, body.name);
  }

  @Get('me')
  @Public()
  @UseGuards(CandidateGuard)
  @ApiOperation({ summary: 'My application form as saved, my documents and my applications' })
  me(@Req() req: CandidateRequest) {
    return this.svc.me(req.candidate!);
  }

  @Put('me/profile')
  @Public()
  @UseGuards(CandidateGuard)
  @PublicThrottle(60)
  @ApiOperation({ summary: 'Save my application form (a draft may be incomplete)' })
  profile(@Req() req: CandidateRequest, @Body() body: CandidateProfileDto) {
    return this.svc.saveProfile(req.candidate!, body);
  }

  @Post('me/files/slot')
  @Public()
  @UseGuards(CandidateGuard)
  @PublicThrottle(30)
  @ApiOperation({ summary: 'An upload slot for one of my documents or photos' })
  slot(@Req() req: CandidateRequest, @Body() body: CandidateFileSlotDto) {
    return this.svc.fileSlot(req.candidate!, body);
  }

  @Post('me/files')
  @Public()
  @UseGuards(CandidateGuard)
  @PublicThrottle(30)
  @ApiOperation({ summary: 'The uploaded file becomes my document of that kind' })
  addFile(@Req() req: CandidateRequest, @Body() body: CandidateFileDto) {
    return this.svc.addFile(req.candidate!, body);
  }

  @Delete('me/files/:id')
  @Public()
  @UseGuards(CandidateGuard)
  @ApiOperation({ summary: 'Remove one of my documents' })
  removeFile(@Req() req: CandidateRequest, @Param('id') id: string) {
    return this.svc.removeFile(req.candidate!, id);
  }

  @Get('me/files/:fileId')
  @Public()
  @UseGuards(CandidateGuard)
  @ApiOperation({ summary: 'One of my own files, as a signed address' })
  fileUrl(@Req() req: CandidateRequest, @Param('fileId') fileId: string) {
    return this.svc.fileUrl(req.candidate!, fileId);
  }

  @Post('vacancies/:id/apply')
  @HttpCode(201)
  @Public()
  @UseGuards(CandidateGuard)
  @PublicThrottle(20)
  @ApiOperation({ summary: 'Apply to an open vacancy with my application as it stands' })
  apply(@Req() req: CandidateRequest, @Param('id') id: string, @Body() body: CandidateApplyDto) {
    return this.svc.apply(req.candidate!, id, body);
  }

  @Get(':schoolCode')
  @Public()
  @PublicThrottle(60)
  @ApiOperation({ summary: 'The open vacancies of a school' })
  vacancies(@Param('schoolCode') schoolCode: string) {
    return this.svc.vacancies(schoolCode);
  }

  @Get(':schoolCode/sign-in')
  @Public()
  @PublicThrottle(60)
  @ApiOperation({
    summary: 'How a candidate can get a sign-in code at this school (mobile, email)',
  })
  async signIn(@Param('schoolCode') schoolCode: string) {
    return this.auth.channels(await this.auth.schoolId(schoolCode));
  }

  @Get(':schoolCode/form')
  @Public()
  @PublicThrottle(60)
  @ApiOperation({
    summary: 'The application form: sections, fields with the school’s lists, rows, documents',
  })
  form(@Param('schoolCode') schoolCode: string) {
    return this.svc.form(schoolCode);
  }

  @Get(':schoolCode/vacancies/:id')
  @Public()
  @PublicThrottle(60)
  @ApiOperation({ summary: 'One open vacancy' })
  vacancy(@Param('schoolCode') schoolCode: string, @Param('id') id: string) {
    return this.svc.vacancy(schoolCode, id);
  }
}
