import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import type { PasscodeDto } from './setup.dto';

/** Letters and digits that cannot be misread (no 0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** An 8-character passcode, shown as ABCD-EFGH. */
export const newPasscode = () =>
  Array.from({ length: 8 }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join('');

/** What a family types: case, spaces and dashes do not matter. */
export const plainPasscode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const shownPasscode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export const hashPasscode = (secret: string, code: string) =>
  createHash('sha256')
    .update(`${secret}:admpass:${plainPasscode(code)}`)
    .digest('hex');

const day = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);

/**
 * Whether a class of a session takes registrations for a family (docs/design/41, part 4): the session and
 * the class are open and within their dates, or the family holds a late-entry passcode for it.
 */
export async function classOpenFor(
  c: PoolClient,
  cycleId: string,
  classId: string,
  applicantId: string | null,
): Promise<{ open: boolean; closedOn: string | null; passUntil: string | null }> {
  const r = await c.query<{ open: boolean; closes: Date | null; pass: Date | null }>(
    `SELECT (y.status = 'open' AND k.status = 'open' AND COALESCE(k.opens_at, y.opens_at) <= now()
             AND COALESCE(k.closes_at, y.closes_at) > now()) AS open,
            COALESCE(k.closes_at, y.closes_at) AS closes,
            (SELECT max(p.valid_until) FROM admission_passcodes p
              WHERE p.cycle_id = k.cycle_id AND p.class_id = k.class_id AND p.used_by = $3::bigint
                AND p.status = 'active' AND p.valid_until > now()) AS pass
       FROM admission_class_criteria k JOIN admission_cycles y ON y.id = k.cycle_id
      WHERE k.cycle_id = $1 AND k.class_id = $2 AND y.deleted_at IS NULL`,
    [cycleId, classId, applicantId],
  );
  const x = r.rows[0];
  if (!x) return { open: false, closedOn: null, passUntil: null };
  return {
    open: x.open || Boolean(x.pass),
    closedOn: x.open ? null : x.closes ? day(x.closes) : null,
    passUntil: x.pass ? x.pass.toISOString() : null,
  };
}

interface PasscodeRow {
  id: string;
  class_id: string;
  class_name: string;
  email: string;
  mobile: string | null;
  child_name: string | null;
  valid_until: Date;
  status: string;
  sent_at: Date | null;
  used_at: Date | null;
  used_by_name: string | null;
  note: string | null;
  created_by: string | null;
  created_at: Date;
}

/**
 * Late-entry passcodes of an admission session (docs/design/41, part 4): the school admin opens a closed
 * class for one family until a date; the passcode is mailed (formatted) and stored hashed. A resend makes
 * a new passcode (the old one stops working); a revoke ends it at once.
 */
