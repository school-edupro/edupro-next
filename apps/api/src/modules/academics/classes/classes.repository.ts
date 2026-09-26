import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import type { ClassRow, ClassSectionRow, ListClassesQueryDto } from './classes.dto';

interface ClassDbRow {
  id: string;
  code: string;
  name: string;
  display_order: number;
  status: 'active' | 'inactive';
  created_at: Date;
  updated_at: Date;
}

interface SectionDbRow {
  id: string;
  academic_year_id: string;
  class_id: string;
  campus_id: string | null;
  name: string;
  capacity: number | null;
  status: 'active' | 'inactive';
}

const toClass = (r: ClassDbRow): ClassRow => ({
  id: r.id,
  code: r.code,
  name: r.name,
  displayOrder: r.display_order,
  status: r.status,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const toSection = (r: SectionDbRow): ClassSectionRow => ({
  id: r.id,
  academicYearId: r.academic_year_id,
  classId: r.class_id,
  campusId: r.campus_id,
  name: r.name,
  capacity: r.capacity,
  status: r.status,
});

const CLASS_COLUMNS = `id::text, code, name, display_order, status, created_at, updated_at`;
const SECTION_COLUMNS = `id::text, academic_year_id::text, class_id::text, campus_id::text, name, capacity, status`;

/**
 * SQL only. No business rules. Never receives a school_id parameter: the tenant context and row-level
 * security decide which rows exist (design section 5).
 */
@Injectable()
export class ClassesRepository {
  constructor(private readonly db: DbService) {}

  async list(tenant: TenantContext, q: ListClassesQueryDto): Promise<{ rows: ClassRow[]; total: number }> {
    return this.db.tenant(tenant, async (c) => {
      const where: string[] = ['deleted_at IS NULL'];
      const params: unknown[] = [];
      if (q.status) {
        params.push(q.status);
        where.push(`status = $${params.length}`);
      }
      if (q.q) {
        params.push(`%${q.q}%`);
        where.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length})`);
      }
      const whereSql = where.join(' AND ');
      const total = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM classes WHERE ${whereSql}`, params);
      params.push(q.size, (q.page - 1) * q.size);
      const rows = await c.query<ClassDbRow>(
        `SELECT ${CLASS_COLUMNS} FROM classes WHERE ${whereSql}
          ORDER BY display_order, code LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { rows: rows.rows.map(toClass), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  async findById(tenant: TenantContext, id: string, client?: PoolClient): Promise<ClassRow | null> {
    const run = async (c: PoolClient) => {
      const r = await c.query<ClassDbRow>(`SELECT ${CLASS_COLUMNS} FROM classes WHERE id = $1 AND deleted_at IS NULL`, [id]);
      return r.rows[0] ? toClass(r.rows[0]) : null;
    };
    return client ? run(client) : this.db.tenant(tenant, run);
  }

  async insert(tenant: TenantContext, input: { code: string; name: string; displayOrder: number }): Promise<ClassRow> {
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<ClassDbRow>(
        `INSERT INTO classes (school_id, code, name, display_order, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id(), app.current_user_id())
         RETURNING ${CLASS_COLUMNS}`,
        [input.code, input.name, input.displayOrder],
      );
      return toClass(r.rows[0]!);
    });
  }

  async update(
    tenant: TenantContext,
    id: string,
    patch: Partial<{ code: string; name: string; displayOrder: number; status: 'active' | 'inactive' }>,
  ): Promise<{ before: ClassRow; after: ClassRow } | null> {
    return this.db.tenant(tenant, async (c) => {
      const before = await this.findById(tenant, id, c);
      if (!before) return null;
      const sets: string[] = ['updated_by = app.current_user_id()'];
      const params: unknown[] = [];
      const set = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (patch.code !== undefined) set('code', patch.code);
      if (patch.name !== undefined) set('name', patch.name);
      if (patch.displayOrder !== undefined) set('display_order', patch.displayOrder);
      if (patch.status !== undefined) set('status', patch.status);
      params.push(id);
      const r = await c.query<ClassDbRow>(
        `UPDATE classes SET ${sets.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL RETURNING ${CLASS_COLUMNS}`,
        params,
      );
      return { before, after: toClass(r.rows[0]!) };
    });
  }

  async softDelete(tenant: TenantContext, id: string): Promise<ClassRow | null> {
    return this.db.tenant(tenant, async (c) => {
      const before = await this.findById(tenant, id, c);
      if (!before) return null;
      const live = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM class_sections
          WHERE class_id = $1 AND deleted_at IS NULL
            AND academic_year_id IN (SELECT id FROM academic_years WHERE status IN ('active', 'planned'))`,
        [id],
      );
      if (Number(live.rows[0]?.n ?? 0) > 0) {
        throw new DomainError('academics.class.has_sections', 'Class has sections in an open academic year', {
          status: 409,
          extra: { classId: id },
        });
      }
      await c.query(
        `UPDATE classes SET deleted_at = now(), status = 'inactive', updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      return before;
    });
  }

  async listSections(tenant: TenantContext, classId: string, allowedSectionIds: string[] | null): Promise<ClassSectionRow[]> {
    return this.db.tenant(tenant, async (c) => {
      const params: unknown[] = [classId, tenant.academicYearId];
      let scopeSql = '';
      if (allowedSectionIds !== null) {
        params.push(allowedSectionIds);
        scopeSql = `AND id = ANY($${params.length}::bigint[])`;
      }
      const r = await c.query<SectionDbRow>(
        `SELECT ${SECTION_COLUMNS} FROM class_sections
          WHERE class_id = $1 AND academic_year_id = $2 AND deleted_at IS NULL ${scopeSql}
          ORDER BY name`,
        params,
      );
      return r.rows.map(toSection);
    });
  }

  async insertSection(
    tenant: TenantContext,
    classId: string,
    input: { name: string; capacity?: number; campusId?: string },
  ): Promise<ClassSectionRow> {
    return this.db.tenant(tenant, async (c) => {
      // ADR-003: the procedure layer decides whether the year accepts academic changes.
      await c.query(`SELECT app.assert_year_open($1, 'academics')`, [tenant.academicYearId]);
      const r = await c.query<SectionDbRow>(
        `INSERT INTO class_sections (school_id, academic_year_id, class_id, campus_id, name, capacity, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id(), app.current_user_id())
         RETURNING ${SECTION_COLUMNS}`,
        [tenant.academicYearId, classId, input.campusId ?? null, input.name, input.capacity ?? null],
      );
      return toSection(r.rows[0]!);
    });
  }
}
