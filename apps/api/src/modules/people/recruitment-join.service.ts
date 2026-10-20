import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CANDIDATE_DOCUMENTS,
  CANDIDATE_FIELDS,
  decryptField,
  insertEmployeeRow,
  loadEmployeeLists,
  nextEmployeeCode,
  type CandidateRowKind,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { EmployeeProfileService } from './employee-profile.service';
import { PEOPLE } from './people.permissions';
import type { JoinDto } from './recruitment-join.dto';

interface Snapshot {
  values: Record<string, unknown>;
  rows: Partial<Record<CandidateRowKind, Array<Record<string, string | null>>>>;
  activities: string[];
  files: Array<{ id: string; kind: string; fileId: string; contentType: string }>;
}
interface JoinRow {
  id: string;
  number: string;
  status: string;
  vacancy_id: string;
  title: string;
  designation: string | null;
  department: string | null;
  employee_type: string | null;
  snapshot: Snapshot;
  snapshot_secure: Record<string, string>;
  employee_id: string | null;
}

/** The employee document type a candidate's document becomes, when the school has that type. */
const SUGGEST: Record<string, string> = {
  photo: 'photo',
  address_proof: 'address',
  resume: 'resume',
};
/** What the employee master has no place for: it stays on the application. */
const STAYS = [
  'Children',
  'References',
  'Education and work of father or spouse',
  'Present pay, notice and reason for leaving',
  'Skills, interests and travel',
  'Father’s and mother’s photos and ID proofs (unless given a document type)',
];

/**
 * Recruitment, part 4 (docs/design/34-recruitment.md): a selected candidate becomes an employee. The
 * employee master's own onboarding makes the record (its checks, the posting of the year, the remark, a
 * staff login when asked) from the answers the candidate gave in the master's fields and the employment
 * the office sets; the qualifications, experience and training become the employee's rows; the documents
 * the office picks become employee documents (the photo also the employee's photo). A candidate whose
 * mobile, email, Aadhaar or PAN is already an active employee's is held back until the office confirms it
 * is a different person or a rejoining.
 */
