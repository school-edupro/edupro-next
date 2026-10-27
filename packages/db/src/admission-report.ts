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
/** The status as the lists say it, by its code (registered → Registered). */
export const ADMISSION_STATUS_BY_CODE: Readonly<Record<string, string>> = STATUS;

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
  // docs/design/57: the written test and the interview, part by part
  { key: 'test_marks', label: 'Written test marks', section: 'record', type: 'number' },
  { key: 'test_percent', label: 'Written test %', section: 'record', type: 'number' },
  { key: 'test_detail', label: 'Written test by subject', section: 'record', type: 'text' },
  { key: 'interview_marks', label: 'Interview marks', section: 'record', type: 'number' },
  { key: 'interview_percent', label: 'Interview %', section: 'record', type: 'number' },
  { key: 'interview_detail', label: 'Interview by parameter', section: 'record', type: 'text' },
  // docs/design/48: the form's points and what the office should look at
  { key: 'form_points', label: 'Form points', section: 'record', type: 'number' },
  { key: 'points_detail', label: 'Points by criterion', section: 'record', type: 'text' },
  { key: 'points_check', label: 'Points to check', section: 'record', type: 'text' },
  // docs/design/50: every level's decision and remark (who, when)
  { key: 'level_remarks', label: 'Decisions and remarks', section: 'record', type: 'text' },
  { key: 'waiting_no', label: 'Waiting list no.', section: 'record', type: 'number' },
  { key: 'registration_fee', label: 'Registration fee', section: 'fees', type: 'number' },
  { key: 'registration_receipt', label: 'Registration receipt', section: 'fees', type: 'text' },
  { key: 'admission_fee', label: 'Admission fee', section: 'fees', type: 'number' },
  { key: 'admission_receipt', label: 'Admission receipt', section: 'fees', type: 'text' },
  // the admission fee in parts (docs/design/53): what is paid so far and the balance
  { key: 'admission_paid', label: 'Admission fee paid', section: 'fees', type: 'number' },
  { key: 'admission_balance', label: 'Admission fee balance', section: 'fees', type: 'number' },
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

/**
 * Every level's latest decision and remark of each registration, as one line (docs/design/50):
 * "Document check · Approval: approved, papers fine (Anita Deshmukh, 26-10) · Level 2: …".
 */
/** The test and interview marks by part of applications (docs/design/57), the stages of a kind added up. */
export async function stageMarks(
  c: PoolClient,
  ids: string[],
): Promise<
  Map<
    string,
    Record<
      'test' | 'interview',
      { total: number | null; max: number; absent: boolean; detail: string }
    >
  >
> {
  const out = new Map<
    string,
    Record<
      'test' | 'interview',
      { total: number | null; max: number; absent: boolean; detail: string }
    >
  >();
  if (!ids.length) return out;
  const r = await c.query<{
    id: string;
    kind: 'test' | 'interview';
    absent: boolean;
    total: string | null;
    max_total: string | null;
    detail: string | null;
  }>(
    `SELECT sm.application_id::text AS id, st.kind, sm.absent, sm.total::text, sm.max_total::text,
            (SELECT string_agg(m.part_name || ' ' || COALESCE(trim_scale(m.marks)::text, '-') || '/' || trim_scale(m.max_marks)::text,
                               ' · ' ORDER BY pp.sort_order, m.id)
               FROM admission_part_marks m JOIN admission_paper_parts pp ON pp.id = m.part_id
              WHERE m.application_id = sm.application_id AND m.stage_id = sm.stage_id) AS detail
       FROM admission_stage_marks sm JOIN admission_stages st ON st.id = sm.stage_id
      WHERE sm.application_id = ANY($1::bigint[]) AND st.kind IN ('test', 'interview') ORDER BY sm.id`,
    [ids],
  );
  for (const x of r.rows) {
    const o =
      out.get(x.id) ??
      ({} as Record<
        'test' | 'interview',
        { total: number | null; max: number; absent: boolean; detail: string }
      >);
    const had = o[x.kind];
    const total = x.total !== null ? Number(x.total) : null;
    o[x.kind] = {
      total: had && had.total !== null ? (total !== null ? had.total + total : had.total) : total,
      max: (had?.max ?? 0) + Number(x.max_total ?? 0),
      absent: (had?.absent ?? true) && x.absent,
      detail: [had?.detail, x.absent ? 'Absent' : (x.detail ?? '')].filter(Boolean).join('; '),
    };
    out.set(x.id, o);
  }
  return out;
}

