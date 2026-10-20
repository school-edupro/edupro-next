import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { DomainError } from '../../common/errors/domain-error';
import { CandidateAuthService, type Candidate } from './candidate-auth.service';

export type CandidateRequest = FastifyRequest & { candidate?: Candidate };

/** Candidate tokens (`Bearer cand.<jwt>`) for the careers page; no EduPro user is involved. */
@Injectable()
export class CandidateGuard implements CanActivate {
  constructor(private readonly auth: CandidateAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<CandidateRequest>();
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer cand.'))
      throw new DomainError(
        'candidate-unauthenticated',
        'Sign in with your mobile or email first',
        {
          status: 401,
        },
      );
    req.candidate = await this.auth.fromToken(header.slice('Bearer '.length).trim());
    return true;
  }
}