@Injectable()
export class RecruitmentJoinService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly employees: EmployeeProfileService,
  ) {}

  private async load(c: PoolClient, id: string): Promise<JoinRow> {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Application not found', { status: 404 });
    const r = await c.query<JoinRow>(
      `SELECT a.id::text, a.number, a.status, a.vacancy_id::text, v.title, v.designation, v.department, v.employee_type,
              a.snapshot, a.snapshot_secure, a.employee_id::text
         FROM job_applications a JOIN vacancies v ON v.id = a.vacancy_id WHERE a.id = $1`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Application not found', { status: 404 });
    return r.rows[0];
  }

  private plainSecure(a: JoinRow): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(a.snapshot_secure ?? {})) {
      const p = v ? decryptField(v) : null;
      if (p) out[k] = p;
    }
    return out;
  }

  /** Active employees with the same mobile, email, Aadhaar or PAN (IDs are compared decrypted). */
  private async matches(c: PoolClient, a: JoinRow) {
    const v = a.snapshot.values;
    const sec = this.plainSecure(a);
    const r = await c.query<{
      id: string;
      code: string;
      name: string;
      mobile: string | null;
      email: string | null;
      secure: Record<string, string>;
    }>(
      `SELECT id::text, employee_code AS code, display_name AS name, mobile, email::text, secure
         FROM employees WHERE deleted_at IS NULL AND status = 'active'
          AND ((mobile IS NOT NULL AND mobile = $1) OR (email IS NOT NULL AND lower(email::text) = lower($2))
               OR ($3 AND secure ?| ARRAY['aadhaar', 'pan']))`,
      [String(v.mobile ?? ''), String(v.email ?? ''), Boolean(sec.aadhaar || sec.pan)],
    );
    const out: Array<{ id: string; code: string; name: string; why: string[] }> = [];
    for (const e of r.rows) {
      const why: string[] = [];
      if (v.mobile && e.mobile === v.mobile) why.push('mobile');
      if (v.email && e.email && e.email.toLowerCase() === String(v.email).toLowerCase())
        why.push('email');
      for (const k of ['aadhaar', 'pan'] as const)
        if (sec[k] && e.secure?.[k] && decryptField(e.secure[k]) === sec[k])
          why.push(k === 'pan' ? 'PAN' : 'Aadhaar');
      if (why.length) out.push({ id: e.id, code: e.code, name: e.name, why });
    }
    return out;
  }

  /** What the move will make, for the form: the defaults, the lists, the documents, the matches. */
  async preview(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.load(c, id);
      await c.query(
        `SELECT app.staff_masters_seed(app.current_school_id()), app.employee_document_types_seed(app.current_school_id())`,
      );
      const lists = await loadEmployeeLists(c);
      const types = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM employee_document_types WHERE status = 'active' ORDER BY sort_order, name`,
      );
      const byCode = new Map(types.rows.map((t) => [t.code, t.id]));
      const label = new Map(CANDIDATE_DOCUMENTS.map((d) => [d.kind, d.label]));
      const masterFields = CANDIDATE_FIELDS.filter((f) => f.master);
      const given = masterFields.filter((f) =>
        f.sensitive
          ? Boolean(a.snapshot_secure?.[f.key])
          : a.snapshot.values[f.key] !== null &&
            a.snapshot.values[f.key] !== undefined &&
            a.snapshot.values[f.key] !== '',
      );
      return {
        status: a.status,
        employeeId: a.employee_id,
        nextCode: await nextEmployeeCode(c),
        defaults: {
          department: a.department,
          designation: a.designation,
          employeeType: a.employee_type,
          post: a.title,
        },
        lists: {
          departments: lists.Department ?? [],
          designations: lists.Designation ?? [],
          employeeTypes: lists.EmployeeType ?? [],
          natures: lists.NatureOfAppointment ?? [],
        },
        copies: {
          fields: given.map((f) => f.label),
          education: (a.snapshot.rows.education ?? []).length,
          experience: (a.snapshot.rows.experience ?? []).length,
          training: (a.snapshot.rows.training ?? []).length,
        },
        stays: STAYS,
        documents: a.snapshot.files.map((f) => ({
          id: f.id,
          kind: f.kind,
          label: label.get(f.kind) ?? f.kind,
          fileId: f.fileId,
          suggestedTypeId: SUGGEST[f.kind] ? (byCode.get(SUGGEST[f.kind]!) ?? null) : null,
        })),
        documentTypes: types.rows.map((t) => ({ id: t.id, name: t.name })),
        matches: await this.matches(c, a),
      };
    });
  }

  async join(ctx: RequestContext, id: string, dto: JoinDto) {
    if (!(ctx.permissions?.has(PEOPLE.employeeCreate) ?? false))
      throw new DomainError(
        'permission-denied',
        'Making an employee needs the right to add employees',
        {
          status: 403,
        },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.load(c, id);
      if (a.employee_id || a.status === 'joined')
        throw new DomainError('recruitment.joined', 'This candidate is already an employee', {
          status: 409,
        });
      if (a.status !== 'selected')
        throw new DomainError(
          'recruitment.not_selected',
          'Only a selected candidate becomes an employee',
          {
            status: 409,
          },
        );
      const found = await this.matches(c, a);
      if (found.length && !dto.confirmMatch)
        throw new DomainError(
          'recruitment.employee_match',
          `Already an employee with the same ${[...new Set(found.flatMap((m) => m.why))].join(', ')}: ${found
            .map((m) => `${m.name} (${m.code})`)
            .join(', ')}. Confirm it is a different person or a rejoining.`,
          { status: 409, extra: { matches: found } },
        );
      // the master's fields as the candidate gave them, the IDs decrypted for the master's own checks
      const values: Record<string, string | number | null> = {};
      const sec = this.plainSecure(a);
      for (const f of CANDIDATE_FIELDS.filter((x) => x.master)) {
        const raw = f.sensitive ? sec[f.key] : a.snapshot.values[f.key];
        if (raw === null || raw === undefined || raw === '') continue;
        values[f.key] = typeof raw === 'number' ? raw : String(raw);
      }
      const designation = dto.designation ?? a.designation ?? null;
      Object.assign(values, {
        employee_code: dto.employeeCode ?? null,
        joined_on: dto.joinedOn,
        department: dto.department ?? a.department ?? null,
        designation,
        designation_at_joining: designation,
        staff_type: dto.employeeType ?? a.employee_type ?? null,
        ...(dto.natureOfAppointment ? { nature_of_appointment: dto.natureOfAppointment } : {}),
      });
      const made = await this.employees.onboardWith(c, ctx, {
        values,
        createLogin: dto.createLogin,
      });
      const employeeId = made.id;
      // the rows: qualifications, experience, training, as the employee's own lists keep them
      const rows = a.snapshot.rows;
      let n = 0;
      for (const r of rows.education ?? []) {
        const inst = [r.institution, r.university].filter(Boolean).join(', ');
        const score = [r.score, r.division].filter(Boolean).join(' ');
        await insertEmployeeRow(c, employeeId, 'education', {
          qualification: r.qualification ?? '',
          specialisation: r.specialisation ?? null,
          institution: inst ? inst.slice(0, 200) : null,
          passingYear: r.passingYear ? Number(r.passingYear) : null,
          score: score ? score.slice(0, 20) : null,
          mode: r.mode ?? null,
        });
        n++;
      }
      for (const r of rows.experience ?? []) {
        await insertEmployeeRow(c, employeeId, 'experience', {
          organisation: r.organisation ?? '',
          designation: r.designation ? r.designation.slice(0, 120) : null,
          fromOn: r.fromOn ?? null,
          toOn: r.toOn ?? null,
        });
        n++;
      }
      for (const r of rows.training ?? []) {
        await insertEmployeeRow(c, employeeId, 'training', {
          topic: r.topic ?? '',
          organisation: r.organisation ?? null,
          duration: r.duration ?? null,
          trainedOn: r.year ? `${r.year}-01-01` : null,
        });
        n++;
      }
      // the documents the office gave a type; the photo becomes the employee's photo
      const typeOk = new Set(
        (
          await c.query<{ id: string }>(
            `SELECT id::text FROM employee_document_types WHERE status = 'active'`,
          )
        ).rows.map((x) => x.id),
      );
      const fileOf = new Map(a.snapshot.files.map((f) => [f.id, f]));
      let docs = 0;
      for (const d of dto.documents ?? []) {
        const f = fileOf.get(d.id);
        if (!f || !d.typeId) continue;
        if (!typeOk.has(d.typeId))
          throw new DomainError('validation-failed', 'A document type named is not in the set-up', {
            status: 400,
          });
        await c.query(
          `INSERT INTO employee_documents (school_id, employee_id, type_id, file_id, remarks, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id())`,
          [employeeId, d.typeId, f.fileId, `From application ${a.number}`],
        );
        docs++;
      }
      const photo = a.snapshot.files.find((f) => f.kind === 'photo');
      if (photo)
        await c.query(
          `UPDATE employees SET photo_file_id = $2 WHERE id = $1 AND photo_file_id IS NULL`,
          [employeeId, photo.fileId],
        );
      await c.query(
        `INSERT INTO employee_remarks (school_id, employee_id, remark, source, created_by)
         VALUES (app.current_school_id(), $1, $2, 'system', app.current_user_id())`,
        [employeeId, `Joined from recruitment: application ${a.number} for ${a.title}`],
      );
      await c.query(
        `UPDATE job_applications SET status = 'joined', employee_id = $2, joined_at = now(), updated_at = now() WHERE id = $1`,
        [id, employeeId],
      );
      await c.query(
        `INSERT INTO job_application_events (school_id, application_id, what, note, by_name)
         VALUES (app.current_school_id(), $1, 'joined', $2, $3)`,
        [id, `Employee ${String(made.code)}`, ctx.user.displayName],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.join',
        entityType: 'job_applications',
        entityId: id,
        after: {
          employeeId,
          code: made.code,
          rows: n,
          documents: docs,
          matchConfirmed: found.length > 0,
        },
      });
      return { employeeId, code: made.code, login: made.login, rows: n, documents: docs };
    });
  }
}
