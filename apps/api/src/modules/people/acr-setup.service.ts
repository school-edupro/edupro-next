import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { writeEmployeeProfile } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  ASSESSOR_KINDS,
  type AcrAssessorsQueryDto,
  type AcrAssessorsSaveDto,
  type AcrCycleDto,
  type AcrLevelsDto,
  type AcrQuestionDto,
  type AcrSettingsDto,
  type AssessorKind,
} from './acr.dto';
type Group = 'teaching' | 'non_teaching';

/**
 * Employee ACR set-up (0184, docs/design/32-employee-acr.md): the rating words, days to object and grade
 * bands; the levels for teaching and non-teaching staff; the question bank; the cycles.
 */
@Injectable()
export class AcrSetupService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** The first read of a school's set-up adds the starting levels, bands and questions. */
  async seed(c: PoolClient) {
    await c.query('SELECT app.acr_seed(app.current_school_id())');
  }

  async view(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seed(c);
      const [settings, bands, levels, questions, cycles, years, roles, designations, staff] =
        await Promise.all([
          c.query<{ scale_labels: string[]; representation_days: number; late: string }>(
            `SELECT scale_labels, representation_days, to_char(staff_late_after, 'HH24:MI') AS late FROM acr_settings`,
          ),
          c.query<{ min_pct: string; label: string; adverse: boolean }>(
            'SELECT min_pct::text, label, adverse FROM acr_grade_bands ORDER BY min_pct DESC',
          ),
          c.query<{
            staff_group: string;
            seq: number;
            label: string;
            kind: string;
            role_code: string | null;
            designation: string | null;
            employee_id: string | null;
            employee_name: string | null;
            action: string;
          }>(
            `SELECT l.staff_group, l.seq, l.label, l.kind, l.role_code, l.designation, l.employee_id::text,
                    e.display_name AS employee_name, l.action
               FROM acr_levels l LEFT JOIN employees e ON e.id = l.employee_id
              ORDER BY l.staff_group, l.seq`,
          ),
          c.query<{
            id: string;
            part: string;
            staff_group: string;
            section: string;
            text: string;
            kind: string;
            weight: string;
            required: boolean;
            sort_order: number;
            active: boolean;
          }>(
            `SELECT id::text, part, staff_group, section, text, kind, weight::text, required, sort_order, active
               FROM acr_questions ORDER BY part, staff_group, sort_order, id`,
          ),
          c.query<{
            id: string;
            academic_year_id: string;
            year: string;
            name: string;
            self_from: string;
            self_to: string;
            review_by: string | null;
            status: string;
            reports: number;
            closed: number;
          }>(
            `SELECT cy.id::text, cy.academic_year_id::text, y.code AS year, cy.name, cy.self_from::text,
                    cy.self_to::text, cy.review_by::text, cy.status,
                    (SELECT count(*)::int FROM acr_reports r WHERE r.cycle_id = cy.id) AS reports,
                    (SELECT count(*)::int FROM acr_reports r WHERE r.cycle_id = cy.id AND r.status = 'closed') AS closed
               FROM acr_cycles cy JOIN academic_years y ON y.id = cy.academic_year_id
              ORDER BY y.start_date DESC`,
          ),
          c.query<{ id: string; code: string; status: string }>(
            `SELECT id::text, code, status::text FROM academic_years
              WHERE status::text <> 'planned' ORDER BY start_date DESC`,
          ),
          c.query<{ code: string; name: string }>(
            `SELECT code, name FROM roles
              WHERE (school_id IS NULL OR school_id = app.current_school_id()) AND deleted_at IS NULL
                AND code NOT IN ('parent', 'student', 'support_engineer', 'erp_support')
              ORDER BY name`,
          ),
          c.query<{ designation: string }>(
            `SELECT DISTINCT designation FROM employees
              WHERE deleted_at IS NULL AND status = 'active' AND designation IS NOT NULL AND designation <> ''
              ORDER BY designation`,
          ),
          c.query<{ id: string; name: string; code: string }>(
            `SELECT id::text, display_name AS name, employee_code AS code FROM employees
              WHERE deleted_at IS NULL AND status = 'active' ORDER BY display_name`,
          ),
        ]);
      const s = settings.rows[0];
      return {
        settings: {
          scaleLabels: s?.scale_labels ?? [],
          representationDays: s?.representation_days ?? 15,
          staffLateAfter: s?.late ?? '08:00',
        },
        bands: bands.rows.map((b) => ({
          minPct: Number(b.min_pct),
          label: b.label,
          adverse: b.adverse,
        })),
        levels: {
          teaching: levels.rows.filter((l) => l.staff_group === 'teaching').map(this.level),
          non_teaching: levels.rows.filter((l) => l.staff_group === 'non_teaching').map(this.level),
        },
        questions: questions.rows.map((q) => ({
          id: q.id,
          part: q.part,
          staffGroup: q.staff_group,
          section: q.section,
          text: q.text,
          kind: q.kind,
          weight: Number(q.weight),
          required: q.required,
          sortOrder: q.sort_order,
          active: q.active,
        })),
        cycles: cycles.rows.map((y) => ({
          id: y.id,
          academicYearId: y.academic_year_id,
          year: y.year,
          name: y.name,
          selfFrom: y.self_from,
          selfTo: y.self_to,
          reviewBy: y.review_by,
          status: y.status,
          reports: y.reports,
          closed: y.closed,
        })),
        years: years.rows,
        roles: roles.rows,
        designations: designations.rows.map((d) => d.designation),
        staff: staff.rows,
      };
    });
  }

  private level = (l: {
    seq: number;
    label: string;
    kind: string;
    role_code: string | null;
    designation: string | null;
    employee_id: string | null;
    employee_name: string | null;
    action: string;
  }) => ({
    seq: l.seq,
    label: l.label,
    kind: l.kind,
    roleCode: l.role_code,
    designation: l.designation,
    employeeId: l.employee_id,
    employeeName: l.employee_name,
    action: l.action,
  });

  async saveSettings(ctx: RequestContext, dto: AcrSettingsDto) {
    const pcts = dto.bands.map((b) => b.minPct);
    if (!pcts.includes(0))
      throw new DomainError(
        'acr.bands_gap',
        'One grade must start at 0% so every score has a grade',
        {
          status: 400,
        },
      );
    if (
      new Set(pcts).size !== pcts.length ||
      new Set(dto.bands.map((b) => b.label)).size !== pcts.length
    )
      throw new DomainError(
        'acr.bands_twice',
        'Each grade needs its own name and its own starting %',
        {
          status: 400,
        },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seed(c);
      await c.query(
        `UPDATE acr_settings SET scale_labels = $1::jsonb, representation_days = $2, staff_late_after = $3::time,
                updated_at = now(), updated_by = app.current_user_id()`,
        [JSON.stringify(dto.scaleLabels), dto.representationDays, dto.staffLateAfter],
      );
      await c.query('DELETE FROM acr_grade_bands');
      for (const b of dto.bands)
        await c.query(
          `INSERT INTO acr_grade_bands (school_id, min_pct, label, adverse)
           VALUES (app.current_school_id(), $1, $2, $3)`,
          [b.minPct, b.label, b.adverse],
        );
      await this.audit.stage(ctx, c, {
        action: 'people.acr.settings',
        entityType: 'acr_settings',
        entityId: requireTenant(ctx).schoolId,
        after: dto,
      });
      return { ok: true };
    });
  }

  async saveLevels(ctx: RequestContext, dto: AcrLevelsDto) {
    for (const [i, l] of dto.levels.entries()) {
      const n = `Level ${String(i + 1)}`;
      if (l.kind === 'role' && !l.roleCode)
        throw new DomainError('acr.level_incomplete', `${n}: choose the role`, { status: 400 });
      if (l.kind === 'designation' && !l.designation)
        throw new DomainError('acr.level_incomplete', `${n}: choose the designation`, {
          status: 400,
        });
      if (l.kind === 'employee' && !l.employeeId)
        throw new DomainError('acr.level_incomplete', `${n}: choose the person`, { status: 400 });
      // the reviewer level needs a fallback designation (the Principal) for records with nobody set
      if (l.kind === 'acr_reviewer' && !l.designation)
        throw new DomainError(
          'acr.level_incomplete',
          `${n}: choose the designation that reviews when nobody is set on the record`,
          { status: 400 },
        );
    }
    if (!dto.levels.some((l) => l.action === 'rate'))
      throw new DomainError('acr.no_rating', 'At least one level must rate the questions', {
        status: 400,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seed(c);
      await c.query('DELETE FROM acr_levels WHERE staff_group = $1', [dto.staffGroup]);
      for (const [i, l] of dto.levels.entries())
        await c.query(
          `INSERT INTO acr_levels (school_id, staff_group, seq, label, kind, role_code, designation, employee_id, action)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            dto.staffGroup,
            i + 1,
            l.label,
            l.kind,
            l.kind === 'role' ? l.roleCode : null,
            l.kind === 'designation' || l.kind === 'acr_reviewer' ? l.designation : null,
            l.kind === 'employee' ? l.employeeId : null,
            l.action,
          ],
        );
      await this.audit.stage(ctx, c, {
        action: 'people.acr.levels',
        entityType: 'acr_levels',
        entityId: dto.staffGroup,
        after: dto,
      });
      return { ok: true };
    });
  }

  async saveQuestion(ctx: RequestContext, id: string | null, dto: AcrQuestionDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const args = [
        dto.part,
        dto.staffGroup,
        dto.section,
        dto.text,
        dto.kind,
        dto.weight,
        dto.required,
        dto.sortOrder,
        dto.active,
      ];
      const r = id
        ? await c.query<{ id: string }>(
            `UPDATE acr_questions SET part = $1, staff_group = $2, section = $3, text = $4, kind = $5, weight = $6,
                    required = $7, sort_order = $8, active = $9
              WHERE id = $10 RETURNING id::text`,
            [...args, id],
          )
        : await c.query<{ id: string }>(
            `INSERT INTO acr_questions (school_id, part, staff_group, section, text, kind, weight, required, sort_order, active)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text`,
            args,
          );
      if (!r.rows[0]) throw new DomainError('not-found', 'Question not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: id ? 'people.acr.question.edit' : 'people.acr.question.add',
        entityType: 'acr_questions',
        entityId: r.rows[0].id,
        after: dto,
      });
      return { id: r.rows[0].id };
    });
  }

  async saveCycle(ctx: RequestContext, id: string | null, dto: AcrCycleDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      try {
        const r = id
          ? await c.query<{ id: string }>(
              `UPDATE acr_cycles SET name = $1, self_from = $2, self_to = $3, review_by = $4
                WHERE id = $5 AND status <> 'closed' RETURNING id::text`,
              [dto.name, dto.selfFrom, dto.selfTo, dto.reviewBy ?? null, id],
            )
          : await c.query<{ id: string }>(
              `INSERT INTO acr_cycles (school_id, academic_year_id, name, self_from, self_to, review_by, created_by)
               VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id()) RETURNING id::text`,
              [dto.academicYearId, dto.name, dto.selfFrom, dto.selfTo, dto.reviewBy ?? null],
            );
        if (!r.rows[0])
          throw new DomainError('not-found', 'Cycle not found or already closed', { status: 404 });
        await this.audit.stage(ctx, c, {
          action: id ? 'people.acr.cycle.edit' : 'people.acr.cycle.add',
          entityType: 'acr_cycles',
          entityId: r.rows[0].id,
          after: dto,
        });
        return { id: r.rows[0].id };
      } catch (e) {
        if (e instanceof Error && e.message.includes('acr_cycles_school_id_academic_year_id_key'))
          throw new DomainError('acr.cycle_exists', 'This year already has an ACR cycle', {
            status: 409,
          });
        throw e;
      }
    });
  }

  // ---- assessors per employee (0189) -------------------------------------------------------------

  /** The employee-wise level kinds in use (both groups, in level order): the columns of the Assessors screen. */
  private async assessorColumns(c: PoolClient) {
    const r = await c.query<{ kind: AssessorKind; label: string; designation: string | null }>(
      `SELECT kind, min(label) AS label, min(designation) AS designation
         FROM acr_levels WHERE kind = ANY($1::text[]) GROUP BY kind ORDER BY min(seq), kind`,
      [[...ASSESSOR_KINDS]],
    );
    const cols = r.rows.map((x) => ({
      key: x.kind,
      label: x.label,
      fallback: x.kind === 'acr_reviewer' ? x.designation : null,
    }));
    return cols.length ? cols : [{ key: 'acr_hod' as AssessorKind, label: 'HOD', fallback: null }];
  }

  /** Every active employee with who assesses them, who is missing, and the filters' departments. */
  async assessors(ctx: RequestContext, q: AcrAssessorsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seed(c);
      const columns = await this.assessorColumns(c);
      const r = await c.query<{
        id: string;
        code: string;
        name: string;
        department: string | null;
        designation: string | null;
        side: string;
        profile: Record<string, unknown>;
      }>(
        `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.department, e.designation,
                app.employee_staff_side(e.department, e.employee_type) AS side, e.profile
           FROM employees e WHERE e.deleted_at IS NULL AND e.status = 'active' ORDER BY e.display_name, e.id`,
      );
      const ids = new Set<string>();
      for (const x of r.rows)
        for (const col of columns) {
          const v = x.profile[col.key];
          if (typeof v === 'string' && /^\d{1,18}$/.test(v)) ids.add(v);
          if (typeof v === 'number') ids.add(String(v));
        }
      const names = new Map<string, { id: string; name: string; code: string }>();
      if (ids.size) {
        const n = await c.query<{ id: string; name: string; code: string }>(
          `SELECT id::text, display_name AS name, employee_code AS code FROM employees WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
          [[...ids]],
        );
        for (const x of n.rows) names.set(x.id, x);
      }
      const all = r.rows.map((x) => {
        const assessors: Record<string, { id: string; name: string; code: string } | null> = {};
        for (const col of columns) {
          const v = x.profile[col.key];
          const id = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
          assessors[col.key] = (id && names.get(id)) || null;
        }
        return {
          id: x.id,
          code: x.code,
          name: x.name,
          department: x.department,
          designation: x.designation,
          staffGroup: (x.side === 'non_teaching' ? 'non_teaching' : 'teaching') as Group,
          assessors,
          // a reviewer column with a fallback designation is never "missing"
          missing: columns.some((col) => !assessors[col.key] && !col.fallback),
        };
      });
      const needle = (q.q ?? '').toLowerCase();
      const rows = all.filter(
        (x) =>
          (!needle ||
            x.name.toLowerCase().includes(needle) ||
            x.code.toLowerCase().includes(needle)) &&
          (!q.department || (x.department ?? '') === q.department) &&
          (!q.staffGroup || x.staffGroup === q.staffGroup) &&
          (!q.missing || x.missing),
      );
      return {
        columns,
        rows,
        total: all.length,
        missing: all.filter((x) => x.missing).length,
        departments: [
          ...new Set(all.map((x) => x.department).filter((d): d is string => !!d)),
        ].sort(),
      };
    });
  }

  /**
   * Writes the assessors on the employees' records (the same fields the levels read). Each reference
   * is an id or an employee code; nobody assesses themselves; rows with a problem are reported, the
   * rest are saved.
   */
  async saveAssessors(ctx: RequestContext, dto: AcrAssessorsSaveDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const refs = new Set<string>();
      for (const row of dto.rows) {
        refs.add(row.employee.toUpperCase());
        for (const v of Object.values(row.assessors)) if (v) refs.add(v.toUpperCase());
      }
      const found = await c.query<{ id: string; code: string }>(
        `SELECT id::text, upper(employee_code) AS code FROM employees
          WHERE deleted_at IS NULL AND status = 'active' AND (id::text = ANY($1::text[]) OR upper(employee_code) = ANY($1::text[]))`,
        [[...refs]],
      );
      const byRef = new Map<string, string>();
      for (const f of found.rows) {
        byRef.set(f.id, f.id);
        byRef.set(f.code, f.id);
      }
      const errors: Array<{ employee: string; message: string }> = [];
      let changed = 0;
      for (const row of dto.rows) {
        const emp = byRef.get(row.employee.toUpperCase());
        if (!emp) {
          errors.push({ employee: row.employee, message: 'No active employee with this code' });
          continue;
        }
        const values: Record<string, string | null> = {};
        let bad = false;
        for (const [k, v] of Object.entries(row.assessors)) {
          if (!v) {
            values[k] = null;
            continue;
          }
          const a = byRef.get(v.toUpperCase());
          if (!a) {
            errors.push({ employee: row.employee, message: `${k}: no active employee ${v}` });
            bad = true;
          } else if (a === emp) {
            errors.push({
              employee: row.employee,
              message: `${k}: an employee never assesses themselves`,
            });
            bad = true;
          } else values[k] = a;
        }
        if (bad || !Object.keys(values).length) continue;
        await writeEmployeeProfile(c, emp, values);
        changed++;
      }
      await this.audit.stage(ctx, c, {
        action: 'people.acr.assessors.save',
        entityType: 'employees',
        entityId: requireTenant(ctx).schoolId,
        after: { changed, errors: errors.length },
      });
      return { changed, errors };
    });
  }
}
