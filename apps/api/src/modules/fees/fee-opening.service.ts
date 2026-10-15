import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { WAITING_WITH, startFeeApproval } from './fee-approval';

const HEADERS = ['Admission no.', 'Amount', 'Dr / Cr', 'Student name', 'Class'];
/** The approval an opening balance file rides; its levels mirror the fee change approval. */
export const FEE_OPENING_FLOW = 'fee_opening';

export interface OpeningRow {
  row: number;
  admissionNo: string;
  studentId: string | null;
  name: string | null;
  section: string | null;
  /** The opening balance the pupil has now. */
  before: string | null;
  /** What it becomes: plus = dues (Dr), minus = advance (Cr). */
  opening: string | null;
  error: string | null;
}
export type OpeningLedger = 'school' | 'hostel';
/** The fee profile column a file writes: the regular opening balance, or the hostel one. */
const COLUMN: Record<OpeningLedger, string> = {
  school: 'opening_balance',
  hostel: 'opening_hostel',
};
const FEE: Record<OpeningLedger, string> = { school: 'Regular fee', hostel: 'Hostel fee' };

export interface OpeningUpload {
  id: string;
  /** school = regular fee, hostel = hostel fee (0140) */
  ledger: OpeningLedger;
  fileName: string | null;
  rows: OpeningRow[];
  totalRows: number;
  goodRows: number;
  totalDr: string;
  totalCr: string;
  status: 'draft' | 'pending' | 'applied' | 'rejected' | 'cancelled';
  reason: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  workflowInstanceId: string | null;
  waitingWith: string | null;
  result: {
    applied: number;
    billsRebuilt: number;
    notRebuilt: Array<{ admissionNo: string; why: string }>;
  } | null;
}

// eslint-disable-next-line no-restricted-syntax -- WAITING_WITH is a fixed SQL fragment over a column name written here
const SELECT = `SELECT u.id::text, u.ledger::text AS ledger, u.file_name AS "fileName", u.rows, u.total_rows AS "totalRows", u.good_rows AS "goodRows", u.total_dr::text AS "totalDr", u.total_cr::text AS "totalCr",
        u.status, u.reason, uu.display_name AS "uploadedBy", u.uploaded_at::text AS "uploadedAt", du.display_name AS "decidedBy", u.decided_at::text AS "decidedAt",
        u.decision_note AS "decisionNote", u.workflow_instance_id::text AS "workflowInstanceId", ${WAITING_WITH('u.workflow_instance_id')} AS "waitingWith", u.result
   FROM fee_opening_uploads u LEFT JOIN users uu ON uu.id = u.uploaded_by LEFT JOIN users du ON du.id = u.decided_by`;

/**
 * Opening balances from Excel (0121): the format (optionally with a class's pupils filled in), the
 * check of an uploaded file, its approval through the fee levels, and the write to the fee profiles
 * with the bills made again. A plus figure is dues (Dr), a minus one is advance (Cr).
 */
