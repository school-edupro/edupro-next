import type { PoolClient } from '@edupro/db';
import { answerText, LAYOUT, type Answers, type Field } from './consent-fields';

/**
 * What leaves the school about one answer (docs/design/28-consent-forms.md, part 4): the same shape in
 * a webhook message and in the API. Only the answer itself: the number, who it is about (a pupil's name,
 * admission number and class; a staff member's name and code; an outsider's name with the contact
 * masked), the answers by question, the status and the fee. Files and signatures go out as names only;
 * nothing else of the pupil's profile.
 */
export type ConsentEvent = 'submitted' | 'changed' | 'approved' | 'rejected' | 'paid';

const mask = (s: string | null) =>
  !s
    ? null
    : s.includes('@')
      ? `${s.slice(0, 2)}***${s.slice(s.indexOf('@'))}`
      : `******${s.slice(-4)}`;

export async function responsePayload(c: PoolClient, rid: string) {
  const r = await c.query<{
    id: string;
    number: string;
    form_id: string;
    code: string;
    title: string;
    fields: Field[];
    respondent: string;
    via_link: boolean;
    status: string;
    waiting: boolean;
    answers: Answers;
    files: Array<{ fileId: string; name: string | null }>;
    signed_at: Date;
    edited_at: Date | null;
    decided_at: Date | null;
    decided_note: string | null;
    fee: string;
    paid: string | null;
    student: string | null;
    admission_no: string | null;
    section: string | null;
    employee: string | null;
    employee_code: string | null;
    public_name: string | null;
    public_mobile: string | null;
    public_email: string | null;
  }>(
    `SELECT x.id::text, x.number, x.form_id::text, f.code, f.title, f.fields, x.respondent, x.via_link, x.status, x.answers, x.files,
            EXISTS (SELECT 1 FROM workflow_instances wi WHERE wi.id = x.instance_id AND wi.status = 'pending') AS waiting,
            x.signed_at, x.edited_at, x.decided_at, x.decided_note, x.fee_amount::text AS fee, l.paid::text AS paid,
            s.display_name AS student, s.admission_no,
            (SELECT k.name || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
              WHERE e.student_id = x.student_id AND e.status = 'active' ORDER BY e.academic_year_id DESC LIMIT 1) AS section,
            em.display_name AS employee, em.employee_code, x.public_name, x.public_mobile, x.public_email
       FROM consent_form_responses x JOIN consent_forms f ON f.id = x.form_id
       LEFT JOIN students s ON s.id = x.student_id LEFT JOIN employees em ON em.id = x.employee_id
       LEFT JOIN misc_fee_students l ON l.id = x.misc_line_id
      WHERE x.id = $1`,
    [rid],
  );
  const x = r.rows[0];
  if (!x) return null;
  const answers: Record<string, string | number | boolean | string[] | null> = {};
  for (const f of x.fields) {
    if (LAYOUT.includes(f.type)) continue;
    const v = x.answers[f.key];
    if (v === undefined) continue;
    if (f.type === 'file')
      answers[f.key] = (Array.isArray(v) ? v : []).map(
        (id) => x.files.find((y) => y.fileId === id)?.name ?? 'file',
      );
    else if (f.type === 'signature') answers[f.key] = answerText(f, v);
    else answers[f.key] = v;
  }
  return {
    form: { id: x.form_id, code: x.code, title: x.title },
    response: {
      id: x.id,
      number: x.number,
      status: x.waiting ? 'waiting' : x.status === 'submitted' ? 'answered' : x.status,
      respondent: x.respondent,
      viaLink: x.via_link,
      submittedAt: x.signed_at,
      changedAt: x.edited_at,
      decidedAt: x.decided_at,
      decisionNote: x.decided_note,
      about: x.student
        ? { kind: 'pupil', name: x.student, admissionNo: x.admission_no, class: x.section }
        : x.employee
          ? { kind: 'staff', name: x.employee, code: x.employee_code }
          : {
              kind: 'outsider',
              name: x.public_name,
              contact: mask(x.public_mobile ?? x.public_email),
            },
      questions: x.fields
        .filter((f) => !LAYOUT.includes(f.type))
        .map((f) => ({ key: f.key, label: f.label, type: f.type })),
      answers,
      fee:
        Number(x.fee) > 0
          ? { amount: Number(x.fee), paid: x.paid === null ? null : Number(x.paid) }
          : null,
    },
  };
}

/** Queues the event for every active webhook of the form that listens to it (the workers deliver). */
export async function emitConsentEvent(c: PoolClient, rid: string, event: ConsentEvent) {
  const hooks = await c.query<{ id: string }>(
    `SELECT w.id::text FROM consent_webhooks w JOIN consent_form_responses x ON x.form_id = w.form_id
      WHERE x.id = $1 AND w.active AND w.deleted_at IS NULL AND $2 = ANY(w.events)`,
    [rid, event],
  );
  if (!hooks.rows.length) return 0;
  const body = await responsePayload(c, rid);
  if (!body) return 0;
  for (const h of hooks.rows)
    await c.query(
      `INSERT INTO consent_webhook_deliveries (school_id, webhook_id, response_id, event, payload)
       VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb)`,
      [h.id, rid, event, JSON.stringify({ event, sentAt: new Date().toISOString(), ...body })],
    );
  return hooks.rows.length;
}
