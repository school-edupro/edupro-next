import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { ENV, type Env } from '../../../config/env';
import { publicTenant } from '../public/otp.service';

export interface AdmissionCandidate {
  id: string;
  schoolId: string;
  mobile: string | null;
  email: string | null;
  name: string | null;
}

type Kind = 'mobile' | 'email' | 'number';

const classify = (raw: string): { kind: Kind; value: string } => {
  const v = raw.trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { kind: 'email', value: v.toLowerCase() };
  const digits = v.replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, '');
  if (/^[6-9]\d{9}$/.test(digits)) return { kind: 'mobile', value: digits };
  if (/^[A-Za-z0-9/_-]{4,40}$/.test(v)) return { kind: 'number', value: v.toUpperCase() };
  throw new DomainError(
    'validation-failed',
    'Enter a 10-digit mobile number, an email or your registration number',
    { status: 400 },
  );
};
const maskMobile = (m: string) => `******${m.slice(-4)}`;
const maskEmail = (e: string) => {
  const [u, d] = e.split('@');
  return `${(u ?? '').slice(0, 2)}***@${d ?? ''}`;
};

/**
 * Sign-in to the admission portal (docs/design/39, part 3): a mobile number, an email or the registration
 * number, and a six-digit code sent to the candidate's mobile and email by the channels the school chose
 * (ten minutes, five tries, three live codes). A registration number reaches the addresses of the family
 * that registered it. The code is returned in the response only under the development bypass.
 */
@Injectable()
export class CandidateSigninService {
  private readonly log = new Logger(CandidateSigninService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
  ) {}

  private hash(code: string) {
    return createHash('sha256')
      .update(`${this.env.APPLICANT_JWT_SECRET}:adm:${code}`)
      .digest('hex');
  }

  async schoolId(code: string): Promise<string> {
    const id = await this.db.global(async (c) => {
      const r = await c.query<{ id: string | null }>(
        `SELECT app.public_school_id($1)::text AS id`,
        [code],
      );
      return r.rows[0]?.id ?? null;
    });
    if (!id) throw new DomainError('not-found', 'School not found', { status: 404 });
    return id;
  }