@Injectable()
export class FeeOpeningService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
  ) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  private async find(c: PoolClient, id: string): Promise<OpeningUpload> {
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the id is a bound parameter
    const r = await c.query<OpeningUpload>(`${SELECT} WHERE u.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'File not found', { status: 404 });
    return r.rows[0];
  }

  /** The sheet to fill; with a class, its pupils and their present opening balance are filled in. */
  async format(ctx: RequestContext, classId?: string, ledger: OpeningLedger = 'school') {
    const yearId = this.year(ctx);
    const col = COLUMN[ledger];
    const rows = classId
      ? await this.db.tenant(requireTenant(ctx), async (c) => {
          const r = await c.query<{
            admission_no: string;
            name: string;
            section: string;
            opening: string | null;
          }>(
            // eslint-disable-next-line no-restricted-syntax -- col is one of two fixed column names; values are bound
            `SELECT s.admission_no, s.display_name AS name, k.code || '-' || cs.name AS section, p.${col}::text AS opening
               FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
               JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
               LEFT JOIN student_fee_profiles p ON p.student_id = s.id AND p.academic_year_id = e.academic_year_id
              WHERE e.academic_year_id = $1 AND e.status = 'active' AND cs.class_id = $2
                -- the hostel format lists the hostellers, and anyone who already has a hostel figure
                AND ($3::text = 'school' OR COALESCE(p.hosteller, false) OR COALESCE(p.opening_hostel, 0) <> 0)
              ORDER BY cs.name, e.roll_no NULLS LAST, s.display_name`,
            [yearId, classId, ledger],
          );
          return r.rows.map((x) => {
            const v = Number(x.opening ?? 0);
            return [
              x.admission_no,
              v !== 0 ? Math.abs(v) : null,
              v > 0 ? 'Dr' : v < 0 ? 'Cr' : null,
              x.name,
              x.section,
            ];
          });
        })
      : [];
    return {
      filename:
        ledger === 'hostel' ? 'hostel-opening-balance-format.xlsx' : 'opening-balance-format.xlsx',
      bytes: await templateSheet({
        sheet: ledger === 'hostel' ? 'Hostel opening balance' : 'Opening balance',
        columns: [
          { header: HEADERS[0]!, width: 18, required: true },
          { header: HEADERS[1]!, width: 16 },
          { header: HEADERS[2]!, width: 10, options: ['Dr', 'Cr'] },
          { header: HEADERS[3]!, width: 28 },
          { header: HEADERS[4]!, width: 12 },
        ],
        guide: [
          ledger === 'hostel'
            ? 'HOSTEL FEE: these figures are the hostel dues or advance, billed on the hostel fee (not the school fee).'
            : 'REGULAR (SCHOOL) FEE: these figures are the school dues or advance (the hostel fee has its own file).',
          'One pupil in each row: the admission number, the amount, and Dr or Cr. Name and class are only for your reading and may be left out.',
          'Dr (debit): dues, what the pupil owes from before this session. Cr (credit): advance, what the pupil paid before.',
          'Write the amount without a minus sign and choose Dr or Cr. Amount empty or 0 means no opening balance.',
          'The file is checked and shown first. Nothing changes until it is approved (Fee setup → Approval levels).',
          'After approval the opening balance is written to each pupil and the bill of the pupil is made again.',
        ],
        rows,
      }),
    };
  }

  async list(ctx: RequestContext, ledger?: OpeningLedger): Promise<OpeningUpload[]> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<OpeningUpload>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the year and fee type are bound parameters
        `${SELECT} WHERE u.academic_year_id = $1 AND ($2::text IS NULL OR u.ledger::text = $2) ORDER BY u.id DESC LIMIT 50`,
        [yearId, ledger ?? null],
      );
      // the list does not need every row of every file
      return r.rows.map((u) => ({ ...u, rows: [] }));
    });
  }

  async get(ctx: RequestContext, id: string): Promise<OpeningUpload> {
    return this.db.tenant(requireTenant(ctx), (c) => this.find(c, id));
  }

  /** Reads and checks the file; it is kept as a draft with the reason beside every row that fails. */
  async upload(
    ctx: RequestContext,
    fileBase64: string,
    fileName?: string,
    ledger: OpeningLedger = 'school',
  ): Promise<OpeningUpload> {
    const yearId = this.year(ctx);
    const col = COLUMN[ledger];
    const sheet = await readSheet(fileBase64, [HEADERS[0]!, HEADERS[1]!, HEADERS[2]!]);
    if (sheet.length === 0)
      throw new DomainError('validation-failed', 'The file has no rows', { status: 400 });
    if (sheet.length > 5000)
      throw new DomainError('validation-failed', 'At most 5,000 rows in one file', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      const nos = sheet.map((r) => (r.cells[HEADERS[0]!] ?? '').trim()).filter(Boolean);
      const found = await c.query<{
        admission_no: string;
        id: string;
        name: string;
        section: string | null;
        opening: string | null;
        status: string;
        hosteller: boolean;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- col is one of two fixed column names; values are bound
        `SELECT s.admission_no, s.id::text, s.display_name AS name, s.status::text,
                COALESCE((SELECT p.hosteller FROM student_fee_profiles p WHERE p.student_id = s.id AND p.academic_year_id = $2), false) AS hosteller,
                (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                  WHERE e.student_id = s.id AND e.academic_year_id = $2 AND e.status = 'active' ORDER BY e.id DESC LIMIT 1) AS section,
                (SELECT p.${col}::text FROM student_fee_profiles p WHERE p.student_id = s.id AND p.academic_year_id = $2) AS opening
           FROM students s WHERE s.deleted_at IS NULL AND lower(s.admission_no) = ANY($1::text[])`,
        [nos.map((n) => n.toLowerCase()), yearId],
      );
      const byNo = new Map(found.rows.map((s) => [s.admission_no.toLowerCase(), s]));
      const seen = new Set<string>();
      const num = (v: string | undefined) => {
        const t = (v ?? '').replace(/[,\s₹]/g, '');
        if (t === '') return 0;
        const n = Number(t);
        return Number.isFinite(n) ? n : NaN;
      };
      const rows: OpeningRow[] = [];
      for (const r of sheet) {
        const admissionNo = (r.cells[HEADERS[0]!] ?? '').trim();
        const amount = num(r.cells[HEADERS[1]!]);
        const side = (r.cells[HEADERS[2]!] ?? '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z]/g, '');
        if (!admissionNo && amount === 0 && side === '') continue;
        const isDr = ['dr', 'debit', 'due', 'dues'].includes(side);
        const isCr = ['cr', 'credit', 'advance'].includes(side);
        const s = byNo.get(admissionNo.toLowerCase());
        const error = !admissionNo
          ? 'Admission number is missing'
          : !s
            ? 'No pupil with this admission number'
            : seen.has(admissionNo.toLowerCase())
              ? 'The pupil is in the file twice'
              : s.status !== 'active' || !s.section
                ? 'The pupil is not active in a class this session'
                : Number.isNaN(amount)
                  ? 'The amount is not a number'
                  : amount < 0
                    ? 'Write the amount without a minus sign and choose Dr or Cr'
                    : amount > 0 && !isDr && !isCr
                      ? 'Choose Dr (dues) or Cr (advance)'
                      : // an advance on hostel fee belongs to a hosteller; old hostel dues may stay with a pupil who left
                        ledger === 'hostel' && isCr && amount > 0 && !s.hosteller
                        ? 'Hostel advance for a pupil who is not a hosteller this session'
                        : null;
        seen.add(admissionNo.toLowerCase());
        rows.push({
          row: r.row,
          admissionNo,
          studentId: s?.id ?? null,
          name: s?.name ?? null,
          section: s?.section ?? null,
          before: s ? Number(s.opening ?? 0).toFixed(2) : null,
          opening: error ? null : (isCr ? -amount : amount).toFixed(2),
          error,
        });
      }
      if (rows.length === 0)
        throw new DomainError('validation-failed', 'The file has no filled rows', { status: 400 });
      const good = rows.filter((r) => !r.error);
      const sum = (f: (v: number) => number) =>
        good.reduce((a, r) => a + f(Number(r.opening)), 0).toFixed(2);
      const ins = await c.query<{ id: string }>(
        `INSERT INTO fee_opening_uploads (school_id, academic_year_id, file_name, rows, total_rows, good_rows, total_dr, total_cr, uploaded_by, ledger)
         VALUES (app.current_school_id(), $1, $2, $3::jsonb, $4, $5, $6, $7, app.current_user_id(), $8::ledger_type) RETURNING id::text`,
        [
          yearId,
          fileName ?? null,
          JSON.stringify(rows),
          rows.length,
          good.length,
          sum((v) => Math.max(v, 0)),
          sum((v) => Math.max(-v, 0)),
          ledger,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'fees.opening_upload.upload',
        entityType: 'fee_opening_uploads',
        entityId: ins.rows[0]!.id,
        after: { fileName, ledger, rows: rows.length, good: good.length },
      });
      return this.find(c, ins.rows[0]!.id);
    });
  }

  /** The uploader sends the checked file for approval (its good rows), or drops it. */
  async submit(
    ctx: RequestContext,
    id: string,
    dto: { action: 'submit' | 'cancel'; reason?: string },
  ): Promise<OpeningUpload> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const u = await this.find(c, id);
      if (u.status !== 'draft')
        throw new DomainError(
          'fees.upload_not_draft',
          'This file has already been sent or closed',
          {
            status: 409,
          },
        );
      if (dto.action === 'cancel') {
        await c.query(`UPDATE fee_opening_uploads SET status = 'cancelled' WHERE id = $1`, [id]);
        return this.find(c, id);
      }
      if (u.goodRows === 0)
        throw new DomainError('fees.upload_empty', 'No row of this file can be applied', {
          status: 409,
        });
      if (!dto.reason || dto.reason.trim().length < 3)
        throw new DomainError('validation-failed', 'Give the reason for these opening balances', {
          status: 422,
        });
      await c.query(
        `UPDATE fee_opening_uploads SET status = 'pending', reason = $2 WHERE id = $1`,
        [id, dto.reason.trim()],
      );
      const instanceId = await startFeeApproval(
        this.workflow,
        c,
        ctx,
        { code: FEE_OPENING_FLOW, name: 'Opening balances from Excel' },
        id,
        `Opening balances (${FEE[u.ledger]}): ${String(u.goodRows)} pupils, dues Rs. ${u.totalDr}, advance Rs. ${u.totalCr}`,
        { fileName: u.fileName, reason: dto.reason, ledger: u.ledger },
      );
      if (instanceId)
        await c.query(`UPDATE fee_opening_uploads SET workflow_instance_id = $2 WHERE id = $1`, [
          id,
          instanceId,
        ]);
      await this.audit.stage(ctx, c, {
        action: 'fees.opening_upload.submit',
        entityType: 'fee_opening_uploads',
        entityId: id,
        after: { reason: dto.reason, rows: u.goodRows },
      });
      return this.find(c, id);
    });
  }

  /** Writes the good rows to the fee profiles and makes each pupil's bill again. */
  private async decideWith(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
    dto: { outcome: 'approved' | 'rejected'; note?: string },
  ): Promise<void> {
    const u = await this.find(c, id);
    if (u.status !== 'pending')
      throw new DomainError('fees.upload_decided', 'This file has already been decided', {
        status: 409,
      });
    let result: OpeningUpload['result'] = null;
    if (dto.outcome === 'approved') {
      const yearId = (
        await c.query<{ y: string }>(
          `SELECT academic_year_id::text AS y FROM fee_opening_uploads WHERE id = $1`,
          [id],
        )
      ).rows[0]!.y;
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      result = { applied: 0, billsRebuilt: 0, notRebuilt: [] };
      const col = COLUMN[u.ledger];
      // the bill puts a hostel opening balance on the hostel ledger under a hostel opening head
      if (u.ledger === 'hostel')
        await c.query(
          `INSERT INTO fee_heads (school_id, code, name, kind, ledger, sort_order, created_by, updated_by)
           SELECT app.current_school_id(), 'PREVDUEH', 'Previous dues (hostel)', 'opening_balance', 'hostel', 0, app.current_user_id(), app.current_user_id()
            WHERE NOT EXISTS (SELECT 1 FROM fee_heads WHERE kind = 'opening_balance' AND ledger = 'hostel' AND deleted_at IS NULL)`,
        );
      for (const r of u.rows.filter((x) => !x.error && x.studentId)) {
        await c.query(
          // eslint-disable-next-line no-restricted-syntax -- col is one of two fixed column names; values are bound
          `INSERT INTO student_fee_profiles (school_id, student_id, academic_year_id, fee_group, student_type, ${col}, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, 'general', 'old', $3, app.current_user_id(), app.current_user_id())
           ON CONFLICT (student_id, academic_year_id) DO UPDATE SET ${col} = EXCLUDED.${col}, updated_at = now(), updated_by = app.current_user_id()`,
          [r.studentId, yearId, r.opening],
        );
        result.applied += 1;
        // the bill carries the figure only when it is made again; a pupil whose bill cannot be made keeps the profile
        await c.query('SAVEPOINT opening_row');
        try {
          await c.query(`SELECT app.generate_fee_demand($1, $2)`, [r.studentId, yearId]);
          await c.query('RELEASE SAVEPOINT opening_row');
          result.billsRebuilt += 1;
        } catch (error) {
          await c.query('ROLLBACK TO SAVEPOINT opening_row');
          result.notRebuilt.push({
            admissionNo: r.admissionNo,
            why: (error as { message?: string }).message ?? 'the bill could not be made',
          });
        }
      }
    }
    await c.query(
      `UPDATE fee_opening_uploads SET status = $2, decided_by = app.current_user_id(), decided_at = now(), decision_note = $3, result = $4::jsonb WHERE id = $1`,
      [
        id,
        dto.outcome === 'approved' ? 'applied' : 'rejected',
        dto.note ?? null,
        JSON.stringify(result),
      ],
    );
    await this.audit.stage(ctx, c, {
      action: `fees.opening_upload.${dto.outcome}`,
      entityType: 'fee_opening_uploads',
      entityId: id,
      after: { note: dto.note, ledger: u.ledger, ...(result ? { applied: result.applied } : {}) },
    });
  }

  /** Decided on the page only when the school has no fee approval levels in force. */
  async decide(
    ctx: RequestContext,
    id: string,
    dto: { outcome: 'approved' | 'rejected'; note?: string },
  ): Promise<OpeningUpload> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const u = await this.find(c, id);
      if (u.status === 'pending' && u.workflowInstanceId)
        throw new DomainError(
          'fees.upload_in_workflow',
          'This file goes through the approval levels: approve it from My approvals',
          { status: 409 },
        );
      await this.decideWith(c, ctx, id, dto);
      return this.find(c, id);
    });
  }

  async onWorkflowComplete(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const note = instance.steps.find((s) => s.status === outcome)?.note ?? undefined;
    await this.decideWith(c, ctx, instance.entityId, { outcome, note });
  }
}
