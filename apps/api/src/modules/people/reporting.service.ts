/* eslint-disable no-restricted-syntax -- the interpolations in this file are fixed fragments; values are bound */
import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type {
  ReportingAssignDto,
  ReportingImportDto,
  ReportingMoveDto,
  ReportingQueryDto,
} from './people.dto';

const bad = (message: string, status = 400): never => {
  throw new DomainError('validation-failed', message, { status });
};

/**
 * Whether these changes (employee → manager, null for nobody) would make anyone report to themselves,
 * directly or round a loop, given this year's other reporting lines. Returns the employees caught in one.
 */
export async function reportingLoops(
  c: PoolClient,
  changes: Map<string, string | null>,
): Promise<Set<string>> {
  const now = await c.query<{ emp: string; mgr: string }>(
    `SELECT employee_id::text AS emp, reports_to_employee_id::text AS mgr FROM postings
      WHERE academic_year_id = app.current_academic_year_id() AND reports_to_employee_id IS NOT NULL`,
  );
  const up = new Map(now.rows.map((r) => [r.emp, r.mgr as string | null]));
  for (const [e, m] of changes) up.set(e, m);
  const caught = new Set<string>();
  for (const e of changes.keys()) {
    let at = up.get(e) ?? null;
    for (let i = 0; at && i < 200; i += 1) {
      if (at === e) {
        caught.add(e);
        break;
      }
      at = up.get(at) ?? null;
    }
  }
  return caught;
}

/**
 * Reporting managers (docs/design/30, "reporting lines"): who each active employee reports to in the
 * working year — the list with filters, ticked employees given a manager (or none), one manager's whole
 * team moved to another, and the same from Excel (checked first, old → new, then the valid rows saved).
 * A change goes on the employee's posting of the year (made from their record when there is none); a line
 * that would make anyone report to themselves round a loop is refused. Leave and corrections already
 * waiting with an old manager stay with them: the answer says how many.
 */
