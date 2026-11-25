import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { OtpService } from './otp.service';

const HOP_SECONDS = 60;

/**
 * The staff website's My children (0424, docs/design/89 "Staff who are parents here"): a staff member who is also a
 * parent in the school opens the family website signed in. The staff website asks for a one-time code (60 seconds,
 * used once, kept as a hash); the family website turns it in for its own session (12 hours, as a code sign-in).
 */
@Injectable()
export class WebHopService {
  constructor(
    private readonly db: DbService,
    private readonly otp: OtpService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private hash(code: string) {
    return createHmac('sha256', this.env.OTP_JWT_SECRET).update(`web-hop:${code}`).digest('hex');
  }

  /** A link that opens the family website signed in, for someone who is a parent in this school. */
  async issue(ctx: RequestContext, to: string) {
    if (ctx.user.impersonation)
      throw new DomainError(
        'auth.hop_view_as',
        'A portal the school opened as someone cannot open another',
        {
          status: 403,
        },
      );
    if (!to.startsWith('/') || to.startsWith('//') || to.length > 500)
      throw new DomainError('validation-failed', 'The page must be a path of the family website', {
        status: 400,
      });
    const tenant = requireTenant(ctx);
    const code = randomBytes(32).toString('base64url');
    const ok = await this.db.global(async (c) => {
      const r = await c.query<{ ok: boolean }>(
        'SELECT app.web_hop_issue($1, $2, $3, $4, $5, $6, $7) AS ok',
        [this.hash(code), ctx.user.id, 'parent', tenant.schoolId, to, ctx.user.mfa, HOP_SECONDS],
      );
      return r.rows[0]?.ok === true;
    });
    if (!ok)
      throw new DomainError('auth.hop_not_family', 'You are not a parent in this school', {
        status: 403,
      });
    return {
      url: `${this.env.PARENT_APP_URL}/api/auth/hop?code=${code}`,
      expiresAt: Math.floor(Date.now() / 1000) + HOP_SECONDS,
    };
  }

  /** The family website turns the code in for its session. */
  async redeem(code: string) {
    const row = await this.db.global(async (c) => {
      const r = await c.query<{ user_id: string; school_id: string; target: string; mfa: boolean }>(
        'SELECT user_id::text, school_id::text, target, mfa FROM app.web_hop_redeem($1, $2)',
        [this.hash(code), 'parent'],
      );
      return r.rows[0];
    });
    if (!row)
      throw new DomainError('auth.hop_invalid', 'The link has expired. Open My children again.', {
        status: 401,
      });
    const u = await this.otp.user(row.user_id);
    const s = await this.otp.session(
      u.sub,
      u.displayName,
      row.mfa ? 'second_factor' : 'login',
      'parent',
    );
    return { ...s, schoolId: row.school_id, to: row.target };
  }
}
