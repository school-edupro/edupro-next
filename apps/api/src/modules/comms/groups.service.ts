import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { readFile } from '../masters/masters.service';
import {
  employeesByRule,
  normaliseEmail,
  normaliseMobile,
  studentsByRule,
  type AudienceRule,
} from './audience';
import type { CreateGroupDto, GroupMembersDto, GroupUploadDto, UpdateGroupDto } from './comms.dto';

export type GroupKind = 'student' | 'employee' | 'student_teacher' | 'external' | 'mixed';
export type MemberType = 'student' | 'employee' | 'guardian' | 'contact' | 'user';

export interface GroupRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: GroupKind;
  mode: 'static' | 'rule';
  rule: AudienceRule | null;
  members: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemberRow {
  type: MemberType;
  id: string;
  name: string;
  /** admission no or employee code */
  ref: string | null;
  detail: string | null;
  mobile: string | null;
  email: string | null;
}

const MEMBER_TYPES: Record<GroupKind, MemberType[]> = {
  student: ['student', 'guardian'],
  employee: ['employee'],
  student_teacher: ['student', 'employee', 'guardian'],
  external: ['contact'],
  mixed: ['student', 'employee', 'guardian', 'contact', 'user'],
};

/** Columns of the member upload, by group kind (the template download uses the same list). */
export const UPLOAD_COLUMNS: Record<Exclude<GroupKind, 'mixed'>, string[]> = {
  student: ['Admission No'],
  employee: ['Employee Code'],
  student_teacher: ['Admission No', 'Employee Code'],
  external: ['Name', 'Mobile', 'Email'],
};

type Cell = string | number | boolean | Date | null;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const varKey = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/**
 * Communication groups (v2, 2026-10-02): student, employee, student + teacher and external groups.
 * A group is kept by hand or by Excel upload (members are people: students, employees, guardians,
 * external contacts), or follows a rule (class, section, house, category, route, department...) so
 * it changes with admissions and withdrawals by itself. Older groups of logins keep working.
 */
