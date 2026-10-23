import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { DomainError } from '../../../common/errors/domain-error';
import { CandidateSigninService, type AdmissionCandidate } from './candidate-signin.service';

export type CandidateRequest = FastifyRequest & { candidate?: AdmissionCandidate };

/** Admission portal tokens (`Bearer adm.<jwt>`); no EduPro user is involved. */
@Injectable()
export class AdmissionCandidateGuard implements CanActivate {
  constructor(private readonly signin: CandidateSigninService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<CandidateRequest>();
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer adm.'))
      throw new DomainError('applicant-unauthenticated', 'Sign in to the admission portal first', {
        status: 401,
      });
    req.candidate = await this.signin.fromToken(header.slice('Bearer '.length).trim());
    return true;
  }
}
