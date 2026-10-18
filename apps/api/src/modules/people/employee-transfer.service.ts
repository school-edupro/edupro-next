import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  EMPLOYEE_FIELDS,
  EmployeeWriteError,
  decryptField,
  encryptField,
  loadEmployeeLists,
  nextEmployeeCode,
  readEmployeeProfile,
  validateEmployeeChanges,
  writeEmployeeProfile,
  type PoolClient,
} from '@edupro/db';
import { LocalStorage } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER, type StorageDriver } from '../files/storage';
import type {
  EmployeeCampusMoveDto,
  EmployeeTransferAcceptDto,
  EmployeeTransferRequestDto,
} from './people.dto';

interface FileRef {
  objectKey: string;
  contentType: string;
  name: string | null;
  size: number;
}
type Row = Record<string, string | number | boolean | null>;
export interface StaffSnapshot {
  name: string;
  code: string;
  designation: string | null;
  department: string | null;
  fromSchool: string;
  toSchool: string;
  values: Record<string, string | number>;
  /** ID numbers, encrypted at rest as the profile keeps them */
  secure: Record<string, string>;
  rows: { education: Row[]; languages: Row[]; experience: Row[]; transfers: Row[] };
  documents: Array<
    FileRef & {
      typeCode: string;
      typeName: string;
      number: string | null;
      issuedOn: string | null;
      expiresOn: string | null;
    }
  >;
  photo: FileRef | null;
  subjects: string[];
  login: string | null;
}
interface TransferRow {
  id: string;
  from_school_id: string;
  to_school_id: string;
  from_employee_id: string;
  on_date: string;
  order_no: string | null;
  status: 'requested' | 'accepted' | 'rejected' | 'cancelled';
  snapshot: StaffSnapshot;
  note: string | null;
  requested_by_name: string | null;
  requested_at: Date;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  to_employee_id: string | null;
}
const COLS = `id::text, from_school_id::text, to_school_id::text, from_employee_id::text, on_date::text, order_no, status, snapshot,
  note, requested_by_name, requested_at, decided_by_name, decided_at, decision_note, to_employee_id::text`;

/** The keys copied as they are; the target chooses these again. */
const NOT_COPIED = new Set([
  'employee_code',
  'department',
  'designation',
  'staff_type',
  'left_on',
  'leaving_reason',
  'acr_hod',
  'approver_l1',
  'approver_l2',
  'approver_l3',
]);

/**
 * Staff transfers (docs/design/30-employee-master.md): a move between campuses of the school (the
 * posting of the year, a transfer row and a remark), and a transfer to another school of the group that
 * the target accepts — the employee is copied there with the target's code (values its masters do not
 * know are left for its office to fill), the rows, documents (by type code), photo, subjects and the same
 * login; the source record closes on the transfer date.
 */
