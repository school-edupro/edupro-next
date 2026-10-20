import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CANDIDATE_ACTIVITIES,
  CANDIDATE_DOCUMENTS,
  CANDIDATE_FIELDS,
  CANDIDATE_FIELD_BY_KEY,
  CANDIDATE_ROWS,
  CANDIDATE_SECTIONS,
  decryptField,
  encryptField,
  loadEmployeeLists,
  maskValue,
  normaliseValue,
  optionsOf,
  parseDate,
  validateEmployeeChanges,
  type CandidateRowKind,
} from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import type { RequestContext } from '../../common/http/request-context';
import { publicTenant } from '../admissions/public/otp.service';
import { FilesService } from '../files/files.service';
import type { Candidate } from './candidate-auth.service';
import { CandidateAuthService } from './candidate-auth.service';
import {
  checkCandidateRow,
  checkCandidateValues,
  CANDIDATE_AGE,
  todayIst,
} from './candidate-checks';
import { ApplicationPdfService } from './application-pdf.service';
import { istText } from './recruitment.service';
import type {
  CandidateApplyDto,
  CandidateFileDto,
  CandidateFileSlotDto,
  CandidateProfileDto,
} from './recruitment-public.dto';

type Values = Record<string, unknown>;
type Rows = Partial<Record<CandidateRowKind, Array<Record<string, string | null>>>>;
interface Profile {
  values: Values;
  rows: Rows;
  activities: string[];
}

const VACANCY_PUBLIC = `SELECT v.id::text, v.code, v.title, v.designation, v.department, v.subject, v.employee_type,
       v.posts, v.qualification, v.experience, v.pay_band, v.description, v.opens_at, v.closes_at,
       cp.name AS campus
  FROM vacancies v LEFT JOIN campuses cp ON cp.id = v.campus_id
 WHERE v.status = 'published' AND v.opens_at <= now() AND v.closes_at > now()`;
interface VacancyPublicRow {
  id: string;
  code: string;
  title: string;
  designation: string | null;
  department: string | null;
  subject: string | null;
  employee_type: string | null;
  posts: number;
  qualification: string | null;
  experience: string | null;
  pay_band: string | null;
  description: string | null;
  opens_at: Date;
  closes_at: Date;
  campus: string | null;
}
const vacancyOut = (v: VacancyPublicRow) => ({
  id: v.id,
  code: v.code,
  title: v.title,
  designation: v.designation,
  department: v.department,
  subject: v.subject,
  employeeType: v.employee_type,
  posts: v.posts,
  qualification: v.qualification,
  experience: v.experience,
  payBand: v.pay_band,
  description: v.description,
  opensAt: v.opens_at.toISOString(),
  closesAt: v.closes_at.toISOString(),
  campus: v.campus,
});

const IMAGE = /^image\/(png|jpeg|webp)$/;
const IMAGE_OR_PDF = /^(application\/pdf|image\/(png|jpeg|webp))$/;
const SINGLE = new Set(CANDIDATE_DOCUMENTS.filter((d) => !d.many).map((d) => d.kind));

/**
 * The public careers page (docs/design/34-recruitment.md, part 2): the open vacancies of a school, the
 * application form (the employee master's fields with its lists and checks, and the candidate's own), the
 * candidate's documents and photos, and applying with what is on file (kept as submitted).
 */
@Injectable()
export class RecruitmentPublicService {
  constructor(
    private readonly db: DbService,
    private readonly auth: CandidateAuthService,
    private readonly files: FilesService,
    private readonly pdf: ApplicationPdfService,
  ) {}

  // ---- what anyone sees ------------------------------------------------------------------------------

  async vacancies(schoolCode: string) {
    const schoolId = await this.auth.schoolId(schoolCode);
    return this.db.tenant(publicTenant(schoolId), async (c) => {
      const school = await c.query<{ name: string }>(
        `SELECT name FROM schools WHERE id = app.current_school_id()`,
      );
      const r = await c.query<VacancyPublicRow>(
        // eslint-disable-next-line no-restricted-syntax -- a fixed fragment
        `${VACANCY_PUBLIC} ORDER BY v.closes_at, v.title`,
      );
      return { school: school.rows[0]?.name ?? '', data: r.rows.map(vacancyOut) };
    });
  }

