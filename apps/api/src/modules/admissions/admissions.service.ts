import { Injectable } from '@nestjs/common';
import {
  DEFAULT_ADMISSION_FORM,
  type FormField,
  type PoolClient,
  type TenantContext,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type {
  CreateCycleDto,
  ListApplicationsQueryDto,
  ScoreApplicationDto,
  SetApplicationStatusDto,
  UpdateCycleDto,
} from './admissions.dto';

export interface CriterionRow {
  id: string;
  classId: string;
  classCode: string;
  className: string;
  seats: number;
  dobFrom: string | null;
  dobTo: string | null;
  passcode: string | null;
  applications: number;
}

export interface ScoreCriterionRow {
  id: string;
  code: string;
  name: string;
  points: number;
  autoRule: string | null;
}

export interface CycleRow {
  id: string;
  academicYearId: string;
  academicYear: string;
  code: string;
  name: string;
  nameHi: string | null;
  instructions: string | null;
  instructionsHi: string | null;
  opensAt: string;
  closesAt: string;
  status: 'draft' | 'open' | 'closed';
  formSchema: FormField[];
  applicationFee: string;
  criteria: CriterionRow[];
  scoreCriteria: ScoreCriterionRow[];
  applications: number;
}

export interface ApplicationRow {
  id: string;
  cycleId: string;
  cycleCode: string;
  classId: string;
  classCode: string;
  applicantId: string;
  applicantMobile: string;
  applicantName: string | null;
  applicationNo: string | null;
  status: string;
  childFirstName: string;
  childLastName: string | null;
  childName: string;
  childDob: string;
  childGender: string;
  data: Record<string, unknown>;
  score: string | null;
  scoreBreakdown: Array<{ code: string; name: string; points: number; source: string }>;
  possibleDuplicateOf: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  remarks: string | null;
  createdAt: string;
  feePaidAt: string | null;
  studentId: string | null;
  workflowInstanceId: string | null;
  /** Sprint 9: the offer (with the admission fee payment form) once the application is selected. */
  offer?: unknown;
  events?: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    actor: string | null;
    createdAt: string;
  }>;
}

const CYCLE_SELECT = `SELECT c.id::text, c.academic_year_id::text, y.code AS academic_year, c.code, c.name, c.name_hi, c.instructions, c.instructions_hi,
        c.opens_at, c.closes_at, c.status, c.form_schema, c.application_fee::text,
        (SELECT count(*)::int FROM applications a WHERE a.cycle_id = c.id AND a.status <> 'draft') AS applications,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', k.id::text, 'classId', k.class_id::text, 'classCode', cl.code, 'className', cl.name, 'seats', k.seats,
                    'dobFrom', k.dob_from::text, 'dobTo', k.dob_to::text, 'passcode', k.passcode,
                    'applications', (SELECT count(*)::int FROM applications a WHERE a.cycle_id = c.id AND a.class_id = k.class_id AND a.status <> 'draft')) ORDER BY cl.display_order)
                    FROM admission_class_criteria k JOIN classes cl ON cl.id = k.class_id WHERE k.cycle_id = c.id), '[]'::jsonb) AS criteria,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id::text, 'code', s.code, 'name', s.name, 'points', s.points, 'autoRule', s.auto_rule) ORDER BY s.sort_order, s.id)
                    FROM admission_score_criteria s WHERE s.cycle_id = c.id), '[]'::jsonb) AS score_criteria
   FROM admission_cycles c JOIN academic_years y ON y.id = c.academic_year_id`;

interface CycleDb {
  id: string;
  academic_year_id: string;
  academic_year: string;
  code: string;
  name: string;
  name_hi: string | null;
  instructions: string | null;
  instructions_hi: string | null;
  opens_at: Date;
  closes_at: Date;
  status: CycleRow['status'];
  form_schema: FormField[];
  application_fee: string;
  applications: number;
  criteria: CriterionRow[];
  score_criteria: ScoreCriterionRow[];
}

export const toCycle = (r: CycleDb): CycleRow => ({
  id: r.id,
  academicYearId: r.academic_year_id,
  academicYear: r.academic_year,
  code: r.code,
  name: r.name,
  nameHi: r.name_hi,
  instructions: r.instructions,
  instructionsHi: r.instructions_hi,
  opensAt: r.opens_at.toISOString(),
  closesAt: r.closes_at.toISOString(),
  status: r.status,
  formSchema: r.form_schema,
  applicationFee: r.application_fee,
  criteria: r.criteria,
  scoreCriteria: r.score_criteria,
  applications: r.applications,
});