@Injectable()
export class EmployeeTransferService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private async userName(c: PoolClient) {
    const r = await c.query<{ name: string }>(
      `SELECT display_name AS name FROM users WHERE id = app.current_user_id()`,
    );
    return r.rows[0]?.name ?? null;
  }

  // ---- within the school ------------------------------------------------------------------------
  /** Moves an employee to another campus (and, if given, department / designation) from a date. */
  async campusMove(ctx: RequestContext, id: string, dto: EmployeeCampusMoveDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await c.query<{
        department: string | null;
        designation: string | null;
        campus: string | null;
        campus_id: string | null;
      }>(
        `SELECT e.department, e.designation,
                (SELECT cp.name FROM postings p JOIN campuses cp ON cp.id = p.campus_id WHERE p.employee_id = e.id ORDER BY p.valid_from DESC LIMIT 1) AS campus,
                (SELECT p.campus_id::text FROM postings p WHERE p.employee_id = e.id ORDER BY p.valid_from DESC LIMIT 1) AS campus_id
           FROM employees e WHERE e.id = $1 AND e.deleted_at IS NULL`,
        [id],
      );
      const cur = e.rows[0];
      if (!cur) throw new DomainError('not-found', 'Employee not found', { status: 404 });
      const to = await c.query<{ name: string }>(`SELECT name FROM campuses WHERE id = $1`, [
        dto.campusId,
      ]);
      if (!to.rows[0])
        throw new DomainError('validation-failed', 'Unknown campus', { status: 400 });
      if (cur.campus_id === dto.campusId)
        throw new DomainError('validation-failed', `Already at ${to.rows[0].name}`, {
          status: 400,
        });
      const lists = await loadEmployeeLists(c);
      const { values, errors } = await validateEmployeeChanges(
        c,
        {
          ...(dto.department ? { department: dto.department } : {}),
          ...(dto.designation ? { designation: dto.designation } : {}),
        },
        lists,
        id,
      );
      if (Object.keys(errors).length)
        throw new DomainError('validation-failed', Object.values(errors).join('; '), {
          status: 400,
        });
      if (Object.keys(values).length) await writeEmployeeProfile(c, id, values);
      const department = (values.department as string | undefined) ?? cur.department;
      const designation = (values.designation as string | undefined) ?? cur.designation;
      // the posting of the active year carries the campus
      await c.query(
        `INSERT INTO postings (school_id, employee_id, academic_year_id, campus_id, department, designation, valid_from, created_by)
         SELECT app.current_school_id(), $1, y.id, $2, $3, $4, $5, app.current_user_id()
           FROM academic_years y WHERE y.status = 'active' ORDER BY y.start_date DESC LIMIT 1
         ON CONFLICT (employee_id, academic_year_id)
         DO UPDATE SET campus_id = EXCLUDED.campus_id, department = EXCLUDED.department, designation = EXCLUDED.designation,
                       valid_from = EXCLUDED.valid_from, updated_at = now(), updated_by = app.current_user_id()`,
        [id, dto.campusId, department, designation, dto.onDate],
      );
      await c.query(
        `INSERT INTO employee_transfers (school_id, employee_id, on_date, from_place, to_place, order_no, remarks, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id())`,
        [
          id,
          dto.onDate,
          cur.campus ?? 'No campus',
          to.rows[0].name,
          dto.orderNo ?? null,
          dto.remarks ?? 'Campus move',
        ],
      );
      await c.query(
        `INSERT INTO employee_remarks (school_id, employee_id, on_date, remark, source, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, 'system', app.current_user_id())`,
        [id, dto.onDate, `Moved to ${to.rows[0].name}${cur.campus ? ` from ${cur.campus}` : ''}`],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.employee.campus_move',
        entityType: 'employees',
        entityId: id,
        before: { campus: cur.campus, department: cur.department, designation: cur.designation },
        after: { campus: to.rows[0].name, department, designation, onDate: dto.onDate },
      });
      return { ok: true };
    });
  }

  // ---- to another school of the group -----------------------------------------------------------
  async targets(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM app.transfer_targets()`,
      );
      return { data: r.rows };
    });
  }

  private view(r: TransferRow, schoolId: string) {
    const s = r.snapshot;
    return {
      id: r.id,
      direction: r.from_school_id === schoolId ? ('outgoing' as const) : ('incoming' as const),
      status: r.status,
      employee: {
        id: r.from_employee_id,
        name: s.name,
        code: s.code,
        designation: s.designation,
        department: s.department,
      },
      fromSchool: s.fromSchool,
      toSchool: s.toSchool,
      onDate: r.on_date,
      orderNo: r.order_no,
      note: r.note,
      requestedBy: r.requested_by_name,
      requestedAt: r.requested_at.toISOString(),
      decidedBy: r.decided_by_name,
      decidedAt: r.decided_at?.toISOString() ?? null,
      decisionNote: r.decision_note,
      toEmployeeId: r.to_employee_id,
      carries: {
        values: Object.keys(s.values).length + Object.keys(s.secure).length,
        documents: s.documents.length,
        education: s.rows.education.length,
        experience: s.rows.experience.length,
        login: Boolean(s.login),
      },
    };
  }

  async list(ctx: RequestContext, box: 'incoming' | 'outgoing' | 'all') {
    const t = requireTenant(ctx);
    return this.db.tenant(t, async (c) => {
      const r = await c.query<TransferRow>(
        // eslint-disable-next-line no-restricted-syntax -- COLS is a fixed fragment; values are bound
        `SELECT ${COLS} FROM employee_school_transfers
          WHERE ($1 = 'all' OR ($1 = 'incoming' AND to_school_id = app.current_school_id()) OR ($1 = 'outgoing' AND from_school_id = app.current_school_id()))
          ORDER BY (status = 'requested') DESC, requested_at DESC LIMIT 200`,
        [box],
      );
      return { data: r.rows.map((x) => this.view(x, t.schoolId)) };
    });
  }

  private async find(c: PoolClient, id: string, lock = false) {
    const r = await c.query<TransferRow>(
      // eslint-disable-next-line no-restricted-syntax -- COLS is a fixed fragment; values are bound
      `SELECT ${COLS} FROM employee_school_transfers WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Transfer not found', { status: 404 });
    return r.rows[0];
  }

  private async fileRef(c: PoolClient, fileId: string | null): Promise<FileRef | null> {
    if (!fileId) return null;
    const r = await c.query<{
      object_key: string;
      content_type: string;
      original_name: string | null;
      size_bytes: string;
    }>(
      `SELECT object_key, content_type, original_name, size_bytes::text FROM files WHERE id = $1 AND status = 'ready'`,
      [fileId],
    );
    const x = r.rows[0];
    return x
      ? {
          objectKey: x.object_key,
          contentType: x.content_type,
          name: x.original_name,
          size: Number(x.size_bytes),
        }
      : null;
  }

  private async snapshot(c: PoolClient, id: string, toSchool: string): Promise<StaffSnapshot> {
    const p = await readEmployeeProfile(c, id, true);
    if (!p) throw new DomainError('not-found', 'Employee not found', { status: 404 });
    const values: StaffSnapshot['values'] = {};
    const secure: StaffSnapshot['secure'] = {};
    for (const f of EMPLOYEE_FIELDS) {
      if (f.store.t === 'auto' || NOT_COPIED.has(f.key)) continue;
      const v = p.values[f.key];
      if (v === null || v === undefined || v === '') continue;
      if (f.sensitive) secure[f.key] = encryptField(String(v));
      else values[f.key] = v;
    }
    const q = async (sql: string) => (await c.query<Row>(sql, [id])).rows;
    const docs = await c.query<{
      code: string;
      name: string;
      number: string | null;
      issued_on: string | null;
      expires_on: string | null;
      file_id: string;
    }>(
      `SELECT t.code, t.name, d.number, d.issued_on::text, d.expires_on::text, d.file_id::text
         FROM employee_documents d JOIN employee_document_types t ON t.id = d.type_id
        WHERE d.employee_id = $1 AND d.deleted_at IS NULL`,
      [id],
    );
    const documents: StaffSnapshot['documents'] = [];
    for (const d of docs.rows) {
      const ref = await this.fileRef(c, d.file_id);
      if (ref)
        documents.push({
          ...ref,
          typeCode: d.code,
          typeName: d.name,
          number: d.number,
          issuedOn: d.issued_on,
          expiresOn: d.expires_on,
        });
    }
    const e = await c.query<{
      display_name: string;
      employee_code: string;
      designation: string | null;
      department: string | null;
      photo: string | null;
      user_id: string | null;
      school: string;
    }>(
      `SELECT e.display_name, e.employee_code, e.designation, e.department, e.photo_file_id::text AS photo, e.user_id::text, s.name AS school
         FROM employees e JOIN schools s ON s.id = e.school_id WHERE e.id = $1`,
      [id],
    );
    const x = e.rows[0]!;
    return {
      name: x.display_name,
      code: x.employee_code,
      designation: x.designation,
      department: x.department,
      fromSchool: x.school,
      toSchool,
      values,
      secure,
      rows: {
        education: await q(
          `SELECT qualification, specialisation, institution, passing_year, score, mode FROM employee_education WHERE employee_id = $1`,
        ),
        languages: await q(
          `SELECT language, can_read, can_write, can_speak FROM employee_languages WHERE employee_id = $1`,
        ),
        experience: await q(
          `SELECT organisation, designation, from_on::text, to_on::text, reason FROM employee_experience WHERE employee_id = $1`,
        ),
        transfers: await q(
          `SELECT on_date::text, from_place, to_place, order_no, remarks FROM employee_transfers WHERE employee_id = $1`,
        ),
      },
      documents,
      photo: await this.fileRef(c, x.photo),
      subjects: (
        await q(
          `SELECT s.name FROM employee_subjects es JOIN subjects s ON s.id = es.subject_id WHERE es.employee_id = $1`,
        )
      ).map((r) => String(r.name)),
      login: x.user_id,
    };
  }

  /** The source school asks another school of the group to take the employee from a date. */
  async request(ctx: RequestContext, id: string, dto: EmployeeTransferRequestDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const target = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM app.transfer_targets() WHERE id = $1`,
        [dto.toSchoolId],
      );
      if (!target.rows[0])
        throw new DomainError('validation-failed', 'Choose another school of the group', {
          status: 400,
        });
      const e = await c.query<{ status: string }>(
        `SELECT status::text FROM employees WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!e.rows[0]) throw new DomainError('not-found', 'Employee not found', { status: 404 });
      if (e.rows[0].status !== 'active')
        throw new DomainError('validation-failed', 'Only an active employee can be transferred', {
          status: 409,
        });
      const snap = await this.snapshot(c, id, target.rows[0].name);
      let tid: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO employee_school_transfers (from_school_id, to_school_id, from_employee_id, on_date, order_no, snapshot, note, requested_by, requested_by_name)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::jsonb, $6, app.current_user_id(), $7) RETURNING id::text`,
          [
            dto.toSchoolId,
            id,
            dto.onDate,
            dto.orderNo ?? null,
            JSON.stringify(snap),
            dto.note ?? null,
            await this.userName(c),
          ],
        );
        tid = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', 'A transfer of this employee is already waiting', {
            status: 409,
          });
        throw error;
      }
      await c.query(
        `INSERT INTO employee_remarks (school_id, employee_id, remark, source, created_by)
         VALUES (app.current_school_id(), $1, $2, 'system', app.current_user_id())`,
        [id, `Transfer to ${target.rows[0].name} from ${dto.onDate} requested`],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.employee.transfer_request',
        entityType: 'employee_school_transfers',
        entityId: tid,
        after: { employeeId: id, toSchoolId: dto.toSchoolId, onDate: dto.onDate },
      });
      return this.view(await this.find(c, tid), requireTenant(ctx).schoolId);
    });
  }

  /** The target school takes the employee: a new record here with its code, rows, documents, login. */
  async accept(ctx: RequestContext, transferId: string, dto: EmployeeTransferAcceptDto) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const t = await this.find(c, transferId, true);
      if (t.to_school_id !== tenant.schoolId)
        throw new DomainError('not-found', 'Transfer not found', { status: 404 });
      if (t.status !== 'requested')
        throw new DomainError('conflict', `This transfer is ${t.status}`, { status: 409 });
      const s = t.snapshot;
      await c.query(
        `SELECT app.staff_masters_seed(app.current_school_id()), app.staff_profile_lists_seed(app.current_school_id()), app.employee_document_types_seed(app.current_school_id())`,
      );
      const lists = await loadEmployeeLists(c);
      // the values this school's lists accept; the rest is left for the office to fill
      const raw: Record<string, unknown> = { ...s.values };
      for (const [k, v] of Object.entries(s.secure)) raw[k] = decryptField(v);
      const { values } = await validateEmployeeChanges(c, raw, lists, null);
      const left = Object.keys(raw).filter((k) => !(k in values));
      const chosen = await validateEmployeeChanges(
        c,
        {
          employee_code: dto.code || (await nextEmployeeCode(c)),
          department: dto.department,
          designation: dto.designation,
          staff_type: dto.staffType,
        },
        lists,
        null,
      );
      if (Object.keys(chosen.errors).length)
        throw new DomainError('validation-failed', Object.values(chosen.errors).join('; '), {
          status: 400,
        });
      let empId: string;
      try {
        empId = await writeEmployeeProfile(c, null, { ...values, ...chosen.values });
      } catch (e) {
        if (e instanceof EmployeeWriteError)
          throw new DomainError('validation-failed', Object.values(e.errors).join('; '), {
            status: 400,
          });
        throw e;
      }
      await c.query(
        `INSERT INTO postings (school_id, employee_id, academic_year_id, campus_id, department, designation, valid_from, created_by)
         SELECT app.current_school_id(), $1, y.id, $2, $3, $4, $5, app.current_user_id()
           FROM academic_years y WHERE y.status = 'active' ORDER BY y.start_date DESC LIMIT 1
         ON CONFLICT (employee_id, academic_year_id) DO NOTHING`,
        [
          empId,
          dto.campusId ?? null,
          chosen.values.department,
          chosen.values.designation,
          t.on_date,
        ],
      );
      // the rows as they were, and this transfer as one more
      const ins = async (table: string, cols: string[], rows: Row[]) => {
        for (const r of rows)
          await c.query(
            // eslint-disable-next-line no-restricted-syntax -- table and columns are constants of this file; values are bound
            `INSERT INTO ${table} (school_id, employee_id, ${cols.join(', ')}, created_by)
             VALUES (app.current_school_id(), $1, ${cols.map((_, i) => `$${String(i + 2)}`).join(', ')}, app.current_user_id())
             ON CONFLICT DO NOTHING`,
            [empId, ...cols.map((k) => r[k] ?? null)],
          );
      };
      await ins(
        'employee_education',
        ['qualification', 'specialisation', 'institution', 'passing_year', 'score', 'mode'],
        s.rows.education,
      );
      await ins(
        'employee_languages',
        ['language', 'can_read', 'can_write', 'can_speak'],
        s.rows.languages,
      );
      await ins(
        'employee_experience',
        ['organisation', 'designation', 'from_on', 'to_on', 'reason'],
        s.rows.experience,
      );
      await ins(
        'employee_transfers',
        ['on_date', 'from_place', 'to_place', 'order_no', 'remarks'],
        [
          ...s.rows.transfers,
          {
            on_date: t.on_date,
            from_place: s.fromSchool,
            to_place: s.toSchool,
            order_no: t.order_no,
            remarks: `Transferred in (was ${s.code})`,
          },
        ],
      );
      // subjects by name, documents by type code; the bytes are copied into this school's storage
      await c.query(
        `INSERT INTO employee_subjects (school_id, employee_id, subject_id, created_by)
         SELECT app.current_school_id(), $1, id, app.current_user_id() FROM subjects
          WHERE deleted_at IS NULL AND lower(name) = ANY($2::text[]) ON CONFLICT DO NOTHING`,
        [empId, s.subjects.map((x) => x.toLowerCase())],
      );
      const copy = async (ref: FileRef): Promise<string> => {
        const bytes = await this.storage.read(ref.objectKey);
        const ext = ref.objectKey.split('.').pop() ?? 'bin';
        const key = LocalStorage.joinKey(
          `school-${tenant.schoolId}`,
          String(new Date().getUTCFullYear()),
          String(new Date().getUTCMonth() + 1).padStart(2, '0'),
          `${randomUUID()}.${ext}`,
        );
        await this.storage.write(key, bytes, ref.contentType);
        const f = await c.query<{ id: string }>(
          `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, classification, storage_driver, status,
                              owner_entity_type, owner_entity_id, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, 'personal', $6, 'ready', 'employee', $7::text, app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [
            this.storage.bucket,
            key,
            ref.contentType,
            bytes.length,
            ref.name,
            this.storage.name,
            empId,
          ],
        );
        return f.rows[0]!.id;
      };
      if (s.photo)
        await c.query(`UPDATE employees SET photo_file_id = $2 WHERE id = $1`, [
          empId,
          await copy(s.photo),
        ]);
      let docsCopied = 0;
      const docsLeft: string[] = [];
      for (const d of s.documents) {
        const type = await c.query<{ id: string }>(
          `SELECT id::text FROM employee_document_types WHERE code = $1 AND status = 'active'`,
          [d.typeCode],
        );
        if (!type.rows[0]) {
          docsLeft.push(d.typeName);
          continue;
        }
        await c.query(
          `INSERT INTO employee_documents (school_id, employee_id, type_id, file_id, number, issued_on, expires_on, remarks, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, 'Carried over by transfer', app.current_user_id())`,
          [empId, type.rows[0].id, await copy(d), d.number, d.issuedOn, d.expiresOn],
        );
        docsCopied += 1;
      }
      // the same login, now also for this school
      if (s.login) {
        await c.query(
          `INSERT INTO user_school_memberships (school_id, user_id, person_type, person_ref_id, status)
           VALUES (app.current_school_id(), $1, 'employee', $2, 'active')
           ON CONFLICT (school_id, user_id, person_type) DO UPDATE SET status = 'active', deleted_at = NULL, person_ref_id = EXCLUDED.person_ref_id, updated_at = now()`,
          [s.login, empId],
        );
        await c.query(`UPDATE employees SET user_id = $2 WHERE id = $1`, [empId, s.login]);
      }
      await c.query(
        `INSERT INTO employee_remarks (school_id, employee_id, on_date, remark, source, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, 'system', app.current_user_id())`,
        [
          empId,
          t.on_date,
          `Transferred in from ${s.fromSchool} (code there ${s.code})${left.length ? `; to fill: ${left.join(', ')}` : ''}`,
        ],
      );
      await c.query(
        `UPDATE employee_school_transfers SET status = 'accepted', decided_by = app.current_user_id(), decided_by_name = $2,
                decided_at = now(), decision_note = $3, to_employee_id = $4 WHERE id = $1`,
        [transferId, await this.userName(c), dto.note ?? null, empId],
      );
      await c.query(`SELECT app.employee_transfer_close_source($1)`, [transferId]);
      await this.audit.stage(ctx, c, {
        action: 'people.employee.transfer_accept',
        entityType: 'employee_school_transfers',
        entityId: transferId,
        after: { employeeId: empId, documents: docsCopied, left, docsLeft },
      });
      return { ...this.view(await this.find(c, transferId), tenant.schoolId), left, docsLeft };
    });
  }

  /** The target rejects, or the source cancels, a waiting transfer. */
  async close(
    ctx: RequestContext,
    transferId: string,
    how: 'rejected' | 'cancelled',
    reason: string,
  ) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const t = await this.find(c, transferId, true);
      if (t.status !== 'requested')
        throw new DomainError('conflict', `This transfer is ${t.status}`, { status: 409 });
      if (how === 'rejected' && t.to_school_id !== tenant.schoolId)
        throw new DomainError('forbidden', 'Only the receiving school can turn it down', {
          status: 403,
        });
      if (how === 'cancelled' && t.from_school_id !== tenant.schoolId)
        throw new DomainError('forbidden', 'Only the sending school can cancel it', {
          status: 403,
        });
      await c.query(
        `UPDATE employee_school_transfers SET status = $2, decided_by = app.current_user_id(), decided_by_name = $3,
                decided_at = now(), decision_note = $4 WHERE id = $1`,
        [transferId, how, await this.userName(c), reason],
      );
      await this.audit.stage(ctx, c, {
        action: `people.employee.transfer_${how === 'rejected' ? 'reject' : 'cancel'}`,
        entityType: 'employee_school_transfers',
        entityId: transferId,
        after: { reason },
      });
      return this.view(await this.find(c, transferId), tenant.schoolId);
    });
  }
}
