import { Injectable } from '@nestjs/common';
import { validateFormData, type FormField, type PoolClient } from '@edupro/db';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import {
  APP_SELECT,
  computeScore,
  toApplication,
  toCycle,
  type ApplicationRow,
  type CycleRow,
} from '../admissions.service';
import type { CreateApplicationDto, UpdateApplicationDto } from '../admissions.dto';
import { publicTenant, type Applicant } from './otp.service';

const CYCLE_SELECT_PUBLIC = `SELECT c.id::text, c.academic_year_id::text, y.code AS academic_year, c.code, c.name, c.name_hi, c.instructions, c.instructions_hi,
        c.opens_at, c.closes_at, c.status, c.form_schema, c.application_fee::text, 0 AS applications,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', k.id::text, 'classId', k.class_id::text, 'classCode', cl.code, 'className', cl.name, 'seats', k.seats,
                    'dobFrom', k.dob_from::text, 'dobTo', k.dob_to::text, 'passcode', CASE WHEN k.passcode IS NULL THEN NULL ELSE '***' END, 'applications', 0) ORDER BY cl.display_order)
                    FROM admission_class_criteria k JOIN classes cl ON cl.id = k.class_id WHERE k.cycle_id = c.id), '[]'::jsonb) AS criteria,
        '[]'::jsonb AS score_criteria
   FROM admission_cycles c JOIN academic_years y ON y.id = c.academic_year_id`;

/** The applicant's side of admissions (S8-05): open cycles, drafts, submission with criteria and duplicate checks. */
@Injectable()
export class PublicAdmissionsService {
  constructor(private readonly db: DbService) {}

  async schools() {
    return this.db.global(async (c) => {
      const r = await c.query<{
        school_id: string;
        code: string;
        name: string;
        short_name: string | null;
        locale: string;
        open_cycles: number;
      }>(
        `SELECT school_id::text, code, name, short_name, locale, open_cycles FROM app.public_admission_schools()`,
      );
      return r.rows.map((s) => ({
        code: s.code,
        name: s.name,
        shortName: s.short_name,
        locale: s.locale,
        openCycles: s.open_cycles,
      }));
    });
  }

  async schoolId(code: string): Promise<string> {
    const id = await this.db.global(async (c) => {
      const r = await c.query<{ id: string | null }>(
        `SELECT app.public_school_id($1)::text AS id`,
        [code],
      );
      return r.rows[0]?.id ?? null;
    });
    if (!id) throw new DomainError('not-found', 'School not found');
    return id;
  }

  async openCycles(schoolCode: string): Promise<CycleRow[]> {
    const schoolId = await this.schoolId(schoolCode);
    return this.db.tenant(publicTenant(schoolId), async (c) => {
      const r = await c.query<Parameters<typeof toCycle>[0]>(
        // eslint-disable-next-line no-restricted-syntax -- CYCLE_SELECT_PUBLIC is a constant
        `${CYCLE_SELECT_PUBLIC} WHERE c.deleted_at IS NULL AND c.status = 'open' AND now() BETWEEN c.opens_at AND c.closes_at ORDER BY c.opens_at DESC`,
      );
      return r.rows.map(toCycle);
    });
  }

