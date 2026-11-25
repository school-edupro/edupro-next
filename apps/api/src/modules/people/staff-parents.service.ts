import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../access/access.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { StaffParentsQueryDto } from './people.dto';
import {
  EMPLOYEE_JOIN,
  IS_STAFF,
  LINK_COLS,
  STATE_SQL,
  TODO,
  linkOf,
  staffParentLinks,
  type LinkRow,
  type StaffParentRow,
  type StaffParentState,
} from './staff-parents.links';
import { StudentsService } from './students.service';

/** The relations a profile section's record can have (the guardian section is any non-parent link). */
const SECTION_RELATIONS: Record<'father' | 'mother' | 'guardian', string[]> = {
  father: ['father'],
  mother: ['mother'],
  guardian: ['guardian', 'grandparent', 'sibling', 'other'],
};

const FAILED: Record<string, string> = {
  separate_login:
    'This parent has a login of their own. Use staff login moves the record to the staff login.',
  staff_no_login:
    'This staff member has no login yet. The record joins by itself when they get one.',
  no_employee: 'No active staff member has this employee code. Check the code on the record.',
  no_code: 'Enter the staff employee code on the record first.',
  not_staff: 'The record does not say School staff: Yes.',
};

/**
 * A staff member who is also a parent here sees their child with the staff login (docs/design/89, staff parents):
 * the parent record (father, mother or guardian) marked "School staff: Yes" with an employee code is joined to that
 * staff member's login — by itself when the office saves it and it has no login of its own, or with Use staff login.
 */
