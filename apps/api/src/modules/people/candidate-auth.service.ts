import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import type { PoolClient } from 'pg';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { ENV, type Env } from '../../config/env';
import { publicTenant } from '../admissions/public/otp.service';

/** A candidate signed in on the careers page (no EduPro user is involved). */
export interface Candidate {
  id: string;
  schoolId: string;
  mobile: string | null;
  email: string | null;
  name: string | null;
}
export type CandidateChannel = 'mobile' | 'email';

/**
 * The careers page sign-in (docs/design/34-recruitment.md, part 2): a six-digit code to the mobile (SMS and
 * WhatsApp) or to the email, as the candidate chooses; ten minutes, five tries, three live codes per
 * address, as the admissions code. The code is returned in the response only under the development bypass.
 */
@Injectable()
export class CandidateAuthService {
  private readonly logger = new Logger(CandidateAuthService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
  ) {}

  private hash(code: string): string {
    return createHash('sha256')
      .update(`${this.env.APPLICANT_JWT_SECRET}:cand:${code}`)
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

  /**
   * The ways a code can reach a candidate at this school: the email when an email provider is on and the
   * code's email template is active; the mobile when SMS (with its DLT id) or WhatsApp (with its approved
   * name) can carry it.
   */
  private async channelsWith(c: PoolClient): Promise<Record<CandidateChannel, boolean>> {
    await c.query(`SELECT app.recruitment_seed_templates(app.current_school_id())`);
    const r = await c.query<{ ch: string }>(
      `SELECT DISTINCT t.channel::text AS ch FROM comms_templates t
         JOIN comms_providers p ON p.school_id = t.school_id AND p.channel = t.channel AND p.active
        WHERE t.code = 'recruitment_otp' AND t.status = 'active' AND t.deleted_at IS NULL
          AND (t.channel <> 'sms' OR COALESCE(btrim(t.dlt_template_id), '') <> '')
          AND (t.channel <> 'whatsapp' OR COALESCE(btrim(t.wa_template_name), '') <> '')`,
    );
    const ch = new Set(r.rows.map((x) => x.ch));
    return { mobile: ch.has('sms') || ch.has('whatsapp'), email: ch.has('email') };
  }

  /** What the sign-in offers (and, under the development bypass, that codes show on screen). */
  async channels(schoolId: string) {
    const ok = await this.db.tenant(publicTenant(schoolId), (c) => this.channelsWith(c));
    return { ...ok, minutes: this.env.OTP_TTL_MINUTES, dev: Boolean(this.env.AUTH_DEV_BYPASS) };
  }

  async request(
    schoolId: string,
    channel: CandidateChannel,
    to: string,
    ip: string | undefined,
  ): Promise<{ sent: boolean; expiresInMinutes: number; devCode?: string }> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const purpose = `recruitment_${channel}`;
    let sent = true;
    await this.db.tenant(publicTenant(schoolId), async (c) => {
      // a way the school cannot send by is refused at once, not left to wait for a code that never comes
      sent = (await this.channelsWith(c))[channel];
      if (!sent && !this.env.AUTH_DEV_BYPASS)
        throw new DomainError(
          'otp.channel_unavailable',
          channel === 'mobile'
            ? 'This school cannot send codes to mobiles yet: use your email'
            : 'This school cannot send codes by email yet: use your mobile',
          { status: 409 },
        );
      const live = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public_otps WHERE mobile = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()`,
        [to, purpose],
      );
      if ((live.rows[0]?.n ?? 0) >= 3)
        throw new DomainError(
          'otp.too_many',
          'Too many codes requested; wait for the earlier code to expire',
          { status: 429 },
        );
      // public_otps.mobile holds the address the code went to (a mobile or an email)
      await c.query(
        `INSERT INTO public_otps (school_id, mobile, purpose, code_hash, expires_at, ip)
         VALUES (app.current_school_id(), $1, $2, $3, now() + make_interval(mins => $4), $5)`,
        [to, purpose, this.hash(code), this.env.OTP_TTL_MINUTES, ip ?? null],
      );
      await c.query(`SELECT app.recruitment_otp_send($1, $2, $3, $4)`, [
        channel,
        to,
        code,
        this.env.OTP_TTL_MINUTES,
      ]);
    });
    this.logger.log(`careers code by ${channel} issued (school ${schoolId})`);
    const out: { sent: boolean; expiresInMinutes: number; devCode?: string } = {
      sent,
      expiresInMinutes: this.env.OTP_TTL_MINUTES,
    };
    if (this.env.AUTH_DEV_BYPASS) out.devCode = code;
    return out;
  }

  async verify(
    schoolId: string,
    channel: CandidateChannel,
    to: string,
    code: string,
    name?: string,
  ): Promise<{ token: string; candidate: Candidate; expiresAt: string }> {
    const purpose = `recruitment_${channel}`;
    // the attempt counter must survive a refusal: the check commits on its own, the error comes after
    const outcome = await this.db.tenant(publicTenant(schoolId), async (c) => {
      const otp = await c.query<{ id: string; code_hash: string; attempts: number }>(
        `SELECT id::text, code_hash, attempts FROM public_otps
          WHERE mobile = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1`,
        [to, purpose],
      );
      const row = otp.rows[0];
      if (!row) return { kind: 'expired' as const };
      if (row.attempts >= 5) return { kind: 'locked' as const };
      if (row.code_hash !== this.hash(code)) {
        await c.query(`UPDATE public_otps SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
        return { kind: 'invalid' as const };
      }
      await c.query(`UPDATE public_otps SET consumed_at = now() WHERE id = $1`, [row.id]);
      const col = channel === 'email' ? 'email' : 'mobile';
      const found = await c.query<{ id: string }>(
        // eslint-disable-next-line no-restricted-syntax -- the column is one of two constants
        `SELECT id::text FROM candidates WHERE ${col} = $1`,
        [to],
      );
      let id = found.rows[0]?.id;
      if (id)
        await c.query(
          `UPDATE candidates SET last_login_at = now(), name = COALESCE(name, $2) WHERE id = $1`,
          [id, name ?? null],
        );
      else
        id = (
          await c.query<{ id: string }>(
            // eslint-disable-next-line no-restricted-syntax -- the column is one of two constants
            `INSERT INTO candidates (school_id, ${col}, name, last_login_at) VALUES (app.current_school_id(), $1, $2, now()) RETURNING id::text`,
            [to, name ?? null],
          )
        ).rows[0]!.id;
      return { kind: 'ok' as const, candidate: await this.load(c, schoolId, id) };
    });
    if (outcome.kind === 'expired')
      throw new DomainError('otp.expired', 'No live code for this address; request a new one', {
        status: 401,
      });
    if (outcome.kind === 'locked')
      throw new DomainError('otp.locked', 'Too many wrong attempts; request a new code', {
        status: 429,
      });
    if (outcome.kind === 'invalid')
      throw new DomainError('otp.invalid', 'The code is not correct', { status: 401 });
    const expiresAt = new Date(Date.now() + 2 * 3600_000);
    const token = await new SignJWT({ sid: schoolId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(outcome.candidate.id)
      .setIssuer('edupro-candidate')
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(new TextEncoder().encode(this.env.APPLICANT_JWT_SECRET));
    return {
      token: `cand.${token}`,
      candidate: outcome.candidate,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async load(c: PoolClient, schoolId: string, id: string): Promise<Candidate> {
    const r = await c.query<{
      id: string;
      mobile: string | null;
      email: string | null;
      name: string | null;
    }>(`SELECT id::text, mobile, email::text, name FROM candidates WHERE id = $1`, [id]);
    const x = r.rows[0];
    if (!x) throw new Error('unknown candidate');
    return { id: x.id, schoolId, mobile: x.mobile, email: x.email, name: x.name };
  }

  async fromToken(token: string): Promise<Candidate> {
    try {
      const { payload } = await jwtVerify(
        token.slice('cand.'.length),
        new TextEncoder().encode(this.env.APPLICANT_JWT_SECRET),
        { issuer: 'edupro-candidate' },
      );
      const schoolId = String(payload.sid ?? '');
      const id = String(payload.sub ?? '');
      if (!schoolId || !id) throw new Error('claims');
      return await this.db.tenant(publicTenant(schoolId), (c) => this.load(c, schoolId, id));
    } catch {
      throw new DomainError(
        'candidate-unauthenticated',
        'Sign in again with your mobile or email',
        {
          status: 401,
        },
      );
    }
  }
}