export const APP_SELECT = `SELECT a.id::text, a.cycle_id::text, c.code AS cycle_code, a.class_id::text, cl.code AS class_code, a.applicant_id::text,
        ap.mobile AS applicant_mobile, ap.name AS applicant_name, a.application_no, a.status::text, a.child_first_name, a.child_last_name,
        btrim(a.child_first_name || ' ' || coalesce(a.child_last_name, '')) AS child_name, a.child_dob::text, a.child_gender::text, a.data,
        a.score::text, a.score_breakdown, a.possible_duplicate_of::text, a.submitted_at, a.decided_at, a.remarks, a.created_at,
        a.fee_paid_at, a.student_id::text, a.workflow_instance_id::text
   FROM applications a JOIN admission_cycles c ON c.id = a.cycle_id JOIN classes cl ON cl.id = a.class_id JOIN applicants ap ON ap.id = a.applicant_id`;

export interface AppDb {
  id: string;
  cycle_id: string;
  cycle_code: string;
  class_id: string;
  class_code: string;
  applicant_id: string;
  applicant_mobile: string;
  applicant_name: string | null;
  application_no: string | null;
  status: string;
  child_first_name: string;
  child_last_name: string | null;
  child_name: string;
  child_dob: string;
  child_gender: string;
  data: Record<string, unknown>;
  score: string | null;
  score_breakdown: ApplicationRow['scoreBreakdown'];
  possible_duplicate_of: string | null;
  submitted_at: Date | null;
  decided_at: Date | null;
  remarks: string | null;
  created_at: Date;
  fee_paid_at?: Date | null;
  student_id?: string | null;
  workflow_instance_id?: string | null;
}

export const toApplication = (r: AppDb): ApplicationRow => ({
  id: r.id,
  cycleId: r.cycle_id,
  cycleCode: r.cycle_code,
  classId: r.class_id,
  classCode: r.class_code,
  applicantId: r.applicant_id,
  applicantMobile: r.applicant_mobile,
  applicantName: r.applicant_name,
  applicationNo: r.application_no,
  status: r.status,
  childFirstName: r.child_first_name,
  childLastName: r.child_last_name,
  childName: r.child_name,
  childDob: r.child_dob,
  childGender: r.child_gender,
  data: r.data,
  score: r.score,
  scoreBreakdown: r.score_breakdown,
  possibleDuplicateOf: r.possible_duplicate_of,
  submittedAt: r.submitted_at ? r.submitted_at.toISOString() : null,
  decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
  remarks: r.remarks,
  createdAt: r.created_at.toISOString(),
  feePaidAt: r.fee_paid_at ? r.fee_paid_at.toISOString() : null,
  studentId: r.student_id ?? null,
  workflowInstanceId: r.workflow_instance_id ?? null,
});

/**
 * Automatic scoring rules (S8-04), evaluated against school data and the answers:
 *   sibling            an active student of the school shares the applicant's mobile (guardian) or the quoted admission number
 *   staff_ward         an active employee has the applicant's mobile
 *   alumni             the applicant answered alumniParent = true
 *   single_girl_child  the applicant answered singleGirlChild = true and the child is a girl
 *   distance_within:N  data.distanceKm <= N
 */
export async function computeScore(
  c: PoolClient,
  app: { applicantMobile: string; childGender: string; data: Record<string, unknown> },
  criteria: ScoreCriterionRow[],
  manualCodes: string[],
): Promise<{ score: number; breakdown: ApplicationRow['scoreBreakdown'] }> {
  const breakdown: ApplicationRow['scoreBreakdown'] = [];
  for (const k of criteria) {
    let awarded = false;
    let source = 'auto';
    if (k.autoRule === 'sibling') {
      const adm =
        typeof app.data.siblingAdmissionNo === 'string' ? app.data.siblingAdmissionNo.trim() : '';
      const r = await c.query(
        `SELECT 1 FROM students s WHERE s.deleted_at IS NULL AND s.status = 'active' AND (
             s.id IN (SELECT sg.student_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE g.mobile = $1)
          OR ($2 <> '' AND s.admission_no = $2)) LIMIT 1`,
        [app.applicantMobile, adm],
      );
      awarded = (r.rowCount ?? 0) > 0;
    } else if (k.autoRule === 'staff_ward') {
      const r = await c.query(
        `SELECT 1 FROM employees WHERE mobile = $1 AND deleted_at IS NULL AND status = 'active' LIMIT 1`,
        [app.applicantMobile],
      );
      awarded = (r.rowCount ?? 0) > 0;
    } else if (k.autoRule === 'alumni') awarded = app.data.alumniParent === true;
    else if (k.autoRule === 'single_girl_child')
      awarded = app.data.singleGirlChild === true && app.childGender === 'female';
    else if (k.autoRule?.startsWith('distance_within:')) {
      const km = Number(k.autoRule.split(':')[1]);
      awarded = typeof app.data.distanceKm === 'number' && app.data.distanceKm <= km;
    } else {
      awarded = manualCodes.includes(k.code);
      source = 'manual';
    }
    if (awarded) breakdown.push({ code: k.code, name: k.name, points: Number(k.points), source });
  }
  return { score: breakdown.reduce((s, b) => s + b.points, 0), breakdown };
}

