import { Injectable } from '@nestjs/common';
import {
  EMPLOYEE_FIELDS,
  EMPLOYEE_QUICK_KEYS,
  EMPLOYEE_SECTIONS,
  EmployeeWriteError,
  employeeCompleteness,
  loadEmployeeLists,
  optionsOf,
  nextEmployeeCode,
  readEmployeeProfile,
  validateEmployeeChanges,
  writeEmployeeProfile,
  type PoolClient,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { FilesService } from '../files/files.service';
import { ReportsService } from '../reports/reports.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  EMPLOYEE_ROW_SCHEMAS,
  type EmployeeOnboardDto,
  type EmployeeProfileDto,
  type EmployeeRowKind,
} from './people.dto';
import { PEOPLE } from './people.permissions';

type Row = Record<string, unknown>;

/** Where the school edits a drop-down (shown under the field). */
function listPath(list: string): string {
  if (list === 'Department' || list === 'Designation' || list === 'EmployeeType')
    return `List: People → Staff setup → ${list === 'EmployeeType' ? 'Employee types' : `${list}s`}`;
  if (list === 'City' || list === 'State' || list === 'Country')
    return `List: System setup → ${list === 'City' ? 'Cities' : list === 'Country' ? 'Countries' : 'States'}`;
  if (list === 'Bank') return 'List: Fees setup → Banks';
  if (list === 'YesNo') return '';
  return `List: System setup → Profile lists (${list})`;
}

/** The row tables: their table, columns (API key → column) and order. */
const ROWS: Record<
  EmployeeRowKind,
  { table: string; cols: Record<string, string>; order: string }
> = {
  education: {
    table: 'employee_education',
    cols: {
      qualification: 'qualification',
      specialisation: 'specialisation',
      institution: 'institution',
      passingYear: 'passing_year',
      score: 'score',
      mode: 'mode',
    },
    order: 'passing_year DESC NULLS LAST, id',
  },
  languages: {
    table: 'employee_languages',
    cols: {
      language: 'language',
      canRead: 'can_read',
      canWrite: 'can_write',
      canSpeak: 'can_speak',
    },
    order: 'language',
  },
  experience: {
    table: 'employee_experience',
    cols: {
      organisation: 'organisation',
      designation: 'designation',
      fromOn: 'from_on',
      toOn: 'to_on',
      reason: 'reason',
    },
    order: 'from_on DESC NULLS LAST, id',
  },
  transfers: {
    table: 'employee_transfers',
    cols: {
      onDate: 'on_date',
      fromPlace: 'from_place',
      toPlace: 'to_place',
      orderNo: 'order_no',
      remarks: 'remarks',
    },
    order: 'on_date DESC, id DESC',
  },
  remarks: {
    table: 'employee_remarks',
    cols: { onDate: 'on_date', remark: 'remark' },
    order: 'on_date DESC, id DESC',
  },
};

/**
 * The employee master (docs/design/30-employee-master.md): the field catalogue with the school's lists,
 * an employee's full profile (masked IDs unless the viewer may see them), saving it, quick onboarding
 * (with the next code and an optional staff login), and the rows: education, languages, experience,
 * transfers and remarks.
 */