  async vacancy(schoolCode: string, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Vacancy not found', { status: 404 });
    const schoolId = await this.auth.schoolId(schoolCode);
    return this.db.tenant(publicTenant(schoolId), async (c) => {
      const r = await c.query<VacancyPublicRow>(`${VACANCY_PUBLIC} AND v.id = $1`, [id]);
      if (!r.rows[0])
        throw new DomainError('not-found', 'This vacancy is not open', { status: 404 });
      return vacancyOut(r.rows[0]);
    });
  }

  /** The form: sections, fields with the school's lists, row lists, documents, interests. */
  async form(schoolCode: string) {
    const schoolId = await this.auth.schoolId(schoolCode);
    return this.db.tenant(publicTenant(schoolId), async (c) => {
      const lists = await loadEmployeeLists(c);
      return {
        sections: CANDIDATE_SECTIONS,
        fields: CANDIDATE_FIELDS.map((f) => ({
          key: f.key,
          section: f.section,
          label: f.label,
          type: f.type,
          required: f.required ?? false,
          help: f.help ?? null,
          when: f.when ?? null,
          sensitive: f.sensitive ?? false,
          options: f.type === 'list' ? optionsOf(f, lists) : null,
        })),
        rows: CANDIDATE_ROWS,
        documents: CANDIDATE_DOCUMENTS,
        activities: CANDIDATE_ACTIVITIES,
        // the address picks country → state → city from the school's lists (a city's PIN fills itself)
        places: await this.places(c),
        age: CANDIDATE_AGE,
        today: todayIst(),
      };
    });
  }

  // ---- the candidate's own -----------------------------------------------------------------------------

  private profileOf(raw: unknown): Profile {
    const p = (raw ?? {}) as Partial<Profile>;
    return { values: p.values ?? {}, rows: p.rows ?? {}, activities: p.activities ?? [] };
  }

  /** What is still needed to apply (labels). */
  private missing(p: Profile, secure: Record<string, string>, files: Array<{ kind: string }>) {
    const out: string[] = [];
    for (const f of CANDIDATE_FIELDS) {
      if (!f.required) continue;
      const v = f.sensitive ? secure[f.key] : p.values[f.key];
      if (v === undefined || v === null || v === '') out.push(f.label);
    }
    if (!(p.rows.education ?? []).length) out.push('At least one qualification');
    for (const d of CANDIDATE_DOCUMENTS)
      if (d.required && !files.some((x) => x.kind === d.kind)) out.push(d.label);
    return out;
  }

  private async filesOf(c: PoolClient, candidateId: string) {
    return (
      await c.query<{ id: string; kind: string; file_id: string; content_type: string }>(
        `SELECT cf.id::text, cf.kind, cf.file_id::text, f.content_type
           FROM candidate_files cf JOIN files f ON f.id = cf.file_id
          WHERE cf.candidate_id = $1 AND f.deleted_at IS NULL ORDER BY cf.kind, cf.id`,
        [candidateId],
      )
    ).rows.map((x) => ({ id: x.id, kind: x.kind, fileId: x.file_id, contentType: x.content_type }));
  }

