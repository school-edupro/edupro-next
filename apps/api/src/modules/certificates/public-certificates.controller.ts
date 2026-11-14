import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/auth/decorators';
import { PublicThrottle, PublicThrottleGuard } from '../admissions/public/public-throttle.guard';
import { CertificateVerifyService } from './certificate-verify.service';

/**
 * The public check of a certificate (docs/design/87, phase D): no sign-in, a few checks a minute per address; the
 * answer names the school and shows the holder's name masked.
 */
@ApiTags('public')
@Controller('public/certificates')
@UseGuards(PublicThrottleGuard)
export class PublicCertificatesController {
  constructor(private readonly verify: CertificateVerifyService) {}

  @Get(':schoolCode/verify')
  @Public()
  @PublicThrottle(10)
  @ApiOperation({ summary: "The school's check page; with number and date, the check by search" })
  search(
    @Req() req: FastifyRequest,
    @Param('schoolCode') schoolCode: string,
    @Query() q: { number?: string; date?: string },
  ) {
    if (typeof q.number !== 'string' || typeof q.date !== 'string')
      return this.verify.page(schoolCode);
    return this.verify.bySearch(schoolCode, q.number, q.date, {
      ip: req.ip,
      agent: req.headers['user-agent'],
    });
  }

  @Get(':schoolCode/verify/:token')
  @Public()
  @PublicThrottle(30)
  @ApiOperation({ summary: "The check behind a certificate's QR" })
  byToken(
    @Req() req: FastifyRequest,
    @Param('schoolCode') schoolCode: string,
    @Param('token') token: string,
  ) {
    return this.verify.byToken(schoolCode, token, { ip: req.ip, agent: req.headers['user-agent'] });
  }
}
