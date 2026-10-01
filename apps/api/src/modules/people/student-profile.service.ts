import { Injectable } from '@nestjs/common';
import {
  EDITABLE_PROFILE_FIELDS,
  findSibling,
  PROFILE_FIELDS,
  PROFILE_LIST_DEFAULTS,
  PROFILE_SECTIONS,
  ProfileWriteError,
  QUICK_ADD_KEYS,
  loadProfileLists,
  optionsOf,
  readStudentProfile,
  refreshCompleteness,
  validateChanges,
  writeStudentProfile,
  type PoolClient,
  type ProfileLists,
  type StudentProfileSnapshot,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { QuickAddDto, UpdateProfileDto } from './people.dto';
import { PEOPLE } from './people.permissions';
import { StudentsService } from './students.service';

const invalid = (errors: Record<string, string>, detail = 'Some fields are not valid') =>
  new DomainError('validation-failed', detail, { status: 400, extra: { errors } });

/** Student 360 profile: catalogue, read (masked per viewer), field-level edit, quick add. */
@Injectable()
export class StudentProfileService {
  constructor(
    private readonly db: DbService,
    private readonly students: StudentsService,
    private readonly audit: AuditService,
  ) {}

  private canSeeSensitive(ctx: RequestContext): boolean {
    return ctx.permissions?.has(PEOPLE.sensitiveView) ?? false;
  }

  /** A sibling by admission number, for the Verify button on the Sibling tab. */
  async sibling(ctx: RequestContext, admissionNo: string, exclude: string | null) {
    const tenant = requireTenant(ctx);
    const found = await this.db.tenant(tenant, (c) => findSibling(c, admissionNo, exclude));
    if (!found)
      throw new DomainError('not-found', `No other student has admission number ${admissionNo}`, {
        status: 404,
      });
    return found;
  }

  /** Sections, fields and the school's drop-down options, plus geography for the address cascade. */
  async catalogue(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const lists = await loadProfileLists(c);
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
      return {
        sections: PROFILE_SECTIONS,
        fields: PROFILE_FIELDS.filter((f) => !f.retired).map((f) => ({
          key: f.key,
          section: f.section,
          label: f.label,
          type: f.type,
          required: f.required ?? false,
          list: f.list ?? null,
          options: f.list ? optionsOf(f, lists) : null,
          upper: f.upper ?? false,
          help: f.help ?? null,
          when: f.when ?? null,
          sensitive: f.sensitive ?? false,
          readOnly: f.store.t === 'auto' || f.store.t === 'enrol',
          excelColumn: f.excelColumn,
        })),
        quickAdd: QUICK_ADD_KEYS,
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
        canSeeSensitive: this.canSeeSensitive(ctx),
      };
    });
  }

  private async assertVisible(ctx: RequestContext, c: PoolClient, id: string): Promise<void> {
    const allowed = await this.students.scopeFilter(requireTenant(ctx));
    if (allowed === null) return;
    const r = await c.query(
      `SELECT 1 FROM enrolments WHERE student_id = $1 AND class_section_id = ANY($2::bigint[]) AND status = 'active'`,
      [id, allowed],
    );
    if ((r.rowCount ?? 0) === 0) throw new DomainError('not-found', 'Student not found');
  }

  async get(
    ctx: RequestContext,
    id: string,
    academicYearId?: string,
  ): Promise<StudentProfileSnapshot> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      await this.assertVisible(ctx, c, id);
      const snap = await readStudentProfile(c, id, {
        academicYearId: academicYearId ?? tenant.academicYearId ?? null,
        showSensitive: this.canSeeSensitive(ctx),
      });
      if (!snap) throw new DomainError('not-found', 'Student not found');
      if (snap.masked.length === 0 && this.canSeeSensitive(ctx)) {
        const shown = PROFILE_FIELDS.filter((f) => f.sensitive && snap.values[f.key] !== null).map(
          (f) => f.key,
        );
        if (shown.length)
          ctx.audit = {
            action: 'people.sensitive.view',
            entityType: 'students',
            entityId: id,
            after: { fields: shown },
          };
      }
      return snap;
    });
  }

  /** Field-level update: only the keys sent change; null clears a value. */
  async update(
    ctx: RequestContext,
    id: string,
    dto: UpdateProfileDto,
  ): Promise<StudentProfileSnapshot> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      await this.assertVisible(ctx, c, id);
      const lists = await loadProfileLists(c);
      const { values, errors } = validateChanges(dto.values, lists);
      if (Object.keys(errors).length) throw invalid(errors);
      const before = await readStudentProfile(c, id, { showSensitive: false });
      if (!before) throw new DomainError('not-found', 'Student not found');
      let changed: string[];
      try {
        ({ changed } = await writeStudentProfile(c, id, values));
      } catch (error) {
        if (error instanceof ProfileWriteError) throw invalid(error.errors, error.message);
        throw error;
      }
      await refreshCompleteness(c, id);
      const after = await readStudentProfile(c, id, {
        academicYearId: tenant.academicYearId ?? null,
        showSensitive: this.canSeeSensitive(ctx),
      });
      const diff = (s: StudentProfileSnapshot) =>
        Object.fromEntries(changed.map((k) => [k, s.values[k] ?? null]));
      const afterMasked = await readStudentProfile(c, id, { showSensitive: false });
      await this.audit.stage(ctx, c, {
        action: 'people.student.profile.edit',
        entityType: 'students',
        entityId: id,
        before: diff(before),
        after: diff(afterMasked!),
      });
      return after!;
    });
  }

  /** Suggested admission number (last one + 1, prefix kept) and next roll number of a section. */
  async nextNumbers(ctx: RequestContext, classSectionId?: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const last = await c.query<{ admission_no: string }>(
        `SELECT admission_no FROM students WHERE deleted_at IS NULL AND admission_no ~ '[0-9]+$'
          ORDER BY created_at DESC, id DESC LIMIT 1`,
      );
      let admissionNo: string | null = null;
      const m = last.rows[0] ? /^(.*?)(\d+)$/.exec(last.rows[0].admission_no) : null;
      if (m) {
        const n = (BigInt(m[2]!) + 1n).toString().padStart(m[2]!.length, '0');
        admissionNo = `${m[1]!}${n}`;
        const taken = await c.query('SELECT 1 FROM students WHERE admission_no = $1', [
          admissionNo,
        ]);
        if ((taken.rowCount ?? 0) > 0) admissionNo = null;
      }
      let rollNo: number | null = null;
      if (classSectionId && tenant.academicYearId) {
        const r = await c.query<{ n: number }>(
          `SELECT COALESCE(max(roll_no), 0) + 1 AS n FROM enrolments
            WHERE class_section_id = $1 AND academic_year_id = $2 AND status = 'active'`,
          [classSectionId, tenant.academicYearId],
        );
        rollNo = r.rows[0]?.n ?? 1;
      }
      return { admissionNo, rollNo };
    });
  }

  /** The minimum to run fees, attendance and SMS on day one; the rest is filled in later. */
  async quickAdd(
    ctx: RequestContext,
    dto: QuickAddDto,
  ): Promise<{ id: string; completeness: number }> {
    const tenant = requireTenant(ctx);
    const raw: Record<string, unknown> = { ...dto.values };
    if (!raw.admitted_on) raw.admitted_on = new Date().toISOString().slice(0, 10);
    return this.db.tenant(tenant, async (c) => {
      const lists: ProfileLists = await loadProfileLists(c);
      const { values, errors } = validateChanges(raw, lists);
      for (const k of QUICK_ADD_KEYS) {
        if (k === 'last_name' || k === 'father_name' || k === 'mother_name') continue;
        if (values[k] === null || values[k] === undefined) errors[k] ??= 'is required';
      }
      if (!values.father_name && !values.mother_name)
        errors.father_name ??= "Enter the father's or the mother's name";
      if (Object.keys(errors).length) throw invalid(errors);
      const dup = await c.query(
        'SELECT 1 FROM students WHERE admission_no = $1 AND deleted_at IS NULL',
        [values.admission_no],
      );
      if ((dup.rowCount ?? 0) > 0)
        throw invalid({ admission_no: 'another student already has this admission number' });
      const ins = await c.query<{ id: string }>(
        `INSERT INTO students (school_id, admission_no, first_name, gender, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, 'unspecified', app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [values.admission_no, values.first_name],
      );
      const id = ins.rows[0]!.id;
      // the SMS mobile also becomes the first parent's mobile, so messages reach someone from day one
      const withMobiles = { ...values };
      const parent = values.father_name ? 'father' : 'mother';
      if (values.sms_mobile && !withMobiles[`${parent}_mobile`])
        withMobiles[`${parent}_mobile`] = values.sms_mobile;
      try {
        await writeStudentProfile(c, id, withMobiles);
      } catch (error) {
        if (error instanceof ProfileWriteError) throw invalid(error.errors, error.message);
        throw error;
      }
      let rollNo = dto.rollNo;
      if (rollNo === undefined && tenant.academicYearId) {
        const r = await c.query<{ n: number }>(
          `SELECT COALESCE(max(roll_no), 0) + 1 AS n FROM enrolments
            WHERE class_section_id = $1 AND academic_year_id = $2 AND status = 'active'`,
          [dto.classSectionId, tenant.academicYearId],
        );
        rollNo = r.rows[0]?.n ?? 1;
      }
      await this.students.enrolWith(c, tenant, id, {
        classSectionId: dto.classSectionId,
        rollNo,
        joinedOn: typeof values.admitted_on === 'string' ? values.admitted_on : undefined,
      });
      const percent = await refreshCompleteness(c, id);
      await this.audit.stage(ctx, c, {
        action: 'people.student.create',
        entityType: 'students',
        entityId: id,
        after: {
          quickAdd: true,
          admissionNo: values.admission_no,
          classSectionId: dto.classSectionId,
        },
      });
      return { id, completeness: percent };
    });
  }

  /** Keys editable through the profile (for templates and forms). */
  editableKeys(): string[] {
    return EDITABLE_PROFILE_FIELDS.map((f) => f.key);
  }

  listDefaults() {
    return PROFILE_LIST_DEFAULTS;
  }
}
