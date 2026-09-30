import { Injectable } from '@nestjs/common';
import {
  FAMILY_EDITABLE_KEYS,
  PROFILE_FIELD_BY_KEY,
  loadProfileLists,
  optionsOf,
  readStudentProfile,
  refreshCompleteness,
  validateChanges,
  writeStudentProfile,
  ProfileWriteError,
  type PoolClient,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { ConsentsService } from '../comms/consents.service';
import {
  CHANGEABLE,
  type CreateChangeRequestDto,
  type CreateFeedbackDto,
  type DecideChangeDto,
  type ListChangeRequestsDto,
  type ListFeedbackDto,
} from './engagement.dto';

/** Family profile, feedback and profile change requests (S10). */
@Injectable()
export class FamilyService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly consents: ConsentsService,
  ) {}

  /** The children linked to the signed-in guardian (or the student themself) with profile, guardians, route and consents. */
  async family(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const v = await this.viewer.resolve(ctx, 'engagement.family.view');
    if (v.kind !== 'family')
      throw new DomainError('engagement.family.staff', 'Staff accounts have no family profile', {
        status: 409,
      });
    return this.db.tenant(tenant, async (c) => {
      const children = [];
      for (const s of v.students) {
        const st = await c.query<Record<string, unknown>>(
          `SELECT s.id::text, s.admission_no, s.first_name, s.last_name, s.display_name, s.dob::text, s.gender::text, s.blood_group, s.house, s.address, s.details, s.photo_file_id::text,
                  (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id WHERE e.student_id = s.id AND e.academic_year_id = $2 AND e.status = 'active' LIMIT 1) AS section,
                  (SELECT e.roll_no FROM enrolments e WHERE e.student_id = s.id AND e.academic_year_id = $2 AND e.status = 'active' LIMIT 1) AS roll_no,
                  (SELECT emp.display_name FROM enrolments e JOIN teacher_assignments ta ON ta.class_section_id = e.class_section_id AND ta.kind = 'class_teacher' AND ta.valid_to IS NULL JOIN employees emp ON emp.id = ta.employee_id WHERE e.student_id = s.id AND e.academic_year_id = $2 AND e.status = 'active' LIMIT 1) AS class_teacher,
                  (SELECT jsonb_build_object('routeId', r.id::text, 'code', r.code, 'name', r.name, 'vehicleNo', r.vehicle_no, 'stopName', a.stop_name, 'pickupTime', a.pickup_time::text, 'dropTime', a.drop_time::text)
                     FROM student_route_assignments a JOIN transport_routes r ON r.id = a.route_id WHERE a.student_id = s.id AND a.academic_year_id = $2) AS route
             FROM students s WHERE s.id = $1`,
          [s.id, yearId],
        );
        const g = await c.query<Record<string, unknown>>(
          `SELECT g.id::text, g.display_name, g.first_name, g.last_name, g.mobile, g.email, g.occupation, g.address, sg.relation::text, sg.is_primary, g.user_id::text
             FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = $1 AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, g.id`,
          [s.id],
        );
        const x = st.rows[0]!;
        children.push({
          id: x.id,
          admissionNo: x.admission_no,
          name: x.display_name,
          dob: x.dob,
          gender: x.gender,
          bloodGroup: x.blood_group,
          house: x.house,
          address: x.address ?? {},
          emergencyContact:
            (x.details as Record<string, unknown> | null)?.emergency_contact ?? null,
          photoFileId: x.photo_file_id,
          section: x.section,
          rollNo: x.roll_no,
          classTeacher: x.class_teacher,
          route: x.route,
          guardians: g.rows.map((y) => ({
            id: y.id,
            name: y.display_name,
            mobile: y.mobile,
            email: y.email,
            occupation: y.occupation,
            address: y.address ?? {},
            relation: y.relation,
            isPrimary: y.is_primary,
            isMe: y.user_id === ctx.user.id,
          })),
        });
      }
      await this.consents.installDefaults(c);
      const pending = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM profile_change_requests WHERE requested_by_user_id = app.current_user_id() AND status = 'pending'`,
      );
      return {
        children,
        consents: await this.consents.statusFor(c, ctx.user.id),
        pendingChangeRequests: Number(pending.rows[0]!.n),
      };
    });
  }

  // ---- feedback ----------------------------------------------------------------------------------
  async createFeedback(ctx: RequestContext, dto: CreateFeedbackDto) {
    const v = await this.viewer.resolve(ctx, 'engagement.feedback.create');
    if (dto.studentId && v.kind === 'family' && !v.students.some((s) => s.id === dto.studentId))
      throw new DomainError('not-found', 'Student not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO feedback_entries (school_id, user_id, student_id, category, rating, comment) VALUES (app.current_school_id(), app.current_user_id(), $1, $2, $3, $4) RETURNING id::text`,
        [dto.studentId ?? null, dto.category, dto.rating, dto.comment ?? null],
      );
      return { id: r.rows[0]!.id, ...dto };
    });
  }

  async listFeedback(ctx: RequestContext, q: ListFeedbackDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      let where = 'true';
      if (q.category) {
        params.push(q.category);
        where = 'f.category = $1';
      }
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- where is one of two fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM feedback_entries f WHERE ${where}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<{
        id: string;
        author: string;
        student: string | null;
        category: string;
        rating: number;
        comment: string | null;
        created_at: Date;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- where is a fixed fragment; values are bound parameters
        `SELECT f.id::text, u.display_name AS author, s.display_name AS student, f.category, f.rating, f.comment, f.created_at FROM feedback_entries f JOIN users u ON u.id = f.user_id LEFT JOIN students s ON s.id = f.student_id
          WHERE ${where} ORDER BY f.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const summary = await c.query<{ category: string; n: number; avg: string }>(
        `SELECT category, count(*)::int AS n, round(avg(rating)::numeric, 2)::text AS avg FROM feedback_entries GROUP BY category ORDER BY category`,
      );
      return {
        data: r.rows.map((x) => ({
          id: x.id,
          author: x.author,
          student: x.student,
          category: x.category,
          rating: x.rating,
          comment: x.comment,
          createdAt: x.created_at.toISOString(),
        })),
        page: { number: q.page, size: q.size, total: Number(total.rows[0]!.n) },
        summary: summary.rows.map((x) => ({
          category: x.category,
          count: x.n,
          average: Number(x.avg),
        })),
      };
    });
  }

  // ---- profile change requests -------------------------------------------------------------------
  async createChangeRequest(ctx: RequestContext, dto: CreateChangeRequestDto) {
    const v = await this.viewer.resolve(ctx, 'engagement.change_request.create');
    if (v.kind === 'family' && !v.students.some((s) => s.id === dto.studentId))
      throw new DomainError('not-found', 'Student not found', { status: 404 });
    if (dto.entity === 'profile') return this.createProfileRequest(ctx, dto);
    const entity = dto.entity;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const allowed = CHANGEABLE[entity];
      const bad = Object.keys(dto.changes).filter((k) => !allowed.includes(k));
      if (bad.length)
        throw new DomainError(
          'engagement.change.field_not_allowed',
          `These fields cannot be changed from the app: ${bad.join(', ')}`,
          { status: 422 },
        );
      let entityId = dto.entityId ?? dto.studentId;
      if (entity === 'guardian') {
        const g = await c.query<{ id: string }>(
          `SELECT g.id::text FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = $1 AND ($2::bigint IS NULL AND g.user_id = app.current_user_id() OR g.id = $2::bigint) LIMIT 1`,
          [dto.studentId, dto.entityId ?? null],
        );
        if (!g.rows[0])
          throw new DomainError('not-found', 'Guardian not found for this student', {
            status: 404,
          });
        entityId = g.rows[0].id;
      }
      const current = await this.currentValues(c, entity, entityId);
      const changes: Record<string, { from: unknown; to: string }> = {};
      for (const [k, to] of Object.entries(dto.changes))
        changes[k] = { from: current[k] ?? null, to };
      const r = await c.query<{ id: string }>(
        `INSERT INTO profile_change_requests (school_id, student_id, requested_by_user_id, entity, entity_id, changes, reason) VALUES (app.current_school_id(), $1, app.current_user_id(), $2, $3, $4::jsonb, $5) RETURNING id::text`,
        [dto.studentId, dto.entity, entityId, JSON.stringify(changes), dto.reason ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.change_request.create',
        entityType: 'profile_change_requests',
        entityId: r.rows[0]!.id,
        after: { entity: dto.entity, fields: Object.keys(changes) },
      });
      return this.findChange(c, r.rows[0]!.id);
    });
  }

  async listChangeRequests(ctx: RequestContext, q: ListChangeRequestsDto, mine: boolean) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const where: string[] = [];
      if (mine) where.push('r.requested_by_user_id = app.current_user_id()');
      if (q.status) {
        params.push(q.status);
        where.push(`r.status = $${params.length}::change_request_status`);
      }
      const whereSql = where.length ? where.join(' AND ') : 'true';
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql holds fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM profile_change_requests r WHERE ${whereSql}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- CHANGE_SELECT is a constant; whereSql holds fixed fragments; values are bound parameters
        `${CHANGE_SELECT} WHERE ${whereSql} ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: r.rows.map(toChange),
        page: { number: q.page, size: q.size, total: Number(total.rows[0]!.n) },
      };
    });
  }

  async decideChange(ctx: RequestContext, id: string, dto: DecideChangeDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.findChange(c, id);
      if (before.status !== 'pending')
        throw new DomainError('engagement.change.decided', 'This request was already decided', {
          status: 409,
        });
      if (dto.approve && before.entity === 'profile') {
        const values = Object.fromEntries(
          Object.entries(before.changes).map(([k, v]) => [k, v.to]),
        );
        try {
          await writeStudentProfile(c, before.entityId, values);
        } catch (error) {
          if (error instanceof ProfileWriteError)
            throw new DomainError('validation-failed', error.message, {
              status: 400,
              extra: { errors: error.errors },
            });
          throw error;
        }
        await refreshCompleteness(c, before.entityId);
      } else if (dto.approve && before.entity !== 'profile')
        await this.apply(c, before.entity, before.entityId, before.changes);
      await c.query(
        `UPDATE profile_change_requests SET status = $2::change_request_status, decided_by = app.current_user_id(), decided_at = now(), decision_note = $3 WHERE id = $1`,
        [id, dto.approve ? 'approved' : 'rejected', dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: dto.approve
          ? 'engagement.change_request.approve'
          : 'engagement.change_request.reject',
        entityType: before.entity === 'guardian' ? 'guardians' : 'students',
        entityId: before.entityId,
        before: Object.fromEntries(Object.entries(before.changes).map(([k, v]) => [k, v.from])),
        after: dto.approve
          ? Object.fromEntries(Object.entries(before.changes).map(([k, v]) => [k, v.to]))
          : { rejected: true, note: dto.note ?? null },
      });
      return this.findChange(c, id);
    });
  }

  /** Fields a family may request, with their drop-down options (parent app form). */
  async familyProfileFields(ctx: RequestContext, studentId?: string) {
    let visible = false;
    if (studentId) {
      const v = await this.viewer.resolve(ctx, 'engagement.change_request.create');
      visible = v.kind !== 'family' || v.students.some((x) => x.id === studentId);
    }
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const lists = await loadProfileLists(c);
      const snap =
        visible && studentId
          ? await readStudentProfile(c, studentId, { showSensitive: false })
          : null;
      return {
        current: snap
          ? Object.fromEntries(FAMILY_EDITABLE_KEYS.map((k) => [k, snap.values[k] ?? null]))
          : null,
        fields: FAMILY_EDITABLE_KEYS.map((k) => PROFILE_FIELD_BY_KEY.get(k)!).map((f) => ({
          key: f.key,
          section: f.section,
          label: f.label,
          type: f.type,
          options: f.list ? optionsOf(f, lists) : null,
          help: f.help ?? null,
        })),
      };
    });
  }

  /** A request on catalogue fields: validated now, applied through the profile writer on approval. */
  private async createProfileRequest(ctx: RequestContext, dto: CreateChangeRequestDto) {
    const bad = Object.keys(dto.changes).filter((k) => !FAMILY_EDITABLE_KEYS.includes(k));
    if (bad.length)
      throw new DomainError(
        'engagement.change.field_not_allowed',
        `These fields cannot be changed from the app: ${bad.join(', ')}`,
        { status: 422 },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const lists = await loadProfileLists(c);
      const { values, errors } = validateChanges(dto.changes, lists);
      if (Object.keys(errors).length)
        throw new DomainError('validation-failed', 'Some fields are not valid', {
          status: 400,
          extra: { errors },
        });
      const current = await readStudentProfile(c, dto.studentId, { showSensitive: false });
      if (!current) throw new DomainError('not-found', 'Student not found', { status: 404 });
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [k, to] of Object.entries(values))
        if ((current.values[k] ?? null) !== to)
          changes[k] = { from: current.values[k] ?? null, to };
      if (!Object.keys(changes).length)
        throw new DomainError('validation-failed', 'Nothing to change: the values are the same', {
          status: 400,
        });
      const r = await c.query<{ id: string }>(
        `INSERT INTO profile_change_requests (school_id, student_id, requested_by_user_id, entity, entity_id, changes, reason)
         VALUES (app.current_school_id(), $1, app.current_user_id(), 'profile', $1, $2::jsonb, $3) RETURNING id::text`,
        [dto.studentId, JSON.stringify(changes), dto.reason ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.change_request.create',
        entityType: 'profile_change_requests',
        entityId: r.rows[0]!.id,
        after: { entity: 'profile', fields: Object.keys(changes) },
      });
      return this.findChange(c, r.rows[0]!.id);
    });
  }

  private async currentValues(
    c: PoolClient,
    entity: 'student' | 'guardian',
    id: string,
  ): Promise<Record<string, unknown>> {
    const table = entity === 'student' ? 'students' : 'guardians';
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- table is one of two fixed names; the id is a bound parameter
      `SELECT * FROM ${table} WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', `${entity} not found`, { status: 404 });
    const row = r.rows[0];
    const out: Record<string, unknown> = {};
    for (const f of CHANGEABLE[entity]) {
      const [col, key] = f.split('.') as [string, string | undefined];
      out[f] = key
        ? ((row[col] as Record<string, unknown> | null)?.[key] ?? null)
        : (row[col] ?? null);
    }
    return out;
  }

  private async apply(
    c: PoolClient,
    entity: 'student' | 'guardian',
    id: string,
    changes: Record<string, { from: unknown; to: string }>,
  ) {
    const table = entity === 'student' ? 'students' : 'guardians';
    for (const [field, v] of Object.entries(changes)) {
      if (!CHANGEABLE[entity].includes(field)) continue;
      const [col, key] = field.split('.') as [string, string | undefined];
      if (key)
        await c.query(
          // eslint-disable-next-line no-restricted-syntax -- table and column come from the CHANGEABLE allow-list; values are bound parameters
          `UPDATE ${table} SET ${col} = jsonb_set(COALESCE(${col}, '{}'::jsonb), ARRAY[$2::text], to_jsonb($3::text), true), updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
          [id, key, v.to],
        );
      else
        await c.query(
          // eslint-disable-next-line no-restricted-syntax -- table and column come from the CHANGEABLE allow-list; values are bound parameters
          `UPDATE ${table} SET ${col} = $2, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
          [id, v.to],
        );
    }
  }

  private async findChange(c: PoolClient, id: string) {
    // eslint-disable-next-line no-restricted-syntax -- CHANGE_SELECT is a constant; the id is a bound parameter
    const r = await c.query<Record<string, unknown>>(`${CHANGE_SELECT} WHERE r.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Change request not found', { status: 404 });
    return toChange(r.rows[0]);
  }
}

