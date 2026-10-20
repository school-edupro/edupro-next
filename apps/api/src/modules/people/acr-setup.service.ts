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
  type AcrFormCopyDto,
  type AcrFormDto,
  type AcrFormLevelsDto,
  type AcrLevelsDto,
  type AcrSectionDto,
  type AcrQuestionDto,
  type AcrSettingsDto,
  type AssessorKind,
  AcrRemarksDto,
  AcrRemarksImportDto,
} from './acr.dto';
type Group = 'teaching' | 'non_teaching';
const KIND_WORDS: Record<AssessorKind, string> = {
  acr_hod: 'the employee’s ACR HOD',
  acr_reviewer: 'the employee’s ACR reviewer',
  approver_l1: 'the employee’s L1 approver',
  approver_l2: 'the employee’s L2 approver',
  approver_l3: 'the employee’s L3 approver',
};

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

  /** The first read of a school's set-up adds the starting levels, bands and questions, as forms (0191). */
  async seed(c: PoolClient) {
    await c.query('SELECT app.acr_seed(app.current_school_id())');
    await c.query('SELECT app.acr_forms_from_questions(app.current_school_id())');
  }

  async view(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seed(c);
      const [
        settings,
        bands,
        levels,
        questions,
        cycles,
        years,
        roles,
        designations,
        staff,
        forms,
        sections,
      ] = await Promise.all([
        c.query<{
          scale_labels: string[];
          representation_days: number;
          late: string;
          guidelines: string;
        }>(
          `SELECT scale_labels, representation_days, to_char(staff_late_after, 'HH24:MI') AS late, guidelines FROM acr_settings`,
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
          instructions: string;
          action: string;
          form_id: string | null;
          form_name: string | null;
        }>(
          `SELECT l.staff_group, l.seq, l.label, l.kind, l.role_code, l.designation, l.employee_id::text,
                    e.display_name AS employee_name, l.action, l.form_id::text, f.name AS form_name, l.instructions
               FROM acr_levels l LEFT JOIN employees e ON e.id = l.employee_id LEFT JOIN acr_forms f ON f.id = l.form_id
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
          form_id: string | null;
          section_id: string | null;
        }>(
          `SELECT id::text, part, staff_group, section, text, kind, weight::text, required, sort_order, active,
                    form_id::text, section_id::text
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
        c.query<{
          id: string;
          name: string;
          part: 'self' | 'level';
          staff_group: string;
          description: string | null;
          active: boolean;
          sort_order: number;
          employee_type_ids: string[];
        }>(
          `SELECT id::text, name, part, staff_group, description, active, sort_order, employee_type_ids::text[]
               FROM acr_forms ORDER BY part, sort_order, id`,
        ),
        c.query<{
          id: string;
          form_id: string;
          title: string;
          help: string | null;
          weight: string;
          sort_order: number;
        }>(
          `SELECT id::text, form_id::text, title, help, weight::text, sort_order
               FROM acr_form_sections ORDER BY form_id, sort_order, id`,
        ),
      ]);
      // 0192: the employee types a self form may be for, and how many active employees each self form
      // serves now (the side as the open or latest cycle's year would give it)
      const types = await c.query<{ id: string; name: string; staff_group: string }>(
        `SELECT id::text, name, staff_group::text FROM employee_types WHERE status = 'active' ORDER BY sort_order, name`,
      );
      const applies = await c.query<{ form_id: string | null; n: number }>(
        `SELECT app.acr_self_form(app.acr_staff_group(e.id, y.id), e.id)::text AS form_id, count(*)::int AS n
           FROM employees e, (SELECT COALESCE(
                  (SELECT academic_year_id FROM acr_cycles ORDER BY (status = 'open') DESC, id DESC LIMIT 1),
                  (SELECT id FROM academic_years WHERE status::text = 'current' ORDER BY start_date DESC LIMIT 1)) AS id) y
          WHERE e.deleted_at IS NULL AND e.status = 'active' GROUP BY 1`,
      );
      // Principal's remarks (0195): standard lines per grade
      await this.seedRemarks(c);
      const remarks = await c.query<{
        id: string;
        grade: string;
        text: string;
        sort_order: number;
        active: boolean;
      }>(
        `SELECT id::text, grade, text, sort_order, active FROM acr_remarks ORDER BY grade, sort_order, id`,
      );
      const typeName = new Map(types.rows.map((t) => [t.id, t.name]));
      const appliesTo = new Map(applies.rows.map((x) => [x.form_id, x.n]));
      const s = settings.rows[0];
      const qOf = (q: (typeof questions.rows)[number]) => ({
        id: q.id,
        formId: q.form_id,
        sectionId: q.section_id,
        part: q.part,
        staffGroup: q.staff_group,
        section: q.section,
        text: q.text,
        kind: q.kind,
        weight: Number(q.weight),
        required: q.required,
        sortOrder: q.sort_order,
        active: q.active,
      });
      const formsOut = forms.rows.map((f) => ({
        id: f.id,
        name: f.name,
        part: f.part,
        staffGroup: f.staff_group,
        description: f.description,
        active: f.active,
        sortOrder: f.sort_order,
        employeeTypeIds: f.employee_type_ids,
        employeeTypes: f.employee_type_ids
          .map((id) => typeName.get(id))
          .filter((x): x is string => !!x),
        appliesTo: f.part === 'self' ? (appliesTo.get(f.id) ?? 0) : null,
        sections: sections.rows
          .filter((x) => x.form_id === f.id)
          .map((x) => ({
            id: x.id,
            title: x.title,
            help: x.help,
            weight: Number(x.weight),
            sortOrder: x.sort_order,
            questions: questions.rows
              .filter((q) => q.section_id === x.id)
              .sort((a, b) => a.sort_order - b.sort_order || Number(a.id) - Number(b.id))
              .map(qOf),
          })),
      }));
      return {
        settings: {
          scaleLabels: s?.scale_labels ?? [],
          representationDays: s?.representation_days ?? 15,
          staffLateAfter: s?.late ?? '08:00',
          guidelines: s?.guidelines ?? '',
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
        questions: questions.rows.map(qOf),
        forms: formsOut,
        employeeTypes: types.rows.map((t) => ({
          id: t.id,
          name: t.name,
          staffGroup: t.staff_group,
        })),
        remarkLines: remarks.rows.map((x) => ({
          id: x.id,
          grade: x.grade,
          text: x.text,
          sortOrder: x.sort_order,
          active: x.active,
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
    form_id: string | null;
    form_name: string | null;
    instructions: string;
  }) => ({
    seq: l.seq,
    instructions: l.instructions,
    label: l.label,
    kind: l.kind,
    roleCode: l.role_code,
    designation: l.designation,
    employeeId: l.employee_id,
    employeeName: l.employee_name,
    action: l.action,
    formId: l.form_id,
    formName: l.form_name,
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
                guidelines = $4, updated_at = now(), updated_by = app.current_user_id()`,
        [
          JSON.stringify(dto.scaleLabels),
          dto.representationDays,
          dto.staffLateAfter,
          dto.guidelines,
        ],
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
    // two levels reading the same record field would always be the same person
    const seen = new Map<string, number>();
    for (const [i, l] of dto.levels.entries()) {
      if (!(ASSESSOR_KINDS as readonly string[]).includes(l.kind)) continue;
      const first = seen.get(l.kind);
      if (first !== undefined)
        throw new DomainError(
          'acr.level_same_person',
          `Levels ${String(first)} and ${String(i + 1)} both read “${KIND_WORDS[l.kind as AssessorKind]}”: each level needs its own person, so choose another kind for one of them`,
          { status: 400 },
        );
      seen.set(l.kind, i + 1);
    }
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seed(c);
      // 0191: each level's questionnaire is a level form of this group (or of both); a rating level needs one
      const forms = await c.query<{ id: string; staff_group: string }>(
        `SELECT id::text, staff_group FROM acr_forms WHERE part = 'level' AND active`,
      );
      for (const [i, l] of dto.levels.entries()) {
        const n = `Level ${String(i + 1)}`;
        if (l.formId) {
          const f = forms.rows.find((x) => x.id === l.formId);
          if (!f || (f.staff_group !== 'both' && f.staff_group !== dto.staffGroup))
            throw new DomainError(
              'acr.level_form',
              `${n}: choose a questionnaire for this staff group`,
              {
                status: 400,
              },
            );
        } else if (l.action === 'rate')
          throw new DomainError(
            'acr.level_form',
            `${n}: a rating level needs a questionnaire (make one under Forms and questions)`,
            { status: 400 },
          );
      }
      await c.query('DELETE FROM acr_levels WHERE staff_group = $1', [dto.staffGroup]);
      for (const [i, l] of dto.levels.entries())
        await c.query(
          `INSERT INTO acr_levels (school_id, staff_group, seq, label, kind, role_code, designation, employee_id, action, form_id, instructions)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            dto.staffGroup,
            i + 1,
            l.label,
            l.kind,
            l.kind === 'role' ? l.roleCode : null,
            l.kind === 'designation' || l.kind === 'acr_reviewer' ? l.designation : null,
            l.kind === 'employee' ? l.employeeId : null,
            l.action,
            l.formId ?? null,
            l.instructions,
          ],
        );
      const followed = await this.refreshOpenAcrForms(c);
      await this.audit.stage(ctx, c, {
        action: 'people.acr.levels',
        entityType: 'acr_levels',
        entityId: dto.staffGroup,
        after: { ...dto, followed },
      });
      return { ok: true };
    });
  }

  /**
   * ACRs of open cycles follow the set-up until a step is filled: a level not yet filled takes the
   * questionnaire its level has now; an ACR whose self-appraisal is not yet submitted takes the self
   * form its category and employee type have now (a draft keeps the answers to questions still on it).
   * Filled steps keep the form they were answered on.
   */
  private async refreshOpenAcrForms(c: PoolClient) {
    const lv = await c.query(
      `UPDATE acr_reviews v SET form_id = l.form_id
         FROM acr_reports r JOIN acr_cycles cy ON cy.id = r.cycle_id, acr_levels l
        WHERE v.report_id = r.id AND cy.status = 'open' AND v.status <> 'done'
          AND l.staff_group = r.staff_group AND l.seq = v.seq AND l.label = v.label AND l.action = v.action
          AND v.form_id IS DISTINCT FROM l.form_id`,
    );
    const sf = await c.query(
      `UPDATE acr_reports r SET self_form_id = app.acr_self_form(r.staff_group, r.employee_id)
         FROM acr_cycles cy
        WHERE cy.id = r.cycle_id AND cy.status = 'open' AND r.status = 'self'
          AND r.self_form_id IS DISTINCT FROM app.acr_self_form(r.staff_group, r.employee_id)`,
    );
    return { levels: lv.rowCount ?? 0, selfForms: sf.rowCount ?? 0 };
  }

  // ---- forms, sections and questions (0191) ------------------------------------------------------

  private async formOf(c: PoolClient, id: string) {
    const r = await c.query<{ id: string; part: 'self' | 'level'; staff_group: string }>(
      'SELECT id::text, part, staff_group FROM acr_forms WHERE id = $1',
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Form not found', { status: 404 });
    return r.rows[0];
  }

  // ---- Principal's remarks (0195) ------------------------------------------------------------------

  /** A school starts with a few plain lines per grade; the office rewrites them or uploads its own. */
  private async seedRemarks(c: PoolClient) {
    const n = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM acr_remarks');
    if (n.rows[0]!.n) return;
    const bands = (
      await c.query<{ label: string }>('SELECT label FROM acr_grade_bands ORDER BY min_pct DESC')
    ).rows.map((b) => b.label);
    const lines: Record<string, string[]> = {
      [bands[0] ?? 'Outstanding']: [
        'Has shown a consistently high level of performance; a positive attitude that encourages others.',
        'Respects deadlines and delivers more than assigned; recommended for higher responsibility.',
      ],
      [bands[1] ?? 'Very good']: [
        'Sincere and diligent; attends to assigned duties well and keeps good class control.',
        'Communicates ideas clearly; a dependable member of the team.',
      ],
      [bands[2] ?? 'Good']: [
        'Knows the subject well; can perform better with more initiative in school activities.',
        'Completes assigned duties on time; improved use of technology in teaching recommended.',
      ],
      [bands[3] ?? 'Average']: [
        'Has the potential to contribute more; needs to follow instructions more closely.',
        'Needs to improve communication skills and adopt better classroom strategies.',
      ],
      [bands[bands.length - 1] ?? 'Below average']: [
        'Needs to improve punctuality, attendance and adherence to school norms.',
        'Loses instructional time; training and mentoring recommended.',
      ],
    };
    let i = 0;
    for (const [grade, texts] of Object.entries(lines))
      for (const text of texts)
        await c.query(
          `INSERT INTO acr_remarks (school_id, grade, text, sort_order) VALUES (app.current_school_id(), $1, $2, $3)`,
          [grade, text, (i++ + 1) * 10],
        );
  }

  /** The whole list at once: lines with an id change, new lines are added, lines left out switch off. */
  async saveRemarks(ctx: RequestContext, dto: AcrRemarksDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seed(c);
      const keep: string[] = [];
      for (const l of dto.lines) {
        if (l.id) {
          const u = await c.query(
            `UPDATE acr_remarks SET grade = $2, text = $3, sort_order = $4, active = $5 WHERE id = $1`,
            [l.id, l.grade, l.text, l.sortOrder, l.active],
          );
          if (u.rowCount) keep.push(l.id);
          continue;
        }
        const r = await c.query<{ id: string }>(
          `INSERT INTO acr_remarks (school_id, grade, text, sort_order, active, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id()) RETURNING id::text`,
          [l.grade, l.text, l.sortOrder, l.active],
        );
        keep.push(r.rows[0]!.id);
      }
      await c.query(`UPDATE acr_remarks SET active = false WHERE NOT (id = ANY($1::bigint[]))`, [
        keep,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'people.acr.remarks.save',
        entityType: 'acr_remarks',
        entityId: requireTenant(ctx).schoolId,
        after: { lines: keep.length },
      });
      return { saved: keep.length };
    });
  }

  /**
   * Lines from a spreadsheet: the grade is matched to a band's label (a leading "02/05 -" is dropped;
   * "Excellent" is the top band, "Very bad" the bottom); a line already there, or a dash, is skipped.
   */
  async importRemarks(ctx: RequestContext, dto: AcrRemarksImportDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seed(c);
      const bands = (
        await c.query<{ label: string }>('SELECT label FROM acr_grade_bands ORDER BY min_pct DESC')
      ).rows.map((b) => b.label);
      const norm = (g: string) => {
        const t = g
          .replace(/^\s*\d+\s*\/\s*\d+\s*-\s*/, '')
          .trim()
          .toLowerCase();
        const hit = bands.find((b) => b.toLowerCase() === t);
        if (hit) return hit;
        if (/^excellent$/.test(t)) return bands[0] ?? g.trim();
        if (/^(very bad|poor)$/.test(t)) return bands[bands.length - 1] ?? g.trim();
        return g.trim();
      };
      const have = new Set(
        (
          await c.query<{ k: string }>(`SELECT grade || '|' || lower(text) AS k FROM acr_remarks`)
        ).rows.map((x) => x.k),
      );
      let added = 0;
      let skipped = 0;
      let order =
        (
          await c.query<{ m: number }>(
            'SELECT COALESCE(max(sort_order), 0)::int AS m FROM acr_remarks',
          )
        ).rows[0]!.m + 10;
      for (const row of dto.rows) {
        const text = row.text.replace(/\s+/g, ' ').trim();
        const grade = norm(row.grade);
        if (!grade || text.length < 3 || /^[-–—.]+$/.test(text)) {
          skipped++;
          continue;
        }
        const k = `${grade}|${text.toLowerCase()}`;
        if (have.has(k)) {
          skipped++;
          continue;
        }
        have.add(k);
        await c.query(
          `INSERT INTO acr_remarks (school_id, grade, text, sort_order, active, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id())`,
          [grade, text, order, row.active ?? true],
        );
        order += 10;
        added++;
      }
      await this.audit.stage(ctx, c, {
        action: 'people.acr.remarks.import',
        entityType: 'acr_remarks',
        entityId: requireTenant(ctx).schoolId,
        after: { added, skipped },
      });
      return { added, skipped };
    });
  }

  /** 0192: the employee types a self form is for, checked against Staff setup; null = leave as they are. */
  private async employeeTypeIds(c: PoolClient, dto: AcrFormDto): Promise<string[] | null> {
    if (dto.part === 'level') return [];
    if (!dto.employeeTypeIds) return null;
    const ids = [...new Set(dto.employeeTypeIds)];
    if (!ids.length) return [];
    const ok = await c.query<{ id: string }>(
      `SELECT id::text FROM employee_types WHERE id = ANY($1::bigint[])`,
      [ids],
    );
    if (ok.rows.length !== ids.length)
      throw new DomainError('acr.employee_type', 'An employee type named is not in Staff setup', {
        status: 400,
      });
    return ids;
  }

  async saveForm(ctx: RequestContext, id: string | null, dto: AcrFormDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seed(c);
      const types = await this.employeeTypeIds(c, dto);
      if (id) {
        const f = await this.formOf(c, id);
        if (f.part !== dto.part)
          throw new DomainError(
            'acr.form_part',
            'A form stays a self-appraisal or a questionnaire',
            {
              status: 400,
            },
          );
        await c.query(
          `UPDATE acr_forms SET name = $2, staff_group = $3, description = $4, active = $5, sort_order = $6,
                  employee_type_ids = COALESCE($7::bigint[], employee_type_ids) WHERE id = $1`,
          [id, dto.name, dto.staffGroup, dto.description ?? null, dto.active, dto.sortOrder, types],
        );
        await c.query(`UPDATE acr_questions SET staff_group = $2 WHERE form_id = $1`, [
          id,
          dto.staffGroup,
        ]);
        await this.refreshOpenAcrForms(c);
        await this.audit.stage(ctx, c, {
          action: 'people.acr.form.save',
          entityType: 'acr_forms',
          entityId: id,
        });
        return { id };
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO acr_forms (school_id, name, part, staff_group, description, active, sort_order, employee_type_ids)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7::bigint[]) RETURNING id::text`,
        [
          dto.name,
          dto.part,
          dto.staffGroup,
          dto.description ?? null,
          dto.active,
          dto.sortOrder,
          types ?? [],
        ],
      );
      await this.refreshOpenAcrForms(c);
      await this.audit.stage(ctx, c, {
        action: 'people.acr.form.save',
        entityType: 'acr_forms',
        entityId: r.rows[0]!.id,
      });
      return { id: r.rows[0]!.id };
    });
  }

  /**
   * The levels that answer a questionnaire, set from the form's side: the levels named take this form
   * (whatever they answered before); a level that answered it and is not named is left without one,
   * unless it rates the questions, which needs a questionnaire.
   */
  async setFormLevels(ctx: RequestContext, id: string, dto: AcrFormLevelsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = await this.formOf(c, id);
      if (f.part !== 'level')
        throw new DomainError(
          'acr.form_part',
          'Only a level questionnaire is answered by a level',
          {
            status: 400,
          },
        );
      for (const l of dto.levels)
        if (f.staff_group !== 'both' && f.staff_group !== l.staffGroup)
          throw new DomainError(
            'acr.level_form',
            `This form is for ${f.staff_group === 'teaching' ? 'teaching' : 'non-teaching'} staff; choose levels of that chain`,
            { status: 400 },
          );
      const using = await c.query<{
        staff_group: string;
        seq: number;
        label: string;
        action: string;
      }>(`SELECT staff_group, seq, label, action FROM acr_levels WHERE form_id = $1`, [id]);
      const named = (g: string, seq: number) =>
        dto.levels.some((l) => l.staffGroup === g && l.seq === seq);
      for (const u of using.rows)
        if (!named(u.staff_group, u.seq) && u.action === 'rate')
          throw new DomainError(
            'acr.level_form',
            `${u.label} (${u.staff_group === 'teaching' ? 'teaching' : 'non-teaching'}) rates the questions and needs a questionnaire: give it another one under Approval levels first`,
            { status: 409 },
          );
      await c.query(`UPDATE acr_levels SET form_id = NULL WHERE form_id = $1`, [id]);
      let set = 0;
      for (const l of dto.levels) {
        const r = await c.query(
          `UPDATE acr_levels SET form_id = $1 WHERE staff_group = $2 AND seq = $3`,
          [id, l.staffGroup, l.seq],
        );
        set += r.rowCount ?? 0;
      }
      const followed = await this.refreshOpenAcrForms(c);
      await this.audit.stage(ctx, c, {
        action: 'people.acr.form.levels',
        entityType: 'acr_forms',
        entityId: id,
        after: { levels: dto.levels, set, followed },
      });
      return { set, followed };
    });
  }

  /** A copy with its sections and questions: the start of another form (another category or level). */
  async copyForm(ctx: RequestContext, id: string, dto: AcrFormCopyDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = await this.formOf(c, id);
      const n = await c.query<{ id: string }>(
        `INSERT INTO acr_forms (school_id, name, part, staff_group, description, active, sort_order, employee_type_ids)
         SELECT app.current_school_id(), $2, part, $3, description, true, sort_order + 1, employee_type_ids FROM acr_forms WHERE id = $1
         RETURNING id::text`,
        [id, dto.name, dto.staffGroup ?? f.staff_group],
      );
      const newId = n.rows[0]!.id;
      const secs = await c.query<{
        id: string;
        title: string;
        help: string | null;
        weight: string;
        sort_order: number;
      }>(
        `SELECT id::text, title, help, weight::text, sort_order FROM acr_form_sections WHERE form_id = $1 ORDER BY sort_order, id`,
        [id],
      );
      for (const sec of secs.rows) {
        const ns = await c.query<{ id: string }>(
          `INSERT INTO acr_form_sections (school_id, form_id, title, help, weight, sort_order)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5) RETURNING id::text`,
          [newId, sec.title, sec.help, sec.weight, sec.sort_order],
        );
        await c.query(
          `INSERT INTO acr_questions (school_id, part, staff_group, section, text, kind, weight, required, sort_order, active, form_id, section_id)
           SELECT app.current_school_id(), part, $4, section, text, kind, weight, required, sort_order, active, $2, $3
             FROM acr_questions WHERE section_id = $1 ORDER BY sort_order, id`,
          [sec.id, newId, ns.rows[0]!.id, dto.staffGroup ?? f.staff_group],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'people.acr.form.copy',
        entityType: 'acr_forms',
        entityId: newId,
        after: { from: id },
      });
      return { id: newId };
    });
  }

  async saveSection(ctx: RequestContext, id: string | null, dto: AcrSectionDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.formOf(c, dto.formId);
      if (id) {
        const r = await c.query(
          `UPDATE acr_form_sections SET title = $2, help = $3, weight = $4, sort_order = $5 WHERE id = $1 AND form_id = $6`,
          [id, dto.title, dto.help ?? null, dto.weight, dto.sortOrder, dto.formId],
        );
        if (!r.rowCount) throw new DomainError('not-found', 'Section not found', { status: 404 });
        await c.query(`UPDATE acr_questions SET section = $2 WHERE section_id = $1`, [
          id,
          dto.title,
        ]);
        return { id };
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO acr_form_sections (school_id, form_id, title, help, weight, sort_order)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5) RETURNING id::text`,
        [dto.formId, dto.title, dto.help ?? null, dto.weight, dto.sortOrder],
      );
      return { id: r.rows[0]!.id };
    });
  }

  /** An empty section goes; one with questions is kept (move or switch off its questions first). */
  async deleteSection(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const n = await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM acr_questions WHERE section_id = $1',
        [id],
      );
      if (Number(n.rows[0]?.n ?? 0) > 0)
        throw new DomainError('acr.section_in_use', 'Move or switch off its questions first', {
          status: 409,
        });
      const r = await c.query('DELETE FROM acr_form_sections WHERE id = $1', [id]);
      if (!r.rowCount) throw new DomainError('not-found', 'Section not found', { status: 404 });
      return { ok: true };
    });
  }

  async saveQuestion(ctx: RequestContext, id: string | null, dto: AcrQuestionDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = await this.formOf(c, dto.formId);
      const sec = await c.query<{ title: string }>(
        'SELECT title FROM acr_form_sections WHERE id = $1 AND form_id = $2',
        [dto.sectionId, dto.formId],
      );
      if (!sec.rows[0])
        throw new DomainError('acr.section', 'Choose a section of this form', { status: 400 });
      const part = f.part === 'self' ? 'self' : 'rate';
      if (id) {
        const r = await c.query(
          `UPDATE acr_questions SET part = $2, staff_group = $3, section = $4, text = $5, kind = $6, weight = $7,
                  required = $8, sort_order = $9, active = $10, form_id = $11, section_id = $12
            WHERE id = $1`,
          [
            id,
            part,
            f.staff_group,
            sec.rows[0].title,
            dto.text,
            dto.kind,
            dto.weight,
            dto.required,
            dto.sortOrder,
            dto.active,
            dto.formId,
            dto.sectionId,
          ],
        );
        if (!r.rowCount) throw new DomainError('not-found', 'Question not found', { status: 404 });
        await this.audit.stage(ctx, c, {
          action: 'people.acr.question.save',
          entityType: 'acr_questions',
          entityId: id,
        });
        return { id };
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO acr_questions (school_id, part, staff_group, section, text, kind, weight, required, sort_order, active, form_id, section_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id::text`,
        [
          part,
          f.staff_group,
          sec.rows[0].title,
          dto.text,
          dto.kind,
          dto.weight,
          dto.required,
          dto.sortOrder,
          dto.active,
          dto.formId,
          dto.sectionId,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.acr.question.save',
        entityType: 'acr_questions',
        entityId: r.rows[0]!.id,
      });
      return { id: r.rows[0]!.id };
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

  /**
   * The chain of each staff group as the Assessors screen shows it (0190): every level, with the record
   * field it reads when it is employee-wise, the designation it falls back to, or who fills it otherwise.
   */
  private async assessorLevels(c: PoolClient) {
    const r = await c.query<{
      staff_group: Group;
      seq: number;
      label: string;
      kind: string;
      role_code: string | null;
      designation: string | null;
      employee_name: string | null;
    }>(
      `SELECT l.staff_group, l.seq, l.label, l.kind, l.role_code, l.designation, e.display_name AS employee_name
         FROM acr_levels l LEFT JOIN employees e ON e.id = l.employee_id ORDER BY l.staff_group, l.seq`,
    );
    const out: Record<
      Group,
      Array<{
        seq: number;
        label: string;
        kind: string;
        field: AssessorKind | null;
        fallback: string | null;
        fixed: string | null;
      }>
    > = { teaching: [], non_teaching: [] };
    for (const x of r.rows)
      out[x.staff_group].push({
        seq: x.seq,
        label: x.label,
        kind: x.kind,
        field: (ASSESSOR_KINDS as readonly string[]).includes(x.kind)
          ? (x.kind as AssessorKind)
          : null,
        fallback: x.kind === 'acr_reviewer' ? x.designation : null,
        fixed:
          x.kind === 'designation'
            ? `everyone with the designation ${x.designation ?? ''}`
            : x.kind === 'role'
              ? `everyone with the role ${x.role_code ?? ''}`
              : x.kind === 'employee'
                ? (x.employee_name ?? 'a named person')
                : null,
      });
    return out;
  }

  /**
   * Every active employee with who assesses them at each level of their group's chain, who is missing,
   * and the filters' departments. The record fields in use are the CSV's columns.
   */
  async assessors(ctx: RequestContext, q: AcrAssessorsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seed(c);
      const levels = await this.assessorLevels(c);
      const fields: Array<{ key: AssessorKind; label: string }> = [];
      for (const g of ['teaching', 'non_teaching'] as const)
        for (const l of levels[g])
          if (l.field && !fields.some((f) => f.key === l.field))
            fields.push({ key: l.field, label: l.label });
      if (!fields.length) fields.push({ key: 'acr_hod', label: 'HOD' });
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
        for (const f of fields) {
          const v = x.profile[f.key];
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
        const group: Group = x.side === 'non_teaching' ? 'non_teaching' : 'teaching';
        const assessors: Record<string, { id: string; name: string; code: string } | null> = {};
        for (const f of fields) {
          const v = x.profile[f.key];
          const id = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
          assessors[f.key] = (id && names.get(id)) || null;
        }
        return {
          id: x.id,
          code: x.code,
          name: x.name,
          department: x.department,
          designation: x.designation,
          staffGroup: group,
          assessors,
          // a level of their chain that reads the record, with nobody there and no fallback designation
          missing: levels[group].some((l) => l.field && !assessors[l.field] && !l.fallback),
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
        levels,
        maxSeq: Math.max(
          0,
          ...levels.teaching.map((l) => l.seq),
          ...levels.non_teaching.map((l) => l.seq),
        ),
        fields,
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
      const employeeIds: string[] = [];
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
        employeeIds.push(emp);
      }
      const changed = employeeIds.length;
      await this.audit.stage(ctx, c, {
        action: 'people.acr.assessors.save',
        entityType: 'employees',
        entityId: requireTenant(ctx).schoolId,
        after: { changed, errors: errors.length },
      });
      return { changed, errors, employeeIds };
    });
  }
}
