import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { ACCESS } from './access.permissions';
import type { PortalAsDto, PortalHandoffDto, PortalLoginDto } from './access.dto';
import { ImpersonationService } from './impersonation.service';

/** One person a portal can be opened as. */
export interface PortalTarget {
  personType: 'student' | 'guardian' | 'employee';
  id: string;
  /** Student, Father, Mother, Guardian, Employee */
  as: string;
  name: string;
  app: 'parent' | 'teacher';
  hasLogin: boolean;
  /** a login can be made (a parent or employee needs a mobile or an email) */
  canMakeLogin: boolean;
  /** why it cannot be opened (another administrator) */
  blocked: string | null;
}

const HANDOFF_SECONDS = 60;
const hash = (code: string) => createHash('sha256').update(code).digest('hex');
const RELATION: Record<string, string> = {
  father: 'Father',
  mother: 'Mother',
  guardian: 'Guardian',
  grandfather: 'Grandfather',
  grandmother: 'Grandmother',
};
const contactOk = (email: string | null, mobile: string | null) =>
  Boolean(email?.trim()) || (mobile ?? '').replace(/\D/g, '').length >= 10;

/**
 * Open the parent portal as a student or parent, or the teacher app as an employee
 * (docs/design/31-portal-view-as.md): an impersonation session (view only, or acting except money) with a
 * reason and a time limit, carried into the other app by a one-time code.
 */