const CHANGE_SELECT = `SELECT r.id::text, r.student_id::text, s.display_name AS student_name, u.display_name AS requested_by, r.entity, r.entity_id::text, r.changes, r.reason, r.status::text, d.display_name AS decided_by, r.decided_at, r.decision_note, r.created_at,
        CASE WHEN r.entity = 'guardian' THEN (SELECT g.display_name FROM guardians g WHERE g.id = r.entity_id) ELSE s.display_name END AS entity_name
   FROM profile_change_requests r JOIN students s ON s.id = r.student_id LEFT JOIN users u ON u.id = r.requested_by_user_id LEFT JOIN users d ON d.id = r.decided_by`;

const toChange = (x: Record<string, unknown>) => ({
  id: x.id as string,
  studentId: x.student_id as string,
  studentName: x.student_name as string,
  requestedBy: (x.requested_by as string) ?? null,
  entity: x.entity as 'student' | 'guardian' | 'profile',
  entityId: x.entity_id as string,
  entityName: (x.entity_name as string) ?? null,
  /** Readable names of the changed fields (catalogue labels for profile requests). */
  fieldLabels: Object.fromEntries(
    Object.keys((x.changes as Record<string, unknown>) ?? {}).map((k) => [
      k,
      PROFILE_FIELD_BY_KEY.get(k)?.label ?? k,
    ]),
  ),
  changes: x.changes as Record<string, { from: unknown; to: string }>,
  reason: (x.reason as string) ?? null,
  status: x.status as 'pending' | 'approved' | 'rejected',
  decidedBy: (x.decided_by as string) ?? null,
  decidedAt: x.decided_at ? (x.decided_at as Date).toISOString() : null,
  decisionNote: (x.decision_note as string) ?? null,
  createdAt: (x.created_at as Date).toISOString(),
});