@Injectable()
export class AdmissionLateEntryService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private hash(code: string) {
    return hashPasscode(this.env.APPLICANT_JWT_SECRET, code);
  }

  private async rowsWith(c: PoolClient, cycleId: string) {
    const r = await c.query<PasscodeRow>(
      `SELECT p.id::text, p.class_id::text, cl.name AS class_name, p.email, p.mobile, p.child_name, p.valid_until,
              p.status, p.sent_at, p.used_at, ap.name AS used_by_name, p.note, u.display_name AS created_by, p.created_at
         FROM admission_passcodes p JOIN classes cl ON cl.id = p.class_id
         LEFT JOIN applicants ap ON ap.id = p.used_by LEFT JOIN users u ON u.id = p.created_by
        WHERE p.cycle_id = $1 ORDER BY p.created_at DESC, p.id DESC`,
      [cycleId],
    );
    const now = Date.now();
    return r.rows.map((x) => ({
      id: x.id,
      classId: x.class_id,
      className: x.class_name,
      email: x.email,
      mobile: x.mobile,
      childName: x.child_name,
      validUntil: x.valid_until.toISOString(),
      state:
        x.status === 'revoked'
          ? ('revoked' as const)
          : x.valid_until.getTime() <= now
            ? ('expired' as const)
            : x.used_at
              ? ('used' as const)
              : ('sent' as const),
      sentAt: x.sent_at?.toISOString() ?? null,
      usedAt: x.used_at?.toISOString() ?? null,
      usedBy: x.used_by_name,
      note: x.note,
      createdBy: x.created_by,
      createdAt: x.created_at.toISOString(),
    }));
  }

  async list(ctx: RequestContext, cycleId: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.rowsWith(c, cycleId));
  }

  /** A new passcode in the database and its email; returns the message id. */
  private async issue(
    c: PoolClient,
    p: { id: string; email: string; childName: string | null; validUntil: Date },
    cls: { className: string; session: string },
  ) {
    const code = newPasscode();
    await c.query(`UPDATE admission_passcodes SET code_hash = $2 WHERE id = $1`, [
      p.id,
      this.hash(code),
    ]);
    const m = await c.query<{ id: string | null }>(
      `SELECT app.admission_passcode_send($1, $2, $3, $4, $5, $6)::text AS id`,
      [p.email, shownPasscode(code), cls.className, cls.session, day(p.validUntil), p.childName],
    );
    if (!m.rows[0]?.id)
      throw new DomainError(
        'admissions.passcode_not_sent',
        'The passcode email could not be made: check the email address',
        { status: 409 },
      );
    await c.query(`UPDATE admission_passcodes SET sent_at = now(), message_id = $2 WHERE id = $1`, [
      p.id,
      m.rows[0].id,
    ]);
  }

  private async classOf(c: PoolClient, cycleId: string, classId: string) {
    const r = await c.query<{ class_name: string; session: string }>(
      `SELECT cl.name AS class_name, y.name AS session FROM admission_class_criteria k
         JOIN classes cl ON cl.id = k.class_id JOIN admission_cycles y ON y.id = k.cycle_id
        WHERE k.cycle_id = $1 AND k.class_id = $2 AND y.deleted_at IS NULL`,
      [cycleId, classId],
    );
    if (!r.rows[0])
      throw new DomainError('validation-failed', 'This class is not in the session', {
        status: 400,
      });
    return { className: r.rows[0].class_name, session: r.rows[0].session };
  }

  async create(ctx: RequestContext, cycleId: string, dto: PasscodeDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cls = await this.classOf(c, cycleId, dto.classId);
      // end of the chosen day, India time
      const until = new Date(`${dto.validUntil}T23:59:59+05:30`);
      if (until.getTime() <= Date.now())
        throw new DomainError('validation-failed', 'The last date has passed', { status: 400 });
      const r = await c.query<{ id: string }>(
        `INSERT INTO admission_passcodes (school_id, cycle_id, class_id, email, mobile, child_name, code_hash, valid_until, note, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, md5(random()::text), $6, $7, app.current_user_id()) RETURNING id::text`,
        [
          cycleId,
          dto.classId,
          dto.email.toLowerCase(),
          dto.mobile ?? null,
          dto.childName ?? null,
          until,
          dto.note ?? null,
        ],
      );
      const id = r.rows[0]!.id;
      await this.issue(
        c,
        {
          id,
          email: dto.email.toLowerCase(),
          childName: dto.childName ?? null,
          validUntil: until,
        },
        cls,
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.passcode.give',
        entityType: 'admission_passcodes',
        entityId: id,
        after: {
          classId: dto.classId,
          email: dto.email,
          validUntil: dto.validUntil,
          note: dto.note ?? null,
        },
      });
      return this.rowsWith(c, cycleId);
    });
  }

  private async one(c: PoolClient, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Passcode not found', { status: 404 });
    const r = await c.query<{
      id: string;
      cycle_id: string;
      class_id: string;
      email: string;
      child_name: string | null;
      valid_until: Date;
      status: string;
    }>(
      `SELECT id::text, cycle_id::text, class_id::text, email, child_name, valid_until, status FROM admission_passcodes WHERE id = $1`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Passcode not found', { status: 404 });
    return r.rows[0];
  }

  /** A new passcode by email (the earlier one stops working). */
  async resend(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = await this.one(c, id);
      if (p.status !== 'active' || p.valid_until.getTime() <= Date.now())
        throw new DomainError(
          'admissions.passcode_ended',
          'This passcode is revoked or past its date: give a new one',
          { status: 409 },
        );
      await this.issue(
        c,
        { id, email: p.email, childName: p.child_name, validUntil: p.valid_until },
        await this.classOf(c, p.cycle_id, p.class_id),
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.passcode.resend',
        entityType: 'admission_passcodes',
        entityId: id,
      });
      return this.rowsWith(c, p.cycle_id);
    });
  }

  async revoke(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = await this.one(c, id);
      await c.query(
        `UPDATE admission_passcodes SET status = 'revoked', revoked_by = app.current_user_id(), revoked_at = now()
          WHERE id = $1 AND status = 'active'`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.passcode.revoke',
        entityType: 'admission_passcodes',
        entityId: id,
      });
      return this.rowsWith(c, p.cycle_id);
    });
  }
}
