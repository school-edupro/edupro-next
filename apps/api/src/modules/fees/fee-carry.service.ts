import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { RunCarryForwardDto } from './fees.dto';

export interface CarryRow {
  studentId: string;
  name: string;
  admissionNo: string;
  section: string | null;
  dueSchool: string;
  dueHostel: string;
  lateFee: string;
  advance: string;
  /** What the new year opens with: dues and late fine less the advance. */
  net: string;
  /** Has a class in the new year; a pupil who left is not carried. */
  enrolled: boolean;
  carried: boolean;
}
export interface CarryPreview {
  from: { id: string; name: string };
  to: { id: string; name: string };
  asOf: string;
  ready: boolean;
  /** Why the run is not possible yet (no fee calendar in the new year, a locked year). */
  blocked: string | null;
  rows: CarryRow[];
  totals: { students: number; due: string; late: string; advance: string; pending: number };
  runs: Array<{
    id: string;
    ranAt: string;
    ranBy: string | null;
    students: number;
    due: string;
    late: string;
    advance: string;
  }>;
}

const HEADS = {
  school: ['PREVDUE', 'Previous dues', 'opening_balance', 'school'],
  hostel: ['PREVDUEH', 'Previous dues (hostel)', 'opening_balance', 'hostel'],
  late: ['PREVLATE', 'Previous late fine', 'late_fee', 'school'],
} as const;

/**
 * Year-end carry-forward (0099): the closing year's unpaid fee, unpaid late fine and advance open the
 * new year as Previous dues, Previous late fine and Advance. The accountant previews, then confirms.
 */
