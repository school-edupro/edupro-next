import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';

/** The libraries the signed-in user works in, by name (null: every library). */
export async function myLibraries(c: PoolClient) {
  const r = await c.query<{ ids: string[] | null }>(`SELECT app.my_libraries()::text[] AS ids`);
  const ids = r.rows[0]?.ids ?? null;
  if (!ids) return null;
  const l = await c.query<{ id: string; name: string }>(
    `SELECT id::text, name FROM library_libraries WHERE id = ANY($1::bigint[]) ORDER BY name`,
    [ids],
  );
  return l.rows;
}

/**
 * Runs `fn` with the limit to my libraries off (a book of another library taken back, or looked up to
 * say whose it is), then puts it back on (docs/design/36-library.md, "Library round 3", part 3). Called
 * inside itself, the inner call leaves the limit off.
 */
export async function withEveryLibrary<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  const was = await c.query<{ v: string | null }>(
    `SELECT current_setting('app.library_all', true) AS v`,
  );
  if (was.rows[0]?.v === 'on') return fn();
  await c.query(`SELECT set_config('app.library_all', 'on', true)`);
  try {
    return await fn();
  } finally {
    await c.query(`SELECT set_config('app.library_all', 'off', true)`);
  }
}

/** Whether a library is one of mine, and its name. */
export async function libraryOf(c: PoolClient, libraryId: string) {
  return withEveryLibrary(c, async () => {
    const r = await c.query<{ name: string; mine: boolean }>(
      `SELECT name, app.library_mine(id) AS mine FROM library_libraries WHERE id = $1`,
      [libraryId],
    );
    return r.rows[0] ?? null;
  });
}

/**
 * Library staff (docs/design/36-library.md, "Library round 3", part 3): each library names the employees
 * who work in it; a user named on one or more libraries works only in those (the database keeps them
 * out of the others), a user named on none in all. Only a user who works in every library names them.
 */
@Injectable()
export class LibraryStaffService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const mine = await myLibraries(c);
      const libraries = await c.query<{ id: string; code: string; name: string; status: string }>(
        `SELECT id::text, code, name, status::text FROM library_libraries ORDER BY name`,
      );
      const staff = await c.query<{
        library_id: string;
        employee_id: string;
        name: string;
        code: string;
        designation: string | null;
        signs_in: boolean;
        by: string | null;
        at: string;
      }>(
        `SELECT s.library_id::text, e.id::text AS employee_id, e.display_name AS name, e.employee_code AS code,
                e.designation, e.user_id IS NOT NULL AS signs_in, s.added_by_name AS by, s.created_at::date::text AS at
           FROM library_staff s JOIN employees e ON e.id = s.employee_id
          WHERE s.library_id = ANY($1::bigint[]) ORDER BY e.display_name`,
        [libraries.rows.map((l) => l.id)],
      );
      const canManage = mine === null;
      const employees = canManage
        ? (
            await c.query<{ id: string; name: string; code: string; designation: string | null }>(
              `SELECT id::text, display_name AS name, employee_code AS code, designation FROM employees
                WHERE deleted_at IS NULL AND status = 'active' ORDER BY display_name LIMIT 3000`,
            )
          ).rows
        : [];
      return {
        canManage,
        mine,
        libraries: libraries.rows.map((l) => ({
          ...l,
          staff: staff.rows
            .filter((s) => s.library_id === l.id)
            .map((s) => ({
              employeeId: s.employee_id,
              name: s.name,
              code: s.code,
              designation: s.designation,
              signsIn: s.signs_in,
              by: s.by,
              at: s.at,
            })),
        })),
        employees,
      };
    });
  }

  /** My libraries, for the screens to say so (null: every library). */
  async me(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({ mine: await myLibraries(c) }));
  }

  private async manager(c: PoolClient) {
    if ((await myLibraries(c)) !== null)
      throw new DomainError(
        'library.staff_limited',
        'You work in some libraries only: the library staff are named by someone who works in all of them',
        { status: 403 },
      );
  }

  async add(ctx: RequestContext, libraryId: string, employeeId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.manager(c);
      const lib = await c.query<{ name: string }>(
        `SELECT name FROM library_libraries WHERE id = $1`,
        [libraryId],
      );
      if (!lib.rows[0]) throw new DomainError('not-found', 'Library not found', { status: 404 });
      const emp = await c.query<{ name: string }>(
        `SELECT display_name AS name FROM employees WHERE id = $1 AND deleted_at IS NULL`,
        [employeeId],
      );
      if (!emp.rows[0])
        throw new DomainError('not-found', 'Staff member not found', { status: 404 });
      const r = await c.query(
        `INSERT INTO library_staff (school_id, library_id, employee_id, added_by, added_by_name)
         VALUES (app.current_school_id(), $1, $2, app.current_user_id(), $3) ON CONFLICT DO NOTHING`,
        [libraryId, employeeId, ctx.user.displayName],
      );
      await this.audit.stage(ctx, c, {
        action: 'library.staff.add',
        entityType: 'library_libraries',
        entityId: libraryId,
        after: { employeeId, employee: emp.rows[0].name, library: lib.rows[0].name },
      });
      return {
        added: (r.rowCount ?? 0) > 0,
        library: lib.rows[0].name,
        employee: emp.rows[0].name,
      };
    });
  }

  async remove(ctx: RequestContext, libraryId: string, employeeId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.manager(c);
      const r = await c.query(
        `DELETE FROM library_staff WHERE library_id = $1 AND employee_id = $2`,
        [libraryId, employeeId],
      );
      if (!r.rowCount)
        throw new DomainError('not-found', 'Not on this library’s staff', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'library.staff.remove',
        entityType: 'library_libraries',
        entityId: libraryId,
        after: { employeeId },
      });
      return { removed: true };
    });
  }
}
