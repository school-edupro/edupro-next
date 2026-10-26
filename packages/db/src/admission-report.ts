import type { PoolClient } from 'pg';
import {
  answerText,
  fieldState,
  isEmptyAnswer,
  LAYOUT_TYPES,
  type AdmissionAnswers,
  type AdmissionField,
  type AdmissionFormDef,
} from './admission-engine';
import { ADMISSION_FORM_TEMPLATES } from './admission-form-templates';
import { decryptField } from './field-crypto';
import type { ReportFieldDef, ReportRow } from './report-builder';

/*
 * The Admissions dataset of the list and the report builder (docs/design/39, part 7): one row per
 * registration with its session, class, status, stage, category, fees, receipts, admission number,
 * section and cancellation, plus the answers of the ready forms' questions (custom questions of a
 * school's own form show through the form's PDF).
 */

const STATUS: Record<string, string> = {
  draft: 'Form not submitted',
  submitted: 'Registration fee due',
  registered: 'Registered',
  under_review: 'Under review',
  sent_back: 'Correction asked',
  shortlisted: 'Shortlisted',
  selected: 'Selected',
  waitlisted: 'Waiting list',
  offered: 'Offered',
  fee_paid: 'Admission fee paid',
  admitted: 'Admitted',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
};
export const ADMISSION_STATUS_LABELS = Object.values(STATUS);

const RECORD: ReportFieldDef[] = [
  { key: 'registration_no', label: 'Registration no.', section: 'record', type: 'text' },
  { key: 'candidate', label: 'Candidate', section: 'record', type: 'text' },
  { key: 'session', label: 'Admission session', section: 'record', type: 'text' },
  { key: 'academic_year', label: 'Academic year', section: 'record', type: 'text' },
  { key: 'class_sought', label: 'Class sought', section: 'record', type: 'text' },
  { key: 'status', label: 'Status', section: 'record', type: 'text' },
  { key: 'stage', label: 'Waiting at', section: 'record', type: 'text' },
  { key: 'level', label: 'Level', section: 'record', type: 'text' },
  { key: 'level_name', label: 'Level name', section: 'record', type: 'text' },
  { key: 'deciders', label: 'Who decides', section: 'record', type: 'text' },
  { key: 'waiting_since', label: 'Waiting since', section: 'record', type: 'date' },
  { key: 'days_waiting', label: 'Days waiting', section: 'record', type: 'number' },
  { key: 'due_on', label: 'Decide by', section: 'record', type: 'date' },
  { key: 'overdue', label: 'Overdue', section: 'record', type: 'text' },
  { key: 'category', label: 'Fee category', section: 'record', type: 'text' },
  { key: 'entered_at', label: 'Registered at', section: 'record', type: 'text' },
  { key: 'mobile', label: 'Mobile', section: 'record', type: 'text' },
  { key: 'email', label: 'Email', section: 'record', type: 'text' },
  { key: 'started_on', label: 'Form started', section: 'record', type: 'date' },
  { key: 'submitted_on', label: 'Form submitted', section: 'record', type: 'date' },
  { key: 'registered_on', label: 'Registered on', section: 'record', type: 'date' },
  { key: 'progress', label: 'Form filled (%)', section: 'record', type: 'number' },
  { key: 'merit', label: 'Merit (marks)', section: 'record', type: 'number' },
  { key: 'waiting_no', label: 'Waiting list no.', section: 'record', type: 'number' },
  { key: 'registration_fee', label: 'Registration fee', section: 'fees', type: 'number' },
  { key: 'registration_receipt', label: 'Registration receipt', section: 'fees', type: 'text' },
  { key: 'admission_fee', label: 'Admission fee', section: 'fees', type: 'number' },
  { key: 'admission_receipt', label: 'Admission receipt', section: 'fees', type: 'text' },
  { key: 'offer_last_date', label: 'Offer: pay by', section: 'fees', type: 'date' },
  { key: 'fee_paid_on', label: 'Admission fee paid on', section: 'fees', type: 'date' },
  { key: 'refund', label: 'Refund', section: 'fees', type: 'number' },
  { key: 'refund_status', label: 'Refund status', section: 'fees', type: 'text' },
  { key: 'admission_no', label: 'Admission no.', section: 'admission', type: 'text' },
  { key: 'class_section', label: 'Class-section', section: 'admission', type: 'text' },
  { key: 'admitted_on', label: 'Admitted on', section: 'admission', type: 'date' },
  { key: 'cancelled_on', label: 'Cancelled on', section: 'admission', type: 'date' },
  { key: 'cancel_reason', label: 'Cancellation reason', section: 'admission', type: 'text' },
];

