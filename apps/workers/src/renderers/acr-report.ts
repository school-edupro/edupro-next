import { tenantForJob, type Db, type JobEnvelope } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { istStamp, letterhead, type Letterhead } from './report-builder';

/**
 * The annual confidential report printout (A4, docs/design/32-employee-acr.md): one ACR, or every ACR
 * shown on the board, each on its own pages on the school letterhead. The employee's facts, the
 * self-appraisal with its answers and section scores, each level's answers, score, grade and remarks
 * (a skipped level with its note), the result, the steps, and the signature lines. Everything printed
 * is what the ACR holds; nothing is recomputed from the records.
 */

type Answer = number | string | string[] | null;
interface Q {
  id: string;
  form_id: string;
  section: string;
  section_id: string | null;
  section_weight: string;
  text: string;
  kind: 'scale' | 'text' | 'yesno' | 'file';
  weight: string;
}
/** A file attached to an answer (0194): an image as a data address, a PDF as a note. */
interface Attachment {
  id: string;
  content_type: string | null;
  object_key: string | null;
  uri: string | null;
}
interface Review {
  report_id: string;
  seq: number;
  label: string;
  action: 'rate' | 'review';
  status: 'waiting' | 'pending' | 'done' | 'skipped';
  people: string[] | null;
  answers: Record<string, Answer>;
  remarks: string | null;
  score_pct: string | null;
  grade: string | null;
  grade_reason: string | null;
  filled_by: string | null;
  filled_by_name: string | null;
  filled_at: Date | null;
  skipped_note: string | null;
  form_id: string | null;
  form_name: string | null;
}
/** Who signs a line: the employee or the person who filled a level, with their signature on file. */
interface Signer {
  id: string;
  user_id: string | null;
  name: string;
  code: string;
  designation: string | null;
  object_key: string | null;
  content_type: string | null;
}
interface Report {
  id: string;
  staff_group: string;
  status: string;
  self_answers: Record<string, Answer>;
  auto_facts: Record<string, unknown> | null;
  office_facts: Record<string, unknown> | null;
  self_pct: string | null;
  self_submitted_at: Date | null;
  self_form_id: string | null;
  self_form: string | null;
  score_pct: string | null;
  grade: string | null;
  adverse: boolean;
  disclosed_at: Date | null;
  object_by: string | null;
  acknowledged_at: Date | null;
  representation: string | null;
  represented_at: Date | null;
  decision: string | null;
  decision_note: string | null;
  decided_at: Date | null;
  closed_at: Date | null;
  employee_id: string;
  name: string;
  code: string;
  designation: string | null;
  department: string | null;
  joined_on: string | null;
  staff_type: string | null;
  profile: Record<string, unknown>;
  cycle: string;
  year: string;
}
interface Row {
  employee_id: string;
  [k: string]: string | number | boolean | null;
}
interface Ev {
  report_id: string;
  at: Date;
  what: string;
  note: string | null;
  by_name: string | null;
}