/** Admission cycles, criteria, scoring masters and the intake desk (S8-03, S8-04). */
@Injectable()
export class AdmissionsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async listCycles(ctx: RequestContext): Promise<CycleRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<CycleDb>(
        // eslint-disable-next-line no-restricted-syntax -- fixed SQL fragments assembled in code; values are bound parameters
        `${CYCLE_SELECT} WHERE c.deleted_at IS NULL ORDER BY c.opens_at DESC`,
      );
      return r.rows.map(toCycle);
    });
  }

  async findCycle(c: PoolClient, id: string): Promise<CycleRow | null> {
    // eslint-disable-next-line no-restricted-syntax -- CYCLE_SELECT is a constant; values are bound parameters
    const r = await c.query<CycleDb>(`${CYCLE_SELECT} WHERE c.id = $1 AND c.deleted_at IS NULL`, [
      id,
    ]);
    return r.rows[0] ? toCycle(r.rows[0]) : null;
  }

  async getCycle(ctx: RequestContext, id: string): Promise<CycleRow> {
    const row = await this.db.tenant(requireTenant(ctx), (c) => this.findCycle(c, id));
    if (!row) throw new DomainError('not-found', 'Admission cycle not found');
    return row;
  }

  private async writeCriteria(
    c: PoolClient,
    cycleId: string,
    criteria: CreateCycleDto['criteria'],
  ): Promise<void> {
    await c.query(
      `DELETE FROM admission_class_criteria WHERE cycle_id = $1 AND class_id <> ALL($2::bigint[])`,
      [cycleId, criteria.map((k) => k.classId)],
    );
    for (const k of criteria)
      await c.query(
        `INSERT INTO admission_class_criteria (school_id, cycle_id, class_id, seats, dob_from, dob_to, passcode)
         VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5::date, $6)
         ON CONFLICT (cycle_id, class_id) DO UPDATE SET seats = EXCLUDED.seats, dob_from = EXCLUDED.dob_from, dob_to = EXCLUDED.dob_to, passcode = EXCLUDED.passcode`,
        [cycleId, k.classId, k.seats, k.dobFrom ?? null, k.dobTo ?? null, k.passcode ?? null],
      );
  }

  private async writeScoreCriteria(
    c: PoolClient,
    cycleId: string,
    list: CreateCycleDto['scoreCriteria'],
  ): Promise<void> {
    await c.query(
      `DELETE FROM admission_score_criteria WHERE cycle_id = $1 AND code <> ALL($2::text[])`,
      [cycleId, list.map((s) => s.code)],
    );
    for (const [i, s] of list.entries())
      await c.query(
        `INSERT INTO admission_score_criteria (school_id, cycle_id, code, name, points, auto_rule, sort_order)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6)
         ON CONFLICT (cycle_id, code) DO UPDATE SET name = EXCLUDED.name, points = EXCLUDED.points, auto_rule = EXCLUDED.auto_rule, sort_order = EXCLUDED.sort_order`,
        [cycleId, s.code, s.name, s.points, s.autoRule ?? null, i],
      );
  }

  async createCycle(ctx: RequestContext, dto: CreateCycleDto): Promise<CycleRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO admission_cycles (school_id, academic_year_id, code, name, name_hi, instructions, instructions_hi, opens_at, closes_at, form_schema, application_fee, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9::jsonb, $10, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [
            dto.academicYearId,
            dto.code,
            dto.name,
            dto.nameHi ?? null,
            dto.instructions ?? null,
            dto.instructionsHi ?? null,
            dto.opensAt,
            dto.closesAt,
            JSON.stringify(dto.formSchema ?? DEFAULT_ADMISSION_FORM),
            dto.applicationFee,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Cycle code "${dto.code}" already exists`);
        throw error;
      }
      await this.writeCriteria(c, id, dto.criteria);
      await this.writeScoreCriteria(c, id, dto.scoreCriteria);
      const created = (await this.findCycle(c, id))!;
      await this.audit.stage(ctx, c, {
        action: 'admissions.cycle.create',
        entityType: 'admission_cycles',
        entityId: id,
        after: { code: created.code, name: created.name },
      });
      return created;
    });
  }

  async updateCycle(ctx: RequestContext, id: string, dto: UpdateCycleDto): Promise<CycleRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.findCycle(c, id);
      if (!before) throw new DomainError('not-found', 'Admission cycle not found');
      const sets: string[] = ['updated_at = now()', 'updated_by = app.current_user_id()'];
      const params: unknown[] = [];
      const set = (col: string, value: unknown, cast = '') => {
        params.push(value);
        sets.push(`${col} = $${params.length}${cast}`);
      };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.nameHi !== undefined) set('name_hi', dto.nameHi);
      if (dto.instructions !== undefined) set('instructions', dto.instructions);
      if (dto.instructionsHi !== undefined) set('instructions_hi', dto.instructionsHi);
      if (dto.opensAt !== undefined) set('opens_at', dto.opensAt, '::timestamptz');
      if (dto.closesAt !== undefined) set('closes_at', dto.closesAt, '::timestamptz');
      if (dto.applicationFee !== undefined) set('application_fee', dto.applicationFee);
      if (dto.formSchema !== undefined)
        set('form_schema', JSON.stringify(dto.formSchema), '::jsonb');
      if (dto.status !== undefined) set('status', dto.status, '::admission_cycle_status');
      params.push(id);
      await c.query(
        // eslint-disable-next-line no-restricted-syntax -- sets holds fixed column assignments; values are bound parameters
        `UPDATE admission_cycles SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      );
      if (dto.criteria) await this.writeCriteria(c, id, dto.criteria);
      if (dto.scoreCriteria) await this.writeScoreCriteria(c, id, dto.scoreCriteria);
      const after = (await this.findCycle(c, id))!;
      await this.audit.stage(ctx, c, {
        action:
          dto.status && dto.status !== before.status
            ? `admissions.cycle.${dto.status}`
            : 'admissions.cycle.edit',
        entityType: 'admission_cycles',
        entityId: id,
        before: { status: before.status, name: before.name },
        after: { status: after.status, name: after.name },
      });
      return after;
    });
  }

  // ---- applications ------------------------------------------------------------------------------
  async listApplications(
    ctx: RequestContext,
    q: ListApplicationsQueryDto,
  ): Promise<{ rows: ApplicationRow[]; total: number }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where: string[] = [`a.status <> 'draft'`];
      const params: unknown[] = [];
      if (q.cycleId) {
        params.push(q.cycleId);
        where.push(`a.cycle_id = $${params.length}`);
      }
      if (q.classId) {
        params.push(q.classId);
        where.push(`a.class_id = $${params.length}`);
      }
      if (q.status) {
        params.push(q.status);
        where.push(`a.status = $${params.length}::application_status`);
      }
      if (q.duplicates) where.push('a.possible_duplicate_of IS NOT NULL');
      if (q.q) {
        params.push(`%${q.q}%`);
        where.push(
          `(a.application_no ILIKE $${params.length} OR a.child_first_name ILIKE $${params.length} OR a.child_last_name ILIKE $${params.length} OR ap.mobile ILIKE $${params.length})`,
        );
      }
      const whereSql = where.join(' AND ');
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql is a conjunction of fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM applications a JOIN applicants ap ON ap.id = a.applicant_id WHERE ${whereSql}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<AppDb>(
        // eslint-disable-next-line no-restricted-syntax -- APP_SELECT is a constant; whereSql holds fixed fragments; values are bound parameters
        `${APP_SELECT} WHERE ${whereSql} ORDER BY a.submitted_at DESC NULLS LAST, a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { rows: r.rows.map(toApplication), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  async applicationWith(c: PoolClient, id: string): Promise<ApplicationRow> {
    // eslint-disable-next-line no-restricted-syntax -- APP_SELECT is a constant; values are bound parameters
    const r = await c.query<AppDb>(`${APP_SELECT} WHERE a.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Application not found');
    const row = toApplication(r.rows[0]);
    const ev = await c.query<{
      id: string;
      from_status: string | null;
      to_status: string;
      note: string | null;
      actor: string | null;
      created_at: Date;
    }>(
      `SELECT e.id::text, e.from_status::text, e.to_status::text, e.note, COALESCE(u.display_name, CASE WHEN e.actor_applicant_id IS NOT NULL THEN 'applicant' END) AS actor, e.created_at
         FROM application_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.application_id = $1 ORDER BY e.id`,
      [id],
    );
    row.events = ev.rows.map((x) => ({
      id: x.id,
      fromStatus: x.from_status,
      toStatus: x.to_status,
      note: x.note,
      actor: x.actor,
      createdAt: x.created_at.toISOString(),
    }));
    return row;
  }

  async getApplication(ctx: RequestContext, id: string): Promise<ApplicationRow> {
    return this.db.tenant(requireTenant(ctx), (c) => this.applicationWith(c, id));
  }

  async setStatus(
    ctx: RequestContext,
    id: string,
    dto: SetApplicationStatusDto,
  ): Promise<ApplicationRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.applicationWith(c, id);
      if (before.status === 'draft')
        throw new DomainError('admission.not_submitted', 'The application has not been submitted', {
          status: 409,
        });
      await c.query(
        `UPDATE applications SET status = $2::application_status, decided_at = CASE WHEN $2 IN ('selected', 'rejected', 'waitlisted', 'withdrawn') THEN now() ELSE decided_at END,
                decided_by = app.current_user_id(), remarks = COALESCE($3, remarks), updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id, dto.status, dto.note ?? null],
      );
      await c.query(
        `INSERT INTO application_events (school_id, application_id, from_status, to_status, note, actor_user_id) VALUES (app.current_school_id(), $1, $2::application_status, $3::application_status, $4, app.current_user_id())`,
        [id, before.status, dto.status, dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: `admissions.application.${dto.status}`,
        entityType: 'applications',
        entityId: id,
        before: { status: before.status },
        after: { status: dto.status, note: dto.note ?? null },
      });
      return this.applicationWith(c, id);
    });
  }

  async score(ctx: RequestContext, id: string, dto: ScoreApplicationDto): Promise<ApplicationRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.applicationWith(c, id);
      const cycle = (await this.findCycle(c, before.cycleId))!;
      const { score, breakdown } = await computeScore(c, before, cycle.scoreCriteria, dto.award);
      await c.query(
        `UPDATE applications SET score = $2, score_breakdown = $3::jsonb, remarks = COALESCE($4, remarks), updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id, score, JSON.stringify(breakdown), dto.remarks ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.application.score',
        entityType: 'applications',
        entityId: id,
        before: { score: before.score },
        after: { score, breakdown },
      });
      return this.applicationWith(c, id);
    });
  }

  async dashboard(ctx: RequestContext, cycleId?: string) {
    const tenant: TenantContext = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const params: unknown[] = [];
      let where = `a.status <> 'draft' AND c.deleted_at IS NULL`;
      if (cycleId) {
        params.push(cycleId);
        where += ` AND a.cycle_id = $1`;
      }
      const byStatus = await c.query<{ status: string; n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- where is built from fixed fragments; values are bound parameters
        `SELECT a.status::text, count(*)::int AS n FROM applications a JOIN admission_cycles c ON c.id = a.cycle_id WHERE ${where} GROUP BY a.status ORDER BY a.status`,
        params,
      );
      const byClass = await c.query<{
        cycle: string;
        class_code: string;
        seats: number;
        applications: number;
        shortlisted: number;
        selected: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- where is built from fixed fragments; values are bound parameters
        `SELECT c.code AS cycle, cl.code AS class_code, k.seats, count(a.id)::int AS applications,
                count(a.id) FILTER (WHERE a.status = 'shortlisted')::int AS shortlisted, count(a.id) FILTER (WHERE a.status = 'selected')::int AS selected
           FROM admission_class_criteria k JOIN admission_cycles c ON c.id = k.cycle_id JOIN classes cl ON cl.id = k.class_id
           LEFT JOIN applications a ON a.cycle_id = k.cycle_id AND a.class_id = k.class_id AND a.status <> 'draft'
          WHERE c.deleted_at IS NULL ${cycleId ? 'AND k.cycle_id = $1' : ''}
          GROUP BY c.code, cl.code, cl.display_order, k.seats ORDER BY c.code, cl.display_order`,
        params,
      );
      const duplicates = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- where is built from fixed fragments; values are bound parameters
        `SELECT count(*)::int AS n FROM applications a JOIN admission_cycles c ON c.id = a.cycle_id WHERE ${where} AND a.possible_duplicate_of IS NOT NULL`,
        params,
      );
      return {
        byStatus: byStatus.rows.map((x) => ({ status: x.status, count: x.n })),
        byClass: byClass.rows.map((x) => ({
          cycle: x.cycle,
          classCode: x.class_code,
          seats: x.seats,
          applications: x.applications,
          shortlisted: x.shortlisted,
          selected: x.selected,
        })),
        possibleDuplicates: duplicates.rows[0]?.n ?? 0,
      };
    });
  }
}
