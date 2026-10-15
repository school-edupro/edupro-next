import { Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { assertPeriodOpen } from '../ops/ops.service';
import { SETTINGS_CATALOGUE } from '../platform/settings.catalogue';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { WAITING_WITH, startFeeApproval } from './fee-approval';
import { FeeSetupService } from './fee-setup.service';
import type {
  AnnounceMiscFeeDto,
  CollectMiscFeeDto,
  ListMiscFeesQueryDto,
  MiscFeeChangeDto,
  MiscReceiptRequestDto,
} from './misc-fees.dto';

/** The approval every misc fee request rides; its levels mirror Fee setup -> Approval levels. */
export const MISC_FEE_FLOW = 'misc_fee_request';

type Kind =
  | 'announce'
  | 'extend'
  | 'pupil_change'
  | 'add_pupils'
  | 'close'
  | 'receipt_cancel'
  | 'receipt_bounce'
  | 'receipt_refund';
const KIND_LABEL: Record<Kind, string> = {
  announce: 'Announce the fee',
  extend: 'Extend the last date',
  pupil_change: "Change a pupil's amount or last date",
  add_pupils: 'Add pupils',
  close: 'Close the fee',
  receipt_cancel: 'Cancel a receipt',
  receipt_bounce: 'Cheque bounced',
  receipt_refund: 'Refund',
};
interface Pupil {
  studentId: string;
  amount: number;
  lastDate: string | null;
}
interface Audience {
  classIds: string[];
  sectionIds: string[];
  studentIds: string[];
  rows: Array<{ admissionNo: string; amount?: number; lastDate?: string }>;
}
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const dmy = (v: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('-') : '');

// eslint-disable-next-line no-restricted-syntax -- WAITING_WITH is a fixed SQL fragment over a column name written here
const FEE = `SELECT f.id::text, f.title, f.head_id::text AS "headId", h.name AS head, f.amount::text, f.last_date::text AS "lastDate", f.remark, f.mandatory, f.seats, f.status,
        ru.display_name AS "requestedBy", f.requested_at AS "requestedAt", f.announced_at AS "announcedAt",
        (SELECT count(*) FROM misc_fee_students l WHERE l.misc_fee_id = f.id AND l.status <> 'cancelled')::int AS pupils,
        (SELECT COALESCE(sum(l.amount), 0) FROM misc_fee_students l WHERE l.misc_fee_id = f.id AND l.status <> 'cancelled')::text AS billed,
        (SELECT COALESCE(sum(l.paid), 0) FROM misc_fee_students l WHERE l.misc_fee_id = f.id AND l.status <> 'cancelled')::text AS collected,
        (SELECT count(*) FROM misc_fee_students l WHERE l.misc_fee_id = f.id AND l.status = 'paid')::int AS "paidPupils",
        (SELECT count(*) FROM misc_fee_requests r WHERE r.misc_fee_id = f.id AND r.status = 'pending')::int AS "openRequests",
        (SELECT ${WAITING_WITH('r.workflow_instance_id')} FROM misc_fee_requests r WHERE r.misc_fee_id = f.id AND r.kind = 'announce' ORDER BY r.id DESC LIMIT 1) AS "waitingWith"
   FROM misc_fees f JOIN fee_heads h ON h.id = f.head_id LEFT JOIN users ru ON ru.id = f.requested_by`;

// eslint-disable-next-line no-restricted-syntax -- WAITING_WITH is a fixed SQL fragment over a column name written here
const REQUEST = `SELECT r.id::text, r.misc_fee_id::text AS "miscFeeId", f.title AS "feeTitle", r.line_id::text AS "lineId", r.receipt_id::text AS "receiptId", m.receipt_no AS "receiptNo",
        r.kind, r.payload, r.reason, r.status, r.workflow_instance_id::text AS "workflowInstanceId", ${WAITING_WITH('r.workflow_instance_id')} AS "waitingWith",
        ru.display_name AS "requestedBy", r.requested_at AS "requestedAt", du.display_name AS "decidedBy", r.decided_at AS "decidedAt", r.decision_note AS "decisionNote",
        r.voucher_no AS "voucherNo", r.result,
        COALESCE(ls.display_name, ms.display_name) AS student, COALESCE(ls.admission_no, ms.admission_no) AS "admissionNo"
   FROM misc_fee_requests r LEFT JOIN misc_fees f ON f.id = r.misc_fee_id
   LEFT JOIN misc_receipts m ON m.id = r.receipt_id LEFT JOIN students ms ON ms.id = m.student_id
   LEFT JOIN misc_fee_students l ON l.id = r.line_id LEFT JOIN students ls ON ls.id = l.student_id
   LEFT JOIN users ru ON ru.id = r.requested_by LEFT JOIN users du ON du.id = r.decided_by`;

/**
 * Misc fees announced to pupils: a trip, an activity, an exam form. A fee names its head, amount, last
 * date, whether it is mandatory and, where places are limited, how many seats there are; it is offered
 * to classes, sections, pupils by name or the rows of an Excel sheet, and each pupil can carry their own
 * amount and last date. Announcing, extending, changing a pupil, adding pupils, closing, and taking a
 * receipt back (cancel, bounce, refund) are all requests through Fee setup -> Approval levels. Money
 * stays on the misc ledger: a misc receipt says which announced fee of which pupil it paid.
 *
 * A seat is taken by paying in full, in the order of payment; a cancelled, bounced or fully refunded
 * receipt gives it back. A fee that is not mandatory closes on its last date; a mandatory one stays due.
 */
@Injectable()
export class MiscFeesService {
  private readonly log = new Logger('MiscFeesService');
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly setup: FeeSetupService,
    private readonly viewer: ViewerService,
  ) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  /** The heads a misc fee can be raised under. */
  async heads(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM fee_heads
          WHERE deleted_at IS NULL AND status = 'active' AND (kind = 'misc' OR ledger = 'misc') ORDER BY sort_order, name`,
      );
      return r.rows;
    });
  }

  // ---- who the fee is for ---------------------------------------------------------------------------
  /** The pupils of an audience, each with the amount and last date that apply to them. */
  private async pupilsOf(
    c: PoolClient,
    yearId: string,
    a: Audience,
    amount: number,
  ): Promise<{ pupils: Pupil[]; unknown: string[] }> {
    const out = new Map<string, Pupil>();
    const byGroup = await c.query<{ id: string }>(
      `SELECT DISTINCT s.id::text FROM students s JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = $1 AND e.status = 'active'
         JOIN class_sections cs ON cs.id = e.class_section_id
        WHERE s.deleted_at IS NULL AND s.status = 'active'
          AND (cs.class_id = ANY($2::bigint[]) OR cs.id = ANY($3::bigint[]) OR s.id = ANY($4::bigint[]))`,
      [yearId, a.classIds, a.sectionIds, a.studentIds],
    );
    for (const s of byGroup.rows) out.set(s.id, { studentId: s.id, amount, lastDate: null });
    const unknown: string[] = [];
    if (a.rows.length) {
      const found = await c.query<{ id: string; admission_no: string }>(
        `SELECT id::text, admission_no FROM students WHERE deleted_at IS NULL AND status = 'active' AND lower(admission_no) = ANY($1::text[])`,
        [a.rows.map((r) => r.admissionNo.toLowerCase())],
      );
      const id = new Map(found.rows.map((s) => [s.admission_no.toLowerCase(), s.id]));
      for (const r of a.rows) {
        const sid = id.get(r.admissionNo.toLowerCase());
        if (!sid) unknown.push(r.admissionNo);
        // a pupil's own figures from the sheet win over the class they also belong to
        else
          out.set(sid, {
            studentId: sid,
            amount: r.amount ?? amount,
            lastDate: r.lastDate ?? null,
          });
      }
    }
    return { pupils: [...out.values()], unknown };
  }

  /** The rows of an uploaded sheet: Admission no., Amount, Last date (the last two may be left empty). */
  async readSheet(contentBase64: string) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(Buffer.from(contentBase64, 'base64') as unknown as ArrayBuffer);
    } catch {
      throw new DomainError('validation-failed', 'The file is not an Excel (.xlsx) sheet', {
        status: 400,
      });
    }
    const ws = wb.worksheets[0];
    const rows: Array<{ admissionNo: string; amount?: number; lastDate?: string }> = [];
    const errors: string[] = [];
    ws?.eachRow((row, n) => {
      const text = (i: number) => {
        const v = row.getCell(i).value;
        if (v === null || v === undefined) return '';
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'object' && 'text' in v)
          return String((v as { text: unknown }).text).trim();
        if (typeof v === 'object' && 'result' in v)
          return String((v as { result: unknown }).result).trim();
        return String(v).trim();
      };
      const adm = text(1);
      if (!adm || /^admission/i.test(adm) || /^sr/i.test(adm)) return;
      const amt = text(2);
      const date = text(3);
      const day = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(date);
      const iso = day ? `${day[3]!}-${day[2]!}-${day[1]!}` : date;
      if (amt && (Number.isNaN(Number(amt)) || Number(amt) < 0))
        return void errors.push(`Row ${String(n)}: the amount "${amt}" is not a number`);
      if (iso && !/^\d{4}-\d{2}-\d{2}$/.test(iso))
        return void errors.push(
          `Row ${String(n)}: the last date "${date}" is not a date (use DD-MM-YYYY)`,
        );
      rows.push({
        admissionNo: adm,
        ...(amt ? { amount: Number(amt) } : {}),
        ...(iso ? { lastDate: iso } : {}),
      });
    });
    return { rows: rows.slice(0, 5000), errors: errors.slice(0, 50) };
  }

  /** The sheet to fill for an Excel announcement. */
  async sheetFormat() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Misc fee');
    ws.addRow([
      'Admission no.',
      'Amount (empty = the fee amount)',
      'Last date DD-MM-YYYY (empty = the fee date)',
    ]);
    ws.getRow(1).font = { bold: true };
    ws.columns = [{ width: 18 }, { width: 30 }, { width: 38 }];
    return {
      bytes: Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer),
      filename: 'misc-fee-format.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // ---- reading --------------------------------------------------------------------------------------
  async list(ctx: RequestContext, q: ListMiscFeesQueryDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where = [`f.academic_year_id = $1`];
      const params: unknown[] = [yearId];
      const add = (sql: string, v: unknown) => {
        params.push(v);
        where.push(sql.replaceAll('?', `$${String(params.length)}`));
      };
      if (q.status) add(`f.status = ?`, q.status);
      if (q.headId) add(`f.head_id = ?`, q.headId);
      if (q.q) add(`lower(f.title) LIKE ?`, `%${q.q.toLowerCase()}%`);
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- where holds fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM misc_fees f WHERE ${where.join(' AND ')}`,
        params,
      );
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- FEE is a constant; where holds fixed fragments; values are bound parameters
        `${FEE} WHERE ${where.join(' AND ')} ORDER BY f.id DESC LIMIT $${String(params.length + 1)} OFFSET $${String(params.length + 2)}`,
        [...params, q.size, (q.page - 1) * q.size],
      );
      return { rows: r.rows, total: Number(total.rows[0]!.n) };
    });
  }

  private async fee(c: PoolClient, id: string) {
    // eslint-disable-next-line no-restricted-syntax -- FEE is a constant; the id is a bound parameter
    const r = await c.query<Record<string, unknown>>(`${FEE} WHERE f.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Misc fee not found', { status: 404 });
    return r.rows[0] as {
      id: string;
      title: string;
      amount: string;
      lastDate: string;
      mandatory: boolean;
      seats: number | null;
      status: string;
      paidPupils: number;
    } & Record<string, unknown>;
  }

  /** A fee with its pupils and the requests made about it. */
  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const fee = await this.fee(c, id);
      const lines = await c.query<Record<string, unknown>>(
        `SELECT l.id::text, l.student_id::text AS "studentId", s.display_name AS student, s.admission_no AS "admissionNo",
                (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                  WHERE e.student_id = s.id AND e.academic_year_id = f.academic_year_id ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) AS class,
                l.amount::text, l.paid::text, (l.amount - l.paid)::text AS balance, COALESCE(l.last_date, f.last_date)::text AS "lastDate",
                l.last_date IS NOT NULL AS "ownDate", l.amount <> f.amount AS "ownAmount", l.status, l.paid_at AS "paidAt"
           FROM misc_fee_students l JOIN misc_fees f ON f.id = l.misc_fee_id JOIN students s ON s.id = l.student_id
          WHERE l.misc_fee_id = $1 ORDER BY (l.status = 'cancelled'), s.display_name LIMIT 5000`,
        [id],
      );
      const requests = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- REQUEST is a constant; the id is a bound parameter
        `${REQUEST} WHERE r.misc_fee_id = $1 ORDER BY r.id DESC LIMIT 200`,
        [id],
      );
      return { fee, lines: lines.rows, requests: requests.rows };
    });
  }

  /** What a pupil can pay at the counter now, and the misc receipts they already hold. */
  async forStudent(ctx: RequestContext, studentId: string) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await c.query<{ name: string; admission_no: string; class: string | null }>(
        `SELECT s.display_name AS name, s.admission_no,
                (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                  WHERE e.student_id = s.id AND e.academic_year_id = $2 ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) AS class
           FROM students s WHERE s.id = $1 AND s.deleted_at IS NULL`,
        [studentId, yearId],
      );
      if (!s.rows[0]) throw new DomainError('not-found', 'Student not found', { status: 404 });
      const lines = await c.query<Record<string, unknown>>(
        `SELECT l.id::text, f.id::text AS "feeId", f.title, h.name AS head, f.mandatory, f.seats, f.remark,
                l.amount::text, l.paid::text, (l.amount - l.paid)::text AS balance, COALESCE(l.last_date, f.last_date)::text AS "lastDate", l.status,
                (SELECT count(*) FROM misc_fee_students x WHERE x.misc_fee_id = f.id AND x.status = 'paid')::int AS "seatsTaken",
                -- why it cannot be paid now, if it cannot
                CASE WHEN f.status = 'closed' THEN 'The fee is closed'
                     WHEN NOT f.mandatory AND COALESCE(l.last_date, f.last_date) < CURRENT_DATE THEN 'The last date has passed'
                     WHEN f.seats IS NOT NULL AND l.paid = 0 AND (SELECT count(*) FROM misc_fee_students x WHERE x.misc_fee_id = f.id AND x.status = 'paid') >= f.seats THEN 'All seats are taken'
                END AS blocked
           FROM misc_fee_students l JOIN misc_fees f ON f.id = l.misc_fee_id JOIN fee_heads h ON h.id = f.head_id
          WHERE l.student_id = $1 AND f.academic_year_id = $2 AND f.status IN ('announced', 'closed') AND l.status <> 'cancelled'
          ORDER BY (l.status = 'paid'), COALESCE(l.last_date, f.last_date), f.id`,
        [studentId, yearId],
      );
      const receipts = await c.query<Record<string, unknown>>(
        `SELECT m.id::text, m.receipt_no AS "receiptNo", m.received_on::text AS "receivedOn", m.amount::text, m.refunded::text, m.mode, m.status,
                m.instrument_no AS "instrumentNo", m.bank_name AS "bankName", m.reference, ru.display_name AS "receivedBy",
                COALESCE(f.title, h.name) AS title, m.misc_fee_student_id IS NOT NULL AS announced,
                (SELECT r.kind FROM misc_fee_requests r WHERE r.receipt_id = m.id AND r.status = 'pending' LIMIT 1) AS waiting
           FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id
           LEFT JOIN misc_fee_students l ON l.id = m.misc_fee_student_id LEFT JOIN misc_fees f ON f.id = l.misc_fee_id
           LEFT JOIN users ru ON ru.id = m.received_by
          WHERE m.student_id = $1 AND m.academic_year_id = $2 ORDER BY m.id DESC LIMIT 200`,
        [studentId, yearId],
      );
      return {
        bounceCharge: await this.bounceCharge(c, studentId, yearId),
        student: {
          id: studentId,
          name: s.rows[0].name,
          admissionNo: s.rows[0].admission_no,
          class: s.rows[0].class,
        },
        lines: lines.rows,
        receipts: receipts.rows,
      };
    });
  }

  /** The misc fees announced for the family's children, as the parent app shows them. */
  async mine(ctx: RequestContext) {
    const v = await this.viewer.resolve(ctx, 'fees.family.view');
    if (v.kind !== 'family') return { children: [] };
    const children = [];
    for (const s of v.students) {
      const one = await this.forStudent(ctx, s.id).catch((error: unknown) => {
        if (error instanceof DomainError && error.status === 404) return null;
        throw error;
      });
      if (one && (one.lines.length > 0 || one.receipts.some((r) => r.announced)))
        children.push({
          student: one.student,
          lines: one.lines,
          receipts: one.receipts.filter((r) => r.announced),
        });
    }
    return { children };
  }

  // ---- requests -------------------------------------------------------------------------------------
  private async findRequest(c: PoolClient, id: string) {
    // eslint-disable-next-line no-restricted-syntax -- REQUEST is a constant; the id is a bound parameter
    const r = await c.query<Record<string, unknown>>(`${REQUEST} WHERE r.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Request not found', { status: 404 });
    return r.rows[0] as {
      id: string;
      miscFeeId: string | null;
      lineId: string | null;
      receiptId: string | null;
      kind: Kind;
      payload: Record<string, unknown>;
      reason: string;
      status: string;
      workflowInstanceId: string | null;
    } & Record<string, unknown>;
  }

  /** Raises a request and sends it through the fee approval levels (or leaves it for a page decision). */
  private async raise(
    c: PoolClient,
    ctx: RequestContext,
    x: {
      kind: Kind;
      miscFeeId?: string | null;
      lineId?: string | null;
      receiptId?: string | null;
      payload: Record<string, unknown>;
      reason: string;
      subject: string;
    },
  ) {
    const open = await c.query(
      `SELECT 1 FROM misc_fee_requests WHERE status = 'pending' AND kind = $1
          AND COALESCE(misc_fee_id, 0) = COALESCE($2::bigint, 0) AND COALESCE(line_id, 0) = COALESCE($3::bigint, 0) AND COALESCE(receipt_id, 0) = COALESCE($4::bigint, 0)`,
      [x.kind, x.miscFeeId ?? null, x.lineId ?? null, x.receiptId ?? null],
    );
    if (open.rowCount)
      throw new DomainError(
        'misc.request_open',
        'The same request is already waiting for approval',
        {
          status: 409,
        },
      );
    const r = await c.query<{ id: string }>(
      `INSERT INTO misc_fee_requests (school_id, misc_fee_id, line_id, receipt_id, kind, payload, reason, requested_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5::jsonb, $6, app.current_user_id()) RETURNING id::text`,
      [
        x.miscFeeId ?? null,
        x.lineId ?? null,
        x.receiptId ?? null,
        x.kind,
        JSON.stringify(x.payload),
        x.reason,
      ],
    );
    const id = r.rows[0]!.id;
    const instanceId = await startFeeApproval(
      this.workflow,
      c,
      ctx,
      { code: MISC_FEE_FLOW, name: 'Misc fee request' },
      id,
      `Misc fee: ${KIND_LABEL[x.kind]}: ${x.subject}`,
      { kind: x.kind, reason: x.reason },
    );
    if (instanceId)
      await c.query(`UPDATE misc_fee_requests SET workflow_instance_id = $2 WHERE id = $1`, [
        id,
        instanceId,
      ]);
    await this.audit.stage(ctx, c, {
      action: 'fees.misc.request',
      entityType: 'misc_fee_requests',
      entityId: id,
      after: {
        kind: x.kind,
        miscFeeId: x.miscFeeId,
        lineId: x.lineId,
        receiptId: x.receiptId,
        reason: x.reason,
      },
    });
    return this.findRequest(c, id);
  }

  /** A new misc fee: kept as waiting, with its pupils, until the announcement is approved. */
  async announce(ctx: RequestContext, dto: AnnounceMiscFeeDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      const head = await c.query(
        `SELECT 1 FROM fee_heads WHERE id = $1 AND deleted_at IS NULL AND status = 'active' AND (kind = 'misc' OR ledger = 'misc')`,
        [dto.headId],
      );
      if (!head.rowCount)
        throw new DomainError(
          'not-found',
          'Choose a misc fee head (Fee setup → Fee heads, kind "misc")',
          {
            status: 404,
          },
        );
      const { pupils, unknown } = await this.pupilsOf(c, yearId, dto, dto.amount);
      if (unknown.length)
        throw new DomainError(
          'misc.unknown_pupils',
          `No active pupil has these admission numbers: ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? ` and ${String(unknown.length - 10)} more` : ''}`,
          { status: 422 },
        );
      if (pupils.length === 0)
        throw new DomainError('misc.nobody', 'No active pupil is in what was chosen', {
          status: 422,
        });
      const f = await c.query<{ id: string }>(
        `INSERT INTO misc_fees (school_id, academic_year_id, head_id, title, amount, last_date, remark, mandatory, seats, requested_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5::date, $6, $7, $8, app.current_user_id()) RETURNING id::text`,
        [
          yearId,
          dto.headId,
          dto.title,
          dto.amount.toFixed(2),
          dto.lastDate,
          dto.remark ?? null,
          dto.mandatory,
          dto.seats ?? null,
        ],
      );
      const id = f.rows[0]!.id;
      await this.addLines(c, id, pupils);
      const total = pupils.reduce((a, p) => a + p.amount, 0);
      await this.raise(c, ctx, {
        kind: 'announce',
        miscFeeId: id,
        payload: { pupils: pupils.length, total: total.toFixed(2) },
        reason: dto.remark ?? dto.title,
        subject: `${dto.title}: ${String(pupils.length)} pupil(s), Rs. ${total.toFixed(2)}, last date ${dmy(dto.lastDate)}${dto.seats ? `, ${String(dto.seats)} seats` : ''}`,
      });
      return this.fee(c, id);
    });
  }

  private async addLines(c: PoolClient, feeId: string, pupils: Pupil[]): Promise<number> {
    let n = 0;
    for (const p of pupils) {
      const r = await c.query(
        `INSERT INTO misc_fee_students (school_id, misc_fee_id, student_id, amount, last_date)
         VALUES (app.current_school_id(), $1, $2, $3, $4::date) ON CONFLICT (misc_fee_id, student_id) DO NOTHING`,
        [feeId, p.studentId, p.amount.toFixed(2), p.lastDate],
      );
      n += r.rowCount ?? 0;
    }
    return n;
  }

  /** A change to an announced fee: a longer last date, a pupil's own amount or date, more pupils, or closing it. */
  async requestChange(ctx: RequestContext, feeId: string, dto: MiscFeeChangeDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const fee = await this.fee(c, feeId);
      if (fee.status !== 'announced')
        throw new DomainError('misc.not_announced', 'Only an announced fee can be changed', {
          status: 409,
        });
      if (dto.kind === 'extend')
        return this.raise(c, ctx, {
          kind: 'extend',
          miscFeeId: feeId,
          payload: { lastDate: dto.lastDate, from: fee.lastDate },
          reason: dto.reason,
          subject: `${fee.title}: last date ${dmy(fee.lastDate)} to ${dmy(dto.lastDate)}`,
        });
      if (dto.kind === 'close')
        return this.raise(c, ctx, {
          kind: 'close',
          miscFeeId: feeId,
          payload: {},
          reason: dto.reason,
          subject: `${fee.title}: no more collection`,
        });
      if (dto.kind === 'pupil_change') {
        const l = await c.query<{ name: string; amount: string; paid: string; last: string }>(
          `SELECT s.display_name AS name, l.amount::text, l.paid::text, COALESCE(l.last_date, f.last_date)::text AS last
             FROM misc_fee_students l JOIN misc_fees f ON f.id = l.misc_fee_id JOIN students s ON s.id = l.student_id
            WHERE l.id = $1 AND l.misc_fee_id = $2 AND l.status <> 'cancelled'`,
          [dto.lineId, feeId],
        );
        const line = l.rows[0];
        if (!line)
          throw new DomainError('not-found', 'The pupil is not on this fee', { status: 404 });
        if (dto.amount !== undefined && dto.amount < Number(line.paid) - 0.005)
          throw new DomainError(
            'misc.below_paid',
            `Rs. ${line.paid} is already paid; refund first to go below it`,
            { status: 409 },
          );
        return this.raise(c, ctx, {
          kind: 'pupil_change',
          miscFeeId: feeId,
          lineId: dto.lineId,
          payload: {
            amount: dto.amount,
            lastDate: dto.lastDate,
            fromAmount: line.amount,
            fromDate: line.last,
          },
          reason: dto.reason,
          subject: `${fee.title}: ${line.name}: ${dto.amount !== undefined ? `amount Rs. ${line.amount} to Rs. ${dto.amount.toFixed(2)}` : ''}${dto.amount !== undefined && dto.lastDate ? ', ' : ''}${dto.lastDate ? `last date ${dmy(line.last)} to ${dmy(dto.lastDate)}` : ''}`,
        });
      }
      const { pupils, unknown } = await this.pupilsOf(c, yearId, dto.audience, Number(fee.amount));
      if (unknown.length)
        throw new DomainError(
          'misc.unknown_pupils',
          `No active pupil has these admission numbers: ${unknown.slice(0, 10).join(', ')}`,
          { status: 422 },
        );
      const have = await c.query<{ id: string }>(
        `SELECT student_id::text AS id FROM misc_fee_students WHERE misc_fee_id = $1`,
        [feeId],
      );
      const fresh = pupils.filter((p) => !have.rows.some((x) => x.id === p.studentId));
      if (fresh.length === 0)
        throw new DomainError('misc.nobody', 'Everyone chosen is already on this fee', {
          status: 422,
        });
      return this.raise(c, ctx, {
        kind: 'add_pupils',
        miscFeeId: feeId,
        payload: { pupils: fresh },
        reason: dto.reason,
        subject: `${fee.title}: ${String(fresh.length)} more pupil(s)`,
      });
    });
  }

  /** The bounce charge of a pupil: the class's own when it has one, else the school's. */
  private async bounceCharge(c: PoolClient, studentId: string, yearId: string): Promise<number> {
    const setting = await c.query<{ v: string | null }>(
      `SELECT app.setting('fees.bounce_charge') #>> '{}' AS v`,
    );
    return (
      (await this.setup.bounceChargeFor(c, studentId, yearId)) ??
      Number(setting.rows[0]?.v ?? SETTINGS_CATALOGUE['fees.bounce_charge']!.default)
    );
  }

  /**
   * The charge for a bounced misc cheque: a mandatory misc fee of the pupil under the bounce charge
   * head, due at once. It stays on the misc ledger, is collected at the misc counter and shows in the
   * misc dues report and to the parent.
   */
  private async raiseBounceCharge(
    c: PoolClient,
    x: { receiptNo: string; studentId: string; yearId: string; charge: number; reason: string },
  ): Promise<string> {
    const code =
      (
        await c.query<{ v: string | null }>(
          `SELECT app.setting('fees.bounce_charge_head') #>> '{}' AS v`,
        )
      ).rows[0]?.v ?? 'BOUNCE';
    const head = await c.query<{ id: string }>(
      `INSERT INTO fee_heads (school_id, code, name, kind, ledger, sort_order, created_by, updated_by)
       VALUES (app.current_school_id(), $1, 'Cheque bounce charge', 'misc', 'school', 900, app.current_user_id(), app.current_user_id())
       ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO UPDATE SET updated_at = now() RETURNING id::text`,
      [code],
    );
    const f = await c.query<{ id: string }>(
      `INSERT INTO misc_fees (school_id, academic_year_id, head_id, title, amount, last_date, remark, mandatory, status, requested_by, announced_at)
       VALUES (app.current_school_id(), $1, $2, $3, $4, CURRENT_DATE, $5, true, 'announced', app.current_user_id(), now()) RETURNING id::text`,
      [
        x.yearId,
        head.rows[0]!.id,
        `Cheque bounce charge · ${x.receiptNo}`,
        x.charge.toFixed(2),
        `Cheque of receipt ${x.receiptNo} bounced: ${x.reason}`.slice(0, 300),
      ],
    );
    await this.addLines(c, f.rows[0]!.id, [
      { studentId: x.studentId, amount: x.charge, lastDate: null },
    ]);
    return f.rows[0]!.id;
  }

  /** A misc receipt taken back: cancelled, a bounced cheque, or refunded in full or in part. */
  async requestReceipt(ctx: RequestContext, receiptId: string, dto: MiscReceiptRequestDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const m = await c.query<{
        receipt_no: string;
        amount: string;
        refunded: string;
        status: string;
        mode: string;
        payer: string;
        fee: string | null;
        line: string | null;
        student: string | null;
        year: string;
      }>(
        `SELECT m.receipt_no, m.amount::text, m.refunded::text, m.status, m.mode, m.payer_name AS payer, l.misc_fee_id::text AS fee, m.misc_fee_student_id::text AS line,
                m.student_id::text AS student, m.academic_year_id::text AS year
           FROM misc_receipts m LEFT JOIN misc_fee_students l ON l.id = m.misc_fee_student_id WHERE m.id = $1 FOR UPDATE OF m`,
        [receiptId],
      );
      const rec = m.rows[0];
      if (!rec) throw new DomainError('not-found', 'Receipt not found', { status: 404 });
      if (rec.status !== 'posted')
        throw new DomainError(
          'misc.receipt_closed',
          'This receipt is already cancelled or bounced',
          {
            status: 409,
          },
        );
      const left = Number(rec.amount) - Number(rec.refunded);
      if (dto.kind === 'receipt_bounce' && !['cheque', 'dd'].includes(rec.mode))
        throw new DomainError('misc.not_a_cheque', 'Only a cheque or draft can bounce', {
          status: 409,
        });
      if (dto.kind !== 'receipt_refund' && Number(rec.refunded) > 0)
        throw new DomainError(
          'misc.partly_refunded',
          'Part of this receipt is refunded: refund the rest instead of cancelling it',
          { status: 409 },
        );
      if (dto.kind === 'receipt_refund' && dto.amount! > left + 0.005)
        throw new DomainError(
          'misc.refund_exceeds',
          `Only Rs. ${left.toFixed(2)} of this receipt is left`,
          {
            status: 409,
          },
        );
      return this.raise(c, ctx, {
        kind: dto.kind,
        miscFeeId: rec.fee,
        lineId: rec.line,
        receiptId,
        payload:
          dto.kind === 'receipt_refund'
            ? { amount: dto.amount, mode: dto.mode, reference: dto.reference ?? null }
            : dto.kind === 'receipt_bounce' && rec.student
              ? {
                  amount: left,
                  charge: dto.charge ?? (await this.bounceCharge(c, rec.student, rec.year)),
                }
              : { amount: left },
        reason: dto.reason,
        subject: `${rec.payer}: receipt ${rec.receipt_no}: Rs. ${(dto.kind === 'receipt_refund' ? dto.amount! : left).toFixed(2)}`,
      });
    });
  }

  /** The requests waiting (or all), newest first. */
  async requests(ctx: RequestContext, status?: 'pending' | 'approved' | 'rejected') {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- REQUEST is a constant; the status is a bound parameter
        `${REQUEST} WHERE ($1::text IS NULL OR r.status = $1) ORDER BY (r.status = 'pending') DESC, r.id DESC LIMIT 300`,
        [status ?? null],
      );
      return r.rows;
    });
  }

  /** A decision on the page, where the school has no approval level in force. */
  async decide(ctx: RequestContext, id: string, outcome: 'approved' | 'rejected', note?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.findRequest(c, id);
      if (r.status === 'pending' && r.workflowInstanceId)
        throw new DomainError(
          'misc.in_workflow',
          'This request goes through the approval levels: approve it from My approvals',
          { status: 409 },
        );
      await this.decideWith(c, ctx, id, outcome, note);
      return this.findRequest(c, id);
    });
  }

  /** The last level approved, or a level rejected. */
  async onWorkflowComplete(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const note = instance.steps.find((x) => x.status === outcome)?.note ?? undefined;
    await this.decideWith(c, ctx, instance.entityId, outcome, note);
  }

  private async decideWith(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
    outcome: 'approved' | 'rejected',
    note?: string,
  ) {
    const r = await this.findRequest(c, id);
    if (r.status !== 'pending')
      throw new DomainError('misc.decided', 'This request has already been decided', {
        status: 409,
      });
    const result = outcome === 'approved' ? await this.apply(c, r) : {};
    if (outcome === 'rejected' && r.kind === 'announce')
      await c.query(`UPDATE misc_fees SET status = 'rejected', updated_at = now() WHERE id = $1`, [
        r.miscFeeId,
      ]);
    await c.query(
      `UPDATE misc_fee_requests SET status = $2, decided_by = app.current_user_id(), decided_at = now(), decision_note = $3, result = $4::jsonb,
              voucher_no = COALESCE($5, voucher_no) WHERE id = $1`,
      [
        id,
        outcome,
        note ?? null,
        JSON.stringify(result),
        (result as { voucherNo?: string }).voucherNo ?? null,
      ],
    );
    await this.audit.stage(ctx, c, {
      action: outcome === 'approved' ? 'fees.misc.approve' : 'fees.misc.reject',
      entityType: 'misc_fee_requests',
      entityId: id,
      after: { kind: r.kind, outcome, note, result },
    });
  }

  /** What an approved request does. */
  private async apply(
    c: PoolClient,
    r: Awaited<ReturnType<MiscFeesService['findRequest']>>,
  ): Promise<Record<string, unknown>> {
    const p = r.payload;
    if (r.kind === 'announce') {
      await c.query(
        `UPDATE misc_fees SET status = 'announced', announced_at = now(), updated_at = now() WHERE id = $1 AND status = 'pending'`,
        [r.miscFeeId],
      );
      return { announced: true };
    }
    if (r.kind === 'extend') {
      await c.query(`UPDATE misc_fees SET last_date = $2::date, updated_at = now() WHERE id = $1`, [
        r.miscFeeId,
        p.lastDate,
      ]);
      // a pupil whose own last date is earlier moves with the fee; one given a later date keeps it
      const moved = await c.query(
        `UPDATE misc_fee_students SET last_date = NULL, updated_at = now() WHERE misc_fee_id = $1 AND last_date IS NOT NULL AND last_date <= $2::date`,
        [r.miscFeeId, p.lastDate],
      );
      return { lastDate: p.lastDate, pupilsMoved: moved.rowCount ?? 0 };
    }
    if (r.kind === 'close') {
      await c.query(`UPDATE misc_fees SET status = 'closed', updated_at = now() WHERE id = $1`, [
        r.miscFeeId,
      ]);
      return { closed: true };
    }
    if (r.kind === 'pupil_change') {
      await c.query(
        `UPDATE misc_fee_students SET amount = COALESCE($2::numeric, amount), last_date = COALESCE($3::date, last_date),
                status = CASE WHEN paid >= COALESCE($2::numeric, amount) AND COALESCE($2::numeric, amount) > 0 THEN 'paid' ELSE 'open' END, updated_at = now()
          WHERE id = $1`,
        [r.lineId, p.amount ?? null, p.lastDate ?? null],
      );
      return { amount: p.amount ?? null, lastDate: p.lastDate ?? null };
    }
    if (r.kind === 'add_pupils') {
      const n = await this.addLines(c, r.miscFeeId!, (p.pupils as Pupil[]) ?? []);
      return { added: n };
    }
    // a receipt taken back: the pupil's fee is unpaid again by what goes, and a seat held by it is free
    const m = await c.query<{
      amount: string;
      refunded: string;
      status: string;
      receipt_no: string;
      student: string | null;
      year: string;
    }>(
      `SELECT amount::text, refunded::text, status, receipt_no, student_id::text AS student, academic_year_id::text AS year
         FROM misc_receipts WHERE id = $1 FOR UPDATE`,
      [r.receiptId],
    );
    const rec = m.rows[0]!;
    if (rec.status !== 'posted')
      throw new DomainError('misc.receipt_closed', 'This receipt is already cancelled or bounced', {
        status: 409,
      });
    const left = Number(rec.amount) - Number(rec.refunded);
    const back = r.kind === 'receipt_refund' ? Number(p.amount) : left;
    if (back > left + 0.005)
      throw new DomainError(
        'misc.refund_exceeds',
        `Only Rs. ${left.toFixed(2)} of this receipt is left`,
        {
          status: 409,
        },
      );
    let voucherNo: string | undefined;
    if (r.kind === 'receipt_refund') {
      await c.query(`UPDATE misc_receipts SET refunded = refunded + $2 WHERE id = $1`, [
        r.receiptId,
        back.toFixed(2),
      ]);
      voucherNo = (await c.query<{ v: string }>(`SELECT app.next_refund_voucher_no() AS v`))
        .rows[0]!.v;
    } else
      await c.query(
        `UPDATE misc_receipts SET status = $2, reversed_at = now(), reversal_reason = $3 WHERE id = $1`,
        [r.receiptId, r.kind === 'receipt_bounce' ? 'bounced' : 'reversed', r.reason],
      );
    if (r.lineId)
      await c.query(
        `UPDATE misc_fee_students SET paid = GREATEST(paid - $2, 0), status = 'open',
                paid_at = CASE WHEN GREATEST(paid - $2, 0) = 0 THEN NULL ELSE paid_at END, updated_at = now()
          WHERE id = $1 AND status <> 'cancelled'`,
        [r.lineId, back.toFixed(2)],
      );
    // a bounced cheque raises the bounce charge on the pupil, as a misc fee due at once
    let chargeFeeId: string | undefined;
    const charge = Number(p.charge ?? 0);
    if (r.kind === 'receipt_bounce' && charge > 0 && rec.student)
      chargeFeeId = await this.raiseBounceCharge(c, {
        receiptNo: rec.receipt_no,
        studentId: rec.student,
        yearId: rec.year,
        charge,
        reason: r.reason,
      });
    return {
      back: back.toFixed(2),
      ...(voucherNo ? { voucherNo } : {}),
      ...(chargeFeeId ? { charge: charge.toFixed(2), chargeFeeId } : {}),
    };
  }

  // ---- collection at the counter --------------------------------------------------------------------
  /**
   * Misc fees of a pupil received at the counter: one receipt for each fee paid. A fee with seats is
   * paid in full and takes a seat in the order of payment; a fee that is not mandatory cannot be paid
   * after its last date.
   */
  async collect(ctx: RequestContext, dto: CollectMiscFeeDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      if (['cheque', 'dd'].includes(dto.mode) && !dto.instrumentNo)
        throw new DomainError('fees.instrument_required', 'A cheque or draft needs its number', {
          status: 400,
        });
      await this.setup.assertModeFields(c, { ...dto, ledger: 'misc' } as never);
      const out = await this.collectIn(c, yearId, dto);
      await this.audit.stage(ctx, c, {
        action: 'fees.misc.collect',
        entityType: 'misc_receipts',
        entityId: out.receipts[0]!.id,
        after: { studentId: dto.studentId, mode: dto.mode, receipts: out.receipts },
      });
      return out;
    });
  }

  /**
   * An online payment of a misc fee went through (purpose misc, entity misc_fee_student): the MF receipt is
   * written as at the counter, mode online, with the gateway reference and the convenience charge apart. A
   * limited-seat fee paid online books the seat; it was free when the payment started, so a seat taken in
   * between is still given (the money is in) and logged for the office.
   */
  async onlinePaid(
    c: PoolClient,
    intent: {
      entityId: string | null;
      amount: string;
      charge: string;
      providerRef: string | null;
      id: string;
    },
  ) {
    if (!intent.entityId) return;
    const line = await c.query<{ student_id: string; year: string }>(
      `SELECT l.student_id::text, f.academic_year_id::text AS year FROM misc_fee_students l JOIN misc_fees f ON f.id = l.misc_fee_id WHERE l.id = $1`,
      [intent.entityId],
    );
    if (!line.rows[0]) return;
    const fee = Number(intent.amount) - Number(intent.charge);
    const out = await this.collectIn(
      c,
      line.rows[0].year,
      {
        studentId: line.rows[0].student_id,
        lines: [{ lineId: intent.entityId, amount: fee }],
        mode: 'online' as never,
        reference: intent.providerRef ?? undefined,
      },
      { online: true },
    );
    await c.query(`UPDATE misc_receipts SET convenience_charge = $2 WHERE id = $1`, [
      out.receipts[0]!.id,
      intent.charge,
    ]);
  }

  /** The counter's collection, inside the caller's transaction (also the online success). */
  private async collectIn(
    c: PoolClient,
    yearId: string,
    dto: Omit<CollectMiscFeeDto, 'mode'> & { mode: string },
    opts: { online?: boolean } = {},
  ) {
    {
      const on = dto.receivedOn ?? today();
      const fy = await c.query<{ fy: string | null }>(
        `SELECT app.financial_year_for($1::date)::text AS fy`,
        [on],
      );
      if (!fy.rows[0]?.fy)
        throw new DomainError(
          'fees.no_financial_year',
          'No financial year covers the receipt date; create it under System → Years',
          { status: 409 },
        );
      await assertPeriodOpen(c, 'misc', on);
      const payer = await c.query<{ name: string; mobile: string | null }>(
        `SELECT s.display_name AS name, (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1) AS mobile
           FROM students s WHERE s.id = $1 AND s.deleted_at IS NULL`,
        [dto.studentId],
      );
      if (!payer.rows[0]) throw new DomainError('not-found', 'Student not found', { status: 404 });
      const receipts: Array<{ id: string; receiptNo: string; title: string; amount: string }> = [];
      for (const want of dto.lines) {
        const l = await c.query<{
          fee_id: string;
          title: string;
          head_id: string;
          mandatory: boolean;
          seats: number | null;
          fee_status: string;
          amount: string;
          paid: string;
          last: string;
          status: string;
        }>(
          `SELECT f.id::text AS fee_id, f.title, f.head_id::text, f.mandatory, f.seats, f.status AS fee_status, l.amount::text, l.paid::text,
                  COALESCE(l.last_date, f.last_date)::text AS last, l.status
             FROM misc_fee_students l JOIN misc_fees f ON f.id = l.misc_fee_id
            WHERE l.id = $1 AND l.student_id = $2 FOR UPDATE OF l`,
          [want.lineId, dto.studentId],
        );
        const line = l.rows[0];
        if (!line)
          throw new DomainError('not-found', 'This fee is not on the pupil', { status: 404 });
        const balance = Number(line.amount) - Number(line.paid);
        if (line.fee_status !== 'announced' || line.status === 'cancelled')
          throw new DomainError('misc.closed', `${line.title} is not open for collection`, {
            status: 409,
          });
        if (!line.mandatory && line.last < on)
          throw new DomainError(
            'misc.closed',
            `${line.title} closed on ${dmy(line.last)}; the last date has to be extended first`,
            { status: 409 },
          );
        if (want.amount > balance + 0.005)
          throw new DomainError(
            'misc.exceeds',
            `Only Rs. ${balance.toFixed(2)} is left to pay on ${line.title}`,
            { status: 409 },
          );
        if (line.seats !== null) {
          // one at a time for the fee: the seats are counted while nobody else can take one
          await c.query(`SELECT 1 FROM misc_fees WHERE id = $1 FOR UPDATE`, [line.fee_id]);
          if (Math.abs(want.amount - balance) > 0.005)
            throw new DomainError(
              'misc.seat_full_amount',
              `${line.title} has limited seats: it is paid in full (Rs. ${balance.toFixed(2)}) to take one`,
              { status: 409 },
            );
          const taken = await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM misc_fee_students WHERE misc_fee_id = $1 AND status = 'paid'`,
            [line.fee_id],
          );
          if (taken.rows[0]!.n >= line.seats && opts.online)
            this.log.warn(`misc fee ${line.fee_id}: a seat paid online after all seats were taken`);
          else if (taken.rows[0]!.n >= line.seats)
            throw new DomainError(
              'misc.full',
              `All ${String(line.seats)} seats of ${line.title} are taken`,
              {
                status: 409,
              },
            );
        }
        const r = await c.query<{ id: string; receipt_no: string }>(
          `INSERT INTO misc_receipts (school_id, academic_year_id, financial_year_id, receipt_no, payer_kind, student_id, payer_name, payer_mobile, head_id, amount,
                                      received_on, mode, reference, instrument_no, bank_name, remarks, received_by, request_id, misc_fee_student_id)
           VALUES (app.current_school_id(), $1, $2, app.next_receipt_no('misc', $2), 'student', $3, $4, $5, $6, $7, $8::date, $9, $10, $11, $12, $13,
                   app.current_user_id(), app.current_request_id(), $14)
           RETURNING id::text, receipt_no`,
          [
            yearId,
            fy.rows[0].fy,
            dto.studentId,
            payer.rows[0].name,
            payer.rows[0].mobile,
            line.head_id,
            want.amount.toFixed(2),
            on,
            dto.mode,
            dto.reference ?? null,
            dto.instrumentNo ?? null,
            dto.bankName ?? null,
            dto.remarks ?? line.title,
            want.lineId,
          ],
        );
        await c.query(
          `UPDATE misc_fee_students SET paid = paid + $2,
                  status = CASE WHEN paid + $2 >= amount THEN 'paid' ELSE 'open' END,
                  paid_at = CASE WHEN paid + $2 >= amount THEN now() ELSE paid_at END, updated_at = now()
            WHERE id = $1`,
          [want.lineId, want.amount.toFixed(2)],
        );
        receipts.push({
          id: r.rows[0]!.id,
          receiptNo: r.rows[0]!.receipt_no,
          title: line.title,
          amount: want.amount.toFixed(2),
        });
      }
      return { receipts, total: receipts.reduce((a, x) => a + Number(x.amount), 0).toFixed(2) };
    }
  }
}