@Injectable()
export class GroupsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private yearOf(ctx: RequestContext): string | null {
    return requireTenant(ctx).academicYearId ?? null;
  }

  private async rulePeople(
    c: PoolClient,
    g: { kind: string; rule: AudienceRule },
    yearId: string | null,
  ): Promise<Array<{ type: MemberType; id: string }>> {
    const out: Array<{ type: MemberType; id: string }> = [];
    if (g.kind !== 'employee' && yearId)
      out.push(
        ...(await studentsByRule(c, yearId, g.rule)).map((id) => ({
          type: 'student' as const,
          id,
        })),
      );
    if (g.kind === 'employee' || g.kind === 'student_teacher')
      out.push(
        ...(await employeesByRule(c, g.rule)).map((id) => ({ type: 'employee' as const, id })),
      );
    return out;
  }

  private async rowOf(c: PoolClient, id: string, yearId: string | null): Promise<GroupRow> {
    const r = await c.query<{
      id: string;
      code: string;
      name: string;
      description: string | null;
      kind: GroupKind;
      mode: 'static' | 'rule';
      rule: AudienceRule | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id::text, code, name, description, kind, mode, rule, created_at, updated_at FROM comms_groups WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    const g = r.rows[0];
    if (!g) throw new DomainError('not-found', 'Group not found', { status: 404 });
    const members =
      g.mode === 'rule' && g.rule
        ? (await this.rulePeople(c, { kind: g.kind, rule: g.rule }, yearId)).length
        : (
            await c.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM comms_group_members WHERE group_id = $1`,
              [g.id],
            )
          ).rows[0]!.n;
    return {
      id: g.id,
      code: g.code,
      name: g.name,
      description: g.description,
      kind: g.kind,
      mode: g.mode,
      rule: g.rule,
      members,
      createdAt: g.created_at.toISOString(),
      updatedAt: g.updated_at.toISOString(),
    };
  }

  async list(ctx: RequestContext): Promise<GroupRow[]> {
    const yearId = this.yearOf(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT id::text FROM comms_groups WHERE deleted_at IS NULL ORDER BY name`,
      );
      const out: GroupRow[] = [];
      for (const x of r.rows) out.push(await this.rowOf(c, x.id, yearId));
      return out;
    });
  }

  async get(ctx: RequestContext, id: string): Promise<GroupRow> {
    return this.db.tenant(requireTenant(ctx), (c) => this.rowOf(c, id, this.yearOf(ctx)));
  }

  /** Members with their identifiers; a rule group lists the people its rule picks today. */
  async members(ctx: RequestContext, groupId: string): Promise<MemberRow[]> {
    const yearId = this.yearOf(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) =>
      this.memberRows(c, await this.rowOf(c, groupId, yearId), yearId),
    );
  }

  private async memberRows(
    c: PoolClient,
    g: GroupRow,
    yearId: string | null,
  ): Promise<MemberRow[]> {
    const pairs =
      g.mode === 'rule' && g.rule
        ? await this.rulePeople(c, { kind: g.kind, rule: g.rule }, yearId)
        : (
            await c.query<{ type: MemberType; id: string }>(
              `SELECT person_type AS type, person_id::text AS id FROM comms_group_members WHERE group_id = $1`,
              [g.id],
            )
          ).rows;
    const of = (t: MemberType) => pairs.filter((p) => p.type === t).map((p) => p.id);
    const rows: MemberRow[] = [];
    const add = async (type: MemberType, sql: string) => {
      if (!of(type).length) return;
      rows.push(...(await c.query<MemberRow>(sql, [of(type)])).rows);
    };
    await add(
      'student',
      `SELECT 'student' AS type, s.id::text, s.display_name AS name, s.admission_no AS ref,
              (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                WHERE e.student_id = s.id AND e.status = 'active' ORDER BY e.academic_year_id DESC LIMIT 1) AS detail,
              s.profile->>'sms_mobile' AS mobile, s.profile->>'primary_email' AS email
         FROM students s WHERE s.id = ANY($1::bigint[]) AND s.deleted_at IS NULL`,
    );
    await add(
      'employee',
      `SELECT 'employee' AS type, e.id::text, e.display_name AS name, e.employee_code AS ref, NULLIF(concat_ws(' · ', e.designation, e.department), '') AS detail, e.mobile, e.email::text
         FROM employees e WHERE e.id = ANY($1::bigint[]) AND e.deleted_at IS NULL`,
    );
    await add(
      'guardian',
      `SELECT 'guardian' AS type, g.id::text, g.display_name AS name, NULL AS ref, 'Parent' AS detail, g.mobile, g.email::text
         FROM guardians g WHERE g.id = ANY($1::bigint[]) AND g.deleted_at IS NULL`,
    );
    await add(
      'contact',
      `SELECT 'contact' AS type, x.id::text, x.name, NULL AS ref,
              NULLIF((SELECT string_agg(v.value, ' · ') FROM jsonb_each_text(x.extra) v), '') AS detail, x.mobile, x.email::text
         FROM comms_contacts x WHERE x.id = ANY($1::bigint[]) AND x.deleted_at IS NULL`,
    );
    await add(
      'user',
      `SELECT 'user' AS type, u.id::text, u.display_name AS name, NULL AS ref, 'Login' AS detail, u.mobile, u.email::text
         FROM users u WHERE u.id = ANY($1::bigint[])`,
    );
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(ctx: RequestContext, dto: CreateGroupDto): Promise<GroupRow> {
    const yearId = this.yearOf(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const kind: GroupKind = dto.kind ?? (dto.userIds.length ? 'mixed' : 'student');
      const mode = dto.mode ?? 'static';
      if (mode === 'rule' && (!dto.rule || kind === 'external' || kind === 'mixed'))
        throw new DomainError(
          'validation-failed',
          'A rule group is a student, employee or student + teacher group with its filters',
          { status: 400 },
        );
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO comms_groups (school_id, code, name, description, kind, mode, rule, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::jsonb, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [
            dto.code,
            dto.name,
            dto.description ?? null,
            kind,
            mode,
            mode === 'rule' ? JSON.stringify(dto.rule) : null,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Group "${dto.code}" already exists`, { status: 409 });
        throw error;
      }
      if (dto.userIds.length) await this.addUsers(c, id, dto.userIds);
      if (dto.members.length) await this.addPeople(c, id, kind, dto.members);
      await this.audit.stage(ctx, c, {
        action: 'comms.group.create',
        entityType: 'comms_groups',
        entityId: id,
        after: { code: dto.code, name: dto.name, kind, mode },
      });
      return this.rowOf(c, id, yearId);
    });
  }

  async update(ctx: RequestContext, id: string, dto: UpdateGroupDto): Promise<GroupRow> {
    const yearId = this.yearOf(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.rowOf(c, id, yearId);
      await c.query(
        `UPDATE comms_groups SET name = COALESCE($2, name), description = CASE WHEN $3::boolean THEN $4 ELSE description END,
                rule = CASE WHEN mode = 'rule' AND $5::jsonb IS NOT NULL THEN $5::jsonb ELSE rule END,
                updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1`,
        [
          id,
          dto.name ?? null,
          dto.description !== undefined,
          dto.description ?? null,
          dto.rule ? JSON.stringify(dto.rule) : null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'comms.group.update',
        entityType: 'comms_groups',
        entityId: id,
        before: { name: before.name, rule: before.rule },
        after: dto,
      });
      return this.rowOf(c, id, yearId);
    });
  }

  async remove(ctx: RequestContext, id: string): Promise<{ ok: true }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE comms_groups SET deleted_at = now(), updated_by = app.current_user_id() WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Group not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'comms.group.delete',
        entityType: 'comms_groups',
        entityId: id,
      });
      return { ok: true as const };
    });
  }

  async updateMembers(ctx: RequestContext, groupId: string, dto: GroupMembersDto) {
    const yearId = this.yearOf(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const g = await this.rowOf(c, groupId, yearId);
      if (g.mode === 'rule')
        throw new DomainError('comms.group.rule', 'A rule group’s members follow its rule', {
          status: 409,
        });
      // older callers send login ids; new callers send people
      const addUsers = dto.add.filter((x): x is string => typeof x === 'string');
      const addPeople = dto.add.filter(
        (x): x is { type: MemberType; id: string } => typeof x !== 'string',
      );
      if (addUsers.length) await this.addUsers(c, groupId, addUsers);
      if (addPeople.length) await this.addPeople(c, groupId, g.kind, addPeople);
      for (const x of dto.remove) {
        if (typeof x === 'string')
          await c.query(
            `DELETE FROM comms_group_members WHERE group_id = $1 AND (user_id = $2 OR (person_type = 'user' AND person_id = $2))`,
            [groupId, x],
          );
        else
          await c.query(
            `DELETE FROM comms_group_members WHERE group_id = $1 AND person_type = $2 AND person_id = $3`,
            [groupId, x.type, x.id],
          );
      }
      await c.query(
        `UPDATE comms_groups SET updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [groupId],
      );
      await this.audit.stage(ctx, c, {
        action: 'comms.group.members',
        entityType: 'comms_groups',
        entityId: groupId,
        after: { added: dto.add.length, removed: dto.remove.length },
      });
      return { members: await this.memberRows(c, await this.rowOf(c, groupId, yearId), yearId) };
    });
  }

  /** Logins of school members (older groups): stored as the person behind the login. */
  private async addUsers(c: PoolClient, groupId: string, userIds: string[]) {
    await c.query(
      `INSERT INTO comms_group_members (school_id, group_id, user_id, person_type, person_id, added_by)
       SELECT app.current_school_id(), $1, u.id,
              COALESCE((SELECT 'guardian' FROM guardians g WHERE g.user_id = u.id LIMIT 1), (SELECT 'employee' FROM employees e WHERE e.user_id = u.id LIMIT 1), (SELECT 'student' FROM students s WHERE s.user_id = u.id LIMIT 1), 'user'),
              COALESCE((SELECT g.id FROM guardians g WHERE g.user_id = u.id LIMIT 1), (SELECT e.id FROM employees e WHERE e.user_id = u.id LIMIT 1), (SELECT s.id FROM students s WHERE s.user_id = u.id LIMIT 1), u.id),
              app.current_user_id()
         FROM users u
        WHERE u.id = ANY($2::bigint[]) AND EXISTS (SELECT 1 FROM user_school_memberships m WHERE m.user_id = u.id AND m.school_id = app.current_school_id() AND m.deleted_at IS NULL)
       ON CONFLICT (group_id, person_type, person_id) DO NOTHING`,
      [groupId, userIds],
    );
  }

  private async addPeople(
    c: PoolClient,
    groupId: string,
    kind: GroupKind,
    people: Array<{ type: MemberType; id: string }>,
  ) {
    const allowed = MEMBER_TYPES[kind];
    const bad = people.find((p) => !allowed.includes(p.type));
    if (bad)
      throw new DomainError(
        'comms.group.member_type',
        `A ${kind.replace('_', ' + ')} group cannot hold a ${bad.type}`,
        { status: 400 },
      );
    const tables = {
      student: 'students',
      employee: 'employees',
      guardian: 'guardians',
      contact: 'comms_contacts',
    } as const;
    for (const t of Object.keys(tables) as Array<keyof typeof tables>) {
      const list = people.filter((p) => p.type === t).map((p) => p.id);
      if (!list.length) continue;
      await c.query(
        // eslint-disable-next-line no-restricted-syntax -- the table is one of four fixed names; values are bound parameters
        `INSERT INTO comms_group_members (school_id, group_id, person_type, person_id, added_by)
         SELECT app.current_school_id(), $1, $2, x.id, app.current_user_id() FROM ${tables[t]} x WHERE x.id = ANY($3::bigint[]) AND x.deleted_at IS NULL
         ON CONFLICT (group_id, person_type, person_id) DO NOTHING`,
        [groupId, t, list],
      );
    }
  }

  /**
   * Members from Excel. Student groups match "Admission No" (old admission numbers too), employee
   * groups "Employee Code", student + teacher groups either; external groups take Name, Mobile, Email
   * and keep every other column as a variable. A dry run reports what would be added and what was not
   * found; "replace" swaps the members for the file's.
   */
  async upload(ctx: RequestContext, groupId: string, dto: GroupUploadDto) {
    const yearId = this.yearOf(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const g = await this.rowOf(c, groupId, yearId);
      if (g.mode === 'rule')
        throw new DomainError('comms.group.rule', 'A rule group’s members follow its rule', {
          status: 409,
        });
      const parsed = await parseMemberSheet(c, dto, g.kind);
      const summary = {
        rows: parsed.rows,
        matched: parsed.people.length + parsed.contacts.length,
        problems: parsed.problems,
        mode: dto.mode,
        dryRun: dto.dryRun,
      };
      if (dto.dryRun) return { ...summary, group: g };
      if (dto.mode === 'replace')
        await c.query(`DELETE FROM comms_group_members WHERE group_id = $1`, [groupId]);
      if (parsed.people.length) await this.addPeople(c, groupId, g.kind, parsed.people);
      for (const id of await saveContacts(c, parsed.contacts))
        await c.query(
          `INSERT INTO comms_group_members (school_id, group_id, person_type, person_id, added_by) VALUES (app.current_school_id(), $1, 'contact', $2, app.current_user_id())
           ON CONFLICT (group_id, person_type, person_id) DO NOTHING`,
          [groupId, id],
        );
      await c.query(
        `UPDATE comms_groups SET updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [groupId],
      );
      await this.audit.stage(ctx, c, {
        action: 'comms.group.upload',
        entityType: 'comms_groups',
        entityId: groupId,
        after: {
          rows: summary.rows,
          matched: summary.matched,
          problems: parsed.problems.length,
          mode: dto.mode,
        },
      });
      return { ...summary, group: await this.rowOf(c, groupId, yearId) };
    });
  }

  /** The upload template for a group kind, with an example row. */
  async template(kind: GroupKind): Promise<Buffer> {
    const cols =
      kind === 'mixed'
        ? ['Admission No', 'Employee Code', 'Name', 'Mobile', 'Email']
        : kind === 'external'
          ? [...UPLOAD_COLUMNS.external, 'Organisation']
          : UPLOAD_COLUMNS[kind];
    const example: Record<string, string> = {
      'Admission No': 'A2401',
      'Employee Code': 'T001',
      Name: 'Ravi Kumar',
      Mobile: '9876543210',
      Email: 'ravi@example.com',
      Organisation: 'Book vendor',
    };
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Members');
    ws.addRow(cols);
    ws.getRow(1).font = { bold: true };
    ws.addRow(cols.map((h) => example[h] ?? ''));
    ws.columns.forEach((col) => (col.width = 20));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Search students, employees and parents to add by hand. */
  async searchPeople(ctx: RequestContext, q: string, types: MemberType[]) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const like = `%${q.toLowerCase()}%`;
      const out: MemberRow[] = [];
      if (types.includes('student'))
        out.push(
          ...(
            await c.query<MemberRow>(
              `SELECT 'student' AS type, s.id::text, s.display_name AS name, s.admission_no AS ref,
                      (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                        WHERE e.student_id = s.id AND e.status = 'active' ORDER BY e.academic_year_id DESC LIMIT 1) AS detail,
                      s.profile->>'sms_mobile' AS mobile, s.profile->>'primary_email' AS email
                 FROM students s WHERE s.deleted_at IS NULL AND s.status = 'active' AND (lower(s.display_name) LIKE $1 OR lower(s.admission_no) LIKE $1)
                ORDER BY s.display_name LIMIT 20`,
              [like],
            )
          ).rows,
        );
      if (types.includes('employee'))
        out.push(
          ...(
            await c.query<MemberRow>(
              `SELECT 'employee' AS type, e.id::text, e.display_name AS name, e.employee_code AS ref, NULLIF(concat_ws(' · ', e.designation, e.department), '') AS detail, e.mobile, e.email::text
                 FROM employees e WHERE e.deleted_at IS NULL AND e.status = 'active' AND (lower(e.display_name) LIKE $1 OR lower(e.employee_code) LIKE $1)
                ORDER BY e.display_name LIMIT 20`,
              [like],
            )
          ).rows,
        );
      if (types.includes('guardian'))
        out.push(
          ...(
            await c.query<MemberRow>(
              `SELECT 'guardian' AS type, g.id::text, g.display_name AS name, NULL AS ref, 'Parent' AS detail, g.mobile, g.email::text
                 FROM guardians g WHERE g.deleted_at IS NULL AND (lower(g.display_name) LIKE $1 OR g.mobile LIKE $1)
                ORDER BY g.display_name LIMIT 20`,
              [like],
            )
          ).rows,
        );
      return out;
    });
  }

  /** Values for rule filters (houses, categories, streams, departments...) as the school uses them. */
  async ruleOptions(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const distinct = async (sql: string) =>
        (await c.query<{ v: string }>(sql)).rows.map((x) => x.v).filter(Boolean);
      return {
        houses: await distinct(
          `SELECT DISTINCT house AS v FROM students WHERE deleted_at IS NULL AND house IS NOT NULL ORDER BY 1`,
        ),
        categories: await distinct(
          `SELECT DISTINCT category AS v FROM students WHERE deleted_at IS NULL AND category IS NOT NULL ORDER BY 1`,
        ),
        genders: ['male', 'female', 'other'],
        streams: await distinct(
          `SELECT DISTINCT profile->>'stream' AS v FROM students WHERE deleted_at IS NULL AND profile ? 'stream' ORDER BY 1`,
        ),
        religions: await distinct(
          `SELECT DISTINCT profile->>'religion' AS v FROM students WHERE deleted_at IS NULL AND profile ? 'religion' ORDER BY 1`,
        ),
        departments: await distinct(
          `SELECT DISTINCT department AS v FROM employees WHERE deleted_at IS NULL AND department IS NOT NULL ORDER BY 1`,
        ),
        designations: await distinct(
          `SELECT DISTINCT designation AS v FROM employees WHERE deleted_at IS NULL AND designation IS NOT NULL ORDER BY 1`,
        ),
        employeeTypes: await distinct(
          `SELECT DISTINCT employee_type::text AS v FROM employees WHERE deleted_at IS NULL ORDER BY 1`,
        ),
        routes: (
          await c.query<{ id: string; label: string }>(
            `SELECT id::text, code || ' · ' || name AS label FROM transport_routes ORDER BY code`,
          )
        ).rows,
      };
    });
  }
}

export interface ParsedContact {
  name: string;
  mobile: string | null;
  email: string | null;
  extra: Record<string, string>;
}

/**
 * Reads a member / recipient sheet. Admission No and Employee Code columns match people; Name with
 * Mobile and / or Email makes contacts, with every other column kept as a {{variable}}.
 */
export async function parseMemberSheet(
  c: PoolClient,
  dto: { csv?: string; contentBase64?: string },
  kind: GroupKind,
): Promise<{
  rows: number;
  people: Array<{ type: MemberType; id: string }>;
  contacts: ParsedContact[];
  problems: Array<{ row: number; value: string; reason: string }>;
}> {
  const file = await readFile(dto, {
    isHeader: (cells) =>
      cells.some((x) =>
        ['admissionno', 'employeecode', 'mobile', 'email', 'name'].includes(norm(x)),
      ),
  });
  const col = (...names: string[]) => file.header.findIndex((h) => names.includes(norm(h)));
  const cell = (row: Cell[], i: number) => (i < 0 ? '' : String(row[i] ?? '').trim());
  const people: Array<{ type: MemberType; id: string }> = [];
  const contacts: ParsedContact[] = [];
  const problems: Array<{ row: number; value: string; reason: string }> = [];
  const ai = col('admissionno', 'admno', 'admission', 'admissionnumber');
  const ci = col('employeecode', 'empcode', 'employeeid', 'staffcode');
  const ni = col('name', 'fullname', 'contactname');
  const mi = col('mobile', 'mobileno', 'phone', 'contactno', 'whatsapp', 'whatsappno');
  const ei = col('email', 'emailid', 'mail');
  const peopleSheet = kind !== 'external' && (ai >= 0 || ci >= 0);
  if (kind !== 'external' && kind !== 'mixed' && !peopleSheet)
    throw new DomainError(
      'validation-failed',
      `The sheet needs ${UPLOAD_COLUMNS[kind].join(' or ')}`,
      { status: 400 },
    );
  if (!peopleSheet && (ni < 0 || (mi < 0 && ei < 0)))
    throw new DomainError(
      'validation-failed',
      'The sheet needs a Name column and a Mobile or Email column',
      { status: 400 },
    );

  if (peopleSheet) {
    const adm = file.rows.map((r) => cell(r, ai).toLowerCase()).filter(Boolean);
    const codes = file.rows.map((r) => cell(r, ci).toLowerCase()).filter(Boolean);
    const st = adm.length
      ? await c.query<{ id: string; no: string }>(
          `SELECT s.id::text, lower(s.admission_no) AS no FROM students s WHERE lower(s.admission_no) = ANY($1::text[]) AND s.deleted_at IS NULL
           UNION
           SELECT h.student_id::text, lower(h.old_no) FROM admission_no_changes h WHERE lower(h.old_no) = ANY($1::text[])`,
          [adm],
        )
      : { rows: [] };
    const em = codes.length
      ? await c.query<{ id: string; code: string }>(
          `SELECT id::text, lower(employee_code) AS code FROM employees WHERE lower(employee_code) = ANY($1::text[]) AND deleted_at IS NULL`,
          [codes],
        )
      : { rows: [] };
    const sBy = new Map(st.rows.map((x) => [x.no, x.id]));
    const eBy = new Map(em.rows.map((x) => [x.code, x.id]));
    file.rows.forEach((row, n) => {
      const a = cell(row, ai);
      const code = cell(row, ci);
      if (a) {
        const id = sBy.get(a.toLowerCase());
        if (id && kind !== 'employee') people.push({ type: 'student', id });
        else
          problems.push({
            row: file.rowNumbers[n]!,
            value: a,
            reason: 'No student with this admission number',
          });
      }
      if (code) {
        const id = eBy.get(code.toLowerCase());
        if (id && kind !== 'student') people.push({ type: 'employee', id });
        else
          problems.push({
            row: file.rowNumbers[n]!,
            value: code,
            reason: 'No employee with this code',
          });
      }
    });
  } else {
    const extraCols = file.header
      .map((h, i) => ({ h, i }))
      .filter((x) => x.h && ![ni, mi, ei].includes(x.i));
    file.rows.forEach((row, n) => {
      const name = cell(row, ni);
      const mobile = normaliseMobile(cell(row, mi));
      const email = normaliseEmail(cell(row, ei));
      if (!name && !cell(row, mi) && !cell(row, ei)) return;
      if (!name) problems.push({ row: file.rowNumbers[n]!, value: '', reason: 'Name is empty' });
      else if (!mobile && !email)
        problems.push({
          row: file.rowNumbers[n]!,
          value: name,
          reason: 'No valid 10-digit mobile or email',
        });
      else
        contacts.push({
          name,
          mobile,
          email,
          extra: Object.fromEntries(
            extraCols.map((x) => [varKey(x.h), cell(row, x.i)]).filter(([k, v]) => k && v),
          ),
        });
    });
  }
  return {
    rows: file.rows.length,
    people: [...new Map(people.map((p) => [`${p.type}:${p.id}`, p])).values()],
    contacts,
    problems,
  };
}

/** Saves contacts (an existing one with the same name, mobile and email is reused); returns their ids. */
export async function saveContacts(c: PoolClient, contacts: ParsedContact[]): Promise<string[]> {
  const ids: string[] = [];
  for (const x of contacts) {
    const existing = await c.query<{ id: string }>(
      `SELECT id::text FROM comms_contacts WHERE deleted_at IS NULL AND name = $1 AND mobile IS NOT DISTINCT FROM $2 AND email IS NOT DISTINCT FROM $3::citext LIMIT 1`,
      [x.name, x.mobile, x.email],
    );
    if (existing.rows[0]) {
      await c.query(`UPDATE comms_contacts SET extra = extra || $2::jsonb WHERE id = $1`, [
        existing.rows[0].id,
        JSON.stringify(x.extra),
      ]);
      ids.push(existing.rows[0].id);
    } else
      ids.push(
        (
          await c.query<{ id: string }>(
            `INSERT INTO comms_contacts (school_id, name, mobile, email, extra, created_by) VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, app.current_user_id()) RETURNING id::text`,
            [x.name, x.mobile, x.email, JSON.stringify(x.extra)],
          )
        ).rows[0]!.id,
      );
  }
  return ids;
}
