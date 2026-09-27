import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import type { TenantContext } from '@edupro/db';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { ENV, type Env } from '../../../config/env';

export interface Applicant {
  id: string;
  schoolId: string;
  mobile: string;
  name: string | null;
}

export const publicTenant = (schoolId: string, requestId?: string): TenantContext => ({
  schoolId,
  userId: null,
  allowedSchoolIds: [schoolId],
  academicYearId: null,
  requestId: requestId ?? null,
});

/**
 * Mobile OTP for applicants (S8-01, legacy candidate OTP with 20 attempts): six digits, ten minutes,
 * five attempts, three live codes per mobile. Delivery goes to the notification service in Sprint 10; until
 * then the code is logged, and returned in the response only under the development bypass.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
  ) {}

  private hash(code: string): string {
    return createHash('sha256').update(`${this.env.APPLICANT_JWT_SECRET}:${code}`).digest('hex');
  }

  async request(
    schoolId: string,
    mobile: string,
    ip: string | undefined,
  ): Promise<{ sent: true; expiresInMinutes: number; devCode?: string }> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.tenant(publicTenant(schoolId), async (c) => {
      const live = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public_otps WHERE mobile = $1 AND purpose = 'admission_login' AND consumed_at IS NULL AND expires_at > now()`,
        [mobile],
      );
      if (Number(live.rows[0]?.n ?? 0) >= 3)
        throw new DomainError(
          'otp.too_many',
          'Too many codes requested; wait for the earlier code to expire',
          { status: 429 },
        );
      await c.query(
        `INSERT INTO public_otps (school_id, mobile, purpose, code_hash, expires_at, ip) VALUES (app.current_school_id(), $1, 'admission_login', $2, now() + make_interval(mins => $3), $4)`,
        [mobile, this.hash(code), this.env.OTP_TTL_MINUTES, ip ?? null],
      );
    });
    this.logger.log(
      `OTP for ${mobile.slice(0, 2)}******${mobile.slice(-2)} issued (school ${schoolId})`,
    );
    const out: { sent: true; expiresInMinutes: number; devCode?: string } = {
      sent: true,
      expiresInMinutes: this.env.OTP_TTL_MINUTES,
    };
    if (this.env.AUTH_DEV_BYPASS) out.devCode = code;
    return out;
  }

  async verify(
    schoolId: string,
    mobile: string,
    code: string,
    name?: string,
  ): Promise<{ token: string; applicant: Applicant; expiresAt: string }> {
    // The attempt counter must survive a refusal, so the check commits in its own transaction and the
    // error is raised afterwards (a throw inside withTenant would roll the counter back).
    const outcome = await this.db.tenant(publicTenant(schoolId), async (c) => {
      const otp = await c.query<{ id: string; code_hash: string; attempts: number }>(
        `SELECT id::text, code_hash, attempts FROM public_otps WHERE mobile = $1 AND purpose = 'admission_login' AND consumed_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1`,
        [mobile],
      );
      const row = otp.rows[0];
      if (!row) return { kind: 'expired' as const };
      if (row.attempts >= 5) return { kind: 'locked' as const };
      if (row.code_hash !== this.hash(code)) {
        await c.query(`UPDATE public_otps SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
        return { kind: 'invalid' as const };
      }
      await c.query(`UPDATE public_otps SET consumed_at = now() WHERE id = $1`, [row.id]);
      const a = await c.query<{ id: string; name: string | null }>(
        `INSERT INTO applicants (school_id, mobile, name, last_login_at) VALUES (app.current_school_id(), $1, $2, now())
         ON CONFLICT (school_id, mobile) DO UPDATE SET last_login_at = now(), name = COALESCE(EXCLUDED.name, applicants.name)
         RETURNING id::text, name`,
        [mobile, name ?? null],
      );
      return {
        kind: 'ok' as const,
        applicant: { id: a.rows[0]!.id, schoolId, mobile, name: a.rows[0]!.name },
      };
    });
    if (outcome.kind === 'expired')
      throw new DomainError('otp.expired', 'No live code for this mobile; request a new one', {
        status: 401,
      });
    if (outcome.kind === 'locked')
      throw new DomainError('otp.locked', 'Too many wrong attempts; request a new code', {
        status: 429,
      });
    if (outcome.kind === 'invalid')
      throw new DomainError('otp.invalid', 'The code is not correct', { status: 401 });
    const applicant = outcome.applicant;
    const expiresAt = new Date(Date.now() + 2 * 3600_000);
    const token = await new SignJWT({ sid: schoolId, mob: mobile })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(applicant.id)
      .setIssuer('edupro-applicant')
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(new TextEncoder().encode(this.env.APPLICANT_JWT_SECRET));
    return { token: `app.${token}`, applicant, expiresAt: expiresAt.toISOString() };
  }

  async fromToken(token: string): Promise<Applicant> {
    try {
      const { payload } = await jwtVerify(
        token.slice('app.'.length),
        new TextEncoder().encode(this.env.APPLICANT_JWT_SECRET),
        {
          issuer: 'edupro-applicant',
        },
      );
      const schoolId = String(payload.sid ?? '');
      const id = String(payload.sub ?? '');
      const mobile = String(payload.mob ?? '');
      if (!schoolId || !id || !mobile) throw new Error('claims');
      const name = await this.db.tenant(publicTenant(schoolId), async (c) => {
        const r = await c.query<{ name: string | null }>(
          `SELECT name FROM applicants WHERE id = $1`,
          [id],
        );
        if (!r.rows[0]) throw new Error('unknown applicant');
        return r.rows[0].name;
      });
      return { id, schoolId, mobile, name };
    } catch {
      throw new DomainError('applicant-unauthenticated', 'Sign in with your mobile number again', {
        status: 401,
      });
    }
  }
}
