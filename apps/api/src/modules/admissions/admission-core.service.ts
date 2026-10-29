import { messageTag } from './message-tag';
import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  amountInWords,
  answerText,
  cleanAnswers,
  decryptField,
  encryptField,
  fieldState,
  formErrors,
  formProgress,
  isEmptyAnswer,
  LAYOUT_TYPES,
  linkCityStates,
  liveAnswers,
  matchCategory,
  pointsTotal,
  workPoints,
  type AdmissionAnswers,
  type AdmissionField,
  type AdmissionFormDef,
  type PoolClient,
} from '@edupro/db';
import { objectKeyFor, type StorageDriver } from '@edupro/storage';
import { DomainError } from '../../common/errors/domain-error';
import { STORAGE_DRIVER } from '../files/storage';
import { applicationPdf } from '../people/application-pdf';
import { admissionReceiptPdf, type SchoolHead } from './admission-pdf';
import { AdmissionFormsService } from './forms.service';
import { convertEnquiry } from './enquiry-engine';
import { classPointRules, classPointsMax } from './points-rules';
import { pointTablesFor, siblingNosOf } from './score-tables';
import { seriesNumber } from './number-series';
import { refreshMerit, startProcess } from './process-engine';
import { AdmissionSetupService } from './setup.service';

/** The answers that are ID numbers: kept encrypted in the application (docs/design/39). */
const SECRET_PRESETS = new Set(['aadhaar', 'apaar', 'pen']);
const SECRET_MAPS = new Set(['aadhaar_no', 'apaar_id', 'pen_no']);
const isSecret = (f: AdmissionField) =>
  SECRET_PRESETS.has(f.preset ?? '') || SECRET_MAPS.has(f.maps ?? '');
const ENC = 'enc:';

/** A registration's status as a family reads it (duplicate messages). */
const STATUS_WORDS: Record<string, string> = {
  submitted: 'form submitted, fee due',
  registered: 'registered',
  under_review: 'under review',
  sent_back: 'sent back for correction',
  shortlisted: 'shortlisted',
  selected: 'selected',
  waitlisted: 'on the waiting list',
  offered: 'offered admission',
  fee_paid: 'admission fee paid',
  admitted: 'admitted',
};

export interface AppRow {
  id: string;
  cycle_id: string;
  cycle_code: string;
  cycle_name: string;
  year_id: string;
  year_name: string;
  class_id: string;
  class_name: string;
  applicant_id: string;
  application_no: string | null;
  status: string;
  data: Record<string, unknown>;
  form_id: string | null;
  form_snapshot: AdmissionFormDef | null;
  category_id: string | null;
  category_name: string | null;
  registration_fee: string | null;
  registration_receipt_id: string | null;
  registered_at: Date | null;
  submitted_at: Date | null;
  progress: number;
  pdf_file_id: string | null;
  candidate_name: string | null;
  contact_mobile: string | null;
  contact_email: string | null;
  child_first_name: string;
  child_last_name: string | null;
  child_dob: string | null;
  child_gender: string;
  entered_by: string | null;
  created_at: Date;
  receipt_no: string | null;
  applicant_mobile: string | null;
  applicant_email: string | null;
  admission_no: string | null;
  admission_receipt_id: string | null;
  admission_fee: string | null;
  offer_expires_at: Date | null;
  fee_paid_at: Date | null;
  student_id: string | null;
  admitted_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
}

export const APP_COLS = `a.id::text, a.cycle_id::text, y.code AS cycle_code, y.name AS cycle_name, y.academic_year_id::text AS year_id,
  ay.name AS year_name, a.class_id::text, cl.name AS class_name, a.applicant_id::text, a.application_no, a.status::text,
  a.data, a.form_id::text, a.form_snapshot, a.category_id::text, k.name AS category_name, a.registration_fee::text,
  a.registration_receipt_id::text, a.registered_at, a.submitted_at, a.progress, a.pdf_file_id::text, a.candidate_name,
  a.contact_mobile, a.contact_email, a.child_first_name, a.child_last_name, a.child_dob::text, a.child_gender::text,
  a.entered_by::text, a.created_at, mr.receipt_no, ap.mobile AS applicant_mobile, ap.email::text AS applicant_email,
  a.admission_no, a.admission_receipt_id::text, a.admission_fee::text, a.offer_expires_at, a.fee_paid_at, a.student_id::text,
  a.admitted_at, a.cancelled_at, a.cancel_reason`;
export const APP_FROM = `FROM applications a JOIN admission_cycles y ON y.id = a.cycle_id JOIN academic_years ay ON ay.id = y.academic_year_id
  JOIN classes cl ON cl.id = a.class_id JOIN applicants ap ON ap.id = a.applicant_id
  LEFT JOIN admission_fee_categories k ON k.id = a.category_id LEFT JOIN misc_receipts mr ON mr.id = a.registration_receipt_id`;