  private async openCycle(
    c: PoolClient,
    id: string,
  ): Promise<
    CycleRow & {
      formSchema: FormField[];
      rawCriteria: Array<{
        classId: string;
        dobFrom: string | null;
        dobTo: string | null;
        passcode: string | null;
      }>;
    }
  > {
    const r = await c.query<Parameters<typeof toCycle>[0]>(
      // eslint-disable-next-line no-restricted-syntax -- CYCLE_SELECT_PUBLIC is a constant; values are bound parameters
      `${CYCLE_SELECT_PUBLIC} WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Admission cycle not found');
    const cycle = toCycle(r.rows[0]);
    if (
      cycle.status !== 'open' ||
      new Date(cycle.opensAt) > new Date() ||
      new Date(cycle.closesAt) < new Date()
    )
      throw new DomainError('admission.cycle_closed', 'Applications are not open for this cycle', {
        status: 409,
      });
    const raw = await c.query<{
      class_id: string;
      dob_from: string | null;
      dob_to: string | null;
      passcode: string | null;
    }>(
      `SELECT class_id::text, dob_from::text, dob_to::text, passcode FROM admission_class_criteria WHERE cycle_id = $1`,
      [id],
    );
    return {
      ...cycle,
      rawCriteria: raw.rows.map((k) => ({
        classId: k.class_id,
        dobFrom: k.dob_from,
        dobTo: k.dob_to,
        passcode: k.passcode,
      })),
    };
  }

  private async find(c: PoolClient, applicant: Applicant, id: string): Promise<ApplicationRow> {
    const r = await c.query<Parameters<typeof toApplication>[0]>(
      // eslint-disable-next-line no-restricted-syntax -- fixed SQL fragments assembled in code; values are bound parameters
      `${APP_SELECT} WHERE a.id = $1 AND a.applicant_id = $2`,
      [id, applicant.id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Application not found');
    return toApplication(r.rows[0]);
  }

  async mine(applicant: Applicant): Promise<ApplicationRow[]> {
    return this.db.tenant(publicTenant(applicant.schoolId), async (c) => {
      const r = await c.query<Parameters<typeof toApplication>[0]>(
        // eslint-disable-next-line no-restricted-syntax -- fixed SQL fragments assembled in code; values are bound parameters
        `${APP_SELECT} WHERE a.applicant_id = $1 ORDER BY a.id DESC`,
        [applicant.id],
      );
      return r.rows.map(toApplication);
    });
  }

  async get(applicant: Applicant, id: string): Promise<ApplicationRow> {
    return this.db.tenant(publicTenant(applicant.schoolId), (c) => this.find(c, applicant, id));
  }

  private checkCriteria(
    cycle: Awaited<ReturnType<PublicAdmissionsService['openCycle']>>,
    classId: string,
    dob: string,
    passcode: string | undefined,
  ) {
    const k = cycle.rawCriteria.find((x) => x.classId === classId);
    if (!k)
      throw new DomainError(
        'admission.class_not_open',
        'This class is not open for admission in the cycle',
        { status: 422 },
      );
    if ((k.dobFrom && dob < k.dobFrom) || (k.dobTo && dob > k.dobTo))
      throw new DomainError(
        'admission.age_criteria',
        `The child must be born between ${k.dobFrom ?? '…'} and ${k.dobTo ?? '…'} for this class`,
        {
          status: 422,
          extra: { dobFrom: k.dobFrom, dobTo: k.dobTo },
        },
      );
    if (k.passcode && k.passcode !== (passcode ?? '').trim())
      throw new DomainError(
        'admission.passcode_invalid',
        'The passcode for this class is not correct',
        { status: 422 },
      );
  }

  private validateData(schema: FormField[], data: Record<string, unknown>) {
    const problems = validateFormData(schema, data);
    if (problems.length > 0)
      throw new DomainError('validation-failed', 'Some answers were not accepted', {
        status: 400,
        extra: { problems },
      });
  }

  async create(
    applicant: Applicant,
    dto: CreateApplicationDto,
    requestId?: string,
  ): Promise<ApplicationRow> {
    return this.db.tenant(publicTenant(applicant.schoolId, requestId), async (c) => {
      const cycle = await this.openCycle(c, dto.cycleId);
      this.checkCriteria(cycle, dto.classId, dto.childDob, dto.passcode);
      this.validateData(cycle.formSchema, dto.data);
      const own = await c.query(
        `SELECT 1 FROM applications WHERE cycle_id = $1 AND applicant_id = $2 AND lower(child_first_name) = lower($3) AND child_dob = $4::date AND status <> 'withdrawn'`,
        [dto.cycleId, applicant.id, dto.childFirstName, dto.childDob],
      );
      if (own.rowCount)
        throw new DomainError(
          'admission.duplicate_application',
          'You already applied for this child in this cycle',
          { status: 409 },
        );
      const other = await c.query<{ id: string }>(
        `SELECT id::text FROM applications WHERE cycle_id = $1 AND applicant_id <> $2 AND lower(child_first_name) = lower($3) AND lower(coalesce(child_last_name, '')) = lower($4) AND child_dob = $5::date AND status <> 'withdrawn' ORDER BY id LIMIT 1`,
        [dto.cycleId, applicant.id, dto.childFirstName, dto.childLastName ?? '', dto.childDob],
      );
      const r = await c.query<{ id: string }>(
        `INSERT INTO applications (school_id, cycle_id, class_id, applicant_id, child_first_name, child_last_name, child_dob, child_gender, data, passcode_used, possible_duplicate_of)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::date, $7::gender, $8::jsonb, $9, $10) RETURNING id::text`,
        [
          dto.cycleId,
          dto.classId,
          applicant.id,
          dto.childFirstName,
          dto.childLastName ?? null,
          dto.childDob,
          dto.childGender,
          JSON.stringify(dto.data),
          dto.passcode ?? null,
          other.rows[0]?.id ?? null,
        ],
      );
      const id = r.rows[0]!.id;
      await c.query(
        `INSERT INTO application_events (school_id, application_id, from_status, to_status, note, actor_applicant_id) VALUES (app.current_school_id(), $1, NULL, 'draft', 'created', $2)`,
        [id, applicant.id],
      );
      if (dto.submit) await this.submitWith(c, applicant, id);
      return this.find(c, applicant, id);
    });
  }

  async update(
    applicant: Applicant,
    id: string,
    dto: UpdateApplicationDto,
  ): Promise<ApplicationRow> {
    return this.db.tenant(publicTenant(applicant.schoolId), async (c) => {
      const before = await this.find(c, applicant, id);
      if (before.status !== 'draft')
        throw new DomainError('admission.not_draft', 'Only a draft can be edited', { status: 409 });
      const cycle = await this.openCycle(c, before.cycleId);
      const data = dto.data ?? before.data;
      this.validateData(cycle.formSchema, data);
      if (dto.childDob) this.checkCriteria(cycle, before.classId, dto.childDob, undefined);
      await c.query(
        `UPDATE applications SET child_first_name = COALESCE($2, child_first_name), child_last_name = CASE WHEN $3::boolean THEN $4 ELSE child_last_name END,
                child_dob = COALESCE($5::date, child_dob), child_gender = COALESCE($6::gender, child_gender), data = $7::jsonb, updated_at = now() WHERE id = $1`,
        [
          id,
          dto.childFirstName ?? null,
          dto.childLastName !== undefined,
          dto.childLastName ?? null,
          dto.childDob ?? null,
          dto.childGender ?? null,
          JSON.stringify(data),
        ],
      );
      return this.find(c, applicant, id);
    });
  }

  private async submitWith(c: PoolClient, applicant: Applicant, id: string): Promise<void> {
    const before = await this.find(c, applicant, id);
    if (before.status !== 'draft')
      throw new DomainError('admission.not_draft', 'The application was already submitted', {
        status: 409,
      });
    const cycle = await this.openCycle(c, before.cycleId);
    const used = await c.query<{ passcode_used: string | null }>(
      `SELECT passcode_used FROM applications WHERE id = $1`,
      [id],
    );
    this.checkCriteria(
      cycle,
      before.classId,
      before.childDob,
      used.rows[0]?.passcode_used ?? undefined,
    );
    this.validateData(cycle.formSchema, before.data);
    const criteria = await c.query<{
      id: string;
      code: string;
      name: string;
      points: number;
      auto_rule: string | null;
    }>(
      `SELECT id::text, code, name, points, auto_rule FROM admission_score_criteria WHERE cycle_id = $1 ORDER BY sort_order`,
      [before.cycleId],
    );
    const { score, breakdown } = await computeScore(
      c,
      before,
      criteria.rows.map((k) => ({
        id: k.id,
        code: k.code,
        name: k.name,
        points: Number(k.points),
        autoRule: k.auto_rule,
      })),
      [],
    );
    const no = await c.query<{ application_no: string; serial: number }>(
      `SELECT * FROM app.next_application_no($1)`,
      [before.cycleId],
    );
    await c.query(
      `UPDATE applications SET status = 'submitted', application_no = $2, serial = $3, submitted_at = now(), score = $4, score_breakdown = $5::jsonb, updated_at = now() WHERE id = $1`,
      [id, no.rows[0]!.application_no, no.rows[0]!.serial, score, JSON.stringify(breakdown)],
    );
    await c.query(
      `INSERT INTO application_events (school_id, application_id, from_status, to_status, note, actor_applicant_id) VALUES (app.current_school_id(), $1, 'draft', 'submitted', $2, $3)`,
      [id, no.rows[0]!.application_no, applicant.id],
    );
  }

  async submit(applicant: Applicant, id: string): Promise<ApplicationRow> {
    return this.db.tenant(publicTenant(applicant.schoolId), async (c) => {
      await this.submitWith(c, applicant, id);
      return this.find(c, applicant, id);
    });
  }
}