@Injectable()
export class StaffParentsService {
  constructor(
    private readonly db: DbService,
    private readonly students: StudentsService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  /** The logins a join or undo changed read their rights afresh (the parent role came or went). */
  async refresh(schoolId: string, userIds: Iterable<string | null>): Promise<void> {
    for (const id of new Set([...userIds].filter((x): x is string => Boolean(x))))
      await this.access.invalidateUser(schoolId, id);
  }

  /** The parent records marked School staff, with their students: to do first (not joined), or joined. */
  async list(ctx: RequestContext, q: StaffParentsQueryDto) {
    const tenant = requireTenant(ctx);
    const allowed = await this.students.scopeFilter(tenant);
    return this.db.tenant(tenant, async (c) => {
      const where: string[] = [IS_STAFF, 'g.deleted_at IS NULL', 's.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (allowed !== null) {
        params.push(allowed);
        where.push(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragments and numbered placeholders only; values are bound
          `EXISTS (SELECT 1 FROM enrolments en WHERE en.student_id = s.id AND en.status = 'active' AND en.class_section_id = ANY($${String(params.length)}::bigint[]))`,
        );
      }
      if (q.q) {
        params.push(`%${q.q.toLowerCase()}%`);
        const p = `$${String(params.length)}`;
        where.push(
          `(lower(s.display_name) LIKE ${p} OR lower(s.admission_no) LIKE ${p} OR lower(g.display_name) LIKE ${p}
            OR lower(COALESCE(g.profile->>'staff_employee_id', '')) LIKE ${p})`,
        );
      }
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments and numbered placeholders only; values are bound
      const base = `FROM student_guardians sg
        JOIN guardians g ON g.id = sg.guardian_id
        JOIN students s ON s.id = sg.student_id
        ${EMPLOYEE_JOIN}
        LEFT JOIN enrolments en ON en.student_id = s.id AND en.status = 'active'
          AND en.academic_year_id = ${tenant.academicYearId ? `$${String(params.push(tenant.academicYearId))}` : 'NULL'}
        LEFT JOIN class_sections cs ON cs.id = en.class_section_id
        LEFT JOIN classes cl ON cl.id = cs.class_id
        WHERE ${where.join(' AND ')}`;
      const counts = await c.query<{ state: StaffParentState; n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments and numbered placeholders only; values are bound
        `SELECT ${STATE_SQL} AS state, count(*)::int AS n ${base} GROUP BY 1`,
        params,
      );
      const by = Object.fromEntries(counts.rows.map((x) => [x.state, x.n])) as Partial<
        Record<StaffParentState, number>
      >;
      const states: StaffParentState[] =
        q.state === 'todo' ? TODO : q.state === 'joined' ? ['joined'] : [...TODO, 'joined'];
      params.push(states);
      const stateParam = `$${String(params.length)}`;
      params.push(q.size, (q.page - 1) * q.size);
      const rows = await c.query<
        LinkRow & {
          guardian_name: string;
          relation: string;
          student_id: string;
          admission_no: string;
          student_name: string;
          section: string | null;
        }
      >(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments and numbered placeholders only; values are bound
        `SELECT ${LINK_COLS}, g.display_name AS guardian_name, sg.relation::text AS relation,
                s.id::text AS student_id, s.admission_no, s.display_name AS student_name,
                CASE WHEN cl.id IS NULL THEN NULL ELSE cl.code || '-' || cs.name END AS section
           ${base} AND ${STATE_SQL} = ANY(${stateParam}::text[])
          ORDER BY CASE ${STATE_SQL} WHEN 'joined' THEN 1 ELSE 0 END, s.admission_no, sg.relation, g.id
          LIMIT $${String(params.length - 1)} OFFSET $${String(params.length)}`,
        params,
      );
      const total = states.reduce((n, s) => n + (by[s] ?? 0), 0);
      return {
        data: rows.rows.map((x): StaffParentRow => ({
          ...linkOf(x),
          guardianId: x.guardian_id,
          guardianName: x.guardian_name,
          relation: x.relation,
          studentId: x.student_id,
          admissionNo: x.admission_no,
          studentName: x.student_name,
          section: x.section,
        })),
        counts: {
          todo: TODO.reduce((n, s) => n + (by[s] ?? 0), 0),
          joined: by.joined ?? 0,
          byState: by,
        },
        page: { number: q.page, size: q.size, total },
      };
    });
  }

  /** Join the record to the staff member's login; move: also when it has a login of its own. */
  async join(ctx: RequestContext, guardianId: string, move: boolean) {
    const tenant = requireTenant(ctx);
    const touched: Array<string | null> = [];
    const out = await this.db.tenant(tenant, async (c) => {
      const before = await this.current(c, guardianId);
      const r = await c.query<{ result: string }>(
        'SELECT app.guardian_staff_join($1, $2) AS result',
        [guardianId, move],
      );
      const result = r.rows[0]!.result;
      if (result !== 'joined' && result !== 'already')
        throw new DomainError(`staff_parent.${result}`, FAILED[result] ?? 'Could not join', {
          status: 409,
        });
      const after = await this.current(c, guardianId);
      touched.push(before.userId, after.userId);
      if (result === 'joined')
        await this.audit.stage(ctx, c, {
          action: 'people.guardian.staff_join',
          entityType: 'guardians',
          entityId: guardianId,
          before: { userId: before.userId },
          after: { userId: after.userId, employeeId: after.employeeId, moved: move },
        });
      return { result, link: (await staffParentLinks(c, [guardianId])).get(guardianId) ?? null };
    });
    await this.refresh(tenant.schoolId, touched);
    return out;
  }

  /** Undo a join: the login the record had before (or none) comes back. */
  async undo(ctx: RequestContext, guardianId: string) {
    const tenant = requireTenant(ctx);
    const touched: Array<string | null> = [];
    const out = await this.db.tenant(tenant, async (c) => {
      const before = await this.current(c, guardianId);
      const r = await c.query<{ result: string }>('SELECT app.guardian_staff_undo($1) AS result', [
        guardianId,
      ]);
      if (r.rows[0]!.result !== 'undone')
        throw new DomainError('staff_parent.not_joined', 'This record was not joined here', {
          status: 409,
        });
      const after = await this.current(c, guardianId);
      touched.push(before.userId, after.userId);
      await this.audit.stage(ctx, c, {
        action: 'people.guardian.staff_undo',
        entityType: 'guardians',
        entityId: guardianId,
        before: { userId: before.userId, employeeId: before.employeeId },
        after: { userId: after.userId },
      });
      return {
        result: 'undone',
        link: (await staffParentLinks(c, [guardianId])).get(guardianId) ?? null,
      };
    });
    await this.refresh(tenant.schoolId, touched);
    return out;
  }

  /**
   * After the office saved a student's record: the parent records of the sections whose School staff fields were
   * saved follow them (joined, or put back). Each join or undo is recorded. Returns the logins it changed: the caller
   * passes them to refresh() once the save is committed.
   */
  async syncAfterSave(
    ctx: RequestContext,
    c: PoolClient,
    studentId: string,
    savedKeys: Iterable<string>,
  ): Promise<string[]> {
    const keys = new Set(savedKeys);
    const relations = (['father', 'mother', 'guardian'] as const)
      .filter((p) => keys.has(`${p}_school_staff`) || keys.has(`${p}_staff_employee_id`))
      .flatMap((p) => SECTION_RELATIONS[p]);
    if (!relations.length) return [];
    const logins = () =>
      c.query<{ id: string; user_id: string | null }>(
        `SELECT g.id::text, g.user_id::text FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
          WHERE sg.student_id = $1 AND sg.relation::text = ANY($2::text[]) AND g.deleted_at IS NULL`,
        [studentId, relations],
      );
    const before = new Map((await logins()).rows.map((x) => [x.id, x.user_id]));
    const r = await c.query<{ guardian_id: string; relation: string; result: string }>(
      'SELECT guardian_id::text, relation, result FROM app.student_staff_parents_sync($1, $2::text[])',
      [studentId, relations],
    );
    for (const x of r.rows) {
      if (x.result !== 'joined' && x.result !== 'undone') continue;
      await this.audit.stage(ctx, c, {
        action: x.result === 'joined' ? 'people.guardian.staff_join' : 'people.guardian.staff_undo',
        entityType: 'guardians',
        entityId: x.guardian_id,
        after: { studentId, relation: x.relation, onSave: true },
      });
    }
    const touched: string[] = [];
    for (const x of (await logins()).rows) {
      const was = before.get(x.id) ?? null;
      if (was === x.user_id) continue;
      if (was) touched.push(was);
      if (x.user_id) touched.push(x.user_id);
    }
    return touched;
  }

  private async current(c: PoolClient, guardianId: string) {
    const r = await c.query<{ user_id: string | null; staff_employee_id: string | null }>(
      'SELECT user_id::text, staff_employee_id::text FROM guardians WHERE id = $1 AND deleted_at IS NULL',
      [guardianId],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Parent record not found');
    return { userId: r.rows[0].user_id, employeeId: r.rows[0].staff_employee_id };
  }
}
