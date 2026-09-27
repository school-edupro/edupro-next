import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { CreateCampusDto, UpdateCampusDto, UpdateSchoolDto } from './platform.dto';

export interface SchoolRow {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  affiliationNo: string | null;
  board: string;
  timezone: string;
  locale: string;
  address: Record<string, unknown>;
  contact: Record<string, unknown>;
  branding: Record<string, unknown>;
  status: string;
  campuses: CampusRow[];
}

export interface CampusRow {
  id: string;
  code: string;
  name: string;
  address: Record<string, unknown>;
  geo: { lat: number; lng: number } | null;
  status: 'active' | 'inactive';
}

@Injectable()
export class SchoolService {
  constructor(private readonly db: DbService) {}

  get(tenant: TenantContext, client?: PoolClient): Promise<SchoolRow> {
    const run = async (c: PoolClient) => {
      const s = await c.query<
        Omit<SchoolRow, 'campuses' | 'shortName' | 'affiliationNo'> & {
          short_name: string | null;
          affiliation_no: string | null;
        }
      >(
        `SELECT id::text, code, name, short_name, affiliation_no, board, timezone, locale, address, contact, branding, status
           FROM schools WHERE id = app.current_school_id()`,
      );
      const row = s.rows[0];
      if (!row) throw new DomainError('not-found', 'School not found');
      const campuses = await c.query<CampusRow>(
        `SELECT id::text, code, name, address, geo, status FROM campuses WHERE deleted_at IS NULL ORDER BY code`,
      );
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        shortName: row.short_name,
        affiliationNo: row.affiliation_no,
        board: row.board,
        timezone: row.timezone,
        locale: row.locale,
        address: row.address,
        contact: row.contact,
        branding: row.branding,
        status: row.status,
        campuses: campuses.rows,
      };
    };
    return client ? run(client) : this.db.tenant(tenant, run);
  }

  async update(ctx: RequestContext, dto: UpdateSchoolDto): Promise<SchoolRow> {
    const tenant = requireTenant(ctx);
    const result = await this.db.tenant(tenant, async (c) => {
      const before = await this.get(tenant, c);
      const sets: string[] = ['updated_by = app.current_user_id()'];
      const params: unknown[] = [];
      const set = (col: string, v: unknown, cast = '') => {
        params.push(v);
        sets.push(`${col} = $${params.length}${cast}`);
      };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.shortName !== undefined) set('short_name', dto.shortName);
      if (dto.affiliationNo !== undefined) set('affiliation_no', dto.affiliationNo);
      if (dto.board !== undefined) set('board', dto.board);
      if (dto.timezone !== undefined) set('timezone', dto.timezone);
      if (dto.locale !== undefined) set('locale', dto.locale);
      if (dto.address !== undefined) set('address', JSON.stringify(dto.address), '::jsonb');
      if (dto.contact !== undefined) set('contact', JSON.stringify(dto.contact), '::jsonb');
      if (dto.branding !== undefined) set('branding', JSON.stringify(dto.branding), '::jsonb');
      await c.query(
        // eslint-disable-next-line no-restricted-syntax -- sets holds fixed column assignments; values are bound parameters
        `UPDATE schools SET ${sets.join(', ')} WHERE id = app.current_school_id()`,
        params,
      );
      return { before, after: await this.get(tenant, c) };
    });
    ctx.audit = {
      action: 'platform.school.edit',
      entityType: 'schools',
      entityId: result.after.id,
      before: result.before,
      after: result.after,
    };
    return result.after;
  }

  async createCampus(ctx: RequestContext, dto: CreateCampusDto): Promise<CampusRow> {
    const tenant = requireTenant(ctx);
    const created = await this.db.tenant(tenant, async (c) => {
      try {
        const r = await c.query<CampusRow>(
          `INSERT INTO campuses (school_id, code, name, address, geo, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3::jsonb, $4::jsonb, app.current_user_id(), app.current_user_id())
           RETURNING id::text, code, name, address, geo, status`,
          [
            dto.code,
            dto.name,
            JSON.stringify(dto.address ?? {}),
            dto.geo ? JSON.stringify(dto.geo) : null,
          ],
        );
        return r.rows[0]!;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Campus code ${dto.code} already exists`);
        throw error;
      }
    });
    ctx.audit = {
      action: 'platform.campus.create',
      entityType: 'campuses',
      entityId: created.id,
      after: created,
    };
    return created;
  }

  async updateCampus(ctx: RequestContext, id: string, dto: UpdateCampusDto): Promise<CampusRow> {
    const tenant = requireTenant(ctx);
    const result = await this.db.tenant(tenant, async (c) => {
      const cur = await c.query<CampusRow>(
        `SELECT id::text, code, name, address, geo, status FROM campuses WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!cur.rows[0]) throw new DomainError('not-found', 'Campus not found');
      const sets: string[] = ['updated_by = app.current_user_id()'];
      const params: unknown[] = [];
      const set = (col: string, v: unknown, cast = '') => {
        params.push(v);
        sets.push(`${col} = $${params.length}${cast}`);
      };
      if (dto.code !== undefined) set('code', dto.code);
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.address !== undefined) set('address', JSON.stringify(dto.address), '::jsonb');
      if (dto.geo !== undefined) set('geo', dto.geo ? JSON.stringify(dto.geo) : null, '::jsonb');
      if (dto.status !== undefined) set('status', dto.status, '::row_status');
      params.push(id);
      const r = await c.query<CampusRow>(
        // eslint-disable-next-line no-restricted-syntax -- sets holds fixed column assignments; values are bound parameters
        `UPDATE campuses SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id::text, code, name, address, geo, status`,
        params,
      );
      return { before: cur.rows[0], after: r.rows[0]! };
    });
    ctx.audit = {
      action: 'platform.campus.edit',
      entityType: 'campuses',
      entityId: id,
      before: result.before,
      after: result.after,
    };
    return result.after;
  }
}