  async me(cand: Candidate) {
    return this.db.tenant(publicTenant(cand.schoolId), async (c) => {
      const row = await c.query<{ profile: unknown; secure: Record<string, string> }>(
        `SELECT profile, secure FROM candidates WHERE id = $1`,
        [cand.id],
      );
      const p = this.profileOf(row.rows[0]?.profile);
      const secure = row.rows[0]?.secure ?? {};
      const masked: Values = {};
      for (const f of CANDIDATE_FIELDS.filter((x) => x.sensitive)) {
        const plain = secure[f.key] ? decryptField(secure[f.key]!) : null;
        masked[f.key] = plain ? maskValue(plain, f.type) : null;
      }
      const files = await this.filesOf(c, cand.id);
      // each application with its post, and the next step the school has set (a date, a time, a venue)
      const apps = await c.query<{
        id: string;
        number: string;
        vacancy_id: string;
        title: string;
        code: string;
        status: string;
        submitted_at: Date;
        department: string | null;
        subject: string | null;
        employee_type: string | null;
        campus: string | null;
        open: boolean;
        next_stage: string | null;
        next_at: Date | null;
        next_venue: string | null;
      }>(
        `SELECT a.id::text, a.number, a.vacancy_id::text, v.title, v.code, a.status, a.submitted_at,
                v.department, v.subject, v.employee_type, cp.name AS campus,
                (v.status = 'published' AND v.opens_at <= now() AND v.closes_at > now()) AS open,
                st.name AS next_stage, r.scheduled_at AS next_at, NULLIF(btrim(r.venue), '') AS next_venue
           FROM job_applications a JOIN vacancies v ON v.id = a.vacancy_id
           LEFT JOIN campuses cp ON cp.id = v.campus_id
           LEFT JOIN application_stage_results r ON r.application_id = a.id AND r.stage_id = a.current_stage_id
                 AND r.scheduled_at IS NOT NULL AND r.result IS NULL AND a.status IN ('submitted', 'screening')
           LEFT JOIN recruitment_stages st ON st.id = r.stage_id
          WHERE a.candidate_id = $1 ORDER BY a.submitted_at DESC`,
        [cand.id],
      );
      const school = await c.query<{ code: string }>(
        `SELECT lower(code) AS code FROM schools WHERE id = app.current_school_id()`,
      );
      return {
        candidate: { id: cand.id, name: cand.name, mobile: cand.mobile, email: cand.email },
        // the school the sign-in is for: a careers page of another school asks to sign in there
        school: school.rows[0]!.code,
        values: { ...p.values, ...masked },
        rows: p.rows,
        activities: p.activities,
        files,
        missing: this.missing(p, secure, files),
        applications: apps.rows.map((a) => ({
          id: a.id,
          number: a.number,
          vacancyId: a.vacancy_id,
          title: a.title,
          code: a.code,
          status: a.status,
          submittedAt: a.submitted_at.toISOString(),
          department: a.department,
          subject: a.subject,
          employeeType: a.employee_type,
          campus: a.campus,
          open: a.open,
          next: a.next_stage
            ? {
                stage: a.next_stage,
                at: a.next_at!.toISOString(),
                venue: a.next_venue,
              }
            : null,
        })),
      };
    });
  }