export async function levelRemarks(c: PoolClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const r = await c.query<{
    id: string;
    stage: string;
    level_name: string | null;
    level: number;
    decision: string;
    remarks: string | null;
    by: string | null;
    at: Date;
  }>(
    `SELECT DISTINCT ON (x.application_id, x.stage_id, x.level)
            x.application_id::text AS id, st.name AS stage, x.level,
            (SELECT s -> 'levels' -> (x.level - 1) ->> 'name' FROM jsonb_array_elements(a.process_steps) s
              WHERE s ->> 'stageId' = x.stage_id::text LIMIT 1) AS level_name,
            x.decision, x.remarks, x.decided_by_name AS by, x.decided_at AS at
       FROM admission_stage_results x JOIN applications a ON a.id = x.application_id
       JOIN admission_stages st ON st.id = x.stage_id
      WHERE x.application_id = ANY($1::bigint[]) AND x.undone_at IS NULL
      ORDER BY x.application_id, x.stage_id, x.level, x.decided_at DESC`,
    [ids],
  );
  const rows = [...r.rows].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const x of rows) {
    const when = day(x.at)?.split('-').reverse().slice(0, 2).join('-') ?? '';
    const part = `${x.stage} · ${x.level_name ?? `Level ${String(x.level)}`}: ${x.decision}${x.remarks ? `, ${x.remarks}` : ''} (${x.by ?? '-'}, ${when})`;
    out.set(x.id, out.has(x.id) ? `${out.get(x.id)!} | ${part}` : part);
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
    form_points: string | null;
    points_lines: Array<{ name: string; points: number; check?: string | null }> | null;
    wait_rank: number | null;
    registration_fee: string | null;
    reg_receipt: string | null;
    admission_fee: string | null;
    adm_receipt: string | null;
    adm_paid: string | null;
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
            a.created_at, a.submitted_at, a.registered_at, a.progress, a.merit::text, a.form_points::text, a.points_breakdown AS points_lines, a.wait_rank, a.registration_fee::text,
            rr.receipt_no AS reg_receipt, a.admission_fee::text, COALESCE(ap2.receipts, ar.receipt_no) AS adm_receipt, ap2.paid::text AS adm_paid,
            a.offer_expires_at, a.fee_paid_at,
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
       LEFT JOIN LATERAL (SELECT sum(m.amount) AS paid, string_agg(m.receipt_no, ', ' ORDER BY m.id) AS receipts
                            FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id
                           WHERE m.application_id = a.id AND h.code = 'ADMFEE' AND m.status = 'posted') ap2 ON true
       LEFT JOIN LATERAL (SELECT x.amount, x.status FROM admission_refunds x WHERE x.application_id = a.id ORDER BY x.id DESC LIMIT 1) rf ON true
      WHERE a.form_id IS NOT NULL AND y.deleted_at IS NULL
      ORDER BY a.id DESC LIMIT $1`,
    [opts.limit ?? 20000],
  );
  const remarks = await levelRemarks(
    c,
    r.rows.map((x) => x.id),
  );
  const deciders = await levelDeciders(
    c,
    r.rows.map((x) => x.level),
  );
  const marks = await stageMarks(
    c,
    r.rows.map((x) => x.id),
  );
  const pct = (m: { total: number | null; max: number } | undefined) =>
    m && m.total !== null && m.max > 0 ? Math.round((m.total / m.max) * 10000) / 100 : null;
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
      form_points: x.form_points !== null ? Number(x.form_points) : null,
      points_detail: x.points_lines?.length
        ? x.points_lines.map((l) => `${l.name} ${String(l.points)}`).join(' · ')
        : null,
      level_remarks: remarks.get(x.id) ?? null,
      points_check: x.points_lines?.some((l) => l.check)
        ? x.points_lines
            .filter((l) => l.check)
            .map((l) => l.check)
            .join('; ')
        : null,
      waiting_no: x.status === 'waitlisted' ? x.wait_rank : null,
      test_marks: marks.get(x.id)?.test?.total ?? null,
      test_percent: pct(marks.get(x.id)?.test),
      test_detail: marks.get(x.id)?.test?.detail || null,
      interview_marks: marks.get(x.id)?.interview?.total ?? null,
      interview_percent: pct(marks.get(x.id)?.interview),
      interview_detail: marks.get(x.id)?.interview?.detail || null,
      registration_fee: x.registration_fee !== null ? Number(x.registration_fee) : null,
      registration_receipt: x.reg_receipt,
      admission_fee: x.admission_fee !== null ? Number(x.admission_fee) : null,
      admission_receipt: x.adm_receipt,
      admission_paid: x.adm_paid !== null ? Number(x.adm_paid) : null,
      admission_balance:
        x.admission_fee !== null && ['offered', 'fee_paid', 'admitted'].includes(x.status)
          ? Math.max(0, Number(x.admission_fee) - Number(x.adm_paid ?? 0))
          : null,
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
