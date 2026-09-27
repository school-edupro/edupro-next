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
    let impersonation: AuthenticatedUser['impersonation'];

    if (token.startsWith('dev:')) {
      if (!this.env.AUTH_DEV_BYPASS || this.env.NODE_ENV === 'production') {
        throw new UnauthorizedException({ type: 'unauthenticated', detail: 'Invalid token' });
      }
      // dev:<sub> or dev:<sub>;auth_time=<unix seconds>;mfa=false to exercise the MFA rules (S5-01).
      const [devSub, ...devOpts] = token.slice('dev:'.length).split(';');
      sub = devSub ?? '';
      mfa = true; // development identities are treated as MFA-verified to exercise step-up paths
      authTime = Math.floor(Date.now() / 1000);
      for (const opt of devOpts) {
        const [k, v] = opt.split('=');
        if (k === 'auth_time' && v && /^\d+$/.test(v)) authTime = Number(v);
        if (k === 'mfa' && v === 'false') mfa = false;
      }
      dev = true;
    } else if (token.startsWith('imp.')) {
      // Impersonation session token (S5-02): the session row is the source of truth and is re-checked here.
      const payload = await this.verifySigned(
        token.slice('imp.'.length),
        this.env.IMPERSONATION_JWT_SECRET,
        'edupro-impersonation',
      );
      const session = await this.identity.impersonationCheck(String(payload.jti ?? ''));
      if (!session || session.endedAt || session.expiresAt.getTime() < Date.now()) {
        throw new UnauthorizedException({
          type: 'impersonation-ended',
          detail: 'The impersonation session has ended',
        });
      }
      sub = typeof payload.sub === 'string' ? payload.sub : '';
      impersonation = {
        sessionId: String(payload.jti),
        byUserId: session.actorUserId,
        byDisplayName: session.actorName,
        expiresAt: session.expiresAt.toISOString(),
      };
      if (!req.headers['x-school-id']) req.headers['x-school-id'] = session.schoolId;
    } else if (token.startsWith('compat.')) {
      // Session token issued by the compatibility handshake (S4-05): HS256, short-lived, carries the school.
      const payload = await this.verifyCompat(token.slice('compat.'.length));
      sub = typeof payload.sub === 'string' ? payload.sub : '';
      if (typeof payload.sid === 'string' && !req.headers['x-school-id'])
        req.headers['x-school-id'] = payload.sid;
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
    if (impersonation) user.impersonation = impersonation;

    req.ctx = {
      requestId,
      user,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
    return true;
  }

  private async verifyCompat(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(this.env.COMPAT_JWT_SECRET),
        {
          issuer: 'edupro-compat',
          audience: 'edupro-compat',
          clockTolerance: 30,
        },
      );
      return payload;
    } catch {
      throw new UnauthorizedException({
        type: 'unauthenticated',
        detail: 'Invalid or expired app session',
      });
    }
  }

  /** HS256 tokens issued by this platform (compatibility sessions, impersonation sessions). */
  private async verifySigned(token: string, secret: string, issuer: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        issuer,
        audience: issuer,
        clockTolerance: 30,
      });
      return payload;
    } catch {
      throw new UnauthorizedException({
        type: 'unauthenticated',
        detail: 'Invalid or expired session token',
      });
    }
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