const GENDER: Record<string, string> = {
  male: 'male',
  female: 'female',
  other: 'other',
  transgender: 'other',
};
const ist = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
const istDate = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
const money = (n: number) =>
  `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The admission core (docs/design/39, parts 3 and 6) shared by the candidate portal and the office: the
 * form an application uses (with the class line's age and date of birth rules), saving and checking its
 * answers, submitting, the fee category, registration with its number, the fee receipts in the fee
 * module (admission ledger, own series), and the form and receipt PDFs.
 */
@Injectable()
export class AdmissionCoreService {
  private readonly log = new Logger(AdmissionCoreService.name);

  constructor(
    private readonly forms: AdmissionFormsService,
    private readonly setup: AdmissionSetupService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async row(c: PoolClient, id: string): Promise<AppRow> {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Application not found', { status: 404 });
    const r = await c.query<AppRow>(
      // eslint-disable-next-line no-restricted-syntax -- APP_COLS / APP_FROM are constants; the id is a bound parameter
      `SELECT ${APP_COLS} ${APP_FROM} WHERE a.id = $1`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Application not found', { status: 404 });
    return r.rows[0];
  }

  /** The form of the application (its snapshot once submitted) with the class line's rules applied. */
  async defOf(c: PoolClient, a: AppRow): Promise<AdmissionFormDef> {
    let def = a.form_snapshot;
    if (!def) {
      const formId =
        a.form_id ??
        (
          await c.query<{ form_id: string | null }>(
            `SELECT form_id::text FROM admission_class_criteria WHERE cycle_id = $1 AND class_id = $2`,
            [a.cycle_id, a.class_id],
          )
        ).rows[0]?.form_id;
      if (!formId)
        throw new DomainError('admissions.no_form', 'This class has no registration form yet', {
          status: 409,
        });
      const f = await c.query<{ def: AdmissionFormDef }>(
        `SELECT def FROM admission_forms WHERE id = $1`,
        [formId],
      );
      def = f.rows[0]!.def;
    }
    const line = await c.query<{
      age_as_on: string | null;
      dob_from: string | null;
      dob_to: string | null;
      pincode_prefixes: string[] | null;
      pass_out_before: number | null;
    }>(
      `SELECT age_as_on::text, dob_from::text, dob_to::text, pincode_prefixes, pass_out_before
         FROM admission_class_criteria WHERE cycle_id = $1 AND class_id = $2`,
      [a.cycle_id, a.class_id],
    );
    const l = line.rows[0];
    // the class line's rules, set on the session (the form's own copies are no longer used)
    const formSettings = { ...def.settings };
    for (const k of ['ageAsOn', 'dobFrom', 'dobTo', 'pincodePrefixes', 'passOutBefore'] as const)
      delete formSettings[k];
    // each city list follows its state (set in the builder, or the only state field on its tab)
    return linkCityStates({
      ...def,
      settings: {
        ...formSettings,
        ...(l?.age_as_on ? { ageAsOn: l.age_as_on } : {}),
        ...(l?.dob_from ? { dobFrom: l.dob_from } : {}),
        ...(l?.dob_to ? { dobTo: l.dob_to } : {}),
        ...(l?.pincode_prefixes?.length ? { pincodePrefixes: l.pincode_prefixes } : {}),
        ...(l?.pass_out_before ? { passOutBefore: l.pass_out_before } : {}),
      },
    });
  }

  /** Stored answers as typed (ID numbers decrypted for the family and the office's form view). */
  plainData(def: AdmissionFormDef, data: Record<string, unknown>): AdmissionAnswers {
    const out: AdmissionAnswers = {};
    for (const [k, v] of Object.entries(data ?? {})) {
      const f = def.fields.find((x) => x.key === k);
      if (f && isSecret(f) && typeof v === 'string' && v.startsWith(ENC))
        out[k] = decryptField(v.slice(ENC.length)) ?? '';
      else out[k] = v as AdmissionAnswers[string];
    }
    return out;
  }

  /** Answers as kept: ID numbers encrypted. */
  private storedData(def: AdmissionFormDef, answers: AdmissionAnswers): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(answers)) {
      const f = def.fields.find((x) => x.key === k);
      out[k] = f && isSecret(f) && typeof v === 'string' && v ? `${ENC}${encryptField(v)}` : v;
    }
    return out;
  }

  /** The fields the office asked to correct (an open correction), or null when the whole form is open. */
  async correctionFields(c: PoolClient, appId: string): Promise<string[] | null> {
    const r = await c.query<{ fields: string[] }>(
      `SELECT fields FROM admission_corrections WHERE application_id = $1 AND status = 'open' ORDER BY id DESC LIMIT 1`,
      [appId],
    );
    return r.rows[0]?.fields ?? null;
  }

  /** Files given as answers must be uploads of this application. */
  private async checkFiles(
    c: PoolClient,
    a: AppRow,
    def: AdmissionFormDef,
    answers: AdmissionAnswers,
  ) {
    const ids: string[] = [];
    for (const f of def.fields)
      if ((f.type === 'file' || f.type === 'photo') && Array.isArray(answers[f.key]))
        ids.push(...(answers[f.key] as string[]));
    if (!ids.length) return;
    const ok = await c.query<{ id: string }>(
      `SELECT id::text FROM files WHERE id = ANY($1::bigint[]) AND owner_entity_type = 'application' AND owner_entity_id = $2
          AND status = 'ready' AND deleted_at IS NULL`,
      [ids.filter((x) => /^\d{1,18}$/.test(x)), a.id],
    );
    const have = new Set(ok.rows.map((x) => x.id));
    const bad = ids.find((x) => !have.has(x));
    if (bad)
      throw new DomainError(
        'validation-failed',
        'An attached file is not an upload of this form; upload it again',
        { status: 400 },
      );
  }

  /** Saves the answers of one tab (checked), or of everything on submit. Returns the errors, if any. */
  async save(
    c: PoolClient,
    a: AppRow,
    answers: AdmissionAnswers,
    opts: { step?: string; actorUser?: string | null },
  ): Promise<{ errors: Record<string, string>; progress: number }> {
    const editable =
      ['draft', 'submitted', 'sent_back'].includes(a.status) && !a.application_no
        ? true
        : a.status === 'sent_back';
    if (!editable)
      throw new DomainError(
        'admissions.locked',
        'The form is submitted and cannot be changed now',
        { status: 409 },
      );
    const def = await this.defOf(c, a);
    const only = a.status === 'sent_back' ? await this.correctionFields(c, a.id) : null;
    const before = this.plainData(def, a.data);
    const incoming: AdmissionAnswers = {};
    for (const f of def.fields) {
      if (LAYOUT_TYPES.includes(f.type)) continue;
      if (!(f.key in answers)) continue;
      if (only && !only.includes(f.key)) continue;
      incoming[f.key] = answers[f.key];
    }
    const merged = { ...before, ...incoming };
    await this.checkFiles(c, a, def, merged);
    const options = await this.forms.optionsWith(c);
    const errors = formErrors(
      def,
      merged,
      (f, a) => AdmissionFormsService.optionsOf(f, options, a),
      opts.step,
    );
    if (Object.keys(errors).length) return { errors, progress: formProgress(def, merged) };
    const clean = { ...merged, ...cleanAnswers(def, merged) };
    const progress = formProgress(def, clean);
    await this.writeData(c, a, def, clean, progress);
    return { errors: {}, progress };
  }

  private async writeData(
    c: PoolClient,
    a: AppRow,
    def: AdmissionFormDef,
    clean: AdmissionAnswers,
    progress: number,
  ) {
    const byMap = (key: string) => {
      const f = def.fields.find((x) => x.maps === key && fieldState(x, clean).shown);
      const v = f ? clean[f.key] : undefined;
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    };
    const first = byMap('first_name') ?? a.child_first_name ?? '';
    const last = byMap('last_name');
    const dob = byMap('dob');
    const gender = GENDER[(byMap('gender') ?? '').toLowerCase()] ?? a.child_gender ?? 'unspecified';
    const mobile =
      byMap('sms_mobile') ?? byMap('father_mobile') ?? byMap('mother_mobile') ?? a.applicant_mobile;
    const email =
      byMap('primary_email') ?? byMap('father_email') ?? byMap('mother_email') ?? a.applicant_email;
    await c.query(
      `UPDATE applications SET data = $2::jsonb, progress = $3, child_first_name = $4::text, child_last_name = $5::text, child_dob = $6::date,
              child_gender = $7::gender, candidate_name = NULLIF(btrim(concat_ws(' ', $4::text, $5::text)), ''), contact_mobile = $8, contact_email = $9,
              updated_at = now() WHERE id = $1`,
      [
        a.id,
        JSON.stringify(this.storedData(def, clean)),
        progress,
        first,
        last,
        dob,
        gender,
        mobile,
        email,
      ],
    );
  }

  /**
   * The office corrects a submitted application before Admit (docs/design/37, case 1b): only the answers
   * sent change, each is checked, and every change is kept with its old and new value. Files, photos,
   * the signature and the declaration stay the family's (Send back asks them).
   */
  /**
   * The form points of an application worked out again from its answers and its class's criteria
   * (docs/design/40), and its merit with them. Left alone once the office has confirmed the points.
   */
  /**
   * The point lines of an application from its live answers, its class's criteria and the school's
   * score tables (docs/design/48); null when the class has no criteria.
   */
  async workedPoints(
    c: PoolClient,
    appId: string,
    cycleId: string,
    classId: string,
  ): Promise<ReturnType<typeof workPoints> | null> {
    const rules = await classPointRules(c, cycleId, classId);
    if (!rules.length) return null;
    const fresh = await this.row(c, appId);
    const def = await this.defOf(c, fresh);
    const answers = liveAnswers(def, this.plainData(def, fresh.data));
    const tables = await pointTablesFor(c, classId, siblingNosOf(answers));
    return workPoints(rules, answers, tables);
  }

  async refreshPoints(c: PoolClient, appId: string): Promise<void> {
    const r = await c.query<{
      cycle_id: string;
      class_id: string;
      status: string;
      confirmed: boolean;
    }>(
      `SELECT cycle_id::text, class_id::text, status::text, points_confirmed_at IS NOT NULL AS confirmed
         FROM applications WHERE id = $1`,
      [appId],
    );
    const x = r.rows[0];
    if (!x || x.confirmed || x.status === 'draft') return;
    const lines = await this.workedPoints(c, appId, x.cycle_id, x.class_id);
    const max = await classPointsMax(c, x.cycle_id, x.class_id);
    await c.query(
      `UPDATE applications SET form_points = $2, points_breakdown = $3::jsonb WHERE id = $1`,
      [
        appId,
        lines ? pointsTotal(lines, max).toFixed(2) : null,
        lines ? JSON.stringify(lines) : null,
      ],
    );
    await refreshMerit(c, appId);
  }

  async officeCorrect(
    c: PoolClient,
    a: AppRow,
    answers: AdmissionAnswers,
    reason: string,
    opts: { maskSecrets: boolean },
  ): Promise<{ errors: Record<string, string>; changed: Array<{ key: string; label: string }> }> {
    if (['draft', 'admitted', 'cancelled', 'withdrawn'].includes(a.status))
      throw new DomainError(
        'admissions.correct_closed',
        a.status === 'admitted'
          ? 'The candidate is admitted: correct the details on the student page'
          : 'Only a submitted application that is not admitted, cancelled or withdrawn can be corrected',
        { status: 409 },
      );
    const def = await this.defOf(c, a);
    const before = this.plainData(def, a.data);
    const incoming: AdmissionAnswers = {};
    const errors: Record<string, string> = {};
    for (const [k, v] of Object.entries(answers)) {
      const f = def.fields.find((x) => x.key === k);
      if (!f || LAYOUT_TYPES.includes(f.type)) errors[k] = 'is not a question of this form';
      else if (['file', 'photo', 'signature', 'agree'].includes(f.type))
        errors[k] = 'is the family’s: use Send back';
      else incoming[k] = v;
    }
    if (Object.keys(errors).length) return { errors, changed: [] };
    const merged = { ...before, ...incoming };
    const options = await this.forms.optionsWith(c);
    const all = formErrors(def, merged, (f, a) => AdmissionFormsService.optionsOf(f, options, a));
    // only the answers corrected are held to the form's rules (the rest stay as the family left them)
    for (const k of Object.keys(incoming)) if (all[k]) errors[k] = all[k];
    if (Object.keys(errors).length) return { errors, changed: [] };
    const clean = { ...merged, ...cleanAnswers(def, merged) };
    const shown = (f: AdmissionField, v: unknown) => {
      const t = answerText(f, v as AdmissionAnswers[string]);
      return isSecret(f) && opts.maskSecrets && t ? `XXXX-XXXX-${t.slice(-4)}` : t || null;
    };
    const changes = Object.keys(incoming)
      .map((k) => def.fields.find((x) => x.key === k)!)
      .filter((f) => JSON.stringify(before[f.key] ?? null) !== JSON.stringify(clean[f.key] ?? null))
      .map((f) => ({
        key: f.key,
        label: f.label,
        from: shown(f, before[f.key]),
        to: shown(f, clean[f.key]),
      }));
    if (!changes.length)
      return { errors: { _: 'Nothing differs from the application' }, changed: [] };
    await this.writeData(c, a, def, clean, formProgress(def, clean));
    // a corrected name, birth date or Aadhaar must not make the child's second registration of the year
    await this.guardSameChild(c, await this.row(c, a.id), {});
    for (const x of changes)
      await c.query(
        `INSERT INTO application_answer_changes (school_id, application_id, field_key, label, old_value, new_value, reason, changed_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id())`,
        [a.id, x.key, x.label.slice(0, 200), x.from, x.to, reason],
      );
    await c.query(
      `INSERT INTO application_events (school_id, application_id, from_status, to_status, note, actor_user_id)
       VALUES (app.current_school_id(), $1, $2::application_status, $2::application_status, $3, app.current_user_id())`,
      [
        a.id,
        a.status,
        `Corrected by the office: ${changes.map((x) => x.label).join(', ')}`.slice(0, 500),
      ],
    );
    await this.refreshPoints(c, a.id);
    // the forms kept for emails and downloads are made again with the corrected answers
    const fresh = await this.row(c, a.id);
    if (fresh.pdf_file_id) await this.storeFormPdf(c, fresh);
    const kept = await c.query<{ id: string | null }>(
      `SELECT admission_form_file_id::text AS id FROM applications WHERE id = $1`,
      [a.id],
    );
    if (kept.rows[0]?.id) await this.storeAdmissionFormPdf(c, fresh);
    return { errors: {}, changed: changes.map((x) => ({ key: x.key, label: x.label })) };
  }

  /**
   * Another live registration of the same child in the same academic year (docs/design/41): the same
   * first name (case, spaces and dots ignored) and date of birth, or the same Aadhaar, in any class of
   * any session of that year. Drafts, cancelled, withdrawn and rejected registrations do not count.
   */
  async sameChild(
    c: PoolClient,
    a: AppRow,
  ): Promise<{
    id: string;
    number: string | null;
    candidate: string | null;
    className: string;
    status: string;
  } | null> {
    const def = await this.defOf(c, a);
    const data = this.plainData(def, a.data);
    const name = (v: string | null) => (v ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const first = name(a.child_first_name);
    const dob = a.child_dob;
    const aadhaarField = def.fields.find((f) => f.preset === 'aadhaar' || f.maps === 'aadhaar_no');
    const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
    const aadhaar = aadhaarField ? digits(data[aadhaarField.key]) : '';
    if (!(first && dob) && aadhaar.length !== 12) return null;
    const others = await c.query<{
      id: string;
      number: string | null;
      candidate: string | null;
      class_name: string;
      status: string;
      first: string | null;
      dob: string | null;
      data: Record<string, unknown>;
    }>(
      `SELECT x.id::text, x.application_no AS number, x.candidate_name AS candidate, cl.name AS class_name,
              x.status::text, x.child_first_name AS first, x.child_dob::text AS dob, x.data
         FROM applications x JOIN admission_cycles y ON y.id = x.cycle_id JOIN classes cl ON cl.id = x.class_id
        WHERE y.academic_year_id = $1 AND y.deleted_at IS NULL AND x.id <> $2
          AND x.status::text NOT IN ('draft', 'cancelled', 'withdrawn', 'rejected')
        ORDER BY x.id`,
      [a.year_id, a.id],
    );
    const hit = others.rows.find((o) => {
      if (first && dob && name(o.first) === first && o.dob === dob) return true;
      if (aadhaar.length !== 12) return false;
      // the ID numbers kept encrypted: any answer of the other form that holds the same Aadhaar
      return Object.values(o.data ?? {}).some((v) => {
        const plain =
          typeof v === 'string' && v.startsWith(ENC) ? decryptField(v.slice(ENC.length)) : v;
        return typeof plain === 'string' && digits(plain) === aadhaar;
      });
    });
    return hit
      ? {
          id: hit.id,
          number: hit.number,
          candidate: hit.candidate,
          className: hit.class_name,
          status: hit.status,
        }
      : null;
  }

  /** Stops a second live registration of the same child in the year, unless an admin lets it through. */
  async guardSameChild(
    c: PoolClient,
    a: AppRow,
    opts: {
      allowDuplicate?: string | null;
      actorUser?: string | null;
      actorApplicant?: string | null;
    },
  ): Promise<string | null> {
    const dup = await this.sameChild(c, a);
    if (!dup) return null;
    if (!opts.allowDuplicate)
      throw new DomainError(
        'admissions.duplicate_child',
        `${dup.candidate ?? a.candidate_name ?? 'This child'} already has ${dup.number ? `registration ${dup.number}` : 'a submitted form'} for ${dup.className} this year (${STATUS_WORDS[dup.status] ?? dup.status}). A child can hold one registration per academic year: contact the school to change the class.`,
        { status: 409, extra: { duplicate: dup } },
      );
    await this.event(
      c,
      a.id,
      a.status,
      a.status,
      `Second registration of the same child let through by the office (${dup.number ?? dup.id}, ${dup.className}): ${opts.allowDuplicate}`,
      opts,
    );
    return dup.id;
  }

  /** Every answer checked; the category and the registration fee; registered at once when there is no fee. */
  async submit(
    c: PoolClient,
    a: AppRow,
    answers: AdmissionAnswers,
    opts: {
      actorUser?: string | null;
      actorApplicant?: string | null;
      /** the office's reason for letting a second registration of the same child through (admins only) */
      allowDuplicate?: string | null;
    },
  ): Promise<{ errors: Record<string, string>; fee: number; registered: boolean }> {
    if (!['draft', 'submitted', 'sent_back'].includes(a.status))
      throw new DomainError('admissions.locked', 'This form is already submitted', { status: 409 });
    const res = await this.save(c, a, answers, { actorUser: opts.actorUser ?? null });
    if (Object.keys(res.errors).length) return { errors: res.errors, fee: 0, registered: false };
    const fresh = await this.row(c, a.id);
    const def = await this.defOf(c, fresh);
    const data = this.plainData(def, fresh.data);
    // one live registration per child per academic year (docs/design/41)
    const allowedDup = await this.guardSameChild(c, fresh, opts);
    if (fresh.status === 'sent_back') {
      // a correction goes back to the approver who asked for it (part 4)
      await c.query(
        `UPDATE admission_corrections SET status = 'resubmitted', resubmitted_at = now() WHERE application_id = $1 AND status = 'open'`,
        [a.id],
      );
      await c.query(
        `UPDATE applications SET status = 'under_review', updated_at = now() WHERE id = $1`,
        [a.id],
      );
      await this.event(
        c,
        a.id,
        'sent_back',
        'under_review',
        'Corrections sent back by the family',
        opts,
      );
      await this.refreshPoints(c, a.id);
      return { errors: {}, fee: 0, registered: true };
    }
    const categories = await this.setup.categoriesWith(c, true);
    const cat = matchCategory(categories, data);
    const fee = await this.registrationFee(c, fresh.cycle_id, fresh.class_id, cat?.id ?? null);
    // a possible duplicate: the same Aadhaar number in another live application of the session
    const aadhaarField = def.fields.find((f) => f.preset === 'aadhaar' || f.maps === 'aadhaar_no');
    const aadhaar = aadhaarField ? String(data[aadhaarField.key] ?? '') : '';
    let dup: string | null = null;
    if (aadhaar) {
      const others = await c.query<{ id: string; data: Record<string, unknown> }>(
        `SELECT id::text, data FROM applications WHERE cycle_id = $1 AND id <> $2 AND status NOT IN ('draft', 'cancelled', 'withdrawn')`,
        [fresh.cycle_id, a.id],
      );
      dup =
        others.rows.find((o) => {
          const v = o.data?.[aadhaarField!.key];
          const plain =
            typeof v === 'string' && v.startsWith(ENC) ? decryptField(v.slice(ENC.length)) : v;
          return plain === aadhaar;
        })?.id ?? null;
    }
    await c.query(
      `UPDATE applications SET status = 'submitted', submitted_at = COALESCE(submitted_at, now()), form_snapshot = $2::jsonb,
              form_id = COALESCE(form_id, (SELECT form_id FROM admission_class_criteria WHERE cycle_id = $3 AND class_id = $4)),
              category_id = $5, registration_fee = $6, possible_duplicate_of = $7, updated_at = now()
        WHERE id = $1`,
      [
        a.id,
        JSON.stringify(def),
        fresh.cycle_id,
        fresh.class_id,
        cat?.id ?? null,
        fee.toFixed(2),
        dup ?? allowedDup,
      ],
    );
    await this.event(
      c,
      a.id,
      fresh.status,
      'submitted',
      `Form submitted${cat ? ` · category ${cat.name}` : ''}`,
      opts,
    );
    await this.refreshPoints(c, a.id);
    if (fee <= 0) {
      await this.register(c, a.id, null);
      return { errors: {}, fee, registered: true };
    }
    const after = await this.row(c, a.id);
    await c.query(
      `SELECT app.admission_notify('admission_received', $1, $2, $3::jsonb, $4, $5, NULL, $6::jsonb, $7)`,
      [
        after.contact_mobile,
        after.contact_email,
        JSON.stringify({
          ...messageTag('status', { applicationId: after.id }),
          name: after.candidate_name ?? '',
          class: after.class_name,
          school: '',
          amount: fee.toLocaleString('en-IN'),
        }),
        'Registration form submitted',
        `The registration form of ${after.candidate_name ?? 'your ward'} for ${after.class_name} is submitted.`,
        JSON.stringify([
          ['Candidate', after.candidate_name ?? ''],
          ['Class', after.class_name],
          ['Session', after.cycle_name],
          ['Registration fee', money(fee)],
        ]),
        'Pay the registration fee in the admission portal to complete the registration; the registration number is given after the payment.',
      ],
    );
    return { errors: {}, fee, registered: false };
  }

  async registrationFee(
    c: PoolClient,
    cycleId: string,
    classId: string,
    categoryId: string | null,
  ): Promise<number> {
    const r = await c.query<{ fee: string }>(
      `SELECT f.registration_fee::text AS fee FROM admission_fees f
        WHERE f.cycle_id = $1 AND f.class_id = $2
          AND f.category_id = COALESCE($3::bigint, (SELECT id FROM admission_fee_categories WHERE is_default AND status = 'active' LIMIT 1))`,
      [cycleId, classId, categoryId],
    );
    if (r.rows[0]) return Number(r.rows[0].fee);
    const d = await c.query<{ fee: string }>(
      `SELECT f.registration_fee::text AS fee FROM admission_fees f JOIN admission_fee_categories k ON k.id = f.category_id AND k.is_default
        WHERE f.cycle_id = $1 AND f.class_id = $2`,
      [cycleId, classId],
    );
    return Number(d.rows[0]?.fee ?? 0);
  }

  async event(
    c: PoolClient,
    appId: string,
    from: string | null,
    to: string,
    note: string,
    who: { actorUser?: string | null; actorApplicant?: string | null },
  ) {
    await c.query(
      `INSERT INTO application_events (school_id, application_id, from_status, to_status, note, actor_user_id, actor_applicant_id)
       VALUES (app.current_school_id(), $1, $2::application_status, $3::application_status, $4, $5, $6)`,
      [appId, from, to, note.slice(0, 500), who.actorUser ?? null, who.actorApplicant ?? null],
    );
  }

  /**
   * What is paid of the admission fee (docs/design/53): every posted receipt on the admission head of
   * this registration (parts at the counter, or one online payment); bounced and reversed ones not.
   */
  async admissionPaid(
    c: PoolClient,
    appId: string,
  ): Promise<{ paid: number; parts: number; lastReceiptId: string | null }> {
    const r = await c.query<{ paid: string; parts: number; last: string | null }>(
      `SELECT COALESCE(sum(m.amount), 0)::text AS paid, count(*)::int AS parts, max(m.id)::text AS last
         FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id
        WHERE m.application_id = $1 AND h.code = 'ADMFEE' AND m.status = 'posted'`,
      [appId],
    );
    return {
      paid: Number(r.rows[0]?.paid ?? 0),
      parts: r.rows[0]?.parts ?? 0,
      lastReceiptId: r.rows[0]?.last ?? null,
    };
  }

  /** Money carried in from another school of the group not used yet (docs/design/64). */
  async creditOf(c: PoolClient, appId: string): Promise<number> {
    const r = await c.query<{ credit: string }>(
      `SELECT transfer_credit::text AS credit FROM applications WHERE id = $1`,
      [appId],
    );
    return Number(r.rows[0]?.credit ?? 0);
  }

  /** A fee receipt in the fee module: the admission ledger head, the session's own series. */
  async postReceipt(
    c: PoolClient,
    a: AppRow,
    p: {
      kind: 'registration' | 'admission';
      amount: number;
      mode: string;
      reference?: string | null;
      instrumentNo?: string | null;
      instrumentDate?: string | null;
      bankName?: string | null;
      receivedOn?: string | null;
      receivedBy?: string | null;
      /** the cashier's own note, after the fee's (docs/design/52) */
      remarks?: string | null;
      /** the school's own name of the payment mode (the mode master), e.g. "Paytm" for UPI */
      modeLabel?: string | null;
    },
  ): Promise<{ id: string; receiptNo: string }> {
    const settings = await this.setup.settingsWith(c);
    const heads = await this.setup.feeHeadsWith(c);
    const fy = await c.query<{ fy: string | null }>(
      `SELECT app.financial_year_for(COALESCE($1::date, (now() AT TIME ZONE 'Asia/Kolkata')::date))::text AS fy`,
      [p.receivedOn ?? null],
    );
    if (!fy.rows[0]?.fy)
      throw new DomainError(
        'fees.no_financial_year',
        'No financial year covers the receipt date; create it under System → Years',
        { status: 409 },
      );
    const prefix =
      p.kind === 'registration' ? settings.regReceiptPrefix : settings.admReceiptPrefix;
    const session = a.year_name.replace(/^Session\s+/i, '').replace(/\s+/g, '');
    const r = await c.query<{ id: string; receipt_no: string }>(
      `INSERT INTO misc_receipts (school_id, academic_year_id, financial_year_id, receipt_no, payer_kind, payer_name, payer_mobile, head_id,
                                  amount, received_on, mode, reference, instrument_no, bank_name, remarks, received_by, application_id, mode_label, instrument_date)
       VALUES (app.current_school_id(), $1, $2, app.next_admission_receipt_no($3, $4), 'other', $5, $6, $7, $8,
               COALESCE($9::date, (now() AT TIME ZONE 'Asia/Kolkata')::date), $10, $11, $12, $13, $14, $15, $16, $17, $18::date)
       RETURNING id::text, receipt_no`,
      [
        a.year_id,
        fy.rows[0].fy,
        prefix,
        session,
        (a.candidate_name ?? 'Candidate').slice(0, 120),
        a.contact_mobile,
        p.kind === 'registration' ? heads.registration : heads.admission,
        p.amount.toFixed(2),
        p.receivedOn ?? null,
        p.mode,
        p.reference ?? null,
        p.instrumentNo ?? null,
        p.bankName ?? null,
        `${p.kind === 'registration' ? 'Registration' : 'Admission'} fee · ${a.class_name} · ${a.cycle_code}${
          p.remarks?.trim() ? ` · ${p.remarks.trim()}` : ''
        }`,
        p.receivedBy ?? null,
        a.id,
        p.modeLabel?.trim() || null,
        p.instrumentDate ?? null,
      ],
    );
    return { id: r.rows[0]!.id, receiptNo: r.rows[0]!.receipt_no };
  }

  /** Registration number, status, the form PDF kept, and the email with the form and the receipt. */
  async register(
    c: PoolClient,
    appId: string,
    receiptId: string | null,
    /** silent: the caller sends its own message (a registration moved in, docs/design/64) */
    opts: { silent?: boolean } = {},
  ): Promise<Array<{ fileId: string; name: string }>> {
    const a = await this.row(c, appId);
    if (a.application_no) return [];
    const no = await c.query<{ application_no: string; serial: number }>(
      `SELECT * FROM app.next_application_no($1)`,
      [a.cycle_id],
    );
    // the session's number series for the class, when one is set (docs/design/48); else APP/<code>/…
    const own = await seriesNumber(c, 'registration', {
      cycle_id: a.cycle_id,
      class_id: a.class_id,
      data: a.data as AdmissionAnswers | null,
    });
    if (own) no.rows[0]!.application_no = own;
    await c.query(
      `UPDATE applications SET application_no = $2, serial = $3, status = 'registered', registered_at = now(), registration_receipt_id = $4,
              updated_at = now() WHERE id = $1`,
      [appId, no.rows[0]!.application_no, no.rows[0]!.serial, receiptId],
    );
    await this.event(
      c,
      appId,
      a.status,
      'registered',
      `Registered: ${no.rows[0]!.application_no}`,
      {},
    );
    // the process of the class starts at once (docs/design/39, part 4)
    await startProcess(c, appId);
    // the enquiry it came from is converted (part 8)
    await convertEnquiry(c, appId);
    const after = await this.row(c, appId);
    const attachments: Array<{ fileId: string; name: string }> = [];
    const pdf = await this.storeFormPdf(c, after);
    if (pdf) attachments.push(pdf);
    if (receiptId) {
      const rec = await this.storeReceiptPdf(c, receiptId);
      if (rec) attachments.push(rec);
    }
    if (opts.silent) {
      await this.moveCorrection(c, appId, false);
      return attachments;
    }
    await c.query(
      `SELECT app.admission_notify('admission_registered', $1, $2, $3::jsonb, $4, $5, $6, $7::jsonb, $8, $9::jsonb)`,
      [
        after.contact_mobile,
        after.contact_email,
        JSON.stringify({
          ...messageTag('status', { applicationId: after.id }),
          name: after.candidate_name ?? '',
          class: after.class_name,
          school: '',
          number: after.application_no ?? '',
        }),
        'Registration complete',
        `${after.candidate_name ?? 'Your ward'} is registered for ${after.class_name} (${after.cycle_name}).`,
        after.application_no,
        JSON.stringify([
          ['Candidate', after.candidate_name ?? ''],
          ['Class', after.class_name],
          ['Registration no.', after.application_no ?? ''],
          ['Receipt no.', after.receipt_no ?? (receiptId ? '' : 'No fee')],
        ]),
        'The registration form and the receipt are attached and stay in the admission portal. The school will tell you the next step.',
        JSON.stringify(attachments),
      ],
    );
    // a registration moved in that waited for the fee difference: its number on the move, and the
    // answers its copy lacked
    await c.query(
      `UPDATE admission_moves SET snapshot = jsonb_set(snapshot, '{to,number}', to_jsonb($2::text))
        WHERE to_application_id = $1 AND status = 'accepted' AND snapshot ? 'to'`,
      [appId, after.application_no],
    );
    await this.moveCorrection(c, appId, true);
    return attachments;
  }

  /**
   * A registration moved in from another school of the group (docs/design/64): the copied answers are
   * kept where this school's form takes them; an answer it refuses (an option it does not offer, a
   * wrong format) is dropped. Returns the fields left unanswered that the form needs.
   */
  async adopt(c: PoolClient, a: AppRow, answers: AdmissionAnswers): Promise<string[]> {
    const def = await this.defOf(c, a);
    const options = await this.forms.optionsWith(c);
    const optionsOf = (f: AdmissionField, x: AdmissionAnswers) =>
      AdmissionFormsService.optionsOf(f, options, x);
    const given: AdmissionAnswers = {};
    for (const f of def.fields)
      if (!LAYOUT_TYPES.includes(f.type) && f.key in answers) given[f.key] = answers[f.key];
    let clean = { ...given, ...cleanAnswers(def, given) };
    for (const k of Object.keys(formErrors(def, clean, optionsOf)))
      if (!isEmptyAnswer(given[k])) delete given[k];
    clean = { ...given, ...cleanAnswers(def, given) };
    await this.writeData(c, a, def, clean, formProgress(def, clean));
    return Object.keys(formErrors(def, clean, optionsOf));
  }

  /** A registration moved in: submitted with this school's category and registration fee. */
  async submitMoved(
    c: PoolClient,
    appId: string,
    note: string,
    who: { actorUser?: string | null },
  ): Promise<{ fee: number; category: string | null }> {
    const fresh = await this.row(c, appId);
    const def = await this.defOf(c, fresh);
    const cat = matchCategory(
      await this.setup.categoriesWith(c, true),
      this.plainData(def, fresh.data),
    );
    const fee = await this.registrationFee(c, fresh.cycle_id, fresh.class_id, cat?.id ?? null);
    await c.query(
      `UPDATE applications SET status = 'submitted', submitted_at = now(), form_snapshot = $2::jsonb,
              form_id = COALESCE(form_id, (SELECT form_id FROM admission_class_criteria WHERE cycle_id = $3 AND class_id = $4)),
              category_id = $5, registration_fee = $6, updated_at = now()
        WHERE id = $1`,
      [appId, JSON.stringify(def), fresh.cycle_id, fresh.class_id, cat?.id ?? null, fee.toFixed(2)],
    );
    await this.event(
      c,
      appId,
      'draft',
      'submitted',
      `${note}${cat ? ` · category ${cat.name}` : ''}`,
      who,
    );
    await this.refreshPoints(c, appId);
    return { fee, category: cat?.name ?? null };
  }

  /**
   * A registration moved in whose copy lacked answers this school's form needs: once registered, they
   * are asked of the family as a correction (once). Returns the fields' names, or null.
   */
  async moveCorrection(c: PoolClient, appId: string, notify: boolean): Promise<string[] | null> {
    const m = await c.query<{ missing: string[]; school: string | null }>(
      `SELECT missing, snapshot->>'fromSchool' AS school FROM admission_moves
        WHERE to_application_id = $1 AND status = 'accepted' AND cardinality(missing) > 0`,
      [appId],
    );
    const x = m.rows[0];
    if (!x) return null;
    const asked = await c.query(`SELECT 1 FROM admission_corrections WHERE application_id = $1`, [
      appId,
    ]);
    if (asked.rowCount) return null;
    const a = await this.row(c, appId);
    const def = await this.defOf(c, a);
    const names = x.missing.map((k) => def.fields.find((f) => f.key === k)?.label ?? k);
    const remark = `This school's form asks for answers the registration moved from ${x.school ?? 'the other school'} did not have`;
    await c.query(
      `INSERT INTO admission_corrections (school_id, application_id, level, fields, remark, created_by)
       VALUES (app.current_school_id(), $1, COALESCE((SELECT level_no FROM applications WHERE id = $1), 1), $2, $3, app.current_user_id())`,
      [appId, x.missing, remark],
    );
    await c.query(
      `UPDATE applications SET status = 'sent_back', updated_at = now() WHERE id = $1`,
      [appId],
    );
    await this.event(
      c,
      appId,
      a.status,
      'sent_back',
      `Sent to the family for the answers this school's form asks for: ${names.join(', ')}`,
      {},
    );
    if (notify)
      await c.query(
        `SELECT app.admission_notify('admission_correction', $1, $2, $3::jsonb, $4, $5, NULL, $6::jsonb, $7)`,
        [
          a.contact_mobile,
          a.contact_email,
          JSON.stringify({
            ...messageTag('status', { applicationId: a.id }),
            name: a.candidate_name ?? '',
            number: a.application_no ?? '',
            school: '',
            due: 'soon',
            remark,
          }),
          'Please complete the registration form',
          `The school asks you to complete the registration form of ${a.candidate_name ?? 'your ward'}.`,
          JSON.stringify([
            ['Registration no.', a.application_no ?? ''],
            ['What to complete', names.join(', ')],
            ['Remark', remark],
          ]),
          'Sign in to the admission portal: only the marked answers can be changed. Submit again when done.',
        ],
      );
    return names;
  }

  /** Online registration fee paid (payment intent of kind admission_registration). */
  async onRegistrationPaid(
    c: PoolClient,
    intent: {
      entityType: string | null;
      entityId: string | null;
      amount: string;
      charge?: string;
      txnId: string;
      providerRef?: string | null;
    },
  ) {
    if (intent.entityType !== 'admission_registration' || !intent.entityId) return;
    const a = await this.row(c, intent.entityId);
    if (a.application_no) return;
    const amount = Number(intent.amount) - Number(intent.charge ?? 0);
    const rec = await this.postReceipt(c, a, {
      kind: 'registration',
      amount,
      mode: 'online',
      reference: intent.providerRef ?? intent.txnId,
    });
    await this.register(c, a.id, rec.id);
  }

  async school(
    c: PoolClient,
  ): Promise<{ head: SchoolHead; logo: { contentType: string; bytes: Buffer } | null }> {
    const s = (
      await c.query<{
        name: string;
        address: string | null;
        contact: string | null;
        logo: string | null;
      }>(
        `SELECT name,
                NULLIF(concat_ws(', ', NULLIF(btrim(address->>'line1'), ''), NULLIF(btrim(address->>'line2'), ''),
                       NULLIF(btrim(address->>'city'), ''), NULLIF(btrim(address->>'state'), ''),
                       NULLIF(btrim(COALESCE(address->>'pincode', address->>'pin')), '')), '') AS address,
                NULLIF(concat_ws(' · ', 'Phone ' || NULLIF(btrim(contact->>'phone'), ''), NULLIF(btrim(contact->>'email'), ''),
                       NULLIF(btrim(contact->>'website'), '')), '') AS contact,
                NULLIF(branding->>'logoFileId', '') AS logo
           FROM schools WHERE id = app.current_school_id()`,
      )
    ).rows[0]!;
    return {
      head: { name: s.name, address: s.address, contact: s.contact },
      logo: await this.fileBytes(c, s.logo),
    };
  }

  async fileBytes(c: PoolClient, fileId: string | null | undefined) {
    if (!fileId || !/^\d{1,18}$/.test(fileId)) return null;
    const f = await c.query<{ object_key: string; content_type: string }>(
      `SELECT object_key, content_type FROM files WHERE id = $1 AND deleted_at IS NULL`,
      [fileId],
    );
    if (!f.rows[0]) return null;
    try {
      return {
        contentType: f.rows[0].content_type,
        bytes: await this.storage.read(f.rows[0].object_key),
      };
    } catch {
      return null;
    }
  }

  /** The registration form as submitted (A4): every tab with its answers, documents, declaration. */
  async formPdf(
    c: PoolClient,
    a: AppRow,
    opts: { admission?: boolean } = {},
  ): Promise<{ filename: string; bytes: Buffer }> {
    const def = await this.defOf(c, a);
    const data = this.plainData(def, a.data);
    const { head, logo } = await this.school(c);
    // the photo strip: the student, father and mother as the form asks for them, a guardian when given
    const fileOf = (f: AdmissionField | undefined) =>
      f && Array.isArray(data[f.key]) ? ((data[f.key] as string[])[0] ?? null) : null;
    const photoOf = (kind: string, key: RegExp) =>
      def.fields.find(
        (f) =>
          f.type === 'photo' &&
          fieldState(f, data).shown &&
          (f.docKind === kind || (!f.docKind && key.test(f.key))),
      );
    const strip = [
      { label: 'Student', field: photoOf('photo', /student|child|candidate/) },
      { label: 'Father', field: photoOf('father_photo', /father/) },
      { label: 'Mother', field: photoOf('mother_photo', /mother/) },
      { label: 'Guardian', field: photoOf('guardian_photo', /guardian/) },
    ].filter((x) => x.field && (x.label !== 'Guardian' || fileOf(x.field)));
    const photos = await Promise.all(
      strip.map(async (x) => ({ label: x.label, file: await this.fileBytes(c, fileOf(x.field)) })),
    );
    const sections = def.steps
      .map((s) => ({
        title: s.title,
        rows: def.fields
          .filter(
            (f) =>
              f.step === s.key &&
              !LAYOUT_TYPES.includes(f.type) &&
              !['file', 'photo', 'agree', 'address_same', 'signature'].includes(f.type) &&
              fieldState(f, data).shown,
          )
          .map((f): [string, string] => [
            f.label.replace(/\s*\(Avoid titles.*\)$/, ''),
            f.type === 'age' ? String(data[f.key] ?? '') : answerText(f, data[f.key]),
          ]),
      }))
      .filter((s) => s.rows.length);
    const docs = def.fields
      .filter((f) => (f.type === 'file' || f.type === 'photo') && fieldState(f, data).shown)
      .map((f): [string, string] => [
        f.label,
        Array.isArray(data[f.key]) && (data[f.key] as string[]).length
          ? 'Attached'
          : 'Not attached',
      ]);
    const sign = def.fields.find((f) => f.type === 'signature');
    const bytes = await applicationPdf({
      school: head,
      logo,
      photo: null,
      // no photo field at all (an old form): the one box as before
      ...(photos.length ? { photos } : {}),
      number: opts.admission
        ? (a.admission_no ?? 'Not yet given')
        : (a.application_no ?? 'Not yet registered'),
      received: opts.admission
        ? ist(a.fee_paid_at ?? new Date())
        : a.submitted_at
          ? ist(a.submitted_at)
          : ist(new Date()),
      post: `${a.class_name} · ${a.cycle_name}`,
      postLine: `Academic year ${a.year_name}${a.category_name ? ` · Category ${a.category_name}` : ''}`,
      sections,
      lists: [],
      interests: [],
      documents: docs,
      declaration: `${def.settings.declaration ?? ''}${sign && data[sign.key] ? `\n\nSigned: ${String(data[sign.key])}` : ''}`,
      kicker: opts.admission ? 'ADMISSION FORM' : 'REGISTRATION FORM FOR ADMISSION TO',
      numberLabel: opts.admission ? 'Admission no.' : 'Registration no.',
      receivedLabel: opts.admission ? 'Admission fee paid' : 'Submitted',
    });
    return {
      filename: opts.admission
        ? `Admission-${(a.admission_no ?? a.id).replace(/\//g, '-')}.pdf`
        : `Registration-${(a.application_no ?? a.id).replace(/\//g, '-')}.pdf`,
      bytes,
    };
  }

  async receiptPdf(c: PoolClient, receiptId: string): Promise<{ filename: string; bytes: Buffer }> {
    const r = await c.query<{
      receipt_no: string;
      received_on: string;
      amount: string;
      mode: string;
      reference: string | null;
      head: string;
      head_code: string;
      application_id: string | null;
      status: string;
      mode_label: string | null;
      instrument_no: string | null;
      instrument_date: string | null;
      bank_name: string | null;
      paid_to_date: string;
    }>(
      `SELECT m.receipt_no, m.received_on::text, m.amount::text, m.mode, m.reference, h.name AS head, h.code AS head_code,
              m.application_id::text, m.status, m.mode_label, m.instrument_no, m.instrument_date::text, m.bank_name,
              (SELECT COALESCE(sum(p.amount), 0) FROM misc_receipts p WHERE p.application_id = m.application_id
                  AND p.head_id = m.head_id AND p.status = 'posted' AND p.id <= m.id)::text AS paid_to_date
         FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id WHERE m.id = $1`,
      [receiptId],
    );
    const x = r.rows[0];
    if (!x || !x.application_id)
      throw new DomainError('not-found', 'Receipt not found', { status: 404 });
    const a = await this.row(c, x.application_id);
    const { head, logo } = await this.school(c);
    const d = x.received_on;
    const bytes = await admissionReceiptPdf({
      school: head,
      logo,
      title: `${x.head} receipt`,
      receiptNo: x.receipt_no,
      date: `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`,
      rows: [
        ['Candidate', a.candidate_name ?? ''],
        ['Class sought', `${a.class_name} (${a.cycle_name})`],
        ['Registration no.', a.application_no ?? 'Given on payment'],
        ['Academic year', a.year_name],
        ['Fee', x.head],
        // the admission fee in parts (docs/design/53): the total, what is paid with this receipt, the balance
        ...(x.head_code === 'ADMFEE' && Number(a.admission_fee ?? 0) > 0
          ? ([
              ['Admission fee (total)', money(Number(a.admission_fee))],
              ['Paid to date', money(Number(x.paid_to_date))],
              ['Balance', money(Math.max(0, Number(a.admission_fee) - Number(x.paid_to_date)))],
            ] as Array<[string, string]>)
          : []),
        [
          'Paid by',
          x.mode === 'online' ? 'Online payment' : (x.mode_label ?? x.mode.toUpperCase()),
        ],
        ...(x.instrument_no
          ? ([
              [
                x.mode === 'dd' ? 'Draft' : 'Cheque',
                [
                  x.instrument_no,
                  x.instrument_date
                    ? `${x.instrument_date.slice(8, 10)}-${x.instrument_date.slice(5, 7)}-${x.instrument_date.slice(0, 4)}`
                    : null,
                  x.bank_name,
                ]
                  .filter(Boolean)
                  .join(' · '),
              ],
            ] as Array<[string, string]>)
          : []),
        ['Reference', x.reference ?? ''],
        [
          'Status',
          x.status === 'reversed' ? 'Reversed' : x.status === 'bounced' ? 'Bounced' : 'Received',
        ],
      ],
      amount: money(Number(x.amount)),
      words: `Rupees ${amountInWords(Number(x.amount)).replace(/\b[a-z]/g, (ch) => ch.toUpperCase())} Only`,
    });
    return { filename: `Receipt-${x.receipt_no.replace(/\//g, '-')}.pdf`, bytes };
  }

  /** A generated PDF kept as a file of the application (attached to emails, opened later). */
  async storePdf(
    c: PoolClient,
    appId: string,
    name: string,
    bytes: Buffer,
  ): Promise<{ fileId: string; name: string } | null> {
    await c.query('SAVEPOINT admission_pdf');
    try {
      const school = await c.query<{ id: string }>(`SELECT app.current_school_id()::text AS id`);
      const key = objectKeyFor(
        school.rows[0]!.id,
        'pdf',
        `admission-${appId}-${randomBytes(6).toString('hex')}`,
      );
      await this.storage.write(key, bytes, 'application/pdf');
      const f = await c.query<{ id: string }>(
        `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, sha256, original_name, owner_entity_type,
                            owner_entity_id, classification, storage_driver, status, scanned_at, scan_result)
         VALUES (app.current_school_id(), $1, $2, 'application/pdf', $3, $4, $5, 'application', $6, 'sensitive', $7, 'ready', now(), 'generated')
         RETURNING id::text`,
        [
          this.storage.bucket,
          key,
          bytes.length,
          createHash('sha256').update(bytes).digest('hex'),
          name,
          appId,
          this.storage.name,
        ],
      );
      await c.query('RELEASE SAVEPOINT admission_pdf');
      return { fileId: f.rows[0]!.id, name };
    } catch (error) {
      await c.query('ROLLBACK TO SAVEPOINT admission_pdf');
      this.log.warn(`admission PDF not kept for ${appId}: ${(error as Error).message}`);
      return null;
    }
  }

  async storeFormPdf(c: PoolClient, a: AppRow) {
    const out = await this.formPdf(c, a);
    const f = await this.storePdf(c, a.id, out.filename, out.bytes);
    if (f)
      await c.query(`UPDATE applications SET pdf_file_id = $2 WHERE id = $1`, [a.id, f.fileId]);
    return f;
  }

  async storeAdmissionFormPdf(c: PoolClient, a: AppRow) {
    const out = await this.formPdf(c, a, { admission: true });
    const f = await this.storePdf(c, a.id, out.filename, out.bytes);
    if (f)
      await c.query(`UPDATE applications SET admission_form_file_id = $2 WHERE id = $1`, [
        a.id,
        f.fileId,
      ]);
    return f;
  }

  async storeReceiptPdf(c: PoolClient, receiptId: string) {
    const out = await this.receiptPdf(c, receiptId);
    const appId = (
      await c.query<{ id: string }>(
        `SELECT application_id::text AS id FROM misc_receipts WHERE id = $1`,
        [receiptId],
      )
    ).rows[0]?.id;
    return appId ? this.storePdf(c, appId, out.filename, out.bytes) : null;
  }

  /** The application as a family or the office sees it: answers (ID numbers shown), fee, receipts. */
  async view(c: PoolClient, a: AppRow, opts: { maskSecrets: boolean }) {
    const def = await this.defOf(c, a);
    const data = this.plainData(def, a.data);
    if (opts.maskSecrets)
      for (const f of def.fields)
        if (isSecret(f) && typeof data[f.key] === 'string' && data[f.key])
          data[f.key] = `XXXX-XXXX-${String(data[f.key]).slice(-4)}`;
    const options = await this.forms.optionsWith(c);
    const fileIds = def.fields
      .filter((f) => f.type === 'file' || f.type === 'photo')
      .flatMap((f) => (Array.isArray(data[f.key]) ? (data[f.key] as string[]) : []));
    const files = fileIds.length
      ? await c.query<{ id: string; original_name: string | null; content_type: string }>(
          `SELECT id::text, original_name, content_type FROM files WHERE id = ANY($1::bigint[])`,
          [fileIds.filter((x) => /^\d{1,18}$/.test(x))],
        )
      : { rows: [] as Array<{ id: string; original_name: string | null; content_type: string }> };
    const receipts = await c.query<{
      id: string;
      receipt_no: string;
      amount: string;
      received_on: string;
      head: string;
      mode: string;
      status: string;
    }>(
      `SELECT m.id::text, m.receipt_no, m.amount::text, m.received_on::text, h.name AS head, m.mode, m.status
         FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id WHERE m.application_id = $1 ORDER BY m.id`,
      [a.id],
    );
    const fee = a.registration_fee !== null ? Number(a.registration_fee) : null;
    return {
      id: a.id,
      number: a.application_no,
      status: a.status,
      session: {
        id: a.cycle_id,
        code: a.cycle_code,
        name: a.cycle_name,
        academicYear: a.year_name,
      },
      class: { id: a.class_id, name: a.class_name },
      candidate: a.candidate_name,
      category: a.category_name,
      progress: a.progress,
      registrationFee: fee,
      feeDue: a.status === 'submitted' && fee !== null && fee > 0 && !a.application_no ? fee : 0,
      submittedAt: a.submitted_at?.toISOString() ?? null,
      registeredAt: a.registered_at?.toISOString() ?? null,
      createdAt: a.created_at.toISOString(),
      enteredByOffice: Boolean(a.entered_by),
      hasPdf: Boolean(a.pdf_file_id) || Boolean(a.application_no),
      def,
      options,
      answers: data,
      files: Object.fromEntries(
        files.rows.map((f) => [
          f.id,
          { fileId: f.id, name: f.original_name, contentType: f.content_type },
        ]),
      ),
      receipts: receipts.rows.map((r) => ({
        id: r.id,
        receiptNo: r.receipt_no,
        amount: Number(r.amount),
        date: r.received_on,
        head: r.head,
        mode: r.mode,
        status: r.status,
      })),
      onlyFields: a.status === 'sent_back' ? await this.correctionFields(c, a.id) : null,
      admissionNo: a.admission_no,
      // the pupil made at Admit (corrections and cancellation then happen on the student page)
      studentId: a.student_id ?? null,
      // the balance after any parts paid at the counter (docs/design/53)
      ...(await (async () => {
        const fee = a.status === 'offered' ? Number(a.admission_fee ?? 0) : 0;
        const { paid } = fee > 0 ? await this.admissionPaid(c, a.id) : { paid: 0 };
        return {
          admissionFeeDue: Math.max(0, Math.round((fee - paid) * 100) / 100),
          admissionFeePaid: paid,
          admissionFee: fee,
        };
      })()),
      offerExpiresAt: a.offer_expires_at?.toISOString() ?? null,
      hasAdmissionForm: Boolean(a.admission_no),
      cancelledAt: a.cancelled_at?.toISOString() ?? null,
      cancelReason: a.cancel_reason,
    };
  }

  /** A pupil found by admission number for the sibling question: first name, last initial, class. */
  async sibling(c: PoolClient, admissionNo: string) {
    const r = await c.query<{ first_name: string; last_name: string | null; cs: string | null }>(
      `SELECT s.first_name, s.last_name,
              (SELECT cl.name || ' ' || sec.name FROM enrolments e JOIN class_sections sec ON sec.id = e.class_section_id JOIN classes cl ON cl.id = sec.class_id
                WHERE e.student_id = s.id AND e.status = 'active' ORDER BY e.id DESC LIMIT 1) AS cs
         FROM students s WHERE upper(s.admission_no) = upper($1) AND s.deleted_at IS NULL AND s.status = 'active' LIMIT 1`,
      [admissionNo.trim()],
    );
    const x = r.rows[0];
    if (!x) return null;
    return {
      name: `${x.first_name}${x.last_name ? ` ${x.last_name.slice(0, 1)}.` : ''}`,
      classSection: x.cs ?? '',
    };
  }

  static istDate = istDate;
}
