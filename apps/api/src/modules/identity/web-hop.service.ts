import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { OtpService } from './otp.service';

const HOP_SECONDS = 60;

/** The websites a code opens: the family website, the staff website, the admin website. */
export type HopApp = 'parent' | 'teacher' | 'admin';

/**
 * Moving between the websites signed in (0424, 0425; docs/design/89 "Staff who are parents here"): a staff member
 * who is also a parent in the school opens the family website from the staff or admin website (My children), and
 * goes back from it (Staff app / Admin app). The website left asks for a one-time code (60 seconds, used once, kept
 * as a keyed hash); the website opened turns it in for its own session (12 hours, as a code sign-in makes).
 *  - to the family website: for someone who is a parent (or student) in the school, from the staff or admin website;
 *  - to the staff or admin website: for someone who is staff in the school, from the other staff-side website or
 *    from a family website session opened from either (a family sign-in of its own may not: the school may sign
 *    families in by other means than staff).
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

  private base(app: HopApp) {
    return app === 'parent'
      ? this.env.PARENT_APP_URL
      : app === 'teacher'
        ? this.env.TEACHER_APP_URL
        : this.env.ADMIN_APP_URL;
  }

  /**
   * A link that opens another website signed in. `app`: the website to open; `from`: the website asking (for the
   * family website's way back).
   */
  async issue(ctx: RequestContext, app: HopApp, from: 'teacher' | 'admin' | undefined, to: string) {
    if (ctx.user.impersonation)
      throw new DomainError(
        'auth.hop_view_as',
        'A portal the school opened as someone cannot open another',
        { status: 403 },
      );
    if (!to.startsWith('/') || to.startsWith('//') || to.length > 500)
      throw new DomainError('validation-failed', 'The page must be a path of that website', {
        status: 400,
      });
    if (app === 'parent' && !from)
      throw new DomainError('validation-failed', 'Say which website asks (from)', { status: 400 });
    // to the staff or admin website: not from a family sign-in of its own (the school may sign families in by other
    // means than staff); a family session opened from the staff or admin website may go there
    if (app !== 'parent' && ctx.user.codeApp === 'parent' && !ctx.user.hopFrom)
      throw new DomainError(
        'auth.hop_not_from',
        'Sign in to that website: this family website session was not opened from the staff or admin website',
        { status: 403 },
      );
    const tenant = requireTenant(ctx);
    const code = randomBytes(32).toString('base64url');
    const ok = await this.db.global(async (c) => {
      const r = await c.query<{ ok: boolean }>(
        'SELECT app.web_hop_issue($1, $2, $3, $4, $5, $6, $7, $8) AS ok',
        [
          this.hash(code),
          ctx.user.id,
          app,
          app === 'parent' ? from : 'parent',
          tenant.schoolId,
          to,
          ctx.user.mfa,
          HOP_SECONDS,
        ],
      );
      return r.rows[0]?.ok === true;
    });
    if (!ok)
      throw new DomainError(
        app === 'parent' ? 'auth.hop_not_family' : 'auth.hop_not_staff',
        app === 'parent'
          ? 'You are not a parent in this school'
          : 'You are not staff in this school',
        { status: 403 },
      );
    return {
      url: `${this.base(app)}/api/auth/hop?code=${code}`,
      expiresAt: Math.floor(Date.now() / 1000) + HOP_SECONDS,
    };
  }

  /** The website opened turns the code in for its session (the family website's notes where it came from). */
  async redeem(code: string, app: HopApp) {
    const row = await this.db.global(async (c) => {
      const r = await c.query<{
        user_id: string;
        school_id: string;
        target: string;
        mfa: boolean;
        from_app: string | null;
      }>(
        'SELECT user_id::text, school_id::text, target, mfa, from_app FROM app.web_hop_redeem($1, $2)',
        [this.hash(code), app],
      );
      return r.rows[0];
    });
    if (!row)
      throw new DomainError('auth.hop_invalid', 'The link has expired. Open it again.', {
        status: 401,
      });
    const via =
      app === 'parent' && (row.from_app === 'teacher' || row.from_app === 'admin')
        ? row.from_app
        : undefined;
    const u = await this.otp.user(row.user_id);
    const s = await this.otp.session(
      u.sub,
      u.displayName,
      row.mfa ? 'second_factor' : 'login',
      app,
      via,
    );
    return { ...s, schoolId: row.school_id, to: row.target, from: via ?? null };
  }
}