  async request(schoolId: string, identifier: string, ip: string | undefined) {
    const who = classify(identifier);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    let sentTo: string[] = [];
    await this.db.tenant(publicTenant(schoolId), async (c) => {
      let mobile: string | null = who.kind === 'mobile' ? who.value : null;
      let email: string | null = who.kind === 'email' ? who.value : null;
      if (who.kind === 'number') {
        const a = await c.query<{ mobile: string | null; email: string | null }>(
          `SELECT ap.mobile, ap.email::text AS email FROM applications a JOIN applicants ap ON ap.id = a.applicant_id
            WHERE upper(a.application_no) = $1 LIMIT 1`,
          [who.value],
        );
        if (!a.rows[0])
          throw new DomainError('not-found', 'No registration with this number', { status: 404 });
        ({ mobile, email } = a.rows[0]);
      } else {
        // a known family: the code reaches every address it gave
        const ap = await c.query<{ mobile: string | null; email: string | null }>(
          who.kind === 'mobile'
            ? `SELECT mobile, email::text AS email FROM applicants WHERE mobile = $1 ORDER BY id LIMIT 1`
            : `SELECT mobile, email::text AS email FROM applicants WHERE lower(email::text) = $1 ORDER BY id LIMIT 1`,
          [who.value],
        );
        if (ap.rows[0]) {
          mobile = ap.rows[0].mobile ?? mobile;
          email = ap.rows[0].email ?? email;
        }
      }
      const live = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public_otps WHERE mobile = $1 AND purpose = 'admission_v2' AND consumed_at IS NULL AND expires_at > now()`,
        [who.value],
      );
      if ((live.rows[0]?.n ?? 0) >= 3)
        throw new DomainError(
          'otp.too_many',
          'Too many codes requested; wait for the earlier code to expire',
          { status: 429 },
        );
      await c.query(
        `INSERT INTO public_otps (school_id, mobile, purpose, code_hash, expires_at, ip)
         VALUES (app.current_school_id(), $1, 'admission_v2', $2, now() + make_interval(mins => $3), $4)`,
        [who.value, this.hash(code), this.env.OTP_TTL_MINUTES, ip ?? null],
      );
      const n = await c.query<{ n: number }>(`SELECT app.admission_otp_send($1, $2, $3, $4) AS n`, [
        mobile,
        email,
        code,
        this.env.OTP_TTL_MINUTES,
      ]);
      const settings = await c.query<{ ch: string[] | null }>(
        `SELECT signin_channels AS ch FROM admission_settings WHERE school_id = app.current_school_id()`,
      );
      const ch = settings.rows[0]?.ch ?? ['email', 'sms', 'whatsapp'];
      if (mobile && (ch.includes('sms') || ch.includes('whatsapp')))
        sentTo.push(`mobile ${maskMobile(mobile)}`);
      if (email && ch.includes('email')) sentTo.push(`email ${maskEmail(email)}`);
      if (!(n.rows[0]?.n ?? 0) && !this.env.AUTH_DEV_BYPASS)
        throw new DomainError(
          'otp.channel_unavailable',
          who.kind === 'email'
            ? 'This school cannot send codes by email yet: use your mobile number'
            : 'This school cannot send codes to this address yet: try your email',
          { status: 409 },
        );
      if (!sentTo.length)
        sentTo = [
          who.kind === 'email'
            ? `email ${maskEmail(who.value)}`
            : `mobile ${maskMobile(mobile ?? '0000')}`,
        ];
    });
    this.log.log(`admission code (${who.kind}) issued (school ${schoolId})`);
    return {
      sent: true,
      sentTo,
      expiresInMinutes: this.env.OTP_TTL_MINUTES,
      ...(this.env.AUTH_DEV_BYPASS ? { devCode: code } : {}),
    };
  }

  async verify(schoolId: string, identifier: string, code: string, name?: string) {
    const who = classify(identifier);
    const outcome = await this.db.tenant(publicTenant(schoolId), async (c) => {
      const otp = await c.query<{ id: string; code_hash: string; attempts: number }>(
        `SELECT id::text, code_hash, attempts FROM public_otps
          WHERE mobile = $1 AND purpose = 'admission_v2' AND consumed_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1`,
        [who.value],
      );
      const row = otp.rows[0];
      if (!row) return { kind: 'expired' as const };
      if (row.attempts >= 5) return { kind: 'locked' as const };
      if (row.code_hash !== this.hash(code.trim())) {
        await c.query(`UPDATE public_otps SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
        return { kind: 'invalid' as const };
      }
      await c.query(`UPDATE public_otps SET consumed_at = now() WHERE id = $1`, [row.id]);
      let id: string | undefined;
      if (who.kind === 'number')
        id = (
          await c.query<{ id: string }>(
            `SELECT applicant_id::text AS id FROM applications WHERE upper(application_no) = $1 LIMIT 1`,
            [who.value],
          )
        ).rows[0]?.id;
      else
        id = (
          await c.query<{ id: string }>(
            who.kind === 'mobile'
              ? `SELECT id::text FROM applicants WHERE mobile = $1 ORDER BY id LIMIT 1`
              : `SELECT id::text FROM applicants WHERE lower(email::text) = $1 ORDER BY id LIMIT 1`,
            [who.value],
          )
        ).rows[0]?.id;
      if (id)
        await c.query(
          `UPDATE applicants SET last_login_at = now(), name = COALESCE(name, $2) WHERE id = $1`,
          [id, name ?? null],
        );
      else
        id = (
          await c.query<{ id: string }>(
            who.kind === 'mobile'
              ? `INSERT INTO applicants (school_id, mobile, name, last_login_at) VALUES (app.current_school_id(), $1, $2, now()) RETURNING id::text`
              : `INSERT INTO applicants (school_id, email, name, last_login_at) VALUES (app.current_school_id(), $1, $2, now()) RETURNING id::text`,
            [who.value, name ?? null],
          )
        ).rows[0]!.id;
      return { kind: 'ok' as const, id };
    });
    if (outcome.kind === 'expired')
      throw new DomainError('otp.expired', 'No live code; request a new one', { status: 401 });
    if (outcome.kind === 'locked')
      throw new DomainError('otp.locked', 'Too many wrong attempts; request a new code', {
        status: 429,
      });
    if (outcome.kind === 'invalid')
      throw new DomainError('otp.invalid', 'The code is not correct', { status: 401 });
    const expiresAt = new Date(Date.now() + 2 * 3600_000);
    const token = await new SignJWT({ sid: schoolId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(outcome.id)
      .setIssuer('edupro-admission')
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(new TextEncoder().encode(this.env.APPLICANT_JWT_SECRET));
    return { token: `adm.${token}`, expiresAt: expiresAt.toISOString() };
  }

  async fromToken(token: string): Promise<AdmissionCandidate> {
    try {
      const { payload } = await jwtVerify(
        token.slice('adm.'.length),
        new TextEncoder().encode(this.env.APPLICANT_JWT_SECRET),
        {
          issuer: 'edupro-admission',
        },
      );
      const schoolId = String(payload.sid ?? '');
      const id = String(payload.sub ?? '');
      if (!schoolId || !id) throw new Error('claims');
      return await this.db.tenant(publicTenant(schoolId), async (c) => {
        const r = await c.query<{
          mobile: string | null;
          email: string | null;
          name: string | null;
        }>(`SELECT mobile, email::text AS email, name FROM applicants WHERE id = $1`, [id]);
        if (!r.rows[0]) throw new Error('unknown');
        return { id, schoolId, ...r.rows[0] };
      });
    } catch {
      throw new DomainError('applicant-unauthenticated', 'Sign in again to go on', { status: 401 });
    }
  }
}