@Injectable()
export class FeeCarryService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** The closing year: the one named, else the working year. */
  private fromYear(ctx: RequestContext, named?: string): string {
    const y = named ?? requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  private async years(c: PoolClient, fromId: string, toId: string) {
    if (fromId === toId)
      throw new DomainError('fees.carry_same_year', 'Choose the new year, not the closing one', {
        status: 422,
      });
    const r = await c.query<{ id: string; name: string; start_date: string }>(
      `SELECT id::text, name, start_date::text FROM academic_years WHERE id = ANY($1::bigint[])`,
      [[fromId, toId]],
    );
    const from = r.rows.find((y) => y.id === fromId);
    const to = r.rows.find((y) => y.id === toId);
    if (!from || !to)
      throw new DomainError('not-found', 'Academic year not found', { status: 404 });
    if (to.start_date <= from.start_date)
      throw new DomainError(
        'fees.carry_backwards',
        'The new year must start after the closing year',
        {
          status: 422,
        },
      );
    return { from, to };
  }

  private async rows(c: PoolClient, fromId: string, toId: string): Promise<CarryRow[]> {
    const r = await c.query<CarryRow>(
      `SELECT p.student_id::text AS "studentId", s.display_name AS name, s.admission_no AS "admissionNo",
              (SELECT k.name || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                WHERE e.student_id = p.student_id AND e.academic_year_id = $1 ORDER BY e.id DESC LIMIT 1) AS section,
              p.due_school::numeric(14,2)::text AS "dueSchool", p.due_hostel::numeric(14,2)::text AS "dueHostel", p.late_fee::numeric(14,2)::text AS "lateFee", p.advance::numeric(14,2)::text AS advance,
              (p.due_school + p.due_hostel + p.late_fee - p.advance)::numeric(14,2)::text AS net, p.enrolled, p.carried
         FROM (
           SELECT v.student_id, v.due_school, v.due_hostel, v.late_fee, v.advance, v.enrolled, false AS carried
             FROM app.fee_carry_preview($1, $2) v
            WHERE NOT v.carried AND (v.due_school <> 0 OR v.due_hostel <> 0 OR v.late_fee <> 0 OR v.advance <> 0)
           UNION ALL
           -- already carried: what went across, as recorded
           SELECT f.student_id, f.due_school, f.due_hostel, f.late_fee, f.advance, true, true
             FROM fee_carry_forwards f WHERE f.from_year_id = $1 AND f.to_year_id = $2 AND f.undone_at IS NULL
         ) p JOIN students s ON s.id = p.student_id
        ORDER BY section NULLS LAST, s.display_name`,
      [fromId, toId],
    );
    return r.rows;
  }

  private async blocked(c: PoolClient, toId: string): Promise<string | null> {
    const p = await c.query(`SELECT 1 FROM fee_periods WHERE academic_year_id = $1 LIMIT 1`, [
      toId,
    ]);
    if (p.rowCount === 0)
      return 'The new year has no fee calendar yet. Switch to the new year and create the fee periods first.';
    // the closing year may already be locked: carrying its balance is the closing step itself
    try {
      await c.query('SAVEPOINT carry_check');
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [toId]);
      await c.query('RELEASE SAVEPOINT carry_check');
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT carry_check');
      return 'Fees of the new year are locked; reopen the fees stage first.';
    }
    return null;
  }

  async preview(ctx: RequestContext, toYearId: string, fromYearId?: string): Promise<CarryPreview> {
    const fromId = this.fromYear(ctx, fromYearId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { from, to } = await this.years(c, fromId, toYearId);
      const rows = await this.rows(c, fromId, toYearId);
      const blocked = await this.blocked(c, toYearId);
      const open = rows.filter((r) => r.enrolled && !r.carried);
      const sum = (k: 'dueSchool' | 'dueHostel' | 'lateFee' | 'advance') =>
        open.reduce((a, r) => a + Number(r[k]), 0);
      const runs = await c.query<CarryPreview['runs'][number]>(
        `SELECT r.id::text, r.ran_at::text AS "ranAt", u.display_name AS "ranBy", r.students, r.total_due::text AS due, r.total_late::text AS late, r.total_advance::text AS advance
           FROM fee_carry_runs r LEFT JOIN users u ON u.id = r.ran_by
          WHERE r.from_year_id = $1 AND r.to_year_id = $2 ORDER BY r.id DESC LIMIT 20`,
        [fromId, toYearId],
      );
      const today = await c.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`);
      return {
        from: { id: from.id, name: from.name },
        to: { id: to.id, name: to.name },
        asOf: today.rows[0]!.d,
        ready: blocked === null,
        blocked,
        rows,
        totals: {
          students: open.length,
          due: (sum('dueSchool') + sum('dueHostel')).toFixed(2),
          late: sum('lateFee').toFixed(2),
          advance: sum('advance').toFixed(2),
          pending: rows.filter((r) => !r.enrolled && !r.carried).length,
        },
        runs: runs.rows,
      };
    });
  }

  private async head(c: PoolClient, which: keyof typeof HEADS): Promise<void> {
    const [code, name, kind, ledger] = HEADS[which];
    const has =
      which === 'late'
        ? await c.query(`SELECT 1 FROM fee_heads WHERE code = $1 AND deleted_at IS NULL`, [code])
        : await c.query(
            `SELECT 1 FROM fee_heads WHERE kind = 'opening_balance' AND ledger = $1::ledger_type AND deleted_at IS NULL`,
            [ledger],
          );
    if (has.rowCount) return;
    await c.query(
      `INSERT INTO fee_heads (school_id, code, name, kind, ledger, sort_order, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2, $3::fee_head_kind, $4::ledger_type, 0, app.current_user_id(), app.current_user_id())`,
      [code, name, kind, ledger],
    );
  }

  /** Carries the chosen pupils (or every pupil that can be carried) and rebuilds their new-year bill. */
  async run(
    ctx: RequestContext,
    dto: RunCarryForwardDto,
  ): Promise<{ runId: string; students: number }> {
    const fromId = this.fromYear(ctx, dto.fromYearId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.years(c, fromId, dto.toYearId);
      const blocked = await this.blocked(c, dto.toYearId);
      if (blocked) throw new DomainError('fees.carry_blocked', blocked, { status: 409 });
      const all = (await this.rows(c, fromId, dto.toYearId)).filter(
        (r) => r.enrolled && !r.carried,
      );
      const chosen = dto.studentIds
        ? all.filter((r) => dto.studentIds!.includes(r.studentId))
        : all;
      if (chosen.length === 0)
        throw new DomainError('fees.carry_nothing', 'There is nobody to carry forward', {
          status: 409,
        });
      await this.head(c, 'school');
      await this.head(c, 'late');
      if (chosen.some((r) => Number(r.dueHostel) !== 0)) await this.head(c, 'hostel');
      const run = await c.query<{ id: string }>(
        `INSERT INTO fee_carry_runs (school_id, from_year_id, to_year_id, ran_by) VALUES (app.current_school_id(), $1, $2, app.current_user_id()) RETURNING id::text`,
        [fromId, dto.toYearId],
      );
      const runId = run.rows[0]!.id;
      let due = 0;
      let late = 0;
      let advance = 0;
      for (const r of chosen) {
        const marked = await c.query<{ id: string }>(
          `UPDATE fee_demands SET status = 'carried', updated_at = now()
            WHERE student_id = $1 AND academic_year_id = $2 AND status IN ('pending', 'partial') RETURNING id::text`,
          [r.studentId, fromId],
        );
        await c.query(
          `INSERT INTO fee_carry_forwards (school_id, run_id, student_id, from_year_id, to_year_id, due_school, due_hostel, late_fee, advance, demand_ids)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9::bigint[])`,
          [
            runId,
            r.studentId,
            fromId,
            dto.toYearId,
            r.dueSchool,
            r.dueHostel,
            r.lateFee,
            r.advance,
            marked.rows.map((x) => x.id),
          ],
        );
        // the new year's profile keeps the pupil's fee group and hostel flag, and opens with the carry
        await c.query(
          `INSERT INTO student_fee_profiles (school_id, student_id, academic_year_id, fee_group, student_type, hosteller, instalments_override,
                  opening_balance, opening_hostel, opening_late_fee, created_by, updated_by)
           SELECT app.current_school_id(), $1, $2, COALESCE(o.fee_group, 'general'), 'old', COALESCE(o.hosteller, false), o.instalments_override,
                  $4::numeric - $7::numeric, $5, $6, app.current_user_id(), app.current_user_id()
             FROM (SELECT 1) one LEFT JOIN student_fee_profiles o ON o.student_id = $1 AND o.academic_year_id = $3
           ON CONFLICT (student_id, academic_year_id) DO UPDATE SET opening_balance = EXCLUDED.opening_balance, opening_hostel = EXCLUDED.opening_hostel,
             opening_late_fee = EXCLUDED.opening_late_fee, updated_at = now(), updated_by = app.current_user_id()`,
          [r.studentId, dto.toYearId, fromId, r.dueSchool, r.dueHostel, r.lateFee, r.advance],
        );
        await this.rebuild(c, r.studentId, dto.toYearId);
        due += Number(r.dueSchool) + Number(r.dueHostel);
        late += Number(r.lateFee);
        advance += Number(r.advance);
      }
      await c.query(
        `UPDATE fee_carry_runs SET students = $2, total_due = $3, total_late = $4, total_advance = $5 WHERE id = $1`,
        [runId, chosen.length, due.toFixed(2), late.toFixed(2), advance.toFixed(2)],
      );
      await this.audit.stage(ctx, c, {
        action: 'fees.carry_forward.run',
        entityType: 'fee_carry_runs',
        entityId: runId,
        after: { toYearId: dto.toYearId, students: chosen.length, due, late, advance },
      });
      return { runId, students: chosen.length };
    });
  }

  private async rebuild(c: PoolClient, studentId: string, yearId: string): Promise<void> {
    const gen = await c.query<{ run_id: string }>(
      `SELECT o_run_id::text AS run_id FROM app.generate_fee_demand($1, $2)`,
      [studentId, yearId],
    );
    await c.query(`SELECT app.apply_instalment_override($1, $2, $3)`, [
      studentId,
      yearId,
      gen.rows[0]!.run_id,
    ]);
  }

  /** Takes one pupil's carry back, while nothing has been paid against it in the new year. */
  async undo(
    ctx: RequestContext,
    toYearId: string,
    studentId: string,
    fromYearId?: string,
  ): Promise<{ ok: true }> {
    const fromId = this.fromYear(ctx, fromYearId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = await c.query<{ id: string; demand_ids: string[] }>(
        `SELECT id::text, demand_ids::text[] AS demand_ids FROM fee_carry_forwards
          WHERE student_id = $1 AND from_year_id = $2 AND to_year_id = $3 AND undone_at IS NULL FOR UPDATE`,
        [studentId, fromId, toYearId],
      );
      const row = f.rows[0];
      if (!row)
        throw new DomainError('not-found', 'Nothing was carried for this pupil', { status: 404 });
      const blocked = await this.blocked(c, toYearId);
      if (blocked) throw new DomainError('fees.carry_blocked', blocked, { status: 409 });
      const paid = await c.query(
        `SELECT 1 FROM fee_demands WHERE student_id = $1 AND academic_year_id = $2 AND source = 'opening_balance' AND paid <> 0 LIMIT 1`,
        [studentId, toYearId],
      );
      if (paid.rowCount)
        throw new DomainError(
          'fees.carry_paid',
          'A receipt has already been posted against the carried amount; reverse the receipt first',
          { status: 409 },
        );
      await c.query(
        `UPDATE fee_demands SET status = CASE WHEN paid = 0 THEN 'pending' ELSE 'partial' END::fee_demand_status, updated_at = now()
          WHERE id = ANY($1::bigint[]) AND status = 'carried'`,
        [row.demand_ids],
      );
      await c.query(
        `UPDATE student_fee_profiles SET opening_balance = 0, opening_hostel = 0, opening_late_fee = 0, updated_at = now(), updated_by = app.current_user_id()
          WHERE student_id = $1 AND academic_year_id = $2`,
        [studentId, toYearId],
      );
      await this.rebuild(c, studentId, toYearId);
      await c.query(
        `UPDATE fee_carry_forwards SET undone_at = now(), undone_by = app.current_user_id() WHERE id = $1`,
        [row.id],
      );
      await this.audit.stage(ctx, c, {
        action: 'fees.carry_forward.undo',
        entityType: 'fee_carry_forwards',
        entityId: row.id,
        after: { studentId, toYearId },
      });
      return { ok: true as const };
    });
  }
}