async function imageUri(storage: StorageDriver, key: string | null, type: string | null) {
  if (!key || !type || !/^image\/(png|jpe?g|webp)$/.test(type)) return null;
  try {
    const bytes = await storage.read(key);
    return bytes.length <= 2 * 1024 * 1024
      ? `data:${type};base64,${bytes.toString('base64')}`
      : null;
  } catch {
    return null;
  }
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const t = (x: unknown) => esc(x === null || x === undefined ? '' : String(x));
const dmy = (s: string | Date | null | undefined) => {
  if (!s) return '';
  const d = s instanceof Date ? s.toISOString() : s;
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : d;
};
const pct = (n: number) => Math.round(n * 100) / 100;
const num = (s: string | null) => (s === null ? null : Number(s));

const STATUS_WORD: Record<string, string> = {
  self: 'Self-appraisal with the employee',
  review: 'With the levels',
  disclosed: 'Shown to the employee',
  represented: 'Objection with the school',
  closed: 'Final',
};
const LEVEL_WORD: Record<Review['status'], string> = {
  waiting: 'Not yet',
  pending: 'With them now',
  done: 'Filled',
  skipped: 'Skipped',
};
const EVENT_WORD: Record<string, string> = {
  started: 'ACR started',
  self_submitted: 'Self-appraisal submitted',
  level_submitted: 'Level filled',
  returned: 'Sent back',
  returned_to_employee: 'Sent back to the employee',
  reviewers_changed: 'People of a level changed',
  disclosed: 'Shown to the employee',
  acknowledged: 'Acknowledged by the employee',
  represented: 'Objection made',
  decided: 'Decided by the school',
  closed: 'Closed',
};
const eventWord = (w: string) =>
  EVENT_WORD[w] ?? w.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** A rating as "3 · Good" on the scale (the first word is the top), yes / no, or the text. */
function answerText(q: Q, a: Answer, scale: string[]): string {
  if (a === null || a === undefined || a === '') return '—';
  if (Array.isArray(a)) return a.length ? `${String(a.length)} attached` : '—';
  if (q.kind === 'scale' && typeof a === 'number')
    return `${String(a)} · ${scale[scale.length - a] ?? ''}`;
  if (q.kind === 'yesno') return a === 'yes' ? 'Yes' : a === 'no' ? 'No' : String(a);
  return String(a);
}

/** Weighted ratings as % of the top of the scale, by section (as the API scores them). */
function sectionScores(qs: Q[], answers: Record<string, Answer>, top: number) {
  const secs: Array<{ key: string; title: string; weight: number; got: number; max: number }> = [];
  for (const q of qs) {
    const key = q.section_id ?? q.section;
    let sec = secs.find((x) => x.key === key);
    if (!sec) {
      sec = { key, title: q.section, weight: Number(q.section_weight), got: 0, max: 0 };
      secs.push(sec);
    }
    const a = answers[q.id];
    if (q.kind !== 'scale' || typeof a !== 'number') continue;
    sec.got += a * Number(q.weight);
    sec.max += top * Number(q.weight);
  }
  return secs.map((x) => ({
    key: x.key,
    title: x.title,
    pct: x.max ? pct((x.got / x.max) * 100) : null,
  }));
}

/** A form's answers as one table per section, with the section score beside its title. */
function answersHtml(
  qs: Q[],
  answers: Record<string, Answer>,
  scale: string[],
  att: Map<string, Attachment>,
): string {
  if (!qs.length) return '<p class="muted">No questions on this form.</p>';
  const scores = sectionScores(qs, answers, scale.length);
  // the files attached to an answer: images small, a PDF as a note
  const files = (a: Answer) =>
    Array.isArray(a) && a.length
      ? `<div class="att">${a
          .map((id) => {
            const f = att.get(id);
            if (f?.uri) return `<img src="${f.uri}" alt="" />`;
            return `<span class="chip">${f?.content_type === 'application/pdf' ? 'PDF attached' : 'File attached'}</span>`;
          })
          .join('')}</div>`
      : '';
  return scores
    .map((sec) => {
      const rows = qs
        .filter((q) => (q.section_id ?? q.section) === sec.key)
        .map(
          (q) =>
            `<tr><td>${esc(q.text)}${q.kind === 'file' ? files(answers[q.id] ?? null) : ''}</td><td class="ans">${esc(answerText(q, answers[q.id] ?? null, scale))}</td></tr>`,
        )
        .join('');
      return `<table class="qa"><thead><tr><th>${esc(sec.title)}</th><th class="ans">${
        sec.pct === null ? '' : `${String(sec.pct)}%`
      }</th></tr></thead><tbody>${rows}</tbody></table>`;
    })
    .join('');
}

export async function renderAcrReport(
  db: Db,
  storage: StorageDriver,
  envelope: JobEnvelope,
  params: Record<string, unknown>,
): Promise<{ html: string; width: string; height: string; count: number }> {
  const ids = String(params.reportIds ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => /^\d{1,18}$/.test(x))
    .slice(0, 100);
  if (!ids.length) throw new Error('reportIds is required');
  const tenant = tenantForJob(envelope);
  const data = await db.withTenant(tenant, async (c) => {
    // the person who asked must still be allowed to see ACRs (the API checked when queuing)
    if (envelope.userId) {
      const perm = await c.query(
        `SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
          WHERE ur.user_id = $1 AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE
            AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE) AND rp.permission_code = 'people.acr.view'
          LIMIT 1`,
        [envelope.userId],
      );
      if (!perm.rowCount) throw new Error('the requester may not see ACRs');
    }
    const reports = (
      await c.query<Report>(
        `SELECT r.id::text, r.employee_id::text, r.staff_group, r.status, r.self_answers, r.auto_facts, r.office_facts,
                r.self_pct::text, r.self_submitted_at, r.self_form_id::text, sf.name AS self_form,
                r.score_pct::text, r.grade, r.adverse, r.disclosed_at, r.object_by::text, r.acknowledged_at,
                r.representation, r.represented_at, r.decision, r.decision_note, r.decided_at, r.closed_at,
                e.display_name AS name, e.employee_code AS code, e.designation, e.department, e.joined_on::text,
                e.profile->>'staff_type' AS staff_type, e.profile, cy.name AS cycle, y.code AS year
           FROM acr_reports r
           JOIN employees e ON e.id = r.employee_id
           JOIN acr_cycles cy ON cy.id = r.cycle_id
           JOIN academic_years y ON y.id = cy.academic_year_id
           LEFT JOIN acr_forms sf ON sf.id = r.self_form_id
          WHERE r.id = ANY($1::bigint[]) ORDER BY e.display_name, r.id`,
        [ids],
      )
    ).rows;
    if (reports.length !== new Set(ids).size) throw new Error('ACR not found');
    const reviews = (
      await c.query<Review>(
        `SELECT v.report_id::text, v.seq, v.label, v.action, v.status, v.answers, v.remarks, v.score_pct::text,
                v.grade, v.grade_reason, v.filled_by::text, v.filled_by_name, v.filled_at, v.skipped_note, v.form_id::text, f.name AS form_name,
                (SELECT array_agg(x.display_name || ' (' || x.employee_code || ')' ORDER BY x.display_name)
                   FROM employees x WHERE x.id = ANY(v.reviewer_ids)) AS people
           FROM acr_reviews v LEFT JOIN acr_forms f ON f.id = v.form_id
          WHERE v.report_id = ANY($1::bigint[]) ORDER BY v.report_id, v.seq`,
        [ids],
      )
    ).rows;
    const formIds = [
      ...new Set(
        [...reports.map((r) => r.self_form_id), ...reviews.map((v) => v.form_id)].filter(
          (x): x is string => !!x,
        ),
      ),
    ];
    const questions = formIds.length
      ? (
          await c.query<Q>(
            `SELECT q.id::text, q.form_id::text, COALESCE(s.title, q.section) AS section, q.section_id::text,
                    COALESCE(s.weight, 1)::text AS section_weight, q.text, q.kind, q.weight::text
               FROM acr_questions q LEFT JOIN acr_form_sections s ON s.id = q.section_id
              WHERE q.form_id = ANY($1::bigint[]) AND q.active
              ORDER BY q.form_id, s.sort_order NULLS LAST, s.id, q.sort_order, q.id`,
            [formIds],
          )
        ).rows
      : [];
    const settings = await c.query<{ scale_labels: string[] }>(
      'SELECT scale_labels FROM acr_settings',
    );
    const events = (
      await c.query<Ev>(
        `SELECT report_id::text, at, what, note, by_name FROM acr_events WHERE report_id = ANY($1::bigint[]) ORDER BY at, id`,
        [ids],
      )
    ).rows;
    // the employee's record (20 Oct 2026): education, experience, training, documents on file
    const empIds = [...new Set(reports.map((r) => r.employee_id))];
    const rowsOf = async (sql: string) => (await c.query<Row>(sql, [empIds])).rows;
    const education = await rowsOf(
      `SELECT employee_id::text, qualification, specialisation, institution, passing_year, score::text, mode
         FROM employee_education WHERE employee_id = ANY($1::bigint[]) ORDER BY passing_year NULLS LAST, id`,
    );
    const experience = await rowsOf(
      `SELECT employee_id::text, organisation, designation, from_on::text, to_on::text, reason
         FROM employee_experience WHERE employee_id = ANY($1::bigint[]) ORDER BY from_on NULLS LAST, id`,
    );
    const training = await rowsOf(
      `SELECT employee_id::text, trained_on::text, topic, venue, duration, organisation
         FROM employee_training WHERE employee_id = ANY($1::bigint[]) ORDER BY trained_on DESC, id`,
    );
    const documents = await rowsOf(
      `SELECT d.employee_id::text, t.name, d.issued_on::text, d.expires_on::text, d.verified_at IS NOT NULL AS verified
         FROM employee_documents d JOIN employee_document_types t ON t.id = d.type_id
        WHERE d.employee_id = ANY($1::bigint[]) AND d.deleted_at IS NULL ORDER BY t.sort_order, t.name, d.id`,
    );
    // who signs: the employees, and the people who filled a level (by their login), with signatures
    const signerUsers = [
      ...new Set(reviews.map((v) => v.filled_by).filter((x): x is string => !!x)),
    ];
    const signers = (
      await c.query<Signer>(
        `SELECT e.id::text, e.user_id::text, e.display_name AS name, e.employee_code AS code, e.designation,
                f.object_key, f.content_type
           FROM employees e LEFT JOIN files f ON f.id = e.signature_file_id AND f.status = 'ready'
          WHERE e.id = ANY($1::bigint[]) OR e.user_id = ANY($2::bigint[])`,
        [empIds, signerUsers],
      )
    ).rows;
    // the files attached to answers (0194)
    const fileIds = [
      ...new Set(
        [...reports.map((r) => r.self_answers), ...reviews.map((v) => v.answers)].flatMap((a) =>
          Object.values(a).flatMap((x) => (Array.isArray(x) ? x : [])),
        ),
      ),
    ];
    const attachments = fileIds.length
      ? (
          await c.query<{ id: string; content_type: string | null; object_key: string | null }>(
            `SELECT id::text, content_type, object_key FROM files WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL AND status = 'ready'`,
            [fileIds],
          )
        ).rows
      : [];
    return {
      reports,
      reviews,
      questions,
      events,
      signers,
      attachments,
      education,
      experience,
      training,
      documents,
      scale: settings.rows[0]?.scale_labels ?? [
        'Outstanding',
        'Very good',
        'Good',
        'Average',
        'Below average',
      ],
    };
  });
  const lh: Letterhead = await letterhead(db, storage, tenant);
  const stamp = istStamp(new Date());
  const sigOf = new Map<string, string>();
  for (const x of data.signers) {
    const uri = await imageUri(storage, x.object_key, x.content_type);
    if (uri) sigOf.set(x.id, uri);
  }
  const attached = new Map<string, Attachment>();
  for (const f of data.attachments.slice(0, 60))
    attached.set(f.id, { ...f, uri: await imageUri(storage, f.object_key, f.content_type) });
  const qsOf = (formId: string | null) =>
    formId ? data.questions.filter((q) => q.form_id === formId) : [];

  const article = (r: Report, last: boolean) => {
    const levels = data.reviews.filter((v) => v.report_id === r.id);
    const events = data.events.filter((e) => e.report_id === r.id);
    const facts: Array<[string, string]> = [
      ['Employee code', t(r.code)],
      ['Designation', t(r.designation)],
      ['Department', t(r.department)],
      ['Employee type', t(r.staff_type)],
      ['Staff', r.staff_group === 'teaching' ? 'Teaching' : 'Non-teaching'],
      ['Date of joining', esc(dmy(r.joined_on))],
      ['Cycle', `${t(r.cycle)} (${t(r.year)})`],
      ['Status', t(STATUS_WORD[r.status] ?? r.status)],
    ];
    const office = (r.office_facts ?? {}) as Record<string, unknown>;
    const officeRows = (['cl', 'el', 'hpl', 'other', 'absent', 'lateSlips'] as const)
      .filter((k) => office[k] !== null && office[k] !== undefined && office[k] !== '')
      .map((k) => [
        {
          cl: 'CL',
          el: 'EL',
          hpl: 'Half-pay leave',
          other: 'Other leave (EOL/LWP)',
          absent: 'Total absence',
          lateSlips: 'Late arrival slips',
        }[k],
        t(office[k]),
      ]);
    const pf = (k: string) => {
      const v = r.profile[k];
      return v === null || v === undefined || v === '' ? '' : String(v);
    };
    const particulars = (
      [
        ['Designation at joining', esc(pf('designation_at_joining'))],
        ['Date of regularisation', esc(dmy(pf('regularised_on')))],
        ['Last promotion', esc(dmy(pf('promoted_on')))],
        ['Last upgradation', esc(dmy(pf('upgraded_on')))],
        ['Pay band / grade', esc(pf('pay_band'))],
      ] as Array<[string, string]>
    ).filter(([, v]) => v);
    const table = (title: string, head: string[], rows: string[][]) =>
      rows.length
        ? `<section class="sec"><h3>${esc(title)}</h3><table><thead><tr>${head
            .map((h) => `<th>${esc(h)}</th>`)
            .join('')}</tr></thead><tbody>${rows
            .map((row) => `<tr>${row.map((x) => `<td>${x}</td>`).join('')}</tr>`)
            .join('')}</tbody></table></section>`
        : '';
    const mine = (rows: Row[]) => rows.filter((x) => x.employee_id === r.employee_id);
    const recordHtml =
      (particulars.length
        ? `<section class="sec"><h3>Personal particulars</h3>${particulars
            .map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${v}</b></div>`)
            .join('')}</section>`
        : '') +
      table(
        'Educational details',
        ['Qualification', 'Specialisation', 'Institution', 'Year', 'Score', 'Mode'],
        mine(data.education).map((x) => [
          t(x.qualification),
          t(x.specialisation),
          t(x.institution),
          t(x.passing_year),
          t(x.score),
          t(x.mode),
        ]),
      ) +
      table(
        'Experience details',
        ['Organisation', 'Designation', 'From', 'To', 'Reason for leaving'],
        mine(data.experience).map((x) => [
          t(x.organisation),
          t(x.designation),
          esc(dmy(x.from_on as string | null)),
          esc(dmy(x.to_on as string | null)),
          t(x.reason),
        ]),
      ) +
      table(
        'Training details',
        ['Date', 'Topic', 'Venue', 'Duration', 'Organisation'],
        mine(data.training).map((x) => [
          esc(dmy(x.trained_on as string | null)),
          t(x.topic),
          t(x.venue),
          t(x.duration),
          t(x.organisation),
        ]),
      ) +
      table(
        'Documents on file',
        ['Document', 'Issued', 'Expires', 'Checked'],
        mine(data.documents).map((x) => [
          t(x.name),
          esc(dmy(x.issued_on as string | null)),
          esc(dmy(x.expires_on as string | null)),
          x.verified ? 'Yes' : '',
        ]),
      );
    const att = (
      r.auto_facts as { attendance?: { daysPresent: number; lateArrivals: number } } | null
    )?.attendance;
    const levelHtml = levels
      .map((v) => {
        const head = `<h3>${String(v.seq)}. ${esc(v.label)} · ${v.action === 'rate' ? 'rates' : 'reviews'}${
          v.form_name ? ` · ${esc(v.form_name)}` : ''
        }</h3>`;
        const who = `<div class="kv"><span>People</span><b>${
          v.people?.length ? esc(v.people.join(', ')) : 'Nobody set'
        }</b></div>`;
        if (v.status === 'skipped')
          return `<section class="sec">${head}${who}<div class="kv"><span>Skipped</span><b>${t(v.skipped_note)}</b></div></section>`;
        if (v.status !== 'done')
          return `<section class="sec">${head}${who}<div class="kv"><span>Status</span><b>${LEVEL_WORD[v.status]}</b></div></section>`;
        const filled = `<div class="kv"><span>Filled by</span><b>${t(v.filled_by_name)}${
          v.filled_at ? ` on ${esc(dmy(v.filled_at))}` : ''
        }</b></div>`;
        const result = [
          v.score_pct !== null
            ? `<div class="kv"><span>Score</span><b>${String(num(v.score_pct))}%</b></div>`
            : '',
          v.grade
            ? `<div class="kv"><span>Grade</span><b>${esc(v.grade)}${v.grade_reason ? ` · ${esc(v.grade_reason)}` : ''}</b></div>`
            : '',
          v.remarks ? `<div class="kv"><span>Remarks</span><b>${esc(v.remarks)}</b></div>` : '',
        ].join('');
        return `<section class="sec">${head}${who}${filled}${answersHtml(qsOf(v.form_id), v.answers, data.scale, attached)}${result}</section>`;
      })
      .join('');
    const resultRows: Array<[string, string]> = [];
    if (r.score_pct !== null) resultRows.push(['Score', `${String(num(r.score_pct))}%`]);
    if (r.grade) resultRows.push(['Grade', `${esc(r.grade)}${r.adverse ? ' · adverse' : ''}`]);
    if (r.disclosed_at)
      resultRows.push([
        'Shown to the employee',
        `${esc(dmy(r.disclosed_at))}${r.object_by ? ` · may object until ${esc(dmy(r.object_by))}` : ''}`,
      ]);
    if (r.acknowledged_at) resultRows.push(['Acknowledged', esc(dmy(r.acknowledged_at))]);
    if (r.representation)
      resultRows.push([
        `Objection${r.represented_at ? ` (${esc(dmy(r.represented_at))})` : ''}`,
        esc(r.representation),
      ]);
    if (r.decision)
      resultRows.push([
        `Decision${r.decided_at ? ` (${esc(dmy(r.decided_at))})` : ''}`,
        `${r.decision === 'upheld' ? 'Grade upheld' : 'Grade revised'}${r.decision_note ? ` · ${esc(r.decision_note)}` : ''}`,
      ]);
    if (r.closed_at) resultRows.push(['Closed', esc(dmy(r.closed_at))]);
    // the signature lines: the employee, then every level that stands; a signed line shows the
    // signature on file, the name, code and designation of who signed, and the date
    const signer = (
      who: Signer | undefined,
      signed: boolean,
      when: Date | null,
      fallback: string,
    ) =>
      `<div class="sig">${
        who && signed && sigOf.has(who.id)
          ? `<img src="${sigOf.get(who.id)!}" alt="" />`
          : '<div class="pad"></div>'
      }<div class="who">${
        who
          ? `${esc(who.name)} (${esc(who.code)})${who.designation ? ` · ${esc(who.designation)}` : ''}${
              signed && when ? `<br/>${esc(dmy(when))}` : ''
            }`
          : esc(fallback)
      }</div>`;
    const employeeSigner = data.signers.find((x) => x.id === r.employee_id);
    const signs = [
      `${signer(employeeSigner, !!r.self_submitted_at, r.self_submitted_at, '')}<div class="line">Employee</div></div>`,
      ...levels
        .filter((v) => v.status !== 'skipped')
        .map(
          (v) =>
            `${signer(
              v.status === 'done' && v.filled_by
                ? data.signers.find((x) => x.user_id === v.filled_by)
                : undefined,
              v.status === 'done',
              v.filled_at,
              v.people?.join(', ') ?? '',
            )}<div class="line">${esc(v.label)}</div></div>`,
        ),
    ];
    return `<article class="acr${last ? '' : ' brk'}">
  <div class="title"><h1>Annual Confidential Report</h1><span>${t(r.cycle)} · Confidential</span></div>
  <div class="top">
    <div class="name">${t(r.name)}</div>
    <div class="facts">${facts.map(([k, v]) => `<div><span>${esc(k)}</span><b>${v}</b></div>`).join('')}</div>
  </div>
  ${recordHtml}
  <section class="sec"><h3>Part A · Self-appraisal${r.self_form ? ` · ${esc(r.self_form)}` : ''}</h3>
    <div class="kv"><span>Submitted</span><b>${r.self_submitted_at ? esc(dmy(r.self_submitted_at)) : 'Not yet'}</b></div>
    ${att ? `<div class="kv"><span>Attendance (from the records)</span><b>${String(att.daysPresent)} days present · ${String(att.lateArrivals)} late</b></div>` : ''}
    ${officeRows.length ? `<div class="kv"><span>Leave taken (office)</span><b>${officeRows.map(([k, v]) => `${k} ${v}`).join(' · ')}</b></div>` : ''}
    ${r.self_submitted_at ? answersHtml(qsOf(r.self_form_id), r.self_answers, data.scale, attached) : ''}
    ${r.self_pct !== null ? `<div class="kv"><span>Self score</span><b>${String(num(r.self_pct))}%</b></div>` : ''}
  </section>
  <h2>Part B · Assessment by the levels</h2>
  ${levelHtml || '<p class="muted">No levels.</p>'}
  ${resultRows.length ? `<section class="sec"><h3>Part C · Result</h3>${resultRows.map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('')}</section>` : ''}
  ${
    events.length
      ? `<section class="sec"><h3>Steps</h3><table><thead><tr><th>When</th><th>What</th><th>By</th></tr></thead><tbody>${events
          .map(
            (e) =>
              `<tr><td>${esc(istStamp(e.at))}</td><td>${esc(eventWord(e.what))}${e.note ? ` · ${esc(e.note)}` : ''}</td><td>${t(e.by_name)}</td></tr>`,
          )
          .join('')}</tbody></table></section>`
      : ''
  }
  <div class="signs">${signs.join('')}</div>
</article>`;
  };

  const one = data.reports.length === 1 ? data.reports[0]! : null;
  const footer = one
    ? `ACR ${esc(one.code)} · ${esc(one.cycle)}`
    : `ACRs · ${esc(data.reports[0]!.cycle)}`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${footer}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 12mm 11mm 16mm;
    @bottom-left { content: "${esc(lh.name).replace(/"/g, '')} · ${footer.replace(/"/g, '')} · Confidential"; font: 7.5px Arial, sans-serif; color: #52606D; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5px Arial, sans-serif; color: #52606D; }
  }
  body { font-family: "Source Sans 3", "Segoe UI", Arial, sans-serif; color: #1F2933; font-size: 9.5px; margin: 0; }
  .lh { display: flex; align-items: center; gap: 10px; border-bottom: 2px solid #00265D; padding-bottom: 6px; }
  .lh img { height: 48px; }
  .lh .school { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 16px; font-weight: 700; color: #00265D; }
  .lh .sub { color: #52606D; font-size: 9px; }
  .stamp { color: #52606D; font-size: 8px; text-align: right; margin-top: 2px; }
  .acr.brk { break-after: page; }
  .title { display: flex; justify-content: space-between; align-items: baseline; margin: 8px 0 6px; }
  .title h1 { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 15px; color: #00265D; margin: 0; }
  .title span { color: #52606D; font-size: 8.5px; }
  .top { border: 1px solid #D9E2EC; border-radius: 6px; padding: 8px; }
  .name { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 15px; font-weight: 700; color: #00265D; margin-bottom: 4px; }
  .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; }
  .facts div { display: flex; justify-content: space-between; border-bottom: 1px dotted #D9E2EC; padding: 1.5px 0; }
  .facts span { color: #52606D; }
  h2 { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 11px; color: #00265D; margin: 10px 0 2px; }
  .sec { break-inside: avoid; margin-top: 7px; }
  .sec h3 { font-size: 10px; margin: 0 0 3px; padding: 3px 6px; background: #00265D; color: #fff; border-radius: 3px; }
  .kv { display: flex; justify-content: space-between; gap: 8px; border-bottom: 1px solid #EEF2F6; padding: 2px; }
  .kv span { color: #52606D; white-space: nowrap; }
  .kv b { font-weight: 600; text-align: right; }
  .muted { color: #52606D; margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 3px; }
  td, th { border-bottom: 1px solid #EEF2F6; padding: 2.5px 4px; text-align: left; vertical-align: top; }
  th { color: #52606D; font-weight: 600; }
  .qa th { background: #F5F7FA; color: #00265D; }
  .att { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
  .att img { height: 60px; border: 1px solid #D9E2EC; }
  .chip { font-size: 8px; color: #52606D; border: 1px solid #D9E2EC; border-radius: 3px; padding: 1px 4px; }
  .ans { width: 34%; text-align: right; }
  .signs { display: grid; grid-auto-flow: column; gap: 16px; margin-top: 18px; text-align: center; color: #52606D; break-inside: avoid; align-items: end; }
  .sig { display: flex; flex-direction: column; justify-content: flex-end; }
  .sig img, .sig .pad { height: 42px; max-width: 100%; object-fit: contain; display: block; margin: 0 auto 2px; }
  .sig .who { font-size: 8px; min-height: 18px; }
  .sig .line { border-top: 1px solid #52606D; padding-top: 3px; font-weight: 600; color: #1F2933; }
</style></head>
<body>
  <div class="lh">
    ${lh.logo ? `<img src="${lh.logo.dataUri}" alt="" />` : ''}
    <div>
      <div class="school">${esc(lh.name)}</div>
      ${lh.address ? `<div class="sub">${esc(lh.address)}</div>` : ''}
      ${lh.affiliation || lh.contact ? `<div class="sub">${esc([lh.affiliation, lh.contact].filter(Boolean).join(' · '))}</div>` : ''}
    </div>
  </div>
  <div class="stamp">Printed ${esc(stamp)}</div>
  ${data.reports.map((r, i) => article(r, i === data.reports.length - 1)).join('\n')}
</body></html>`;
  return { html, width: '210mm', height: '297mm', count: data.reports.length };
}
