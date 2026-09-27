import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { DomainError } from '../../../common/errors/domain-error';
import { OtpService, type Applicant } from './otp.service';

export type ApplicantRequest = FastifyRequest & { applicant?: Applicant };

/** Applicant tokens (`Bearer app.<jwt>`) for the public admissions surface; no EduPro user is involved. */
@Injectable()
export class ApplicantGuard implements CanActivate {
  constructor(private readonly otp: OtpService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApplicantRequest>();
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer app.'))
      throw new DomainError('applicant-unauthenticated', 'Sign in with your mobile number first', {
        status: 401,
      });
    req.applicant = await this.otp.fromToken(header.slice('Bearer '.length).trim());
    return true;
  }
}
