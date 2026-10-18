import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser, RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { PublicAdmissionsService } from '../admissions/public/public-admissions.service';
import { publicTenant } from '../admissions/public/otp.service';
import { FilesService } from '../files/files.service';
import { PaymentsService } from '../payments/payments.service';
import { sourceOptions } from './consent-fields';
import type {
  PublicOtpDto,
  PublicRespondDto,
  PublicUploadDto,
  PublicVerifyDto,
} from './consent-forms.dto';
import { ConsentFormsService, type FormDb } from './consent-forms.service';

/** Who signed in on a form's public link: an outsider (mobile or email) or a pupil's family. */
export interface LinkUser {
  schoolId: string;
  formId: string;
  mode: 'outsider' | 'family';
  /** the outsider's mobile or email; the family's mobile the code went to */
  address: string;
  studentId: string | null;
  name: string | null;
}

const ISSUER = 'edupro-consent';
const isEmail = (s: string) => s.includes('@');
const mask = (s: string) =>
  isEmail(s)
    ? `${s.slice(0, 2)}***${s.slice(s.indexOf('@'))}`
    : `${s.slice(0, 2)}******${s.slice(-2)}`;

/**
 * The public link and QR of a consent form (docs/design/28-consent-forms.md, part 3): no login. An
 * outsider proves a mobile or an email with a one-time code; a family without the app gives the pupil's
 * admission number and the code goes to the mobile the school has on file. The code gives a two-hour
 * pass to answer, see, change (until the edit date) and print the answers, and for a family to pay the
 * fee online. Everything else (rules, fee, approval) is the same as in the apps.
 */
