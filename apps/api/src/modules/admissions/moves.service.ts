import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { decryptField, type AdmissionAnswers, type PoolClient } from '@edupro/db';
import { objectKeyFor, type StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { AdmissionCoreService, type AppRow } from './admission-core.service';
import { tablePdf } from './admission-pdf';
import { messageTag } from './message-tag';

interface FileRef {
  objectKey: string;
  contentType: string;
  name: string | null;
  size: number;
}
interface Receipt {
  id: string;
  receiptNo: string;
  head: 'registration' | 'admission';
  amount: number;
  on: string;
}
/** What the first school sends: kept as it was when the move was asked (docs/design/64). */
export interface MoveSnapshot {
  candidate: string | null;
  number: string | null;
  admissionNo: string | null;
  status: string;
  className: string;
  session: string;
  fromSchool: string;
  toSchool: string;
  child: { first: string; last: string | null; dob: string | null; gender: string };
  contact: { mobile: string | null; email: string | null };
  applicant: { mobile: string | null; email: string | null; name: string | null };
  /** the first form's fields, to find each answer's place in the other form (same key, or what it maps to) */
  fields: Array<{ key: string; maps: string | null; type: string; label: string }>;
  /** the answers as kept there (ID numbers encrypted) */
  data: Record<string, unknown>;
  /** the files the answers name, by their id there */
  files: Record<string, FileRef>;
  receipts: Receipt[];
  paid: { registration: number; admission: number; total: number };
  points: number | null;
  /** filled once accepted: the new registration */
  to?: { number: string | null; className: string; session: string };
}

interface Row {
  id: string;
  from_school_id: string;
  to_school_id: string;
  from_application_id: string;
  status: 'requested' | 'accepted' | 'refused' | 'withdrawn';
  reason: string;
  snapshot: MoveSnapshot;
  requested_by_name: string | null;
  requested_at: Date;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  to_application_id: string | null;
  carried: string | null;
  to_registration: string | null;
  difference_due: string | null;
  credit: string | null;
  missing: string[];
}

const COLS = `m.id::text, m.from_school_id::text, m.to_school_id::text, m.from_application_id::text, m.status, m.reason,
  m.snapshot, m.requested_by_name, m.requested_at, m.decided_by_name, m.decided_at, m.decision_note,
  m.to_application_id::text, m.carried::text, m.to_registration::text, m.difference_due::text, m.credit::text, m.missing`;

/** Registered up to the admission fee paid: a registration that may move. */
const NOT_MOVABLE = ['draft', 'submitted', 'admitted', 'cancelled', 'withdrawn'];
const ENC = 'enc:';
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) =>
  `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ist = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
const STATUS: Record<Row['status'], string> = {
  requested: 'Waiting',
  accepted: 'Moved',
  refused: 'Refused',
  withdrawn: 'Withdrawn',
};

/**
 * Moving a registration to the other school of the group (docs/design/64). The first school sends it
 * with a reason (a copy of the form, its files, the family's login and the money paid); the other
 * accepts it into a session and class, which makes a fresh registration there (its own number, points
 * and approval process, the answers its form lacks asked of the family) and cancels the old one "Moved
 * to …". The money goes with it, no cash: transfer-out lines close the first school's receipts, the other
 * school takes it in receipts of mode "transfer" for the registration fee and keeps the rest as credit
 * for the admission fee (or the family pays a higher fee's difference).
 */
@Injectable()
export class AdmissionMovesService {
  constructor(
    private readonly db: DbService,
    private readonly core: AdmissionCoreService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private view(r: Row, schoolId: string) {
    const s = r.snapshot;
    const out = r.from_school_id === schoolId;
    return {
      id: r.id,
      direction: out ? ('outgoing' as const) : ('incoming' as const),
      status: r.status,
      statusLabel: STATUS[r.status],
      candidate: s.candidate,
      number: s.number,
      admissionNo: s.admissionNo,
      fromStatus: s.status,
      className: s.className,
      session: s.session,
      fromSchool: s.fromSchool,
      toSchool: s.toSchool,
      reason: r.reason,
      requestedBy: r.requested_by_name,
      requestedAt: r.requested_at.toISOString(),
      decidedBy: r.decided_by_name,
      decidedAt: r.decided_at?.toISOString() ?? null,
      decisionNote: r.decision_note,
      // each school opens only its own registration
      applicationId: out ? r.from_application_id : r.to_application_id,
      to: s.to ?? null,
      money: {
        paid: s.paid.total,
        registration: s.paid.registration,
        admission: s.paid.admission,
        receipts: s.receipts.map((x) => ({
          receiptNo: x.receiptNo,
          head: x.head,
          amount: x.amount,
          on: x.on,
        })),
        carried: r.carried === null ? null : Number(r.carried),
        toRegistration: r.to_registration === null ? null : Number(r.to_registration),
        differenceDue: r.difference_due === null ? null : Number(r.difference_due),
        credit: r.credit === null ? null : Number(r.credit),
      },
      carries: {
        answers: Object.keys(s.data).length,
        files: Object.keys(s.files).length,
        login: Boolean(s.applicant.mobile || s.applicant.email),
      },
      missing: r.missing,
      // the receiving office sees whom it accepts
      details: out
        ? null
        : {
            dob: s.child.dob,
            gender: s.child.gender,
            mobile: s.contact.mobile ?? s.applicant.mobile,
            email: s.contact.email ?? s.applicant.email,
            points: s.points,
          },
    };
  }

  private async find(c: PoolClient, id: string, lock = false): Promise<Row> {
    if (!/^\d{1,18}$/.test(id)) throw new DomainError('not-found', 'Move not found');
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- COLS is a constant; values are bound parameters
      `SELECT ${COLS} FROM admission_moves m WHERE m.id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Move not found');
    return r.rows[0];
  }

  private async rows(c: PoolClient, q: { box?: string; status?: string }) {
    return (
      await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- COLS is a constant; values are bound parameters
        `SELECT ${COLS} FROM admission_moves m
          WHERE ($1 = 'all' OR ($1 = 'incoming' AND m.to_school_id = app.current_school_id())
                 OR ($1 = 'outgoing' AND m.from_school_id = app.current_school_id()))
            AND ($2::text IS NULL OR m.status = $2)
          ORDER BY (m.status = 'requested') DESC, COALESCE(m.decided_at, m.requested_at) DESC LIMIT 500`,
        [q.box ?? 'all', q.status ?? null],
      )
    ).rows;
  }

  async targets(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      data: (
        await c.query<{ id: string; code: string; name: string }>(
          `SELECT id::text, code, name FROM app.transfer_targets()`,
        )
      ).rows,
    }));
  }

  async list(ctx: RequestContext, q: { box?: string; status?: string }) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const rows = await this.rows(c, q);
      const counts = await c.query<{ incoming: number; outgoing: number }>(
        `SELECT count(*) FILTER (WHERE to_school_id = app.current_school_id())::int AS incoming,
                count(*) FILTER (WHERE from_school_id = app.current_school_id())::int AS outgoing
           FROM admission_moves WHERE status = 'requested'`,
      );
      return {
        data: rows.map((x) => this.view(x, tenant.schoolId)),
        waiting: counts.rows[0] ?? { incoming: 0, outgoing: 0 },
      };
    });
  }

  async get(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => this.view(await this.find(c, id), tenant.schoolId));
  }

  /** The receiving school's sessions with their classes (a form set), the same class suggested. */
  async options(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const m = await this.find(c, id);
      if (m.to_school_id !== tenant.schoolId) throw new DomainError('not-found', 'Move not found');
      const r = await c.query<{
        cycle_id: string;
        cycle: string;
        class_id: string;
        class_name: string;
        code: string;
        open: boolean;
      }>(
        `SELECT y.id::text AS cycle_id, y.name AS cycle, cl.id::text AS class_id, cl.name AS class_name, cl.code,
                (now() BETWEEN y.opens_at AND y.closes_at) AS open
           FROM admission_class_criteria k JOIN admission_cycles y ON y.id = k.cycle_id AND y.deleted_at IS NULL
           JOIN classes cl ON cl.id = k.class_id
          WHERE k.form_id IS NOT NULL
          ORDER BY y.opens_at DESC, cl.display_order, cl.name`,
      );
      const cycles = new Map<
        string,
        { id: string; name: string; open: boolean; classes: Array<{ id: string; name: string }> }
      >();
      for (const x of r.rows) {
        const y = cycles.get(x.cycle_id) ?? {
          id: x.cycle_id,
          name: x.cycle,
          open: x.open,
          classes: [],
        };
        y.classes.push({ id: x.class_id, name: x.class_name });
        cycles.set(x.cycle_id, y);
      }
      const want = m.snapshot.className.toLowerCase();
      const hit =
        r.rows.find((x) => x.open && x.class_name.toLowerCase() === want) ??
        r.rows.find((x) => x.class_name.toLowerCase() === want);
      return {
        cycles: [...cycles.values()],
        suggested: hit ? { cycleId: hit.cycle_id, classId: hit.class_id } : null,
      };
    });
  }

  /** The first school sends a registration (registered up to the admission fee paid) with a reason. */
  async request(ctx: RequestContext, appId: string, dto: { toSchoolId: string; reason: string }) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const a = await this.core.row(c, appId);
      if (a.status === 'admitted')
        throw new DomainError(
          'admissions.move.admitted',
          'The candidate is admitted: move the student with People → Transfers between schools',
          { status: 409 },
        );
      if (NOT_MOVABLE.includes(a.status) || !a.application_no)
        throw new DomainError(
          'admissions.move.not_movable',
          'Only a registration (registered up to the admission fee paid) can move to another school',
          { status: 409 },
        );
      const target = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM app.transfer_targets() WHERE id = $1`,
        [dto.toSchoolId],
      );
      if (!target.rows[0])
        throw new DomainError(
          'admissions.move.unknown_school',
          'That school is not in this group',
          {
            status: 400,
          },
        );
      const snapshot = await this.snapshot(c, a, target.rows[0].name);
      const me = await c.query<{ name: string | null }>(
        `SELECT display_name AS name FROM users WHERE id = app.current_user_id()`,
      );
      let id: string;
      try {
        id = (
          await c.query<{ id: string }>(
            `INSERT INTO admission_moves (from_school_id, to_school_id, from_application_id, reason, snapshot, requested_by, requested_by_name)
             VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, app.current_user_id(), $5) RETURNING id::text`,
            [dto.toSchoolId, appId, dto.reason, JSON.stringify(snapshot), me.rows[0]?.name ?? null],
          )
        ).rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'admissions.move.open',
            'This registration already waits to move to another school',
            { status: 409 },
          );
        throw error;
      }
      await this.core.event(
        c,
        appId,
        a.status,
        a.status,
        `Move to ${target.rows[0].name} asked: ${dto.reason}`,
        { actorUser: ctx.user.id },
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.move.request',
        entityType: 'admission_moves',
        entityId: id,
        after: { applicationId: appId, toSchoolId: dto.toSchoolId, paid: snapshot.paid.total },
      });
      return this.view(await this.find(c, id), tenant.schoolId);
    });
  }

  private async snapshot(c: PoolClient, a: AppRow, toSchool: string): Promise<MoveSnapshot> {
    const def = await this.core.defOf(c, a);
    const ids: string[] = [];
    for (const f of def.fields) {
      const v = a.data[f.key];
      if ((f.type === 'file' || f.type === 'photo') && Array.isArray(v))
        ids.push(...v.filter((x): x is string => typeof x === 'string' && /^\d{1,18}$/.test(x)));
    }
    const files: MoveSnapshot['files'] = {};
    if (ids.length) {
      const fr = await c.query<{
        id: string;
        object_key: string;
        content_type: string;
        original_name: string | null;
        size_bytes: string;
      }>(
        `SELECT id::text, object_key, content_type, original_name, size_bytes::text FROM files
          WHERE id = ANY($1::bigint[]) AND status = 'ready' AND deleted_at IS NULL`,
        [ids],
      );
      for (const x of fr.rows)
        files[x.id] = {
          objectKey: x.object_key,
          contentType: x.content_type,
          name: x.original_name,
          size: Number(x.size_bytes),
        };
    }
    // what the family paid here, less what was refunded already
    const rec = await c.query<{
      id: string;
      receipt_no: string;
      code: string;
      amount: string;
      on: string;
    }>(
      `SELECT m.id::text, m.receipt_no, h.code, (m.amount - COALESCE((SELECT sum(f.amount) FROM admission_refunds f
                WHERE f.receipt_id = m.id AND f.status = 'paid'), 0))::text AS amount, m.received_on::text AS on
         FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id
        WHERE m.application_id = $1 AND m.status = 'posted' ORDER BY m.id`,
      [a.id],
    );
    const receipts: Receipt[] = rec.rows
      .filter((x) => Number(x.amount) > 0)
      .map((x) => ({
        id: x.id,
        receiptNo: x.receipt_no,
        head: x.code === 'ADMFEE' ? 'admission' : 'registration',
        amount: Number(x.amount),
        on: x.on,
      }));
    const sum = (h: Receipt['head']) =>
      r2(receipts.filter((x) => x.head === h).reduce((t, x) => t + x.amount, 0));
    const extra = await c.query<{
      school: string;
      name: string | null;
      points: string | null;
    }>(
      `SELECT (SELECT name FROM schools WHERE id = app.current_school_id()) AS school,
              (SELECT name FROM applicants WHERE id = $1) AS name,
              (SELECT form_points::text FROM applications WHERE id = $2) AS points`,
      [a.applicant_id, a.id],
    );
    const e = extra.rows[0]!;
    return {
      candidate: a.candidate_name,
      number: a.application_no,
      admissionNo: a.admission_no,
      status: a.status,
      className: a.class_name,
      session: a.cycle_name,
      fromSchool: e.school,
      toSchool,
      child: {
        first: a.child_first_name,
        last: a.child_last_name,
        dob: a.child_dob,
        gender: a.child_gender,
      },
      contact: { mobile: a.contact_mobile, email: a.contact_email },
      applicant: { mobile: a.applicant_mobile, email: a.applicant_email, name: e.name },
      fields: def.fields.map((f) => ({
        key: f.key,
        maps: f.maps ?? null,
        type: f.type,
        label: f.label,
      })),
      data: a.data,
      files,
      receipts,
      paid: {
        registration: sum('registration'),
        admission: sum('admission'),
        total: r2(sum('registration') + sum('admission')),
      },
      points: e.points === null ? null : Number(e.points),
    };
  }

  /**
   * What accepting into a session and class would do, nothing kept: the registration fee there, the
   * money carried (to the fee, a difference to pay, credit) and the answers the family will be asked for.
   */
  async preview(ctx: RequestContext, id: string, dto: { cycleId: string; classId: string }) {
    return this.accept(ctx, id, dto, true);
  }

  /** The receiving school accepts: a fresh registration in the chosen session and class. */
  async accept(
    ctx: RequestContext,
    id: string,
    dto: { cycleId: string; classId: string; note?: string },
    dryRun = false,
  ) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const m = await this.find(c, id, !dryRun);
      if (m.to_school_id !== tenant.schoolId) throw new DomainError('not-found', 'Move not found');
      if (m.status !== 'requested')
        throw new DomainError('admissions.move.decided', 'This move is already decided', {
          status: 409,
        });
      const line = await c.query<{ class_name: string; cycle: string }>(
        `SELECT cl.name AS class_name, y.name AS cycle FROM admission_class_criteria k
           JOIN admission_cycles y ON y.id = k.cycle_id AND y.deleted_at IS NULL JOIN classes cl ON cl.id = k.class_id
          WHERE k.cycle_id = $1 AND k.class_id = $2`,
        [dto.cycleId, dto.classId],
      );
      if (!line.rows[0])
        throw new DomainError(
          'validation-failed',
          'Choose a session and a class of this school that take registrations',
          { status: 400 },
        );
      if (dryRun) await c.query('SAVEPOINT move_preview');
      try {
        return await this.bring(c, ctx, m, dto, line.rows[0], dryRun);
      } finally {
        if (dryRun) await c.query('ROLLBACK TO SAVEPOINT move_preview');
      }
    });
  }

  private async bring(
    c: PoolClient,
    ctx: RequestContext,
    m: Row,
    dto: { cycleId: string; classId: string; note?: string },
    line: { class_name: string; cycle: string },
    dryRun: boolean,
  ) {
    const tenant = requireTenant(ctx);
    const s = m.snapshot;
    // the family's login here: the same mobile number signs in to both schools' portals
    const mobile = s.applicant.mobile;
    const have = mobile
      ? await c.query<{ id: string }>(`SELECT id::text FROM applicants WHERE mobile = $1`, [mobile])
      : { rows: [] as Array<{ id: string }> };
    const applicantId =
      have.rows[0]?.id ??
      (
        await c.query<{ id: string }>(
          `INSERT INTO applicants (school_id, mobile, email, name) VALUES (app.current_school_id(), $1, $2, $3) RETURNING id::text`,
          [mobile, s.applicant.email, s.applicant.name],
        )
      ).rows[0]!.id;
    const appId = (
      await c.query<{ id: string }>(
        `INSERT INTO applications (school_id, cycle_id, class_id, applicant_id, child_first_name, child_last_name, child_dob,
                                   child_gender, data, entered_by, candidate_name, contact_mobile, contact_email)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::date, $7::gender, '{}'::jsonb, app.current_user_id(), $8, $9, $10)
         RETURNING id::text`,
        [
          dto.cycleId,
          dto.classId,
          applicantId,
          s.child.first,
          s.child.last,
          s.child.dob,
          s.child.gender,
          s.candidate,
          s.contact.mobile,
          s.contact.email,
        ],
      )
    ).rows[0]!.id;
    const row = await this.core.row(c, appId);
    // one live registration of a child per year here too
    const dup = await this.core.sameChild(c, row);
    if (dup)
      throw new DomainError(
        'admissions.move.duplicate',
        `${s.candidate ?? 'This child'} already has ${dup.number ? `registration ${dup.number}` : 'a form'} for ${dup.className} in this school: refuse the move, or cancel that one first`,
        { status: 409, extra: { duplicate: dup } },
      );
    // each answer goes to the field of the same key, or to the one that maps to the same master field
    const def = await this.core.defOf(c, row);
    const answers: AdmissionAnswers = {};
    const copied = new Map<string, string>();
    for (const f of def.fields) {
      const src =
        s.fields.find((x) => x.key === f.key && x.type === f.type) ??
        (f.maps ? s.fields.find((x) => x.maps === f.maps && x.type === f.type) : undefined);
      if (!src || !(src.key in s.data)) continue;
      let v = s.data[src.key];
      if (typeof v === 'string' && v.startsWith(ENC)) v = decryptField(v.slice(ENC.length)) ?? '';
      if ((f.type === 'file' || f.type === 'photo') && Array.isArray(v)) {
        const ids: string[] = [];
        for (const old of v as string[]) {
          const ref = s.files[old];
          if (!ref) continue;
          // a preview names the first school's files; accepting copies them here
          const now = dryRun
            ? old
            : (copied.get(old) ?? (await this.copyFile(c, tenant.schoolId, appId, ref)));
          copied.set(old, now);
          ids.push(now);
        }
        v = ids;
      }
      answers[f.key] = v as AdmissionAnswers[string];
    }
    const missing = await this.core.adopt(c, row, answers);
    const labels = missing.map((k) => def.fields.find((f) => f.key === k)?.label ?? k);
    const { fee, category } = await this.core.submitMoved(
      c,
      appId,
      `Moved from ${s.fromSchool} (registration ${s.number ?? '-'}): ${m.reason}`,
      { actorUser: ctx.user.id },
    );
    // the money: the registration fee here first, a higher fee's difference to pay, the rest credit
    const carried = s.paid.total;
    const toRegistration = r2(Math.min(carried, fee));
    const differenceDue = r2(Math.max(0, fee - carried));
    const credit = r2(carried - toRegistration);
    const outcome = {
      fee,
      category,
      className: line.class_name,
      session: line.cycle,
      carried,
      toRegistration,
      differenceDue,
      credit,
      missing: labels,
    };
    if (dryRun) return { preview: true as const, ...outcome };

    const ref = `Move ${m.id} from ${s.fromSchool}`;
    const receiptNos = s.receipts.map((x) => x.receiptNo).join(', ');
    let receiptId: string | null = null;
    if (toRegistration > 0) {
      const rec = await this.core.postReceipt(c, await this.core.row(c, appId), {
        kind: 'registration',
        amount: toRegistration,
        mode: 'transfer',
        modeLabel: 'Inter-school transfer',
        reference: ref.slice(0, 120),
        remarks: `carried over from ${s.fromSchool}${receiptNos ? ` (receipts ${receiptNos})` : ''}`,
        receivedBy: ctx.user.id,
      });
      receiptId = rec.id;
    }
    await c.query(
      `UPDATE applications SET registration_fee = CASE WHEN $2::numeric > 0 THEN $2::numeric ELSE registration_fee END,
              transfer_credit = $3, updated_at = now() WHERE id = $1`,
      [appId, differenceDue.toFixed(2), credit.toFixed(2)],
    );
    if (carried > 0 || differenceDue > 0)
      await this.core.event(
        c,
        appId,
        'submitted',
        'submitted',
        [
          `Carried over from ${s.fromSchool}: ${money(carried)}`,
          s.paid.admission > 0
            ? ` (registration fee ${money(s.paid.registration)}, admission fee ${money(s.paid.admission)})`
            : '',
          `; registration fee here ${money(fee)}`,
          differenceDue > 0 ? `; ${money(differenceDue)} to pay` : '',
          credit > 0 ? `; credit ${money(credit)} kept for the admission fee` : '',
        ].join(''),
        { actorUser: ctx.user.id },
      );
    const me = await c.query<{ name: string | null }>(
      `SELECT display_name AS name FROM users WHERE id = app.current_user_id()`,
    );
    await c.query(
      `UPDATE admission_moves SET status = 'accepted', decided_by = app.current_user_id(), decided_by_name = $2, decided_at = now(),
              decision_note = $3, to_cycle_id = $4, to_class_id = $5, to_application_id = $6, carried = $7, to_registration = $8,
              difference_due = $9, credit = $10, missing = $11
        WHERE id = $1`,
      [
        m.id,
        me.rows[0]?.name ?? null,
        dto.note?.trim() || null,
        dto.cycleId,
        dto.classId,
        appId,
        carried.toFixed(2),
        toRegistration.toFixed(2),
        differenceDue.toFixed(2),
        credit.toFixed(2),
        missing,
      ],
    );
    // registered at once when the money covers the fee; else once the difference is paid
    const attachments =
      differenceDue > 0 ? [] : await this.core.register(c, appId, receiptId, { silent: true });
    const after = await this.core.row(c, appId);
    await c.query(`UPDATE admission_moves SET snapshot = snapshot || $2::jsonb WHERE id = $1`, [
      m.id,
      JSON.stringify({
        to: { number: after.application_no, className: line.class_name, session: line.cycle },
      }),
    ]);
    // the first school's side: the old registration cancelled, its receipts closed by transfer-out lines
    const closed = await c.query<{ from: string | null }>(
      `SELECT app.admission_move_close($1) AS from`,
      [m.id],
    );
    if (!closed.rows[0]?.from)
      throw new DomainError(
        'admissions.move.closed',
        `${s.candidate ?? 'The candidate'} was admitted or cancelled in ${s.fromSchool} meanwhile: refuse this move`,
        { status: 409 },
      );
    if (closed.rows[0].from === 'money_changed')
      throw new DomainError(
        'admissions.move.money_changed',
        `${s.fromSchool} took or reversed a fee of ${s.candidate ?? 'the candidate'} after asking: ask them to withdraw the move and send it again`,
        { status: 409 },
      );
    await this.tell(c, after, s, { ...outcome, attachments });
    await this.audit.stage(ctx, c, {
      action: 'admissions.move.accept',
      entityType: 'admission_moves',
      entityId: m.id,
      after: {
        applicationId: appId,
        number: after.application_no,
        carried,
        toRegistration,
        differenceDue,
        credit,
        missing,
      },
    });
    return {
      ...this.view(await this.find(c, m.id), tenant.schoolId),
      applicationId: appId,
      newNumber: after.application_no,
    };
  }

  private async copyFile(
    c: PoolClient,
    schoolId: string,
    appId: string,
    ref: FileRef,
  ): Promise<string> {
    const bytes = await this.storage.read(ref.objectKey);
    const ext =
      (ref.objectKey.split('.').pop() ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';
    const key = objectKeyFor(schoolId, ext, `admission-${appId}-${randomBytes(6).toString('hex')}`);
    await this.storage.write(key, bytes, ref.contentType);
    const f = await c.query<{ id: string }>(
      `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, sha256, original_name, owner_entity_type,
                          owner_entity_id, classification, storage_driver, status, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, 'application', $7, 'personal', $8, 'ready',
               app.current_user_id(), app.current_user_id())
       RETURNING id::text`,
      [
        this.storage.bucket,
        key,
        ref.contentType,
        bytes.length,
        createHash('sha256').update(bytes).digest('hex'),
        ref.name,
        appId,
        this.storage.name,
      ],
    );
    return f.rows[0]!.id;
  }

  /** The family is told once: the new registration number, or the difference to pay; the credit kept. */
  private async tell(
    c: PoolClient,
    a: AppRow,
    s: MoveSnapshot,
    o: {
      fee: number;
      carried: number;
      differenceDue: number;
      credit: number;
      missing: string[];
      attachments: Array<{ fileId: string; name: string }>;
    },
  ) {
    const school = (
      await c.query<{ name: string }>(`SELECT name FROM schools WHERE id = app.current_school_id()`)
    ).rows[0]!.name;
    const rows: Array<[string, string]> = [
      ['Candidate', a.candidate_name ?? ''],
      ['Class', `${a.class_name} (${a.cycle_name})`],
      ['Moved from', `${s.fromSchool}, registration ${s.number ?? '-'} (cancelled)`],
      ...(a.application_no ? [['Registration no.', a.application_no] as [string, string]] : []),
      ['Carried over', money(o.carried)],
      ['Registration fee here', money(o.fee)],
      ...(o.differenceDue > 0 ? [['To pay', money(o.differenceDue)] as [string, string]] : []),
      ...(o.credit > 0
        ? [['Credit for the admission fee', money(o.credit)] as [string, string]]
        : []),
      ...(o.missing.length
        ? [['Answers to complete', o.missing.join(', ')] as [string, string]]
        : []),
    ];
    const due = o.differenceDue > 0;
    await c.query(
      `SELECT app.admission_notify($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9, $10::jsonb)`,
      [
        due ? 'admission_received' : 'admission_registered',
        a.contact_mobile,
        a.contact_email,
        JSON.stringify({
          ...messageTag('status', { applicationId: a.id }),
          name: a.candidate_name ?? '',
          class: a.class_name,
          school: '',
          number: a.application_no ?? '',
          amount: o.differenceDue.toLocaleString('en-IN'),
        }),
        `Registration moved to ${school}`,
        `The registration of ${a.candidate_name ?? 'your ward'} is moved from ${s.fromSchool} to ${school}.`,
        a.application_no,
        JSON.stringify(rows),
        [
          due
            ? `Pay ${money(o.differenceDue)} in the admission portal of ${school} (sign in with the same mobile number) or at the school; the registration number is given after the payment.`
            : `The form and the receipt are attached and stay in the admission portal of ${school}.`,
          o.credit > 0 ? ' The credit is used for the admission fee.' : '',
          o.missing.length && !due
            ? ' Sign in to the admission portal to complete the answers asked.'
            : '',
        ].join(''),
        JSON.stringify(o.attachments),
      ],
    );
  }

  /** Refused by the receiving school, or withdrawn by the first: nothing changes in either school. */
  async close(ctx: RequestContext, id: string, how: 'refused' | 'withdrawn', note: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const m = await this.find(c, id, true);
      const mine = how === 'refused' ? m.to_school_id : m.from_school_id;
      if (mine !== tenant.schoolId) throw new DomainError('not-found', 'Move not found');
      if (m.status !== 'requested')
        throw new DomainError('admissions.move.decided', 'This move is already decided', {
          status: 409,
        });
      const me = await c.query<{ name: string | null }>(
        `SELECT display_name AS name FROM users WHERE id = app.current_user_id()`,
      );
      await c.query(
        `UPDATE admission_moves SET status = $2, decided_by = app.current_user_id(), decided_by_name = $3, decided_at = now(),
                decision_note = $4 WHERE id = $1`,
        [id, how, me.rows[0]?.name ?? null, note],
      );
      if (how === 'withdrawn')
        await this.core.event(
          c,
          m.from_application_id,
          m.snapshot.status,
          m.snapshot.status,
          `Move to ${m.snapshot.toSchool} withdrawn: ${note}`,
          { actorUser: ctx.user.id },
        );
      await this.audit.stage(ctx, c, {
        action: `admissions.move.${how === 'refused' ? 'refuse' : 'withdraw'}`,
        entityType: 'admission_moves',
        entityId: id,
        after: { note },
      });
      return this.view(await this.find(c, id), tenant.schoolId);
    });
  }

  /** The register of moves (both directions) as Excel or PDF. */
  async export(ctx: RequestContext, q: { box?: string; status?: string; format: 'xlsx' | 'pdf' }) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const list = (await this.rows(c, q)).map((x) => this.view(x, tenant.schoolId));
      const head = [
        'Asked on',
        'Direction',
        'Candidate',
        'Registration no.',
        'Class',
        'From',
        'To',
        'New registration',
        'Status',
        'Paid there',
        'To registration fee',
        'Difference due',
        'Credit',
        'Reason',
      ];
      const rowOf = (x: ReturnType<AdmissionMovesService['view']>) => [
        ist(new Date(x.requestedAt)),
        x.direction === 'outgoing' ? 'Out' : 'In',
        x.candidate ?? '',
        x.number ?? '',
        x.className,
        x.fromSchool,
        x.toSchool,
        x.to ? `${x.to.number ?? 'fee due'} · ${x.to.className}` : '',
        x.statusLabel,
        x.money.paid,
        x.money.toRegistration ?? '',
        x.money.differenceDue ?? '',
        x.money.credit ?? '',
        x.reason,
      ];
      const stamp = new Date().toISOString().slice(0, 10);
      if (q.format === 'xlsx') {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Moves');
        ws.addRow(['Registrations moved between schools']).font = { bold: true, size: 13 };
        ws.addRow([`Printed ${ist(new Date())}`]);
        ws.addRow([]);
        ws.addRow(head).font = { bold: true };
        for (const x of list) ws.addRow(rowOf(x));
        ws.columns.forEach((col, i) => {
          col.width = [12, 9, 24, 20, 14, 22, 22, 24, 11, 12, 14, 13, 11, 40][i] ?? 14;
        });
        for (const k of [10, 11, 12, 13]) ws.getColumn(k).numFmt = '#,##0.00';
        const bytes = Buffer.from(await wb.xlsx.writeBuffer());
        return {
          filename: `registration-moves-${stamp}.xlsx`,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          base64: bytes.toString('base64'),
        };
      }
      const { head: school, logo } = await this.core.school(c);
      const n = (v: number | string) => (typeof v === 'number' ? v.toLocaleString('en-IN') : v);
      const bytes = await tablePdf({
        school,
        logo,
        title: 'Registrations moved between schools',
        subtitle: `${String(list.length)} move${list.length === 1 ? '' : 's'}${q.status ? ` · ${STATUS[q.status as Row['status']]}` : ''}`,
        columns: [
          { h: 'Asked', w: 52 },
          { h: 'Candidate', w: 96 },
          { h: 'From → to', w: 112 },
          { h: 'New registration', w: 90 },
          { h: 'Status', w: 46 },
          { h: 'Paid', w: 44 },
          { h: 'Due / credit', w: 75 },
        ],
        rows: list.map((x) => [
          ist(new Date(x.requestedAt)),
          `${x.candidate ?? ''} (${x.number ?? '-'})`,
          `${x.fromSchool} → ${x.toSchool}`,
          x.to ? `${x.to.number ?? 'fee due'} · ${x.to.className}` : '',
          x.statusLabel,
          n(x.money.paid),
          x.money.differenceDue
            ? `due ${n(x.money.differenceDue)}`
            : x.money.credit
              ? `credit ${n(x.money.credit)}`
              : '',
        ]),
        printedAt: ist(new Date()),
      });
      return {
        filename: `registration-moves-${stamp}.pdf`,
        contentType: 'application/pdf',
        base64: bytes.toString('base64'),
      };
    });
  }
}

/** A registration's moves for its page: asked, moved out, or moved in (with the credit left). */
export async function movesOf(c: PoolClient, appId: string) {
  const r = await c.query<{
    id: string;
    status: string;
    out: boolean;
    reason: string;
    from_school: string;
    to_school: string;
    from_number: string | null;
    to_number: string | null;
    requested_at: Date;
    requested_by: string | null;
    decided_at: Date | null;
    decided_by: string | null;
    decision_note: string | null;
    carried: string | null;
    difference_due: string | null;
    credit: string | null;
    missing: string[];
  }>(
    `SELECT id::text, status, from_application_id = $1 AS out, reason, snapshot->>'fromSchool' AS from_school,
            snapshot->>'toSchool' AS to_school, snapshot->>'number' AS from_number, snapshot#>>'{to,number}' AS to_number,
            requested_at, requested_by_name AS requested_by, decided_at, decided_by_name AS decided_by, decision_note,
            carried::text, difference_due::text, credit::text, missing
       FROM admission_moves WHERE from_application_id = $1 OR to_application_id = $1
      ORDER BY requested_at DESC`,
    [appId],
  );
  return r.rows.map((x) => ({
    id: x.id,
    status: x.status,
    direction: x.out ? ('outgoing' as const) : ('incoming' as const),
    reason: x.reason,
    fromSchool: x.from_school,
    toSchool: x.to_school,
    fromNumber: x.from_number,
    toNumber: x.to_number,
    requestedAt: x.requested_at.toISOString(),
    requestedBy: x.requested_by,
    decidedAt: x.decided_at?.toISOString() ?? null,
    decidedBy: x.decided_by,
    decisionNote: x.decision_note,
    carried: x.carried === null ? null : Number(x.carried),
    differenceDue: x.difference_due === null ? null : Number(x.difference_due),
    credit: x.credit === null ? null : Number(x.credit),
    missing: x.missing,
  }));
}