const SECRET = (f: AdmissionField) =>
  ['aadhaar', 'apaar', 'pen'].includes(f.preset ?? '') ||
  ['aadhaar_no', 'apaar_id', 'pen_no'].includes(f.maps ?? '');

/** The ready forms' questions, once each, as `f_<key>` columns. */
const FORM_FIELDS: Array<{ def: ReportFieldDef; field: AdmissionField }> = (() => {
  const seen = new Map<string, { def: ReportFieldDef; field: AdmissionField }>();
  for (const t of ADMISSION_FORM_TEMPLATES)
    for (const f of t.def.fields) {
      if (
        LAYOUT_TYPES.includes(f.type) ||
        ['file', 'photo', 'agree', 'address_same', 'signature'].includes(f.type)
      )
        continue;
      if (seen.has(f.key)) continue;
      seen.set(f.key, {
        field: f,
        def: {
          key: `f_${f.key}`,
          label: f.label.replace(/\s*\(Avoid titles.*\)$/, ''),
          section: 'form',
          type:
            f.type === 'date'
              ? 'date'
              : f.type === 'number' || f.type === 'age'
                ? 'number'
                : 'text',
          list: f.list ?? null,
          sensitive: SECRET(f),
        },
      });
    }
  return [...seen.values()];
})();

export const ADMISSION_REPORT_SECTIONS: ReadonlyArray<{ id: string; title: string }> = [
  { id: 'record', title: 'Registration' },
  { id: 'fees', title: 'Fees and offer' },
  { id: 'admission', title: 'Admission' },
  { id: 'form', title: 'Form answers' },
];
export const ADMISSION_REPORT_FIELDS: ReportFieldDef[] = [
  ...RECORD,
  ...FORM_FIELDS.map((x) => x.def),
];
export const ADMISSION_SEARCH_KEYS = [
  'registration_no',
  'candidate',
  'mobile',
  'email',
  'admission_no',
];

const day = (d: Date | null) =>
  d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10) : null;

/**
 * Who may decide at each level (docs/design/47): the names behind `app.admission_level_users`, keyed by
 * the level's JSON; "anyone" levels say so instead of naming everyone with the decide right.
 */
export async function levelDeciders(
  c: PoolClient,
  levels: Array<Record<string, unknown> | null>,
): Promise<Map<string, string>> {
  const keys = [...new Set(levels.filter((l) => l !== null).map((l) => JSON.stringify(l)))];
  const out = new Map<string, string>();
  if (!keys.length) return out;
  const r = await c.query<{ level: string; names: string[] | null }>(
    `SELECT l AS level, (SELECT array_agg(u.display_name ORDER BY u.display_name)
                           FROM app.admission_level_users(l::jsonb) x JOIN users u ON u.id = x) AS names
       FROM unnest($1::text[]) l`,
    [keys],
  );
  for (const x of r.rows) {
    const by = (JSON.parse(x.level) as { by?: string }).by;
    const names = x.names ?? [];
    out.set(
      x.level,
      !names.length
        ? 'Nobody yet (set-up managers only)'
        : by === 'anyone'
          ? 'Anyone who may decide'
          : names.length > 4
            ? `${names.slice(0, 4).join(', ')} +${String(names.length - 4)}`
            : names.join(', '),
    );
  }
  return out;
}

