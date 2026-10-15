import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { QUEUES } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import type { RequestContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/jobs/outbox.service';
import { ENV, type Env } from '../../config/env';

export type OtpApp = 'admin' | 'teacher' | 'parent';
export type OtpPurpose = 'login' | 'second_factor';
const CODE_MINUTES = 10;
const SESSION_HOURS = 12;
const DEVICE_DAYS = 30;

export interface OtpStarted {
  /** The challenge to answer; a made-up one when the login names nobody (the answer is the same shape). */
  challengeId?: string;
  /** Where the code went, masked (a***@school.in); null when there is no email on record. */
  sentTo?: string | null;
  /** The code itself, only when the school shows codes on screen. */
  screenCode?: string;
  /** Remembered device, or no code asked: the session is ready. */
  session?: OtpSession;
  /** One Auth alone is enough for this user (no school asks a code). */
  notRequired?: boolean;
}
export interface OtpSession {
  accessToken: string;
  sub: string;
  displayName: string;
  expiresAt: number;
  /** Set when "remember this device" was ticked: kept in a cookie of that browser for 30 days. */
  deviceToken?: string;
}

const mask = (email: string | null): string | null => {
  if (!email) return null;
  const [name = '', domain = ''] = email.split('@');
  return `${name.slice(0, 1)}${'*'.repeat(Math.max(name.length - 1, 2))}@${domain}`;
};
const maskMobile = (m: string) => `${m.slice(0, 2)}******${m.slice(-2)}`;
const esc = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
/** The sign-in code as a formatted email on the school's letterhead (inline styles, for every mail client). */
function otpLetter(
  school: { name: string; address: string | null; phone: string | null; mail: string | null },
  name: string,
  code: string,
): string {
  const contact = [school.phone, school.mail]
    .filter(Boolean)
    .map((v) => esc(v!))
    .join(' · ');
  return `<!doctype html><html><body style="margin:0;padding:0;background:#eef2f8;font-family:Arial,Helvetica,sans-serif;color:#0b1f3a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f8;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #d7deea">
<tr><td style="background:#0b2a5b;color:#ffffff;padding:18px 24px">
<div style="font-size:20px;font-weight:bold">${esc(school.name)}</div>
${school.address ? `<div style="font-size:12px;opacity:.85;margin-top:4px">${esc(school.address)}</div>` : ''}
</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 12px;font-size:15px">Dear ${esc(name)},</p>
<p style="margin:0 0 16px;font-size:15px">Use this code to sign in to ${esc(school.name)}:</p>
<div style="text-align:center;margin:8px 0 18px"><span style="display:inline-block;font-size:32px;font-weight:bold;letter-spacing:8px;padding:12px 22px;border:2px dashed #0b2a5b;border-radius:8px;background:#f4f7fc">${code}</span></div>
<p style="margin:0 0 8px;font-size:14px">The code works <strong>once</strong>, for <strong>${CODE_MINUTES} minutes</strong>.</p>
<p style="margin:0 0 8px;font-size:14px;color:#8a1c1c">Do not share this code with anyone, not even school staff.</p>
<p style="margin:0;font-size:13px;color:#5b6676">If you did not try to sign in, ignore this email and tell the school office.</p>
</td></tr>
<tr><td style="background:#f4f7fc;padding:14px 24px;font-size:12px;color:#5b6676;border-top:1px solid #d7deea">
${contact ? `${contact}<br>` : ''}This is an automatic email; please do not reply.
</td></tr></table></td></tr></table></body></html>`;
}
const validEmail = (v: string | null): v is string => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/**
 * Sign-in with a one-time code sent by email (0136). The school chooses One Auth only, One Auth and a
 * code, or the code alone (Settings: auth.login_mode); the code may also be shown on screen while emails
 * are being corrected (auth.otp_on_screen). A checked code gives an EduPro session token ("otp.").
 */
@Injectable()
export class OtpService {
  private readonly log = new Logger(OtpService.name);

  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Each challenge row belongs to one user, so the code alone is hashed (keyed, never stored plain). */
  private hash(code: string): string {
    return createHmac('sha256', this.env.OTP_JWT_SECRET).update(`otp:${code}`).digest('hex');
  }
  private deviceHash(token: string): string {
    return createHmac('sha256', this.env.OTP_JWT_SECRET).update(`device:${token}`).digest('hex');
  }

  /** How the user signs in, over all of the user's schools (the strictest wins). */
  async policy(userId: string) {
    return this.db.global(async (c) => {
      const r = await c.query<{
        otp_required: boolean;
        otp_only: boolean;
        on_screen: boolean;
        school_id: string | null;
      }>(`SELECT otp_required, otp_only, on_screen, school_id::text FROM app.login_policy($1)`, [
        userId,
      ]);
      const p = r.rows[0];
      return {
        otpRequired: p?.otp_required ?? false,
        otpOnly: p?.otp_only ?? false,
        onScreen: p?.on_screen ?? false,
        schoolId: p?.school_id ?? null,
      };
    });
  }

  /** Is the code-only sign-in offered at all (some school uses it)? Shown on the sign-in page. */
  async offered(): Promise<boolean> {
    return this.db.global(async (c) => {
      const r = await c.query<{ v: boolean }>(`SELECT app.otp_login_offered() AS v`);
      return r.rows[0]?.v ?? false;
    });
  }

  private async session(sub: string, displayName: string, purpose: OtpPurpose, app: OtpApp) {
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
    const token = await new SignJWT({
      amr: purpose === 'second_factor' ? ['pwd', 'otp', 'mfa'] : ['otp'],
      app,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer('edupro-otp')
      .setAudience('edupro-otp')
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(new TextEncoder().encode(this.env.OTP_JWT_SECRET));
    return { accessToken: `otp.${token}`, sub, displayName, expiresAt };
  }

  private async deviceRemembered(userId: string, app: OtpApp, deviceToken?: string) {
    if (!deviceToken || !/^[A-Za-z0-9_-]{20,100}$/.test(deviceToken)) return false;
    return this.db.global(async (c) => {
      const r = await c.query<{ ok: boolean }>(`SELECT app.otp_device_ok($1, $2, $3) AS ok`, [
        userId,
        app,
        this.deviceHash(deviceToken),
      ]);
      return r.rows[0]?.ok ?? false;
    });
  }

  /** Makes a code, records it, and mails it through the school's email (the comms queue). */
  private async issue(
    user: { id: string; email: string | null; mobile: string | null; displayName: string },
    schoolId: string | null,
    purpose: OtpPurpose,
    app: OtpApp,
    onScreen: boolean,
    meta: { ip?: string; userAgent?: string; requestId: string },
  ): Promise<OtpStarted> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const email = validEmail(user.email) ? user.email : null;
    const mobile = user.mobile && /^\d{10}$/.test(user.mobile) ? user.mobile : null;
    if (!email && !mobile && !onScreen)
      throw new DomainError(
        'auth.otp_no_email',
        'There is no valid email or mobile on record for this account. Ask the school office to correct it.',
        { status: 422 },
      );
    const id = await this.db.global(async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT app.otp_issue($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)::text AS id`,
        [
          user.id,
          schoolId,
          purpose,
          app,
          this.hash(code),
          email ?? (mobile ? `mobile ${maskMobile(mobile)}` : null),
          onScreen,
          meta.ip ?? null,
          meta.userAgent ?? null,
          CODE_MINUTES,
        ],
      );
      return r.rows[0]!.id;
    });
    const sent: string[] = [];
    if (schoolId && (email || mobile)) {
      try {
        sent.push(...(await this.send(schoolId, user, code, email, mobile, meta.requestId)));
      } catch (error) {
        // the code stands; on screen it can still be used, and a resend tries again
        this.log.warn(`sign-in code not queued: ${(error as Error).message}`);
      }
    }
    return {
      challengeId: id,
      sentTo: sent.length ? sent.join(' · ') : null,
      ...(onScreen ? { screenCode: code } : {}),
    };
  }

  /**
   * Queues the code on every channel the user can be reached on (email, WhatsApp, SMS), through the school's
   * providers. Email is a formatted letter on the school's letterhead; WhatsApp and SMS use the school's
   * approved templates (System -> Sign-in, else the active OTP templates: a WhatsApp template with an
   * approved name, an SMS one with a DLT id). Returns where it went, masked.
   */
  private async send(
    schoolId: string,
    user: { id: string; displayName: string },
    code: string,
    email: string | null,
    mobile: string | null,
    requestId: string,
  ): Promise<string[]> {
    const tenant = { schoolId, userId: user.id, allowedSchoolIds: [schoolId], requestId };
    const ctx = { requestId, tenant } as unknown as RequestContext;
    return this.db.tenant(tenant, async (c) => {
      const school = (
        await c.query<{
          name: string;
          address: string | null;
          phone: string | null;
          mail: string | null;
        }>(
          `SELECT name, NULLIF(concat_ws(', ', NULLIF(address->>'line1', ''), NULLIF(address->>'city', ''), NULLIF(address->>'state', '')), '') AS address,
                  NULLIF(contact->>'phone', '') AS phone, NULLIF(contact->>'email', '') AS mail
             FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!;
      const vars: Record<string, string> = {
        otp: code,
        code,
        minutes: String(CODE_MINUTES),
        school: school.name,
        name: user.displayName,
      };
      const fill = (t: string) =>
        t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
      const queue = async (
        channel: 'email' | 'sms' | 'whatsapp',
        to: string,
        subject: string | null,
        body: string,
        extra: { templateId?: string; params?: string[]; format?: 'text' | 'html' } = {},
      ) => {
        const m = await c.query<{ id: string }>(
          `INSERT INTO comms_messages (school_id, template_id, channel, recipient_user_id, recipient_address, subject, body, format, variables, params, status, request_id, created_by)
           VALUES (app.current_school_id(), $1, $2::comms_channel, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 'queued', $10, $3) RETURNING id::text`,
          [
            extra.templateId ?? null,
            channel,
            user.id,
            to,
            subject,
            body,
            extra.format ?? 'text',
            JSON.stringify(vars),
            extra.params ? JSON.stringify(extra.params) : null,
            requestId,
          ],
        );
        await this.outbox.enqueue(c, ctx, QUEUES.notifications, 'comms.message', {
          messageId: m.rows[0]!.id,
        });
      };
      const sent: string[] = [];
      if (email) {
        await queue(
          'email',
          email,
          `${code} is your sign-in code · ${school.name}`,
          otpLetter(school, user.displayName, code),
          {
            format: 'html',
          },
        );
        sent.push(mask(email)!);
      }
      if (mobile) {
        const pick = async (channel: 'sms' | 'whatsapp') => {
          const chosen = (
            await c.query<{ v: string | null }>(
              `SELECT NULLIF(app.setting($1) #>> '{}', '') AS v`,
              [channel === 'sms' ? 'auth.otp_sms_template' : 'auth.otp_whatsapp_template'],
            )
          ).rows[0]?.v;
          const r = await c.query<{ id: string; body: string; wa_params: string[] | null }>(
            `SELECT t.id::text, t.body, t.wa_params FROM comms_templates t
              WHERE t.channel = $1::comms_channel AND t.status = 'active'
                AND (CASE WHEN $1 = 'sms' THEN COALESCE(btrim(t.dlt_template_id), '') <> '' ELSE COALESCE(btrim(t.wa_template_name), '') <> '' END)
                AND (($2::bigint IS NOT NULL AND t.id = $2::bigint)
                  OR ($2::bigint IS NULL AND t.body ~ '\{\{\s*(otp|code)\s*\}\}'))
              ORDER BY (t.code = 'login_otp') DESC, (t.name ILIKE '%otp%' OR t.code ILIKE '%otp%' OR t.wa_template_name ILIKE '%otp%') DESC, t.id DESC
              LIMIT 1`,
            [channel, chosen && /^\d+$/.test(chosen) ? chosen : null],
          );
          return r.rows[0] ?? null;
        };
        const wa = await pick('whatsapp');
        if (wa) {
          // the approved template's variables in Meta's order; an OTP template's one variable is the code
          const names = wa.wa_params && wa.wa_params.length ? wa.wa_params : ['otp'];
          await queue('whatsapp', mobile, null, fill(wa.body), {
            templateId: wa.id,
            params: names.map((n) => vars[n.replace(/[{}\s]/g, '')] ?? ''),
          });
          sent.push(`WhatsApp ${maskMobile(mobile)}`);
        }
        const sms = await pick('sms');
        if (sms) {
          // the DLT text must match the registered one: only the variable is filled in
          await queue('sms', mobile, null, fill(sms.body), { templateId: sms.id });
          sent.push(`SMS ${maskMobile(mobile)}`);
        }
      }
      return sent;
    });
  }

  /** Code-only sign-in, step 1: the email or mobile number of the account. */
  async startLogin(
    login: string,
    app: OtpApp,
    deviceToken: string | undefined,
    meta: { ip?: string; userAgent?: string; requestId: string },
  ): Promise<OtpStarted> {
    const found = await this.db.global(async (c) => {
      const r = await c.query<{
        user_id: string;
        sub: string;
        email: string | null;
        display_name: string;
        mobile: string | null;
      }>(`SELECT user_id::text, sub, email, display_name, mobile FROM app.otp_find_user($1)`, [
        login.trim(),
      ]);
      return r.rows[0];
    });
    // the same answer for an unknown login and for an account that may not sign in with a code alone; a
    // school that shows codes on screen has given up that secrecy for the rollout, so it is told plainly
    const blind = async (): Promise<OtpStarted> => {
      const plain = await this.db.global(async (c) => {
        const r = await c.query<{ v: boolean }>(`SELECT app.otp_screen_offered() AS v`);
        return r.rows[0]?.v ?? false;
      });
      if (plain)
        throw new DomainError(
          'auth.otp_not_found',
          'No account was found for this email, mobile number or admission number, or it cannot sign in with a code. Ask the school office.',
          { status: 404 },
        );
      return { challengeId: randomUUID(), sentTo: null };
    };
    if (!found) return blind();
    const p = await this.policy(found.user_id);
    if (!p.otpOnly) return blind();
    if (await this.deviceRemembered(found.user_id, app, deviceToken))
      return { session: await this.session(found.sub, found.display_name, 'login', app) };
    return this.issue(
      {
        id: found.user_id,
        email: found.email,
        mobile: found.mobile,
        displayName: found.display_name,
      },
      p.schoolId,
      'login',
      app,
      p.onScreen,
      meta,
    );
  }

  /** After One Auth: a code is asked when a school of the user asks it (a remembered device skips it). */
  async startSecondFactor(
    ctx: RequestContext,
    app: OtpApp,
    deviceToken: string | undefined,
  ): Promise<OtpStarted> {
    const p = await this.policy(ctx.user.id);
    if (!p.otpRequired) return { notRequired: true };
    const u = await this.user(ctx.user.id);
    if (await this.deviceRemembered(ctx.user.id, app, deviceToken))
      return { session: await this.session(u.sub, u.displayName, 'second_factor', app) };
    return this.issue(
      { id: ctx.user.id, email: u.email, mobile: u.mobile, displayName: u.displayName },
      p.schoolId,
      'second_factor',
      app,
      p.onScreen,
      {
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      },
    );
  }

  private async user(userId: string) {
    return this.db.global(async (c) => {
      const r = await c.query<{
        sub: string;
        email: string | null;
        display_name: string;
        mobile: string | null;
      }>(`SELECT sub, email, display_name, mobile FROM app.otp_user($1)`, [userId]);
      const u = r.rows[0];
      if (!u)
        throw new DomainError('unauthenticated', 'The account is not active', { status: 401 });
      return { sub: u.sub, email: u.email, mobile: u.mobile, displayName: u.display_name };
    });
  }

  /** Step 2: the code. A right code gives the session; "remember" keeps this browser for 30 days. */
  async verify(
    challengeId: string,
    code: string,
    purpose: OtpPurpose,
    remember: boolean,
    meta: { userAgent?: string; userId?: string },
  ): Promise<OtpSession> {
    const wrong = () =>
      new DomainError('auth.otp_wrong', 'The code is not right. Check it and try again.', {
        status: 401,
      });
    if (!/^[0-9a-f-]{36}$/.test(challengeId) || !/^\d{6}$/.test(code)) throw wrong();
    const r = await this.db.global(async (c) => {
      const x = await c.query<{ outcome: string; user_id: string | null; app: OtpApp | null }>(
        `SELECT outcome, user_id::text, app FROM app.otp_check($1::uuid, $2, $3)`,
        [challengeId, this.hash(code), purpose],
      );
      return x.rows[0]!;
    });
    if (r.outcome === 'expired')
      throw new DomainError('auth.otp_expired', 'The code has expired. Ask for a new one.', {
        status: 401,
      });
    if (r.outcome === 'locked')
      throw new DomainError('auth.otp_locked', 'Too many wrong tries. Ask for a new code.', {
        status: 401,
      });
    if (r.outcome === 'used')
      throw new DomainError('auth.otp_used', 'This code was already used. Ask for a new one.', {
        status: 401,
      });
    // a second factor answers only the challenge of the signed-in user
    if (r.outcome !== 'ok' || !r.user_id || (meta.userId && meta.userId !== r.user_id))
      throw wrong();
    const owner = r.user_id;
    const u = await this.user(owner);
    const app = r.app ?? 'admin';
    const s: OtpSession = await this.session(u.sub, u.displayName, purpose, app);
    if (remember) {
      const deviceToken = randomBytes(32).toString('base64url');
      await this.db.global((c) =>
        c.query(`SELECT app.otp_trust_device($1, $2, $3, $4, $5)`, [
          owner,
          app,
          this.deviceHash(deviceToken),
          DEVICE_DAYS,
          meta.userAgent ?? null,
        ]),
      );
      s.deviceToken = deviceToken;
    }
    return s;
  }
}