@Injectable()
export class PortalAsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly impersonation: ImpersonationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Administrators (who may open portals or impersonate) are not opened by one another. */
  private async adminOf(c: PoolClient, userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const r = await c.query<{ user_id: string }>(
      `SELECT DISTINCT ur.user_id::text FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
        WHERE ur.school_id = app.current_school_id() AND ur.revoked_at IS NULL AND ur.user_id = ANY($1::bigint[])
          AND rp.permission_code IN ('access.portal.view_as', 'access.portal.act_as', 'access.session.impersonate')`,
      [userIds],
    );
    return new Set(r.rows.map((x) => x.user_id));
  }

  /** The student and each parent of a student, with their logins. */
  async forStudent(ctx: RequestContext, studentId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await c.query<{ id: string; name: string; user_id: string | null }>(
        `SELECT id::text, display_name AS name, user_id::text FROM students
          WHERE id = $1 AND deleted_at IS NULL`,
        [studentId],
      );
      if (!s.rows[0]) throw new DomainError('not-found', 'Student not found', { status: 404 });
      const g = await c.query<{
        id: string;
        name: string;
        relation: string;
        user_id: string | null;
        email: string | null;
        mobile: string | null;
      }>(
        `SELECT gd.id::text, gd.display_name AS name, sg.relation::text AS relation, gd.user_id::text,
                gd.email::text AS email, gd.mobile
           FROM student_guardians sg JOIN guardians gd ON gd.id = sg.guardian_id AND gd.deleted_at IS NULL
          WHERE sg.student_id = $1
          ORDER BY (sg.relation = 'father') DESC, (sg.relation = 'mother') DESC, sg.is_primary DESC, gd.id`,
        [studentId],
      );
      const st = s.rows[0];
      const admins = await this.adminOf(
        c,
        [st.user_id, ...g.rows.map((x) => x.user_id)].filter((x): x is string => Boolean(x)),
      );
      const blocked = (uid: string | null) =>
        uid && (admins.has(uid) || uid === ctx.user.id) ? 'An administrator; not opened' : null;
      const targets: PortalTarget[] = [
        {
          personType: 'student',
          id: st.id,
          as: 'Student',
          name: st.name,
          app: 'parent',
          hasLogin: Boolean(st.user_id),
          canMakeLogin: true,
          blocked: blocked(st.user_id),
        },
        ...g.rows.map((x) => ({
          personType: 'guardian' as const,
          id: x.id,
          as: RELATION[x.relation] ?? 'Guardian',
          name: x.name,
          app: 'parent' as const,
          hasLogin: Boolean(x.user_id),
          canMakeLogin: contactOk(x.email, x.mobile),
          blocked: blocked(x.user_id),
        })),
      ];
      return { targets, modes: this.modes(ctx) };
    });
  }

  /** The employee, for the teacher app. */
  async forEmployee(ctx: RequestContext, employeeId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        name: string;
        user_id: string | null;
        email: string | null;
        mobile: string | null;
      }>(
        `SELECT id::text, display_name AS name, user_id::text, email::text AS email, mobile
           FROM employees WHERE id = $1 AND deleted_at IS NULL`,
        [employeeId],
      );
      const e = r.rows[0];
      if (!e) throw new DomainError('not-found', 'Employee not found', { status: 404 });
      const admins = await this.adminOf(c, e.user_id ? [e.user_id] : []);
      const targets: PortalTarget[] = [
        {
          personType: 'employee',
          id: e.id,
          as: 'Employee',
          name: e.name,
          app: 'teacher',
          hasLogin: Boolean(e.user_id),
          canMakeLogin: contactOk(e.email, e.mobile),
          blocked:
            e.user_id && (admins.has(e.user_id) || e.user_id === ctx.user.id)
              ? 'An administrator; not opened'
              : null,
        },
      ];
      return { targets, modes: this.modes(ctx) };
    });
  }

  private modes(ctx: RequestContext) {
    return {
      view: ctx.permissions?.has(ACCESS.portalViewAs) ?? false,
      act: ctx.permissions?.has(ACCESS.portalActAs) ?? false,
    };
  }

  /** A login for a student, parent or employee who has none (as the sign-in by code would make). */
  async makeLogin(ctx: RequestContext, dto: PortalLoginDto) {
    const edit = dto.personType === 'employee' ? 'people.employee.edit' : 'people.student.edit';
    if (!ctx.permissions?.has(edit))
      throw new DomainError('permission-denied', `Making a login needs ${edit}`, { status: 403 });
    const fn = {
      student: 'app.student_create_login',
      guardian: 'app.guardian_create_login',
      employee: 'app.employee_create_login',
    }[dto.personType];
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let userId: string;
      try {
        // eslint-disable-next-line no-restricted-syntax -- the function name is one of three fixed names
        const r = await c.query<{ uid: string }>(`SELECT ${fn}($1)::text AS uid`, [dto.id]);
        userId = r.rows[0]!.uid;
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.endsWith('.no_contact'))
          throw new DomainError('portal.no_contact', 'Add a mobile or an email first', {
            status: 409,
          });
        if (msg.endsWith('.not_found'))
          throw new DomainError('not-found', 'Not found', { status: 404 });
        throw e;
      }
      await this.audit.stage(ctx, c, {
        action: 'access.portal.login_made',
        entityType: dto.personType === 'guardian' ? 'guardians' : `${dto.personType}s`,
        entityId: dto.id,
        after: { userId },
      });
      return { userId };
    });
  }

  /** Starts the session and gives the link that opens the portal (good for a minute, once). */
  async open(ctx: RequestContext, dto: PortalAsDto) {
    const need = dto.mode === 'act' ? ACCESS.portalActAs : ACCESS.portalViewAs;
    if (!ctx.permissions?.has(need))
      throw new DomainError(
        'permission-denied',
        dto.mode === 'act'
          ? 'Acting as someone needs the right to act for them'
          : 'Opening portals needs the right to view them',
        { status: 403 },
      );
    const tenant = requireTenant(ctx);
    const target = await this.db.tenant(tenant, async (c) => {
      const table = { student: 'students', guardian: 'guardians', employee: 'employees' }[
        dto.personType
      ];
      const r = await c.query<{ user_id: string | null }>(
        // eslint-disable-next-line no-restricted-syntax -- the table is one of three fixed names
        `SELECT user_id::text FROM ${table} WHERE id = $1 AND deleted_at IS NULL`,
        [dto.id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Not found', { status: 404 });
      const uid = r.rows[0].user_id;
      if (!uid)
        throw new DomainError('portal.no_login', 'No portal login yet: make one first', {
          status: 409,
        });
      if (uid === ctx.user.id || (await this.adminOf(c, [uid])).has(uid))
        throw new DomainError('portal.admin', 'An administrator is not opened as', {
          status: 409,
        });
      return uid;
    });
    const app = dto.personType === 'employee' ? 'teacher' : 'parent';
    const { session } = await this.impersonation.open(ctx, {
      userId: target,
      reason: dto.reason,
      minutes: dto.minutes,
      mode: dto.mode,
      app,
      personType: dto.personType,
      personRefId: dto.id,
    });
    const code = randomBytes(32).toString('base64url');
    await this.db.tenant(tenant, (c) =>
      c.query(
        `INSERT INTO portal_handoffs (school_id, session_id, app, code_hash, expires_at)
         VALUES (app.current_school_id(), $1, $2, $3, now() + make_interval(secs => $4))`,
        [session.id, app, hash(code), HANDOFF_SECONDS],
      ),
    );
    const base = app === 'teacher' ? this.env.TEACHER_APP_URL : this.env.PARENT_APP_URL;
    return {
      url: `${base}/api/auth/handoff?code=${encodeURIComponent(code)}`,
      session,
    };
  }

  /** The other app hands the code in (no one is signed in there yet): the session token, once. */
  async take(dto: PortalHandoffDto) {
    const row = await this.db.global(async (c) => {
      const r = await c.query<{
        o_session_id: string;
        o_school_id: string;
        o_sub: string;
        o_target_name: string;
        o_expires_at: Date;
      }>(
        `SELECT o_session_id::text, o_school_id::text, o_sub, o_target_name, o_expires_at
           FROM app.portal_handoff_take($1, $2)`,
        [hash(dto.code), dto.app],
      );
      return r.rows[0];
    });
    if (!row)
      throw new DomainError('portal.handoff_invalid', 'This link has expired or was used', {
        status: 410,
      });
    const token = await this.impersonation.sign(
      row.o_session_id,
      row.o_school_id,
      row.o_sub,
      row.o_expires_at,
    );
    return {
      token,
      sub: row.o_sub,
      displayName: row.o_target_name,
      schoolId: row.o_school_id,
      expiresAt: row.o_expires_at.toISOString(),
    };
  }

  /** "End" in the portal: the session it runs under closes at once. */
  async endSelf(ctx: RequestContext) {
    const imp = ctx.user.impersonation;
    if (!imp || imp.mode === 'full')
      throw new DomainError('portal.not_opened_as', 'Not a portal opened as someone', {
        status: 409,
      });
    const row = await this.impersonation.end(ctx, imp.sessionId);
    return { ended: true, endedAt: row.endedAt };
  }
}