/** The registrations waiting now at a level this user may decide (docs/design/47). */
export async function admissionWaitingFor(c: PoolClient, userId: string): Promise<Set<string>> {
  const r = await c.query<{ id: string }>(
    `WITH lv AS (SELECT DISTINCT level FROM admission_waiting WHERE level IS NOT NULL)
     SELECT w.id::text FROM admission_waiting w JOIN lv ON lv.level = w.level
      WHERE $1::bigint IN (SELECT app.admission_level_users(lv.level))`,
    [userId],
  );
  return new Set(r.rows.map((x) => x.id));
}

/** One row per registration (drafts included), ID numbers masked unless allowed. */
export async function loadAdmissionReportRows(
  c: PoolClient,
  opts: { showSensitive: boolean; limit?: number },
): Promise<ReportRow[]> {
  const r = await c.query<{
    id: string;
    number: string | null;
    candidate: string | null;
    session: string;
    year: string;
    class_name: string;
    status: string;
    stage: string | null;
    level_no: number | null;
    levels: number | null;
    level: Record<string, unknown> | null;
    level_since: Date | null;
    due_at: Date | null;
    category: string | null;
    entered_by: string | null;
    mobile: string | null;
    email: string | null;
    created_at: Date;
    submitted_at: Date | null;
    registered_at: Date | null;
    progress: number;
    merit: string | null;
    wait_rank: number | null;
    registration_fee: string | null;
    reg_receipt: string | null;
    admission_fee: string | null;
    adm_receipt: string | null;
    offer_expires_at: Date | null;
    fee_paid_at: Date | null;
    refund: string | null;
    refund_status: string | null;
    admission_no: string | null;
    class_section: string | null;
    admitted_at: Date | null;
    cancelled_at: Date | null;
    cancel_reason: string | null;
    data: AdmissionAnswers;
    snapshot: AdmissionFormDef | null;
  }>(
    `SELECT a.id::text, a.application_no AS number, a.candidate_name AS candidate, y.name AS session, ay.name AS year, cl.name AS class_name,
            a.status::text, CASE WHEN a.status::text IN ('registered', 'under_review', 'sent_back') THEN st.name END AS stage,
            w.level_no, w.levels, w.level, w.level_since, w.due_at,
            k.name AS category, a.entered_by::text, COALESCE(a.contact_mobile, ap.mobile) AS mobile, COALESCE(a.contact_email, ap.email::text) AS email,
            a.created_at, a.submitted_at, a.registered_at, a.progress, a.merit::text, a.wait_rank, a.registration_fee::text,
            rr.receipt_no AS reg_receipt, a.admission_fee::text, ar.receipt_no AS adm_receipt, a.offer_expires_at, a.fee_paid_at,
            rf.amount::text AS refund, rf.status AS refund_status, a.admission_no,
            (SELECT c2.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes c2 ON c2.id = cs.class_id
              WHERE e.student_id = a.student_id AND e.academic_year_id = y.academic_year_id ORDER BY e.id DESC LIMIT 1) AS class_section,
            a.admitted_at, a.cancelled_at, a.cancel_reason, a.data, COALESCE(a.form_snapshot, f.def) AS snapshot
       FROM applications a JOIN admission_cycles y ON y.id = a.cycle_id JOIN academic_years ay ON ay.id = y.academic_year_id
       JOIN classes cl ON cl.id = a.class_id JOIN applicants ap ON ap.id = a.applicant_id
       LEFT JOIN admission_forms f ON f.id = a.form_id
       LEFT JOIN admission_fee_categories k ON k.id = a.category_id
       LEFT JOIN admission_stages st ON st.id = (a.process_steps -> a.stage_no ->> 'stageId')::bigint
       LEFT JOIN admission_waiting w ON w.id = a.id
       LEFT JOIN misc_receipts rr ON rr.id = a.registration_receipt_id
       LEFT JOIN misc_receipts ar ON ar.id = a.admission_receipt_id
       LEFT JOIN LATERAL (SELECT x.amount, x.status FROM admission_refunds x WHERE x.application_id = a.id ORDER BY x.id DESC LIMIT 1) rf ON true
      WHERE a.form_id IS NOT NULL AND y.deleted_at IS NULL
      ORDER BY a.id DESC LIMIT $1`,
    [opts.limit ?? 20000],
  );
  const deciders = await levelDeciders(
    c,
    r.rows.map((x) => x.level),
  );
  const now = Date.now();
  return r.rows.map((x) => {
    const waiting = x.level !== null;
    const row: ReportRow = {
      __id: x.id,
      registration_no: x.number,
      candidate: x.candidate,
      session: x.session,
      academic_year: x.year,
      class_sought: x.class_name,
      status: STATUS[x.status] ?? x.status,
      stage: x.stage,
      level: waiting && x.levels ? `${String(x.level_no)} of ${String(x.levels)}` : null,
      level_name: waiting ? String(x.level?.name ?? '') || null : null,
      deciders: waiting ? (deciders.get(JSON.stringify(x.level)) ?? null) : null,
      waiting_since: waiting ? day(x.level_since) : null,
      // calendar days in India since the registration reached its level (today: 0)
      days_waiting:
        waiting && x.level_since
          ? Math.max(
              0,
              Math.round(
                (Date.parse(day(new Date(now))!) - Date.parse(day(x.level_since)!)) / 86_400_000,
              ),
            )
          : null,
      due_on: waiting ? day(x.due_at) : null,
      overdue: waiting ? (x.due_at && x.due_at.getTime() < now ? 'Yes' : 'No') : null,
      category: x.category,
      entered_at: x.entered_by ? 'School desk' : 'Online',
      mobile: x.mobile,
      email: x.email,
      started_on: day(x.created_at),
      submitted_on: day(x.submitted_at),
      registered_on: day(x.registered_at),
      progress: x.progress,
      merit: x.merit !== null ? Number(x.merit) : null,
      waiting_no: x.status === 'waitlisted' ? x.wait_rank : null,
      registration_fee: x.registration_fee !== null ? Number(x.registration_fee) : null,
      registration_receipt: x.reg_receipt,
      admission_fee: x.admission_fee !== null ? Number(x.admission_fee) : null,
      admission_receipt: x.adm_receipt,
      offer_last_date: x.status === 'offered' ? day(x.offer_expires_at) : null,
      fee_paid_on: day(x.fee_paid_at),
      refund: x.refund !== null ? Number(x.refund) : null,
      refund_status: x.refund_status,
      admission_no: x.admission_no,
      class_section: x.class_section,
      admitted_on: day(x.admitted_at),
      cancelled_on: day(x.cancelled_at),
      cancel_reason: x.cancel_reason,
    };
    const data = x.data ?? {};
    const own = new Map((x.snapshot?.fields ?? []).map((f) => [f.key, f]));
    for (const { def, field } of FORM_FIELDS) {
      const f = own.get(field.key) ?? field;
      let v = data[f.key];
      if (typeof v === 'string' && v.startsWith('enc:')) {
        try {
          v = decryptField(v.slice(4));
        } catch {
          v = null;
        }
      }
      if (isEmptyAnswer(v) || !fieldState(f, data).shown) {
        row[def.key] = null;
        continue;
      }
      if (def.sensitive && !opts.showSensitive && typeof v === 'string') {
        row[def.key] = `XXXX-XXXX-${v.slice(-4)}`;
        continue;
      }
      const text = answerText(f, v);
      row[def.key] =
        def.type === 'number'
          ? Number.isFinite(Number(text))
            ? Number(text)
            : null
          : text || null;
    }
    return row;
  });
}
