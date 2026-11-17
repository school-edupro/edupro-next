import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/auth/decorators';
import { PublicThrottle, PublicThrottleGuard } from '../admissions/public/public-throttle.guard';
import { CertificateVerifyService } from './certificate-verify.service';
import { PublicCheckDto, PublicSearchDto } from './certificates.dto';
import { HumanCheckService } from './human-check.service';

/**
 * The public check of a certificate (docs/design/87, phase D): no sign-in; the answer names the school and shows the
 * holder's name masked. For people only (17 Nov 2026): a search and a QR check each pass a human check first
 * (Google reCAPTCHA, or EduPro's proof-of-work), a few a minute per visitor, and a visitor or a number that keeps
 * finding nothing waits. The pages (GET) give only the school and which check to show.
 */
@ApiTags('public')
@Controller('public/certificates')
@UseGuards(PublicThrottleGuard)
export class PublicCertificatesController {
  constructor(
    private readonly verify: CertificateVerifyService,
    private readonly human: HumanCheckService,
  ) {}

  private who(req: FastifyRequest) {
    return { ip: req.ip, agent: req.headers['user-agent'] };
  }

  @Get(':schoolCode/verify')
  @Public()
  @PublicThrottle(30)
  @ApiOperation({ summary: "The school's check page: its name and the human check to show" })
  async page(@Param('schoolCode') schoolCode: string) {
    return { ...(await this.verify.page(schoolCode)), check: this.human.config() };
  }

  @Post(':schoolCode/verify')
  @Public()
  @PublicThrottle(10)
  @ApiOperation({ summary: 'The check by the number and the date of issue, after the human check' })
  async search(
    @Req() req: FastifyRequest,
    @Param('schoolCode') schoolCode: string,
    @Body() body: PublicSearchDto,
  ) {
    await this.human.assertNotLocked(req.ip, schoolCode, body.number);
    await this.human.verify(body, req.ip);
    const r = await this.verify.bySearch(schoolCode, body.number, body.date, this.who(req));
    if (r.result === 'not_found') await this.human.missed(req.ip, schoolCode, body.number);
    return r;
  }

  @Get(':schoolCode/verify/:token')
  @Public()
  @PublicThrottle(30)
  @ApiOperation({ summary: "A certificate's QR page: the school and the human check to show" })
  async tokenPage(@Param('schoolCode') schoolCode: string) {
    return { ...(await this.verify.page(schoolCode)), check: this.human.config() };
  }

  @Post(':schoolCode/verify/:token')
  @Public()
  @PublicThrottle(30)
  @ApiOperation({ summary: "The check behind a certificate's QR, after the human check" })
  async byToken(
    @Req() req: FastifyRequest,
    @Param('schoolCode') schoolCode: string,
    @Param('token') token: string,
    @Body() body: PublicCheckDto,
  ) {
    await this.human.assertNotLocked(req.ip);
    await this.human.verify(body, req.ip);
    const r = await this.verify.byToken(schoolCode, token, this.who(req));
    if (r.result === 'not_found') await this.human.missed(req.ip);
    return r;
  }
}