  /**
   * One row of a list: each cell checked by its column's type and the candidate's rules; a cell refused
   * is left empty and reported (by `kind.i.column` for the form); a row without its key column is dropped.
   */
  private row(
    kind: CandidateRowKind,
    raw: Record<string, unknown>,
    i: number,
    dob: string | null,
    report: (key: string, text: string) => void,
  ) {
    const def = CANDIDATE_ROWS[kind];
    const out: Record<string, string | null> = {};
    let any = false;
    const year = Number(todayIst().slice(0, 4));
    for (const col of def.columns) {
      const v = raw[col.key];
      const s =
        typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, 300) : '';
      out[col.key] = null;
      if (!s) continue;
      any = true;
      const key = `${kind}.${String(i)}.${col.key}`;
      if (col.type === 'year' && !(/^\d{4}$/.test(s) && Number(s) >= 1940 && Number(s) <= year))
        report(key, `a 4-digit year from 1940 to ${String(year)}`);
      else if (col.type === 'date' && !parseDate(s)) report(key, 'a date');
      else if (col.type === 'list' && col.options && !col.options.includes(s))
        report(key, `one of ${col.options.join(', ')}`);
      else out[col.key] = col.type === 'date' ? parseDate(s) : s;
    }
    if (!any) return null;
    for (const [col, text] of Object.entries(checkCandidateRow(kind, out, dob))) {
      report(`${kind}.${String(i)}.${col}`, text);
      out[col] = null;
    }
    const missing = def.columns.find((col) => col.required && !out[col.key]);
    if (missing) {
      report(`${kind}.${String(i)}.${missing.key}`, 'needed; the entry is not kept without it');
      return null;
    }
    return out;
  }

  /** The school's lists of places, for the address (country → state → city, a city's PIN). */
  private async places(c: PoolClient) {
    const r = await c.query<{
      kind: string;
      name: string;
      parent: string | null;
      pin: string | null;
    }>(
      `SELECT 'country' AS kind, name, NULL AS parent, NULL AS pin FROM countries WHERE status = 'active'
       UNION ALL
       SELECT 'state', s.name, co.name, NULL FROM states s LEFT JOIN countries co ON co.id = s.country_id WHERE s.status = 'active'
       UNION ALL
       SELECT 'city', ci.name, st.name, NULLIF(ci.pincode, '') FROM cities ci LEFT JOIN states st ON st.id = ci.state_id WHERE ci.status = 'active'
       ORDER BY 1, 2`,
    );
    return {
      countries: r.rows.filter((x) => x.kind === 'country').map((x) => x.name),
      states: r.rows
        .filter((x) => x.kind === 'state')
        .map((x) => ({ name: x.name, country: x.parent })),
      cities: r.rows
        .filter((x) => x.kind === 'city')
        .map((x) => ({ name: x.name, state: x.parent, pin: x.pin })),
    };
  }

  /**
   * Saves the form as it stands (a draft may be incomplete; the careers form saves one step at a time):
   * each answer is checked as the employee master checks it (the master's own validation for its
   * fields), then by the candidate's own rules (age, names, Aadhaar check digit, places in their lists…);
   * Aadhaar and PAN are encrypted, the rows are checked column by column. Every answer accepted is saved;
   * the ones refused are left as they were and come back by field (`errors`, for the form) and as lines
   * (`refused`), so a long form is never lost over one answer.
   */
  async saveProfile(cand: Candidate, dto: CandidateProfileDto) {
    return this.db.tenant(publicTenant(cand.schoolId), async (c) => {
      const lists = await loadEmployeeLists(c);
      const errors: string[] = [];
      const byField: Record<string, string> = {};
      const refuse = (key: string, label: string, text: string) => {
        byField[key] = text;
        errors.push(`${label}: ${text}`);
      };
      const cur = await c.query<{ profile: unknown; secure: Record<string, string> }>(
        `SELECT profile, secure FROM candidates WHERE id = $1 FOR UPDATE`,
        [cand.id],
      );
      const p = this.profileOf(cur.rows[0]?.profile);
      const masterRaw: Values = {};
      const ownValues: Values = {};
      const secureNew: Record<string, string | null> = {};
      for (const [key, raw] of Object.entries(dto.values ?? {})) {
        const f = CANDIDATE_FIELD_BY_KEY.get(key);
        if (!f) {
          refuse(key, key, 'not a field of the application');
          continue;
        }
        // a masked ID sent back unchanged keeps the one on file
        if (f.sensitive && typeof raw === 'string' && /^X{2,}/i.test(raw.trim())) continue;
        if (f.master) masterRaw[key] = raw;
        else if (f.type === 'textarea') {
          const s = typeof raw === 'string' ? raw.trim() : '';
          if (s.length > 2000) refuse(key, f.label, 'at most 2000 characters');
          else ownValues[key] = s || null;
        } else {
          const n = normaliseValue(f as never, raw, lists);
          if (n.ok) ownValues[key] = n.value;
          else refuse(key, f.label, n.error);
        }
      }
      // the employee master's own checks for its fields (and its lists)
      const checked = await validateEmployeeChanges(c, masterRaw, lists, null);
      for (const [k, e] of Object.entries(checked.errors)) {
        const f = CANDIDATE_FIELD_BY_KEY.get(k);
        const label = f?.label ?? k;
        refuse(k, label, e.startsWith(label) ? e.slice(label.length).replace(/^[:\s]+/, '') : e);
      }
      const accepted: Values = { ...ownValues, ...checked.values };
      // the pay total is worked out from its parts
      const basic = Number(accepted.current_basic ?? p.values.current_basic ?? 0) || 0;
      const allow = Number(accepted.current_allowance ?? p.values.current_allowance ?? 0) || 0;
      if ('current_basic' in accepted || 'current_allowance' in accepted)
        accepted.current_total = basic || allow ? basic + allow : null;
      // the candidate's own rules, on the form as it will stand
      const all = { ...p.values, ...accepted } as Record<string, string | number | null>;
      const own = checkCandidateValues(Object.keys(accepted), all, await this.places(c));
      for (const [k, text] of Object.entries(own)) {
        refuse(k, CANDIDATE_FIELD_BY_KEY.get(k)?.label ?? k, text);
        delete accepted[k];
      }
      for (const [k, v] of Object.entries(accepted)) {
        const f = CANDIDATE_FIELD_BY_KEY.get(k);
        if (f?.sensitive) secureNew[k] = v === null || v === undefined ? null : String(v);
        else ownValues[k] = v;
      }
      for (const k of Object.keys(ownValues)) if (!(k in accepted)) delete ownValues[k];
      const dob = typeof all.dob === 'string' && !own.dob ? all.dob : null;
      const rows: Rows = {};
      for (const kind of Object.keys(CANDIDATE_ROWS) as CandidateRowKind[]) {
        const given = dto.rows?.[kind];
        if (given === undefined) continue;
        const def = CANDIDATE_ROWS[kind];
        const list = given
          .map((r, i) =>
            this.row(kind, r, i, dob, (key, text) => {
              const col = def.columns.find((x) => key.endsWith(`.${x.key}`));
              refuse(key, `${def.title} entry ${String(i + 1)}, ${col?.label ?? ''}`, text);
            }),
          )
          .filter((x): x is Record<string, string | null> => x !== null);
        if (list.length > def.max) refuse(kind, def.title, `at most ${String(def.max)}`);
        rows[kind] = list.slice(0, def.max);
      }
      const activities = dto.activities?.filter((a) =>
        (CANDIDATE_ACTIVITIES as readonly string[]).includes(a),
      );
      const secure = { ...(cur.rows[0]?.secure ?? {}) };
      for (const [k, v] of Object.entries(secureNew)) {
        if (v === null) delete secure[k];
        else secure[k] = encryptField(v);
      }
      const next: Profile = {
        values: { ...p.values, ...ownValues },
        rows: { ...p.rows, ...rows },
        activities: activities ?? p.activities,
      };
      const name =
        [next.values.first_name, next.values.last_name].filter(Boolean).join(' ') || null;
      await c.query(
        `UPDATE candidates SET profile = $2::jsonb, secure = $3::jsonb, name = COALESCE($4, name), updated_at = now() WHERE id = $1`,
        [cand.id, JSON.stringify(next), JSON.stringify(secure), name],
      );
      // the other way to sign in: the mobile or email given here, when nobody else signs in with it
      const mob = next.values.mobile;
      const mail = next.values.email;
      if (typeof mob === 'string' && !cand.mobile)
        await c.query(
          `UPDATE candidates SET mobile = $2 WHERE id = $1 AND mobile IS NULL
              AND NOT EXISTS (SELECT 1 FROM candidates x WHERE x.mobile = $2 AND x.id <> $1)`,
          [cand.id, mob],
        );
      if (typeof mail === 'string' && !cand.email)
        await c.query(
          `UPDATE candidates SET email = $2 WHERE id = $1 AND email IS NULL
              AND NOT EXISTS (SELECT 1 FROM candidates x WHERE x.email = $2 AND x.id <> $1)`,
          [cand.id, mail],
        );
      return { saved: true, refused: errors, errors: byField };
    });
  }

  /** The files service needs a request context; the candidate's is the school's public one. */
  private ctxFor(cand: Candidate): RequestContext {
    return {
      requestId: randomUUID(),
      tenant: publicTenant(cand.schoolId),
      user: {
        id: '0',
        sub: `candidate:${cand.id}`,
        displayName: cand.name ?? 'Candidate',
        memberships: [],
      },
    } as unknown as RequestContext;
  }

  /** An upload slot for one document or photo, owned by the candidate. */
  async fileSlot(cand: Candidate, dto: CandidateFileSlotDto) {
    const doc = CANDIDATE_DOCUMENTS.find((d) => d.kind === dto.kind);
    if (!doc) throw new DomainError('validation-failed', 'Unknown document', { status: 400 });
    if (!(doc.image ? IMAGE : IMAGE_OR_PDF).test(dto.contentType))
      throw new DomainError(
        'validation-failed',
        doc.image ? `${doc.label}: a photo (JPG, PNG or WebP)` : `${doc.label}: a PDF or a photo`,
        { status: 400 },
      );
    if (dto.sizeBytes > 5 * 1024 * 1024)
      throw new DomainError('validation-failed', `${doc.label}: at most 5 MB`, { status: 400 });
    return this.files.createUpload(this.ctxFor(cand), {
      fileName: dto.fileName,
      contentType: dto.contentType,
      sizeBytes: dto.sizeBytes,
      classification: 'personal',
      ownerEntityType: 'candidate',
      ownerEntityId: cand.id,
    });
  }

  /** The uploaded file becomes the document of that kind (a single one replaces the earlier). */
  async addFile(cand: Candidate, dto: CandidateFileDto) {
    if (!CANDIDATE_DOCUMENTS.some((d) => d.kind === dto.kind))
      throw new DomainError('validation-failed', 'Unknown document', { status: 400 });
    return this.db.tenant(publicTenant(cand.schoolId), async (c) => {
      const f = await c.query(
        `SELECT 1 FROM files WHERE id = $1 AND owner_entity_type = 'candidate' AND owner_entity_id = $2
            AND status = 'ready' AND deleted_at IS NULL`,
        [dto.fileId, cand.id],
      );
      if (!f.rowCount) throw new DomainError('not-found', 'Upload the file first', { status: 404 });
      if (SINGLE.has(dto.kind))
        await c.query(`DELETE FROM candidate_files WHERE candidate_id = $1 AND kind = $2`, [
          cand.id,
          dto.kind,
        ]);
      const r = await c.query<{ id: string }>(
        `INSERT INTO candidate_files (school_id, candidate_id, kind, file_id)
         VALUES (app.current_school_id(), $1, $2, $3) RETURNING id::text`,
        [cand.id, dto.kind, dto.fileId],
      );
      return { id: r.rows[0]!.id };
    });
  }

  async removeFile(cand: Candidate, id: string) {
    return this.db.tenant(publicTenant(cand.schoolId), async (c) => {
      const r = await c.query(`DELETE FROM candidate_files WHERE id = $1 AND candidate_id = $2`, [
        id,
        cand.id,
      ]);
      if (!r.rowCount) throw new DomainError('not-found', 'Document not found', { status: 404 });
      return { removed: true };
    });
  }

  /** One of my own files (a document of mine), as a signed address. */
  async fileUrl(cand: Candidate, fileId: string) {
    await this.db.tenant(publicTenant(cand.schoolId), async (c) => {
      const ok = await c.query(
        `SELECT 1 FROM files WHERE id = $1 AND owner_entity_type = 'candidate' AND owner_entity_id = $2 AND deleted_at IS NULL`,
        [fileId, cand.id],
      );
      if (!ok.rowCount) throw new DomainError('not-found', 'File not found', { status: 404 });
    });
    return this.files.downloadUrl(this.ctxFor(cand), fileId);
  }

  /**
   * Applies to an open vacancy with what is on file: everything required must be there; the application
   * keeps a copy of the answers, rows and files as submitted. An active employee with the same mobile or
   * email is noted for the office.
   */
  async apply(cand: Candidate, vacancyId: string, dto: CandidateApplyDto) {
    if (!dto.declaration)
      throw new DomainError('validation-failed', 'Tick the declaration to apply', { status: 400 });
    if (!/^\d{1,18}$/.test(vacancyId))
      throw new DomainError('not-found', 'Vacancy not found', { status: 404 });
    return this.db.tenant(publicTenant(cand.schoolId), async (c) => {
      const v = await c.query<VacancyPublicRow>(`${VACANCY_PUBLIC} AND v.id = $1`, [vacancyId]);
      if (!v.rows[0]) {
        // the window passed while the form was being filled: say when it closed
        const was = await c.query<{ closes_at: Date | null }>(
          `SELECT closes_at FROM vacancies WHERE id = $1 AND status IN ('published', 'closed') AND closes_at <= now()`,
          [vacancyId],
        );
        throw new DomainError(
          'recruitment.closed',
          was.rows[0]?.closes_at
            ? `Applications for this post closed at ${istText(was.rows[0].closes_at)}`
            : 'This vacancy is not open for applications',
          { status: 409 },
        );
      }
      const row = await c.query<{ profile: unknown; secure: Record<string, string> }>(
        `SELECT profile, secure FROM candidates WHERE id = $1`,
        [cand.id],
      );
      const p = this.profileOf(row.rows[0]?.profile);
      const secure = row.rows[0]?.secure ?? {};
      const files = await this.filesOf(c, cand.id);
      const missing = this.missing(p, secure, files);
      if (missing.length)
        throw new DomainError('validation-failed', `Still needed: ${missing.join(', ')}`, {
          status: 400,
          extra: { missing },
        });
      const dup = await c.query(
        `SELECT 1 FROM job_applications WHERE vacancy_id = $1 AND candidate_id = $2`,
        [vacancyId, cand.id],
      );
      if (dup.rowCount)
        throw new DomainError(
          'recruitment.already_applied',
          'You have already applied for this post',
          {
            status: 409,
          },
        );
      const match = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, employee_code AS code, display_name AS name FROM employees
          WHERE deleted_at IS NULL AND status = 'active'
            AND ((mobile IS NOT NULL AND mobile = $1) OR (email IS NOT NULL AND lower(email::text) = lower($2)))
          LIMIT 3`,
        [String(p.values.mobile ?? ''), String(p.values.email ?? '')],
      );
      const y = new Date().getFullYear();
      const n = await c.query<{ n: number }>(
        `SELECT COALESCE(max(substring(number FROM '([0-9]+)$')::int), 0) + 1 AS n FROM job_applications WHERE number LIKE $1`,
        [`APP-${String(y)}-%`],
      );
      const number = `APP-${String(y)}-${String(n.rows[0]!.n).padStart(4, '0')}`;
      const r = await c.query<{ id: string }>(
        `INSERT INTO job_applications (school_id, number, vacancy_id, candidate_id, snapshot, snapshot_secure, employee_match, current_stage_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, (SELECT stage_ids[1] FROM vacancies WHERE id = $2))
         RETURNING id::text`,
        [
          number,
          vacancyId,
          cand.id,
          JSON.stringify({ ...p, files }),
          JSON.stringify(secure),
          match.rows.length ? JSON.stringify(match.rows) : null,
        ],
      );
      const id = r.rows[0]!.id;
      await c.query(
        `INSERT INTO job_application_events (school_id, application_id, what, note) VALUES (app.current_school_id(), $1, 'applied', 'Online')`,
        [id],
      );
      // the candidate hears it is received (when the school sends this notice), with the application as a PDF
      const pdf = await this.pdf.store(c, id);
      await c.query(`SELECT app.recruitment_notify($1, 'applied', $2::jsonb)`, [
        id,
        JSON.stringify(pdf ? { attachments: [pdf] } : {}),
      ]);
      return { id, number };
    });
  }

  /** The candidate's own application as a PDF (made again from the application as it was sent). */
  async applicationPdf(cand: Candidate, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Application not found', { status: 404 });
    return this.db.tenant(publicTenant(cand.schoolId), async (c) => {
      const mine = await c.query(
        `SELECT 1 FROM job_applications WHERE id = $1 AND candidate_id = $2`,
        [id, cand.id],
      );
      const out = mine.rowCount ? await this.pdf.render(c, id) : null;
      if (!out) throw new DomainError('not-found', 'Application not found', { status: 404 });
      return {
        filename: out.filename,
        contentType: 'application/pdf',
        base64: out.bytes.toString('base64'),
      };
    });
  }
}