@Injectable()
export class ReportingService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private async year(c: PoolClient) {
    const y = (
      await c.query<{ id: string | null; name: string | null }>(
        `SELECT app.current_academic_year_id()::text AS id,
                (SELECT name FROM academic_years WHERE id = app.current_academic_year_id()) AS name`,
      )
    ).rows[0];
    if (!y?.id) return bad('Pick the working year at the top first');
    return { id: y.id, name: y.name };
  }

  async list(ctx: RequestContext, q: ReportingQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const year = await this.year(c);
      const where = [`e.deleted_at IS NULL`, `e.status = 'active'`];
      const args: unknown[] = [];
      const arg = (v: unknown) => {
        args.push(v);
        return `$${String(args.length)}`;
      };
      if (q.q)
        where.push(
          `(e.display_name ILIKE '%' || ${arg(q.q)} || '%' OR e.employee_code ILIKE '%' || ${arg(q.q)} || '%')`,
        );
      if (q.department) where.push(`lower(e.department) = lower(${arg(q.department)})`);
      if (q.designation) where.push(`lower(e.designation) = lower(${arg(q.designation)})`);
      if (q.managerId === 'none') where.push(`p.reports_to_employee_id IS NULL`);
      else if (q.managerId) where.push(`p.reports_to_employee_id = ${arg(q.managerId)}::bigint`);
      const from = `FROM employees e
        LEFT JOIN postings p ON p.employee_id = e.id AND p.academic_year_id = app.current_academic_year_id()
        LEFT JOIN employees m ON m.id = p.reports_to_employee_id
        WHERE ${where.join(' AND ')}`;
      const total = (await c.query<{ n: number }>(`SELECT count(*)::int AS n ${from}`, args))
        .rows[0]!.n;
      const rows = await c.query<{
        id: string;
        code: string | null;
        name: string;
        department: string | null;
        designation: string | null;
        mid: string | null;
        mcode: string | null;
        mname: string | null;
        reportees: number;
      }>(
        `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.department, e.designation,
                m.id::text AS mid, m.employee_code AS mcode, m.display_name AS mname,
                (SELECT count(*)::int FROM postings r JOIN employees re ON re.id = r.employee_id
                  WHERE r.reports_to_employee_id = e.id AND r.academic_year_id = app.current_academic_year_id()
                    AND re.deleted_at IS NULL AND re.status = 'active') AS reportees
           ${from}
          ORDER BY e.display_name, e.employee_code
          LIMIT ${arg(q.size)} OFFSET ${arg((q.page - 1) * q.size)}`,
        args,
      );
      const fig = (
        await c.query<{ staff: number; set: number; managers: number }>(
          `SELECT count(*)::int AS staff, count(p.reports_to_employee_id)::int AS set,
                  count(DISTINCT p.reports_to_employee_id)::int AS managers
             FROM employees e LEFT JOIN postings p ON p.employee_id = e.id AND p.academic_year_id = app.current_academic_year_id()
            WHERE e.deleted_at IS NULL AND e.status = 'active'`,
        )
      ).rows[0]!;
      const lists = await c.query<{ kind: string; id: string; name: string; n: number | null }>(
        `SELECT 'employee' AS kind, id::text, display_name || ' (' || COALESCE(employee_code, '—') || ')' AS name, NULL::int AS n
           FROM employees WHERE deleted_at IS NULL AND status = 'active'
         UNION ALL
         SELECT 'manager', m.id::text, m.display_name || ' (' || COALESCE(m.employee_code, '—') || ')', count(*)::int
           FROM postings p JOIN employees m ON m.id = p.reports_to_employee_id JOIN employees e ON e.id = p.employee_id
          WHERE p.academic_year_id = app.current_academic_year_id() AND e.deleted_at IS NULL AND e.status = 'active'
          GROUP BY m.id, m.display_name, m.employee_code
         UNION ALL SELECT DISTINCT 'department', department, department, NULL::int FROM employees
          WHERE deleted_at IS NULL AND status = 'active' AND COALESCE(department, '') <> ''
         UNION ALL SELECT DISTINCT 'designation', designation, designation, NULL::int FROM employees
          WHERE deleted_at IS NULL AND status = 'active' AND COALESCE(designation, '') <> ''
         ORDER BY 1, 3`,
      );
      const of = (k: string) => lists.rows.filter((x) => x.kind === k);
      return {
        year,
        figures: {
          staff: fig.staff,
          set: fig.set,
          none: fig.staff - fig.set,
          managers: fig.managers,
        },
        rows: rows.rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          department: r.department,
          designation: r.designation,
          manager: r.mid ? { id: r.mid, code: r.mcode, name: r.mname } : null,
          reportees: r.reportees,
        })),
        total,
        page: q.page,
        size: q.size,
        lists: {
          employees: of('employee').map(({ id, name }) => ({ id, name })),
          managers: of('manager').map(({ id, name, n }) => ({ id, name, reportees: n ?? 0 })),
          departments: of('department').map((x) => x.name),
          designations: of('designation').map((x) => x.name),
        },
      };
    });
  }

  /**
   * Set the manager of these employees for the year (null: nobody): the posting of the year changed, or
   * made from the employee's record; each change audited. Refused for a loop or an employee as their own
   * manager. How many leave and corrections of theirs wait with an old manager is counted, not moved.
   */
  private async apply(
    c: PoolClient,
    ctx: RequestContext,
    changes: Map<string, string | null>,
    how: string,
  ) {
    const year = await this.year(c);
    const ids = [...changes.keys()];
    const mgrs = [...new Set([...changes.values()].filter((m): m is string => !!m))];
    const known = await c.query<{ id: string }>(
      `SELECT id::text FROM employees WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL AND status = 'active'`,
      [[...new Set([...ids, ...mgrs])]],
    );
    const ok = new Set(known.rows.map((r) => r.id));
    for (const id of ids) if (!ok.has(id)) bad('An employee is not on the active staff list', 404);
    for (const m of mgrs) if (!ok.has(m)) bad('The manager is not on the active staff list', 404);
    for (const [e, m] of changes) if (e === m) bad('An employee cannot report to themselves');
    const loops = await reportingLoops(c, changes);
    if (loops.size) {
      const names = await c.query<{ name: string }>(
        `SELECT display_name || ' (' || COALESCE(employee_code, '—') || ')' AS name FROM employees WHERE id = ANY($1::bigint[]) ORDER BY 1`,
        [[...loops]],
      );
      bad(
        `That would make ${names.rows.map((n) => n.name).join(', ')} report to someone who reports to them: change the manager above first`,
        409,
      );
    }
    const now = new Map(
      (
        await c.query<{ emp: string; mgr: string | null }>(
          `SELECT employee_id::text AS emp, reports_to_employee_id::text AS mgr FROM postings
            WHERE academic_year_id = app.current_academic_year_id() AND employee_id = ANY($1::bigint[])`,
          [ids],
        )
      ).rows.map((r) => [r.emp, r.mgr]),
    );
    let changed = 0;
    const old = new Set<string>();
    for (const [e, m] of changes) {
      const was = now.get(e) ?? null;
      if (was === m) continue;
      if (was) old.add(was);
      await c.query(
        `INSERT INTO postings (school_id, employee_id, academic_year_id, department, designation, reports_to_employee_id,
                               valid_from, created_by, updated_by)
         SELECT app.current_school_id(), e.id, app.current_academic_year_id(), e.department, e.designation, $2::bigint,
                CURRENT_DATE, app.current_user_id(), app.current_user_id()
           FROM employees e WHERE e.id = $1::bigint
         ON CONFLICT (employee_id, academic_year_id) DO UPDATE
           SET reports_to_employee_id = EXCLUDED.reports_to_employee_id, updated_at = now(), updated_by = app.current_user_id()`,
        [e, m],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.reporting.set',
        entityType: 'employees',
        entityId: e,
        before: { reportsToEmployeeId: was, year: year.id },
        after: { reportsToEmployeeId: m, year: year.id, how },
      });
      changed += 1;
    }
    // leave and corrections of theirs waiting with an old manager stay there (counted)
    const waiting = old.size
      ? (
          await c.query<{ n: number }>(
            `SELECT count(DISTINCT i.id)::int AS n FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
              WHERE i.status = 'pending' AND s.status = 'pending' AND s.level = i.current_level
                AND s.assignee_user_ids && (SELECT array_agg(user_id) FROM employees WHERE id = ANY($2::bigint[]) AND user_id IS NOT NULL)
                AND ((i.entity_type IN ('staff_leave', 'staff_leave_cancel')
                       AND i.entity_id::text IN (SELECT id::text FROM staff_leave_requests WHERE employee_id = ANY($1::bigint[])))
                  OR (i.entity_type = 'staff_regularisation'
                       AND i.entity_id::text IN (SELECT id::text FROM staff_regularisations WHERE employee_id = ANY($1::bigint[]))))`,
            [ids, [...old]],
          )
        ).rows[0]!.n
      : 0;
    return { year: year.name, changed, unchanged: changes.size - changed, waiting };
  }

  async assign(ctx: RequestContext, dto: ReportingAssignDto) {
    return this.db.tenant(requireTenant(ctx), (c) =>
      this.apply(
        c,
        ctx,
        new Map([...new Set(dto.employeeIds)].map((e) => [e, dto.managerId])),
        dto.employeeIds.length === 1 ? 'one' : 'ticked',
      ),
    );
  }

  async move(ctx: RequestContext, dto: ReportingMoveDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const team = await c.query<{ id: string }>(
        `SELECT p.employee_id::text AS id FROM postings p JOIN employees e ON e.id = p.employee_id
          WHERE p.reports_to_employee_id = $1::bigint AND p.academic_year_id = app.current_academic_year_id()
            AND e.deleted_at IS NULL AND e.status = 'active'`,
        [dto.fromManagerId],
      );
      if (!team.rowCount) bad('Nobody reports to that manager this year', 409);
      // the new manager may be one of the team: they then report to nobody new (their own line is kept)
      const changes = new Map(
        team.rows.filter((r) => r.id !== dto.toManagerId).map((r) => [r.id, dto.toManagerId]),
      );
      return { ...(await this.apply(c, ctx, changes, 'moved')), team: team.rowCount };
    });
  }

  /** The sheet: every active employee with their manager's code now, to change and upload again. */
  async format(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const year = await this.year(c);
      const r = await c.query<{
        code: string | null;
        name: string;
        department: string | null;
        designation: string | null;
        mcode: string | null;
        mname: string | null;
      }>(
        `SELECT e.employee_code AS code, e.display_name AS name, e.department, e.designation,
                m.employee_code AS mcode, m.display_name AS mname
           FROM employees e
           LEFT JOIN postings p ON p.employee_id = e.id AND p.academic_year_id = app.current_academic_year_id()
           LEFT JOIN employees m ON m.id = p.reports_to_employee_id
          WHERE e.deleted_at IS NULL AND e.status = 'active' AND e.employee_code IS NOT NULL
          ORDER BY e.department NULLS LAST, e.display_name LIMIT 20000`,
      );
      const bytes = await templateSheet({
        sheet: 'Reporting managers',
        hideLists: true,
        columns: [
          { header: 'Employee code', width: 14, required: true, format: 'text' },
          { header: 'Employee', width: 28, note: 'For reading only (the code is read)' },
          { header: 'Department', width: 18, note: 'For reading only' },
          { header: 'Designation', width: 20, note: 'For reading only' },
          {
            header: 'Reports to (code)',
            width: 16,
            format: 'text',
            note: 'The manager’s employee code. Empty: reports to nobody',
          },
          { header: 'Reports to', width: 28, note: 'For reading only: the manager now' },
        ],
        guide: [
          `Who each employee reports to in ${year.name ?? 'the working year'}. The sheet comes filled with the managers now.`,
          'Change the Reports to (code) column: the manager’s employee code. Empty means the employee reports to nobody.',
          'Delete the rows you do not change, or leave them: a row whose manager is the same changes nothing.',
          'Upload it and press Check: every row is shown old → new, with the reason for any refused; then save the good rows.',
          'Refused: a code not on the active staff list, an employee as their own manager, or a line that goes round a loop.',
        ],
        rows: r.rows.map((x) => [x.code, x.name, x.department, x.designation, x.mcode, x.mname]),
        examples: [['E104', 'Teacher name', 'Science', 'TGT Science', 'E003', 'Coordinator name']],
      });
      return {
        filename: 'reporting-managers.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
      };
    });
  }

  /** Reporting managers from Excel: every row checked (old → new, or why not), then the good ones saved. */
  async import(ctx: RequestContext, dto: ReportingImportDto) {
    const sheet = await readSheet(
      dto.file,
      ['Employee code'],
      ['Reports to (code)', 'Reports to code'],
      [['Reports to (code)', 'Reports to code']],
    );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.year(c);
      const staff = await c.query<{ id: string; code: string; name: string; mgr: string | null }>(
        `SELECT e.id::text, upper(e.employee_code) AS code, e.display_name || ' (' || e.employee_code || ')' AS name,
                p.reports_to_employee_id::text AS mgr
           FROM employees e
           LEFT JOIN postings p ON p.employee_id = e.id AND p.academic_year_id = app.current_academic_year_id()
          WHERE e.deleted_at IS NULL AND e.status = 'active' AND e.employee_code IS NOT NULL`,
      );
      const byCode = new Map(staff.rows.map((s) => [s.code, s]));
      const byId = new Map(staff.rows.map((s) => [s.id, s]));
      const seen = new Set<string>();
      type Row = {
        row: number;
        employee: string;
        from: string | null;
        to: string | null;
        status: 'change' | 'same' | 'error';
        error?: string;
      };
      const rows: Row[] = [];
      const changes = new Map<string, string | null>();
      const rowOf = new Map<string, Row>();
      for (const { row, cells } of sheet) {
        const code = (cells['Employee code'] ?? '').trim().toUpperCase();
        const mcode = (cells['Reports to (code)'] || cells['Reports to code'] || '')
          .trim()
          .toUpperCase();
        if (!code && !mcode) continue;
        const e = byCode.get(code);
        const m = mcode ? byCode.get(mcode) : null;
        const r: Row = {
          row,
          employee: e?.name ?? code,
          from: e?.mgr ? (byId.get(e.mgr)?.name ?? null) : null,
          to: m?.name ?? (mcode ? mcode : null),
          status: 'change',
        };
        if (!e) r.error = `${code || 'The code'} is not on the active staff list`;
        else if (seen.has(e.id)) r.error = 'The same employee again: keep one row';
        else if (mcode && !m) r.error = `${mcode} is not on the active staff list`;
        else if (m && m.id === e.id) r.error = 'An employee cannot report to themselves';
        if (r.error) r.status = 'error';
        else {
          seen.add(e!.id);
          const to = m?.id ?? null;
          if ((e!.mgr ?? null) === to) r.status = 'same';
          else {
            changes.set(e!.id, to);
            rowOf.set(e!.id, r);
          }
        }
        rows.push(r);
      }
      // a line round a loop: those rows refused, the rest go ahead
      const loops = await reportingLoops(c, changes);
      for (const e of loops) {
        const r = rowOf.get(e)!;
        r.status = 'error';
        r.error = 'This would make them report to someone who reports to them';
        changes.delete(e);
      }
      const counts = {
        change: rows.filter((r) => r.status === 'change').length,
        same: rows.filter((r) => r.status === 'same').length,
        error: rows.filter((r) => r.status === 'error').length,
      };
      if (dto.dryRun || !changes.size) return { rows, counts, saved: 0, waiting: 0 };
      const done = await this.apply(c, ctx, changes, 'excel');
      return { rows, counts, saved: done.changed, waiting: done.waiting };
    });
  }
}