@Injectable()
export class ConsentPublicService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
    private readonly consents: ConsentFormsService,
    private readonly schools: PublicAdmissionsService,
    private readonly files: FilesService,
    private readonly payments: PaymentsService,
  ) {}

  private hash(code: string) {
    return createHash('sha256')
      .update(`${this.env.APPLICANT_JWT_SECRET}:consent:${code}`)
      .digest('hex');
  }

  /** A request context for work done on the public link (no user; the school of the link). */
  private ctxFor(schoolId: string, base: RequestContext): RequestContext {
    return {
      ...base,
      user: {
        id: null as unknown as string,
        sub: 'public-link',
        displayName: 'Public link',
        memberships: [],
      } as unknown as AuthenticatedUser,
      tenant: publicTenant(schoolId, base.requestId),
    };
  }

  private async form(schoolCode: string, token: string) {
    const schoolId = await this.schools.schoolId(schoolCode);
    const f = await this.db.tenant(publicTenant(schoolId), (c) =>
      this.consents.formByToken(c, token),
    );
    return { schoolId, f };
  }

  /** What the link shows before signing in: the form, the school, who may answer. */
  async info(schoolCode: string, token: string) {
    const { schoolId, f } = await this.form(schoolCode, token);
    return this.db.tenant(publicTenant(schoolId), async (c) => {
      const school = await c.query<{ name: string }>(`SELECT name FROM schools WHERE id = $1`, [
        schoolId,
      ]);
      const state = this.consents.stateOf(f);
      const link = f.settings.publicLink!;
      return {
        school: school.rows[0]?.name ?? '',
        title: f.title,
        description: f.description,
        fields: f.fields,
        lists: await sourceOptions(c, f.fields),
        open: state.open,
        closedWhy: state.why,
        closesAt: f.settings.closesAt ?? null,
        editUntil: f.settings.editUntil ?? null,
        repeat: f.settings.repeat,
        families: link.families && f.respondents !== 'staff',
        outsiders: link.outsiders,
        fee: f.settings.fee ?? { mode: 'none', items: [] },
        approval: Boolean(f.settings.approval?.on),
        // the gateways the school takes misc fees through, for the family's Pay
        gateways: (
          await c.query<{ id: string; label: string }>(
            `SELECT g.id::text, g.label FROM payment_gateway_routes r JOIN payment_gateways g ON g.id = r.gateway_id
              WHERE r.ledger = 'misc' AND g.active ORDER BY r.sort_order, g.id`,
          )
        ).rows,
      };
    });
  }

  /** Sends a code: to the outsider's mobile or email, or to the pupil's family mobile on file. */
  async otp(schoolCode: string, token: string, dto: PublicOtpDto, ip: string | undefined) {
    const { schoolId, f } = await this.form(schoolCode, token);
    const link = f.settings.publicLink!;
    if (dto.mode === 'outsider' && !link.outsiders)
      throw new DomainError('consent.not_asked', 'This form is for the families of the school', {
        status: 403,
      });
    if (dto.mode === 'family' && (!link.families || f.respondents === 'staff'))
      throw new DomainError('consent.not_asked', 'This form is not for families on this link', {
        status: 403,
      });
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const sent = await this.db.tenant(publicTenant(schoolId), async (c) => {
      let address = dto.mode === 'outsider' ? (dto.mobile ?? dto.email!) : dto.admissionNo!.trim();
      let studentId: string | null = null;
      let to: string[] = [address];
      if (dto.mode === 'family') {
        const s = await c.query<{ id: string }>(
          `SELECT id::text FROM students WHERE upper(admission_no) = upper($1) AND deleted_at IS NULL AND status = 'active'`,
          [address],
        );
        studentId = s.rows[0]?.id ?? null;
        if (!studentId || !(await this.consents.studentsAsked(c, f)).includes(studentId))
          throw new DomainError('consent.not_asked', 'This form is not for this admission number', {
            status: 404,
          });
        // the family's mobiles and emails on file (up to two of each): the code goes to all of them
        const g = await c.query<{ mobile: string | null; email: string | null }>(
          `SELECT g.mobile, g.email FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
            WHERE sg.student_id = $1 AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, g.id`,
          [studentId],
        );
        const mobiles = [
          ...new Set(
            g.rows.map((x) => x.mobile).filter((m): m is string => !!m && m.trim() !== ''),
          ),
        ];
        const emails = [
          ...new Set(
            g.rows
              .map((x) => x.email?.trim().toLowerCase())
              .filter((m): m is string => !!m && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)),
          ),
        ];
        to = [...mobiles.slice(0, 2), ...emails.slice(0, 2)];
        if (!to.length)
          throw new DomainError(
            'consent.no_mobile',
            'The school has no mobile number or email for this pupil: please contact the school office',
            { status: 409 },
          );
        address = address.toUpperCase();
      }
      const live = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM consent_otps WHERE form_id = $1 AND mode = $2 AND upper(address) = upper($3) AND consumed_at IS NULL AND expires_at > now()`,
        [f.id, dto.mode, address],
      );
      if ((live.rows[0]?.n ?? 0) >= 3)
        throw new DomainError('otp.too_many', 'Too many codes asked; wait a few minutes', {
          status: 429,
        });
      await c.query(
        `INSERT INTO consent_otps (school_id, form_id, mode, address, student_id, code_hash, expires_at, ip)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, now() + make_interval(mins => $6), $7)`,
        [f.id, dto.mode, address, studentId, this.hash(code), this.env.OTP_TTL_MINUTES, ip ?? null],
      );
      await c.query(`SELECT app.consent_seed_templates(app.current_school_id())`);
      const school = (
        await c.query<{ name: string }>(`SELECT name FROM schools WHERE id = $1`, [schoolId])
      ).rows[0]?.name;
      const vars = JSON.stringify({
        otp: code,
        form: f.title.slice(0, 60),
        school: school ?? '',
        minutes: String(this.env.OTP_TTL_MINUTES),
      });
      for (const addr of to)
        for (const ch of isEmail(addr) ? ['email'] : ['sms', 'whatsapp'])
          await c.query(`SELECT app.send_template('consent_otp', $1, $2, $3::jsonb)`, [
            ch,
            addr,
            vars,
          ]);
      // a code in the message log is wiped once it has expired
      await c.query(
        `UPDATE comms_messages m SET body = regexp_replace(m.body, '\\d{6}', '******'), variables = m.variables - 'otp'
           FROM comms_templates t
          WHERE t.id = m.template_id AND t.code = 'consent_otp' AND m.created_at < now() - interval '15 minutes' AND m.variables ? 'otp'`,
      );
      return to;
    });
    const out: { sent: true; to: string[]; expiresInMinutes: number; devCode?: string } = {
      sent: true,
      to: sent.map(mask),
      expiresInMinutes: this.env.OTP_TTL_MINUTES,
    };
    if (this.env.AUTH_DEV_BYPASS) out.devCode = code;
    return out;
  }

  /** Checks the code and gives a two-hour pass for this form. */
  async verify(schoolCode: string, token: string, dto: PublicVerifyDto) {
    const { schoolId, f } = await this.form(schoolCode, token);
    const address =
      dto.mode === 'outsider'
        ? (dto.mobile ?? dto.email ?? '')
        : (dto.admissionNo ?? '').toUpperCase();
    if (!address)
      throw new DomainError('validation-failed', 'Give the mobile, email or admission number', {
        status: 400,
      });
    if (dto.mode === 'outsider' && !dto.name)
      throw new DomainError('validation-failed', 'Give your name', { status: 400 });
    // the attempt counter must survive a refusal: decided in its own transaction, refused after it
    const outcome = await this.db.tenant(publicTenant(schoolId), async (c) => {
      const r = await c.query<{
        id: string;
        code_hash: string;
        attempts: number;
        student_id: string | null;
      }>(
        `SELECT id::text, code_hash, attempts, student_id::text FROM consent_otps
          WHERE form_id = $1 AND mode = $2 AND upper(address) = upper($3) AND consumed_at IS NULL AND expires_at > now()
          ORDER BY id DESC LIMIT 1`,
        [f.id, dto.mode, address],
      );
      const row = r.rows[0];
      if (!row) return { kind: 'expired' as const };
      if (row.attempts >= 5) return { kind: 'locked' as const };
      if (row.code_hash !== this.hash(dto.code)) {
        await c.query(`UPDATE consent_otps SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
        return { kind: 'invalid' as const };
      }
      await c.query(`UPDATE consent_otps SET consumed_at = now() WHERE id = $1`, [row.id]);
      return { kind: 'ok' as const, studentId: row.student_id };
    });
    if (outcome.kind === 'expired')
      throw new DomainError('otp.expired', 'No live code; ask for a new one', { status: 401 });
    if (outcome.kind === 'locked')
      throw new DomainError('otp.locked', 'Too many wrong attempts; ask for a new code', {
        status: 429,
      });
    if (outcome.kind === 'invalid')
      throw new DomainError('otp.invalid', 'The code is not correct', { status: 401 });
    const expiresAt = new Date(Date.now() + 2 * 3600_000);
    const jwt = await new SignJWT({
      sid: schoolId,
      fid: f.id,
      mode: dto.mode,
      addr: address,
      stu: outcome.studentId,
      nm: dto.mode === 'outsider' ? dto.name : null,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(new TextEncoder().encode(this.env.APPLICANT_JWT_SECRET));
    return { token: `cf.${jwt}`, expiresAt: expiresAt.toISOString() };
  }

  /** The pass for this form, or a refusal (sign in again). */
  private async userOf(header: string | undefined, f: FormDb, schoolId: string): Promise<LinkUser> {
    try {
      const raw = (header ?? '').replace(/^Bearer\s+/i, '');
      if (!raw.startsWith('cf.')) throw new Error('no pass');
      const { payload } = await jwtVerify(
        raw.slice(3),
        new TextEncoder().encode(this.env.APPLICANT_JWT_SECRET),
        { issuer: ISSUER },
      );
      if (String(payload.sid) !== schoolId || String(payload.fid) !== f.id)
        throw new Error('other form');
      return {
        schoolId,
        formId: f.id,
        mode: payload.mode === 'family' ? 'family' : 'outsider',
        address: String(payload.addr ?? ''),
        studentId: payload.stu ? String(payload.stu) : null,
        name: payload.nm ? String(payload.nm) : null,
      };
    } catch {
      throw new DomainError('consent.signed_out', 'Ask for a new code to go on', { status: 401 });
    }
  }

  private async withUser<T>(
    schoolCode: string,
    token: string,
    header: string | undefined,
    fn: (c: PoolClient, f: FormDb, u: LinkUser) => Promise<T>,
  ): Promise<T> {
    const { schoolId, f } = await this.form(schoolCode, token);
    const u = await this.userOf(header, f, schoolId);
    return this.db.tenant(publicTenant(schoolId), (c) => fn(c, f, u));
  }

  /** The answers of this pupil (family) or this outsider, with status, fee, what may be done. */
  async me(schoolCode: string, token: string, header: string | undefined) {
    return this.withUser(schoolCode, token, header, async (c, f, u) => {
      const editable =
        f.status === 'published' &&
        Boolean(f.settings.editUntil) &&
        new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16) <=
          (f.settings.editUntil ?? '');
      const r = await c.query<Record<string, unknown>>(
        `SELECT x.id::text, x.number, x.status, x.signed_at AS "signedAt", x.fee_amount::text AS fee, x.misc_line_id::text AS "lineId",
                l.amount::text AS "lineAmount", l.paid::text AS paid, x.decided_note AS "decidedNote",
                EXISTS (SELECT 1 FROM workflow_instances wi WHERE wi.id = x.instance_id AND wi.status = 'pending') AS waiting,
                (x.status = 'submitted' AND $4::boolean) AS "canEdit"
           FROM consent_form_responses x LEFT JOIN misc_fee_students l ON l.id = x.misc_line_id
          WHERE x.form_id = $1 AND x.status <> 'withdrawn'
            AND (($2::bigint IS NOT NULL AND x.student_id = $2::bigint)
                 OR ($2::bigint IS NULL AND x.respondent = 'public' AND (x.public_mobile = $3 OR x.public_email = $3)))
          ORDER BY x.signed_at DESC`,
        [f.id, u.studentId, u.address, editable],
      );
      const pupil = u.studentId
        ? (
            await c.query<{ name: string; section: string | null }>(
              `SELECT s.display_name AS name, (SELECT k.name || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                        JOIN classes k ON k.id = cs.class_id WHERE e.student_id = s.id AND e.status = 'active' ORDER BY e.academic_year_id DESC LIMIT 1) AS section
                 FROM students s WHERE s.id = $1`,
              [u.studentId],
            )
          ).rows[0]
        : null;
      const state = this.consents.stateOf(f);
      return {
        mode: u.mode,
        about: pupil
          ? { name: pupil.name, section: pupil.section }
          : { name: u.name ?? '', section: null },
        address: mask(u.address),
        responses: r.rows,
        canAnswer: state.open && (f.settings.repeat === 'many' || r.rows.length === 0),
      };
    });
  }

  private async owned(c: PoolClient, f: FormDb, u: LinkUser, rid: string) {
    const r = await c.query<{ id: string }>(
      `SELECT id::text FROM consent_form_responses WHERE id = $1 AND form_id = $2
          AND (($3::bigint IS NOT NULL AND student_id = $3::bigint)
               OR ($3::bigint IS NULL AND respondent = 'public' AND (public_mobile = $4 OR public_email = $4)))`,
      [rid, f.id, u.studentId, u.address],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Answer not found', { status: 404 });
  }

  /** An answer to change: what was answered, the signatures on it. */
  async answer(schoolCode: string, token: string, header: string | undefined, rid: string) {
    return this.withUser(schoolCode, token, header, async (c, f, u) => {
      await this.owned(c, f, u, rid);
      const r = await c.query<Record<string, unknown>>(
        `SELECT x.id::text, x.number, x.answers, x.signed_name AS "signedName", x.status,
                (SELECT array_agg(field_key) FROM consent_form_signatures sg WHERE sg.response_id = x.id) AS signed
           FROM consent_form_responses x WHERE x.id = $1`,
        [rid],
      );
      return r.rows[0];
    });
  }

  /** A slot to upload a file for this form (PDF or image, 5 MB). */
  async upload(
    schoolCode: string,
    token: string,
    header: string | undefined,
    dto: PublicUploadDto,
    base: RequestContext,
  ) {
    const { schoolId, f } = await this.form(schoolCode, token);
    await this.userOf(header, f, schoolId);
    return this.files.createUpload(this.ctxFor(schoolId, base), {
      fileName: dto.fileName,
      contentType: dto.contentType,
      sizeBytes: dto.sizeBytes,
      classification: 'personal',
      ownerEntityType: 'consent_form',
      ownerEntityId: f.id,
    });
  }

  /** Answers: a family for its pupil, an outsider for themself. */
  async respond(
    schoolCode: string,
    token: string,
    header: string | undefined,
    dto: PublicRespondDto,
    base: RequestContext,
  ) {
    const { schoolId, f } = await this.form(schoolCode, token);
    const u = await this.userOf(header, f, schoolId);
    const ctx = this.ctxFor(schoolId, base);
    return this.db.tenant(publicTenant(schoolId, base.requestId), (c) =>
      this.consents.write(
        c,
        ctx,
        f.id,
        u.mode === 'family'
          ? {
              studentId: u.studentId!,
              respondent: 'family',
              link: { name: dto.signedName },
            }
          : {
              respondent: 'public',
              link: {
                name: u.name ?? dto.signedName,
                mobile: isEmail(u.address) ? undefined : u.address,
                email: isEmail(u.address) ? u.address : undefined,
              },
            },
        { answers: dto.answers, signedName: dto.signedName ?? u.name ?? undefined },
      ),
    );
  }

  /** Changes an answer of this pupil / outsider (until the edit date, before it is decided). */
  async edit(
    schoolCode: string,
    token: string,
    header: string | undefined,
    rid: string,
    dto: PublicRespondDto,
    base: RequestContext,
  ) {
    const { schoolId, f } = await this.form(schoolCode, token);
    const u = await this.userOf(header, f, schoolId);
    return this.consents.editAs(
      this.ctxFor(schoolId, base),
      rid,
      dto,
      (row) =>
        row.form_id === f.id &&
        (u.studentId
          ? row.student_id === u.studentId
          : row.respondent === 'public' &&
            (row.public_mobile === u.address || row.public_email === u.address)),
    );
  }

  async pdf(schoolCode: string, token: string, header: string | undefined, rid: string) {
    return this.withUser(schoolCode, token, header, async (c, f, u) => {
      await this.owned(c, f, u, rid);
      return this.consents.pdfOf(c, rid);
    });
  }

  /** A family pays the fee of its pupil's line online (the gateway of the misc ledger). */
  async pay(
    schoolCode: string,
    token: string,
    header: string | undefined,
    rid: string,
    base: RequestContext,
    gatewayId?: string,
  ) {
    return this.withUser(schoolCode, token, header, async (c, f, u) => {
      await this.owned(c, f, u, rid);
      const l = await c.query<{ id: string; balance: string; status: string; name: string }>(
        `SELECT l.id::text, (l.amount - l.paid)::text AS balance, l.status, s.display_name AS name
           FROM consent_form_responses x JOIN misc_fee_students l ON l.id = x.misc_line_id JOIN students s ON s.id = l.student_id
          WHERE x.id = $1`,
        [rid],
      );
      const line = l.rows[0];
      if (!line || line.status === 'cancelled' || !(Number(line.balance) > 0))
        throw new DomainError('consent.nothing_due', 'Nothing is due on this answer', {
          status: 409,
        });
      const intent = await this.payments.createIntent(c, {
        purpose: 'misc',
        entityType: 'misc_fee_student',
        entityId: line.id,
        ledger: 'misc',
        amount: Number(line.balance),
        payer: {
          name: line.name,
          email: `consent.${f.id}@example.invalid`,
          mobile: isEmail(u.address) ? '' : u.address,
        },
        returnUrl: `${this.env.PUBLIC_APP_URL}/${schoolCode.toLowerCase()}/consent/${f.public_token}`,
        createdByUser: null,
        requestId: base.requestId,
        gatewayId: gatewayId ?? null,
      });
      return {
        intent: {
          id: intent.id,
          txnId: intent.txnId,
          amount: intent.amount,
          provider: intent.provider,
        },
        checkout: await this.payments.checkout(intent),
      };
    });
  }
}