@Injectable()
export class EmployeeProfileService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly reports: ReportsService,
  ) {}

  /** The employee profile printout (A4 PDF on the letterhead), as an export the screen waits for. */
  async requestPrint(ctx: RequestContext, id: string) {
    const code = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ code: string }>(
        `SELECT employee_code AS code FROM employees WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Employee not found', { status: 404 });
      return r.rows[0].code;
    });
    return this.reports.create(
      ctx,
      {
        dataset: 'employee_profile',
        format: 'pdf',
        // the worker re-checks the requester's permission before printing full ID numbers
        params: { employeeId: id },
        title: `Employee profile ${code}`,
      },
      'people.employee.profile_print',
    );
  }

  async catalogue(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      // a school opening the master the first time gets its staff setup lists
      await c.query(
        `SELECT app.staff_masters_seed(app.current_school_id()), app.staff_profile_lists_seed(app.current_school_id()), app.employee_document_types_seed(app.current_school_id())`,
      );
      const lists = await loadEmployeeLists(c);
      const geo = await c.query<{
        kind: string;
        code: string;
        name: string;
        parent: string | null;
      }>(
        `SELECT 'country' AS kind, code, name, NULL AS parent FROM countries WHERE status = 'active'
         UNION ALL
         SELECT 'state', s.code, s.name, co.name FROM states s LEFT JOIN countries co ON co.id = s.country_id WHERE s.status = 'active'
         UNION ALL
         SELECT 'city', COALESCE(ci.pincode, ''), ci.name, st.name FROM cities ci LEFT JOIN states st ON st.id = ci.state_id WHERE ci.status = 'active'
         ORDER BY 1, 3`,
      );
      // approvers are picked from the active staff ("NAME (CODE)")
      const staff = await c.query<{ label: string }>(
        `SELECT display_name || ' (' || employee_code || ')' AS label FROM employees
          WHERE deleted_at IS NULL AND status = 'active' ORDER BY display_name LIMIT 3000`,
      );
      return {
        sections: EMPLOYEE_SECTIONS,
        // the shape of the student catalogue, so the same field boxes serve both
        fields: EMPLOYEE_FIELDS.map((f) => ({
          key: f.key,
          section: f.section,
          label: f.label,
          type: f.type,
          required: f.required ?? false,
          list: f.list ?? null,
          options:
            f.type === 'employee'
              ? staff.rows.map((x) => x.label)
              : f.list
                ? optionsOf(f as never, lists)
                : null,
          upper: f.upper ?? false,
          help: f.help ?? (f.list ? listPath(f.list) : null),
          when: f.when ?? null,
          sensitive: f.sensitive ?? false,
          readOnly: f.store.t === 'auto',
          excelColumn: '',
        })),
        quickAdd: EMPLOYEE_QUICK_KEYS,
        geography: {
          countries: geo.rows
            .filter((g) => g.kind === 'country')
            .map((g) => ({ code: g.code, name: g.name })),
          states: geo.rows
            .filter((g) => g.kind === 'state')
            .map((g) => ({ code: g.code, name: g.name, country: g.parent })),
          cities: geo.rows
            .filter((g) => g.kind === 'city')
            .map((g) => ({ name: g.name, state: g.parent, pincode: g.code || null })),
        },
        canSeeSensitive: this.full(ctx),
        lists,
        // teaching subjects come from Academics → Subjects
        subjects: (
          await c.query<{ id: string; name: string; code: string }>(
            `SELECT id::text, name, code FROM subjects WHERE deleted_at IS NULL AND status = 'active' ORDER BY display_order, name`,
          )
        ).rows,
        nextCode: await nextEmployeeCode(c),
      };
    });
  }

  private full(ctx: RequestContext) {
    return Boolean(ctx.permissions?.has(PEOPLE.sensitiveView));
  }

  private async view(c: PoolClient, ctx: RequestContext, id: string) {
    const p = await readEmployeeProfile(c, id, this.full(ctx));
    if (!p) throw new DomainError('not-found', 'Employee not found', { status: 404 });
    const meta = await c.query<{
      status: string;
      user_id: string | null;
      photo_file_id: string | null;
      display_name: string;
      employee_type: string;
    }>(
      `SELECT status::text, user_id::text, photo_file_id::text, display_name, employee_type::text FROM employees WHERE id = $1`,
      [id],
    );
    const rows: Record<string, Row[]> = {};
    for (const [kind, def] of Object.entries(ROWS)) {
      const sel = Object.entries(def.cols)
        .map(
          ([k, col]) =>
            `${col}${col.endsWith('_on') || col === 'on_date' ? '::text' : ''} AS "${k}"`,
        )
        .join(', ');
      rows[kind] = (
        await c.query<Row>(
          // eslint-disable-next-line no-restricted-syntax -- table and columns from the ROWS constant; values are bound
          `SELECT id::text, ${sel}${kind === 'remarks' ? ', source, (SELECT display_name FROM users WHERE id = created_by) AS "by"' : ''}
             FROM ${def.table} WHERE employee_id = $1 ORDER BY ${def.order}`,
          [id],
        )
      ).rows;
    }
    const done = employeeCompleteness(p.values);
    return {
      id,
      name: meta.rows[0]!.display_name,
      status: meta.rows[0]!.status,
      staffGroup: meta.rows[0]!.employee_type,
      hasLogin: Boolean(meta.rows[0]!.user_id),
      photoFileId: meta.rows[0]!.photo_file_id,
      values: p.values,
      approvers: p.approvers,
      // the sensitive values shown masked (the form keeps them unless retyped)
      masked: this.full(ctx)
        ? []
        : EMPLOYEE_FIELDS.filter((f) => f.sensitive && p.values[f.key] !== null).map((f) => f.key),
      completeness: done.percent,
      missing: done.missing,
      sensitiveShown: this.full(ctx),
      rows,
      subjects: (
        await c.query<{ id: string; name: string }>(
          `SELECT s.id::text, s.name FROM employee_subjects es JOIN subjects s ON s.id = es.subject_id
            WHERE es.employee_id = $1 ORDER BY s.display_order, s.name`,
          [id],
        )
      ).rows,
      documents: await this.documentsOf(c, id),
    };
  }

  async profile(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.view(c, ctx, id));
  }

  private errors(e: Record<string, string>): never {
    throw new DomainError('validation-failed', Object.values(e).slice(0, 6).join('; '), {
      status: 400,
      extra: { errors: Object.entries(e).map(([path, message]) => ({ path, message })) },
    });
  }

  async save(ctx: RequestContext, id: string, dto: EmployeeProfileDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const lists = await loadEmployeeLists(c);
      const { values, errors } = await validateEmployeeChanges(c, dto.changes, lists, id);
      if (Object.keys(errors).length) this.errors(errors);
      const before = await readEmployeeProfile(c, id, false);
      if (!before) throw new DomainError('not-found', 'Employee not found', { status: 404 });
      try {
        await writeEmployeeProfile(c, id, values);
      } catch (e) {
        if (e instanceof EmployeeWriteError) this.errors(e.errors);
        throw e;
      }
      // a leaving date makes the employee inactive (and a remark says so)
      if (values.left_on !== undefined) await this.leaving(c, id, values.left_on as string | null);
      await this.audit.stage(ctx, c, {
        action: 'people.employee.profile',
        entityType: 'employees',
        entityId: id,
        // the keys changed; values of sensitive fields never go to the audit
        after: { changed: Object.keys(values) },
      });
      return this.view(c, ctx, id);
    });
  }

  private async leaving(c: PoolClient, id: string, leftOn: string | null) {
    const r = await c.query<{ status: string }>(
      `UPDATE employees SET status = CASE WHEN $2::date IS NOT NULL AND $2::date <= CURRENT_DATE THEN 'inactive'::row_status
                                          WHEN $2::date IS NULL THEN 'active'::row_status ELSE status END
        WHERE id = $1 RETURNING status::text`,
      [id, leftOn],
    );
    await c.query(
      `INSERT INTO employee_remarks (school_id, employee_id, remark, source, created_by)
       VALUES (app.current_school_id(), $1, $2, 'system', app.current_user_id())`,
      [
        id,
        leftOn
          ? `Leaving date set to ${leftOn}; status ${r.rows[0]?.status ?? ''}`
          : 'Leaving date removed; status active',
      ],
    );
  }

  /** Quick onboarding: the minimum fields (code filled with the next one), and a staff login if asked. */
  async onboard(ctx: RequestContext, dto: EmployeeOnboardDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `SELECT app.staff_masters_seed(app.current_school_id()), app.staff_profile_lists_seed(app.current_school_id()), app.employee_document_types_seed(app.current_school_id())`,
      );
      const lists = await loadEmployeeLists(c);
      const raw: Record<string, unknown> = { ...dto.values };
      if (!raw.employee_code) raw.employee_code = await nextEmployeeCode(c);
      const { values, errors } = await validateEmployeeChanges(c, raw, lists, null);
      for (const k of [
        'first_name',
        'gender',
        'mobile',
        'staff_type',
        'department',
        'designation',
        'joined_on',
      ])
        if (!values[k] && !errors[k])
          errors[k] = `${EMPLOYEE_FIELDS.find((f) => f.key === k)!.label}: an answer is needed`;
      if (Object.keys(errors).length) this.errors(errors);
      let id: string;
      try {
        id = await writeEmployeeProfile(c, null, values);
      } catch (e) {
        if (e instanceof EmployeeWriteError) this.errors(e.errors);
        throw e;
      }
      // the posting of the year, so the timetable and the department lists know the person
      await c.query(
        `INSERT INTO postings (school_id, employee_id, academic_year_id, department, designation, valid_from, created_by)
         SELECT app.current_school_id(), $1, y.id, $2, $3, COALESCE($4::date, CURRENT_DATE), app.current_user_id()
           FROM academic_years y WHERE y.status = 'active' ORDER BY y.start_date DESC LIMIT 1
         ON CONFLICT (employee_id, academic_year_id) DO NOTHING`,
        [id, values.department, values.designation, values.joined_on],
      );
      await c.query(
        `INSERT INTO employee_remarks (school_id, employee_id, remark, source, created_by)
         VALUES (app.current_school_id(), $1, 'Onboarded', 'system', app.current_user_id())`,
        [id],
      );
      let login: { made: boolean; reason?: string } = { made: false };
      if (dto.createLogin) {
        // a savepoint: a login that cannot be made never undoes the onboarding
        await c.query('SAVEPOINT login');
        try {
          await c.query(`SELECT app.employee_create_login($1)`, [id]);
          await c.query('RELEASE SAVEPOINT login');
          login = { made: true };
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT login');
          const msg = e instanceof Error ? e.message : '';
          login = {
            made: false,
            reason: msg.includes('employee.no_contact')
              ? 'no mobile or email to sign in with'
              : 'the login could not be made',
          };
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'people.employee.onboard',
        entityType: 'employees',
        entityId: id,
        after: { code: values.employee_code, login: login.made },
      });
      return { id, code: values.employee_code, login };
    });
  }

  /** A staff login for an employee who has none. */
  async createLogin(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      try {
        await c.query(`SELECT app.employee_create_login($1)`, [id]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('employee.no_contact'))
          throw new DomainError('employee.no_contact', 'Add a mobile or an email first', {
            status: 409,
          });
        if (msg.includes('employee.not_found'))
          throw new DomainError('not-found', 'Employee not found', { status: 404 });
        throw e;
      }
      await this.audit.stage(ctx, c, {
        action: 'people.employee.login',
        entityType: 'employees',
        entityId: id,
      });
      return this.view(c, ctx, id);
    });
  }

  // ---- teaching subjects and documents ----
  /** The document types with what is on file for one employee: required ones first. */
  private async documentsOf(c: PoolClient, id: string) {
    const types = await c.query<{
      id: string;
      code: string;
      name: string;
      has_expiry: boolean;
      required: boolean;
      valid: number;
    }>(
      `SELECT t.id::text, t.code, t.name, t.has_expiry, d.required, d.valid
         FROM app.employee_documents_due($1) d JOIN employee_document_types t ON t.id = d.type_id
        ORDER BY d.required DESC, t.sort_order, t.name`,
      [id],
    );
    const files = await c.query<{
      id: string;
      type_id: string;
      file_id: string;
      file_name: string | null;
      content_type: string;
      number: string | null;
      issued_on: string | null;
      expires_on: string | null;
      remarks: string | null;
      verified_at: Date | null;
      verified_by: string | null;
      uploaded_at: Date;
    }>(
      `SELECT d.id::text, d.type_id::text, d.file_id::text, f.original_name AS file_name, f.content_type,
              d.number, d.issued_on::text, d.expires_on::text, d.remarks, d.verified_at,
              (SELECT display_name FROM users WHERE id = d.verified_by) AS verified_by, d.created_at AS uploaded_at
         FROM employee_documents d JOIN files f ON f.id = d.file_id
        WHERE d.employee_id = $1 AND d.deleted_at IS NULL ORDER BY d.created_at DESC`,
      [id],
    );
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const list = types.rows.map((t) => ({
      typeId: t.id,
      code: t.code,
      name: t.name,
      hasExpiry: t.has_expiry,
      required: t.required,
      done: t.valid > 0,
      files: files.rows
        .filter((f) => f.type_id === t.id)
        .map((f) => ({
          id: f.id,
          fileId: f.file_id,
          fileName: f.file_name,
          contentType: f.content_type,
          number: f.number,
          issuedOn: f.issued_on,
          expiresOn: f.expires_on,
          expired: Boolean(f.expires_on && f.expires_on < today),
          remarks: f.remarks,
          verifiedAt: f.verified_at?.toISOString() ?? null,
          verifiedBy: f.verified_by,
          uploadedAt: f.uploaded_at.toISOString(),
        })),
    }));
    const required = list.filter((x) => x.required);
    return {
      types: list,
      required: required.length,
      missing: required.filter((x) => !x.done).length,
      unverified: files.rows.filter((f) => !f.verified_at).length,
    };
  }

  /** Sets the teaching subjects (from Academics → Subjects). */
  async setSubjects(ctx: RequestContext, id: string, subjectIds: string[]) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ok = await c.query(`SELECT 1 FROM employees WHERE id = $1 AND deleted_at IS NULL`, [
        id,
      ]);
      if (!ok.rowCount) throw new DomainError('not-found', 'Employee not found', { status: 404 });
      const known = await c.query<{ id: string }>(
        `SELECT id::text FROM subjects WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
        [subjectIds],
      );
      if (known.rowCount !== new Set(subjectIds).size)
        throw new DomainError('validation-failed', 'Unknown subject', { status: 400 });
      await c.query(`DELETE FROM employee_subjects WHERE employee_id = $1`, [id]);
      await c.query(
        `INSERT INTO employee_subjects (school_id, employee_id, subject_id, created_by)
         SELECT app.current_school_id(), $1, unnest($2::bigint[]), app.current_user_id() ON CONFLICT DO NOTHING`,
        [id, subjectIds],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.employee.subjects',
        entityType: 'employees',
        entityId: id,
        after: { subjectIds },
      });
      return this.view(c, ctx, id);
    });
  }

  /** Attaches an uploaded file (PDF or image) as a document of a type. */
  async addDocument(
    ctx: RequestContext,
    id: string,
    dto: {
      typeId: string;
      fileId: string;
      number?: string;
      issuedOn?: string;
      expiresOn?: string;
      remarks?: string;
    },
  ) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ok = await c.query(`SELECT 1 FROM employees WHERE id = $1 AND deleted_at IS NULL`, [
        id,
      ]);
      if (!ok.rowCount) throw new DomainError('not-found', 'Employee not found', { status: 404 });
      const t = await c.query<{ has_expiry: boolean }>(
        `SELECT has_expiry FROM employee_document_types WHERE id = $1 AND status = 'active'`,
        [dto.typeId],
      );
      if (!t.rows[0])
        throw new DomainError('validation-failed', 'Unknown document type', { status: 400 });
      if (t.rows[0].has_expiry && !dto.expiresOn)
        throw new DomainError('validation-failed', 'This document needs its valid-till date', {
          status: 400,
        });
      const f = await c.query<{ content_type: string; status: string }>(
        `SELECT content_type, status FROM files WHERE id = $1 AND deleted_at IS NULL`,
        [dto.fileId],
      );
      if (!f.rows[0] || !/^(application\/pdf|image\/(png|jpeg|webp))$/.test(f.rows[0].content_type))
        throw new DomainError('validation-failed', 'Attach a PDF or an image', { status: 400 });
      // the file belongs to the employee from now on
      await c.query(
        `UPDATE files SET owner_entity_type = 'employee', owner_entity_id = $2::text, classification = 'personal' WHERE id = $1`,
        [dto.fileId, id],
      );
      const r = await c.query<{ id: string }>(
        `INSERT INTO employee_documents (school_id, employee_id, type_id, file_id, number, issued_on, expires_on, remarks, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, app.current_user_id()) RETURNING id::text`,
        [
          id,
          dto.typeId,
          dto.fileId,
          dto.number ?? null,
          dto.issuedOn ?? null,
          dto.expiresOn ?? null,
          dto.remarks ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.employee.document.add',
        entityType: 'employees',
        entityId: id,
        after: { documentId: r.rows[0]!.id, typeId: dto.typeId },
      });
      return this.view(c, ctx, id);
    });
  }

  /** HR checks a document against the original (or takes the check back). */
  async verifyDocument(ctx: RequestContext, id: string, docId: string, verified: boolean) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE employee_documents SET verified_at = CASE WHEN $3 THEN now() END, verified_by = CASE WHEN $3 THEN app.current_user_id() END
          WHERE id = $1 AND employee_id = $2 AND deleted_at IS NULL`,
        [docId, id, verified],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Document not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: verified ? 'people.employee.document.verify' : 'people.employee.document.unverify',
        entityType: 'employees',
        entityId: id,
        after: { documentId: docId },
      });
      return this.view(c, ctx, id);
    });
  }

  async removeDocument(ctx: RequestContext, id: string, docId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE employee_documents SET deleted_at = now() WHERE id = $1 AND employee_id = $2 AND deleted_at IS NULL`,
        [docId, id],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Document not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'people.employee.document.remove',
        entityType: 'employees',
        entityId: id,
        after: { documentId: docId },
      });
      return this.view(c, ctx, id);
    });
  }

  /** A short-lived link to one document's file (only through its employee). */
  async documentFile(ctx: RequestContext, id: string, docId: string) {
    const fileId = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ file_id: string }>(
        `SELECT file_id::text FROM employee_documents WHERE id = $1 AND employee_id = $2 AND deleted_at IS NULL`,
        [docId, id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Document not found', { status: 404 });
      return r.rows[0].file_id;
    });
    return this.files.downloadUrl(ctx, fileId);
  }

  // ---- rows ----
  private parse(kind: EmployeeRowKind, body: unknown) {
    const r = EMPLOYEE_ROW_SCHEMAS[kind].safeParse(body);
    if (!r.success)
      throw new DomainError(
        'validation-failed',
        r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        {
          status: 400,
        },
      );
    return r.data as Record<string, unknown>;
  }

  async addRow(ctx: RequestContext, id: string, kind: EmployeeRowKind, body: unknown) {
    const data = this.parse(kind, body);
    const def = ROWS[kind];
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ok = await c.query(`SELECT 1 FROM employees WHERE id = $1 AND deleted_at IS NULL`, [
        id,
      ]);
      if (!ok.rowCount) throw new DomainError('not-found', 'Employee not found', { status: 404 });
      const keys = Object.keys(def.cols).filter((k) => data[k] !== undefined);
      const params: unknown[] = [id, ...keys.map((k) => data[k])];
      try {
        await c.query(
          // eslint-disable-next-line no-restricted-syntax -- table and columns from the ROWS constant; values are bound
          `INSERT INTO ${def.table} (school_id, employee_id, created_by${keys.map((k) => `, ${def.cols[k]}`).join('')})
           VALUES (app.current_school_id(), $1, app.current_user_id()${keys.map((_, i) => `, $${i + 2}`).join('')})`,
          params,
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw new DomainError('employee.row_exists', 'This language is already on the list', {
            status: 409,
          });
        throw e;
      }
      await this.audit.stage(ctx, c, {
        action: `people.employee.${kind}.add`,
        entityType: 'employees',
        entityId: id,
        after: data,
      });
      return this.view(c, ctx, id);
    });
  }

  async updateRow(
    ctx: RequestContext,
    id: string,
    kind: EmployeeRowKind,
    rowId: string,
    body: unknown,
  ) {
    const data = this.parse(kind, body);
    const def = ROWS[kind];
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const keys = Object.keys(def.cols);
      const params: unknown[] = [rowId, id, ...keys.map((k) => data[k] ?? null)];
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- table and columns from the ROWS constant; values are bound
        `UPDATE ${def.table} SET ${keys.map((k, i) => `${def.cols[k]} = $${i + 3}`).join(', ')}
          WHERE id = $1 AND employee_id = $2${kind === 'remarks' ? ` AND source = 'office'` : ''}`,
        params,
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Row not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: `people.employee.${kind}.change`,
        entityType: 'employees',
        entityId: id,
        after: data,
      });
      return this.view(c, ctx, id);
    });
  }

  async removeRow(ctx: RequestContext, id: string, kind: EmployeeRowKind, rowId: string) {
    const def = ROWS[kind];
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- the table from the ROWS constant; values are bound
        `DELETE FROM ${def.table} WHERE id = $1 AND employee_id = $2${kind === 'remarks' ? ` AND source = 'office'` : ''}`,
        [rowId, id],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Row not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: `people.employee.${kind}.remove`,
        entityType: 'employees',
        entityId: id,
        after: { rowId },
      });
      return this.view(c, ctx, id);
    });
  }
}
