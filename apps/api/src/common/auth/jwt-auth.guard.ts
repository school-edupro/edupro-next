import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../../config/env';
import { IdentityService } from '../../modules/identity/identity.service';
import type { AuthenticatedUser, ContextualRequest } from '../http/request-context';
import { IS_PUBLIC } from './decorators';

/**
 * First guard in the chain. Verifies the One Auth JWT (or the development bypass token), resolves the user
 * and their memberships, and initialises request.ctx. Public routes still get a request id.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly reflector: Reflector,
    private readonly identity: IdentityService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.jwks = createRemoteJWKSet(new URL(env.ONEAUTH_JWKS_URL));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ContextualRequest>();
    const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      // Public routes carry no identity; downstream guards skip as well.
      return true;
    }

    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({ type: 'unauthenticated', detail: 'Bearer token required' });
    }
    const token = header.slice('Bearer '.length).trim();

    let sub: string;
    let mfa = false;
    let authTime: number | undefined;
    let dev = false;
    let mobile: string | null = null;

    if (token.startsWith('dev:')) {
      if (!this.env.AUTH_DEV_BYPASS || this.env.NODE_ENV === 'production') {
        throw new UnauthorizedException({ type: 'unauthenticated', detail: 'Invalid token' });
      }
      sub = token.slice('dev:'.length);
      mfa = true; // development identities are treated as MFA-verified to exercise step-up paths
      authTime = Math.floor(Date.now() / 1000);
      dev = true;
    } else {
      const payload = await this.verify(token);
      sub = payload.sub ?? '';
      const amr = Array.isArray(payload.amr) ? (payload.amr as string[]) : [];
      mfa = amr.includes('mfa') || amr.includes('otp') || amr.includes('hwk');
      authTime = typeof payload.auth_time === 'number' ? payload.auth_time : undefined;
      const claimMobile =
        (payload as { mobile?: unknown; phone_number?: unknown }).mobile ??
        (payload as { phone_number?: unknown }).phone_number;
      mobile = typeof claimMobile === 'string' ? claimMobile : null;
    }
    if (!sub)
      throw new UnauthorizedException({ type: 'unauthenticated', detail: 'Token has no subject' });

    const resolved = await this.identity.resolveBySub(sub, { mobile });
    if (!resolved) {
      throw new UnauthorizedException({
        type: 'user-not-provisioned',
        detail: 'This identity has no EduPro account. Ask your school administrator for access.',
      });
    }

    const user: AuthenticatedUser = { ...resolved, mfa, dev };
    if (authTime !== undefined) user.authTime = authTime;

    req.ctx = {
      requestId,
      user,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
    return true;
  }

  private async verify(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.env.ONEAUTH_ISSUER,
        audience: this.env.ONEAUTH_AUDIENCE,
        clockTolerance: 30,
      });
      return payload;
    } catch {
      throw new UnauthorizedException({
        type: 'unauthenticated',
        detail: 'Invalid or expired token',
      });
    }
  }
}
