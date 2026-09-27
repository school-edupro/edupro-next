import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import type {
  CreateSubjectDto,
  ListSubjectsQueryDto,
  SetClassSubjectsDto,
  UpdateSubjectDto,
} from './academics.dto';

export interface SubjectRow {
  id: string;
  code: string;
  name: string;
  kind: 'scholastic' | 'co_scholastic' | 'language' | 'vocational';
  displayOrder: number;
  status: 'active' | 'inactive';
  updatedAt: string;
}

export interface ClassSubjectRow {
  id: string;
  classId: string;
  subjectId: string;
  code: string;
  name: string;
  kind: SubjectRow['kind'];
  isElective: boolean;
  periodsPerWeek: number | null;
}

interface SubjectDb {
  id: string;
  code: string;
  name: string;
  kind: SubjectRow['kind'];
  display_order: number;
  status: 'active' | 'inactive';
  updated_at: Date;
}

const SUBJECT_COLUMNS = `id::text, code, name, kind, display_order, status, updated_at`;
const toSubject = (r: SubjectDb): SubjectRow => ({
  id: r.id,
  code: r.code,
  name: r.name,
  kind: r.kind,
  displayOrder: r.display_order,
  status: r.status,
  updatedAt: r.updated_at.toISOString(),
});

/** Subject master and the class-subject mapping of the working year (S6-01). */
@Injectable()
export class SubjectsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(
    ctx: RequestContext,
    q: ListSubjectsQueryDto,
  ): Promise<{ rows: SubjectRow[]; total: number }> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const where: string[] = ['deleted_at IS NULL'];
      const params: unknown[] = [];
      if (q.status) {
        params.push(q.status);
        where.push(`status = $${params.length}`);
      }
      if (q.kind) {
        params.push(q.kind);
        where.push(`kind = $${params.length}::subject_kind`);
      }
      if (q.q) {
        params.push(`%${q.q}%`);
        where.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length})`);
      }
      const whereSql = where.join(' AND ');
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql is a conjunction of fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM subjects WHERE ${whereSql}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const rows = await c.query<SubjectDb>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql is a conjunction of fixed fragments; values are bound parameters
        `SELECT ${SUBJECT_COLUMNS} FROM subjects WHERE ${whereSql}
          ORDER BY display_order, code LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { rows: rows.rows.map(toSubject), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  private async find(c: PoolClient, id: string): Promise<SubjectRow | null> {
    const r = await c.query<SubjectDb>(
      // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
      `SELECT ${SUBJECT_COLUMNS} FROM subjects WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return r.rows[0] ? toSubject(r.rows[0]) : null;
  }

  async get(ctx: RequestContext, id: string): Promise<SubjectRow> {
    const row = await this.db.tenant(requireTenant(ctx), (c) => this.find(c, id));
    if (!row) throw new DomainError('not-found', 'Subject not found');
    return row;
  }

  async create(ctx: RequestContext, dto: CreateSubjectDto): Promise<SubjectRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<SubjectDb>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
        `INSERT INTO subjects (school_id, code, name, kind, display_order, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3::subject_kind, $4, app.current_user_id(), app.current_user_id())
         RETURNING ${SUBJECT_COLUMNS}`,
        [dto.code, dto.name, dto.kind, dto.displayOrder],
      );
      const created = toSubject(r.rows[0]!);
      await this.audit.stage(ctx, c, {
        action: 'academics.subject.create',
        entityType: 'subjects',
        entityId: created.id,
        after: created,
      });
      return created;
    });
  }

  async update(ctx: RequestContext, id: string, dto: UpdateSubjectDto): Promise<SubjectRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Subject not found');
      const sets: string[] = ['updated_by = app.current_user_id()'];
      const params: unknown[] = [];
      const set = (column: string, value: unknown, cast = '') => {
        params.push(value);
        sets.push(`${column} = $${params.length}${cast}`);
      };
      if (dto.code !== undefined) set('code', dto.code);
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.kind !== undefined) set('kind', dto.kind, '::subject_kind');
      if (dto.displayOrder !== undefined) set('display_order', dto.displayOrder);
      if (dto.status !== undefined) set('status', dto.status, '::row_status');
      params.push(id);
      const r = await c.query<SubjectDb>(
        // eslint-disable-next-line no-restricted-syntax -- sets holds fixed column assignments; values are bound parameters
        `UPDATE subjects SET ${sets.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL RETURNING ${SUBJECT_COLUMNS}`,
        params,
      );
      const after = toSubject(r.rows[0]!);
      await this.audit.stage(ctx, c, {
        action: 'academics.subject.edit',
        entityType: 'subjects',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    const tenant = requireTenant(ctx);
    await this.db.tenant(tenant, async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Subject not found');
      const used = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM class_subjects cs JOIN academic_years y ON y.id = cs.academic_year_id
          WHERE cs.subject_id = $1 AND y.status IN ('active', 'planned')`,
        [id],
      );
      if (Number(used.rows[0]?.n ?? 0) > 0)
        throw new DomainError(
          'academics.subject.in_use',
          'Subject is mapped to classes in an open year',
          {
            status: 409,
          },
        );
      await c.query(
        `UPDATE subjects SET deleted_at = now(), status = 'inactive', updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'academics.subject.delete',
        entityType: 'subjects',
        entityId: id,
        before,
      });
    });
  }

  // ---- class-subject mapping ------------------------------------------------------------------
  private requireYear(tenant: TenantContext): string {
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  async listClassSubjects(ctx: RequestContext, classId: string): Promise<ClassSubjectRow[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.requireYear(tenant);
    return this.db.tenant(tenant, (c) => this.classSubjectsWith(c, classId, yearId));
  }

  private async classSubjectsWith(
    c: PoolClient,
    classId: string,
    yearId: string,
  ): Promise<ClassSubjectRow[]> {
    const r = await c.query<{
      id: string;
      class_id: string;
      subject_id: string;
      code: string;
      name: string;
      kind: SubjectRow['kind'];
      is_elective: boolean;
      periods_per_week: number | null;
    }>(
      `SELECT cs.id::text, cs.class_id::text, cs.subject_id::text, s.code, s.name, s.kind, cs.is_elective, cs.periods_per_week
         FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id
        WHERE cs.class_id = $1 AND cs.academic_year_id = $2
        ORDER BY s.display_order, s.code`,
      [classId, yearId],
    );
    return r.rows.map((x) => ({
      id: x.id,
      classId: x.class_id,
      subjectId: x.subject_id,
      code: x.code,
      name: x.name,
      kind: x.kind,
      isElective: x.is_elective,
      periodsPerWeek: x.periods_per_week,
    }));
  }

  async setClassSubjects(
    ctx: RequestContext,
    classId: string,
    dto: SetClassSubjectsDto,
  ): Promise<ClassSubjectRow[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.requireYear(tenant);
    return this.db.tenant(tenant, async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'academics')`, [yearId]);
      const cls = await c.query(`SELECT 1 FROM classes WHERE id = $1 AND deleted_at IS NULL`, [
        classId,
      ]);
      if (cls.rowCount === 0) throw new DomainError('not-found', 'Class not found');
      const before = await c.query<{ subject_id: string }>(
        `SELECT subject_id::text FROM class_subjects WHERE class_id = $1 AND academic_year_id = $2 ORDER BY subject_id`,
        [classId, yearId],
      );
      const keep = dto.subjects.map((s) => s.subjectId);
      await c.query(
        `DELETE FROM class_subjects WHERE class_id = $1 AND academic_year_id = $2 AND NOT (subject_id = ANY($3::bigint[]))`,
        [classId, yearId, keep],
      );
      for (const s of dto.subjects) {
        await c.query(
          `INSERT INTO class_subjects (school_id, academic_year_id, class_id, subject_id, is_elective, periods_per_week, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id())
           ON CONFLICT (academic_year_id, class_id, subject_id) DO UPDATE
             SET is_elective = EXCLUDED.is_elective, periods_per_week = EXCLUDED.periods_per_week`,
          [yearId, classId, s.subjectId, s.isElective, s.periodsPerWeek ?? null],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'academics.class_subject.set',
        entityType: 'class_subjects',
        entityId: classId,
        before: { subjectIds: before.rows.map((r) => r.subject_id) },
        after: { subjectIds: keep },
      });
      return this.classSubjectsWith(c, classId, yearId);
    });
  }
}
