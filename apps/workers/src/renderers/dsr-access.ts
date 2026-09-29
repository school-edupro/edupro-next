import { documentHtml, tenantForJob, type Db, type JobEnvelope } from '@edupro/db';

type Q = {
  query: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

const esc = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

function table(rows: Record<string, unknown>[], columns: Array<[string, string]>): string {
  if (rows.length === 0) return '<p class="muted">None on record.</p>';
  const head = columns.map(([, h]) => `<th>${esc(h)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${columns.map(([k]) => `<td>${esc(r[k])}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const dl = (pairs: Array<[string, unknown]>) =>
  `<dl>${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v ?? '—')}</dd>`).join('')}</dl>`;

/**
 * Sprint 20: the access report of a data-principal request (DPDP section 11). Everything the school
 * holds about the person, section by section, in plain language. Rendered under the office user who
 * completed the request, so row-level security applies.
 */
export async function renderDsrAccess(
  db: Db,
  envelope: JobEnvelope,
  params: Record<string, unknown>,
) {
  const requestId = String(params.requestId ?? '');
  return db.withTenant(tenantForJob(envelope), async (c) => {
    const q = c as unknown as Q;
    const req = (
      await q.query<{
        id: string;
        kind: string;
        principal_kind: string;
        principal_id: string;
        received_on: string;
        school: string;
      }>(
        `SELECT r.id::text, r.kind, r.principal_kind, r.principal_id::text, r.received_on::text, s.name AS school
           FROM data_subject_requests r JOIN schools s ON s.id = r.school_id WHERE r.id = $1`,
        [requestId],
      )
    ).rows[0];
    if (!req) throw new Error(`data subject request ${requestId} not found`);

    const sections: string[] = [];
    const push = (title: string, html: string) => sections.push(`<h2>${esc(title)}</h2>${html}`);
    let name = '';
    let userId: string | null = null;
    const studentIds: string[] = [];

    if (req.principal_kind === 'student') {
      const s = (
        await q.query(
          `SELECT id::text, admission_no, display_name, dob::text, gender::text, category, blood_group, house, admitted_on::text, left_on::text, address, details, user_id::text, status::text FROM students WHERE id = $1`,
          [req.principal_id],
        )
      ).rows[0];
      if (!s) throw new Error('student not found');
      name = String(s.display_name);
      userId = (s.user_id as string | null) ?? null;
      studentIds.push(String(s.id));
      push(
        'Identity',
        dl([
          ['Name', s.display_name],
          ['Admission number', s.admission_no],
          ['Date of birth', s.dob],
          ['Gender', s.gender],
          ['Category', s.category],
          ['Blood group', s.blood_group],
          ['House', s.house],
          ['Admitted on', s.admitted_on],
          ['Left on', s.left_on],
          ['Address', JSON.stringify(s.address ?? {})],
          ['Other details', JSON.stringify(s.details ?? {})],
          ['Status', s.status],
        ]),
      );
      const guardians = await q.query(
        `SELECT g.display_name AS name, sg.relation::text, sg.is_primary, g.mobile, g.email FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = $1`,
        [req.principal_id],
      );
      push(
        'Guardians on record',
        table(guardians.rows, [
          ['name', 'Name'],
          ['relation', 'Relation'],
          ['is_primary', 'Primary'],
          ['mobile', 'Mobile'],
          ['email', 'Email'],
        ]),
      );
    } else if (req.principal_kind === 'guardian') {
      const g = (
        await q.query(
          `SELECT id::text, display_name, mobile, email, occupation, address, details, user_id::text, status::text FROM guardians WHERE id = $1`,
          [req.principal_id],
        )
      ).rows[0];
      if (!g) throw new Error('guardian not found');
      name = String(g.display_name);
      userId = (g.user_id as string | null) ?? null;
      push(
        'Identity',
        dl([
          ['Name', g.display_name],
          ['Mobile', g.mobile],
          ['Email', g.email],
          ['Occupation', g.occupation],
          ['Address', JSON.stringify(g.address ?? {})],
          ['Other details', JSON.stringify(g.details ?? {})],
          ['Status', g.status],
        ]),
      );
      const kids = await q.query<{ id: string; name: string; relation: string }>(
        `SELECT s.id::text, s.display_name AS name, sg.relation::text FROM student_guardians sg JOIN students s ON s.id = sg.student_id WHERE sg.guardian_id = $1`,
        [req.principal_id],
      );
      studentIds.push(...kids.rows.map((k) => k.id));
      push(
        'Children linked',
        table(kids.rows as unknown as Record<string, unknown>[], [
          ['name', 'Name'],
          ['relation', 'Relation'],
        ]),
      );
    } else {
      const e = (
        await q.query(
          `SELECT id::text, employee_code, display_name, dob::text, gender::text, employee_type::text, designation, department, joined_on::text, left_on::text, mobile, email, address, details, user_id::text, status::text FROM employees WHERE id = $1`,
          [req.principal_id],
        )
      ).rows[0];
      if (!e) throw new Error('employee not found');
      name = String(e.display_name);
      userId = (e.user_id as string | null) ?? null;
      push(
        'Identity and service',
        dl([
          ['Name', e.display_name],
          ['Employee code', e.employee_code],
          ['Date of birth', e.dob],
          ['Gender', e.gender],
          ['Type', e.employee_type],
          ['Designation', e.designation],
          ['Department', e.department],
          ['Joined on', e.joined_on],
          ['Left on', e.left_on],
          ['Mobile', e.mobile],
          ['Email', e.email],
          ['Address', JSON.stringify(e.address ?? {})],
          ['Other details', JSON.stringify(e.details ?? {})],
        ]),
      );
      const postings = await q.query(
        `SELECT y.code AS year, p.department, p.designation, p.valid_from::text, p.valid_to::text FROM postings p JOIN academic_years y ON y.id = p.academic_year_id WHERE p.employee_id = $1 ORDER BY p.valid_from DESC`,
        [req.principal_id],
      );
      push(
        'Postings',
        table(postings.rows, [
          ['year', 'Year'],
          ['department', 'Department'],
          ['designation', 'Designation'],
          ['valid_from', 'From'],
          ['valid_to', 'To'],
        ]),
      );
    }

    if (studentIds.length) {
      const enr = await q.query(
        `SELECT s.display_name AS student, y.code AS year, k.code || '-' || cs.name AS section, e.roll_no, e.status::text, e.joined_on::text, e.ended_on::text
           FROM enrolments e JOIN students s ON s.id = e.student_id JOIN academic_years y ON y.id = e.academic_year_id
           JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
          WHERE e.student_id = ANY($1::bigint[]) ORDER BY y.start_date DESC, s.display_name`,
        [studentIds],
      );
      push(
        'Enrolments',
        table(enr.rows, [
          ['student', 'Pupil'],
          ['year', 'Year'],
          ['section', 'Section'],
          ['roll_no', 'Roll'],
          ['status', 'Status'],
          ['joined_on', 'From'],
          ['ended_on', 'To'],
        ]),
      );
      const att = await q
        .query(
          `SELECT s.display_name AS student, y.code AS year, count(*) FILTER (WHERE m.code = 'P') AS present, count(*) FILTER (WHERE m.code = 'A') AS absent, count(*) AS marked
           FROM attendance_marks m JOIN attendance_sessions ss ON ss.id = m.session_id JOIN students s ON s.id = m.student_id JOIN academic_years y ON y.id = ss.academic_year_id
          WHERE m.student_id = ANY($1::bigint[]) GROUP BY s.display_name, y.code ORDER BY y.code DESC`,
          [studentIds],
        )
        .catch(() => ({ rows: [] as Record<string, unknown>[] }));
      push(
        'Attendance (summary per year)',
        table(att.rows, [
          ['student', 'Pupil'],
          ['year', 'Year'],
          ['present', 'Present'],
          ['absent', 'Absent'],
          ['marked', 'Days marked'],
        ]),
      );
      const fees = await q.query(
        `SELECT s.display_name AS student, y.code AS year, d.ledger::text, sum(d.net)::text AS net, sum(d.paid)::text AS paid, (sum(d.net) - sum(d.paid))::text AS balance
           FROM fee_demands d JOIN students s ON s.id = d.student_id JOIN academic_years y ON y.id = d.academic_year_id
          WHERE d.student_id = ANY($1::bigint[]) GROUP BY s.display_name, y.code, d.ledger ORDER BY y.code DESC`,
        [studentIds],
      );
      push(
        'Fees (demand, paid, balance)',
        table(fees.rows, [
          ['student', 'Pupil'],
          ['year', 'Year'],
          ['ledger', 'Ledger'],
          ['net', 'Demand'],
          ['paid', 'Paid'],
          ['balance', 'Balance'],
        ]),
      );
      const receipts = await q.query(
        `SELECT s.display_name AS student, p.receipt_no, p.received_on::text, p.amount::text, p.mode::text, p.status::text FROM fee_payments p JOIN students s ON s.id = p.student_id WHERE p.student_id = ANY($1::bigint[]) ORDER BY p.received_on DESC LIMIT 200`,
        [studentIds],
      );
      push(
        'Receipts',
        table(receipts.rows, [
          ['student', 'Pupil'],
          ['receipt_no', 'Receipt'],
          ['received_on', 'Date'],
          ['amount', 'Amount'],
          ['mode', 'Mode'],
          ['status', 'Status'],
        ]),
      );
      const results = await q
        .query(
          `SELECT s.display_name AS student, e.code AS exam, x.pct::text, x.grade, x.result FROM exam_results x JOIN exams e ON e.id = x.exam_id JOIN students s ON s.id = x.student_id WHERE x.student_id = ANY($1::bigint[]) ORDER BY e.starts_on DESC NULLS LAST`,
          [studentIds],
        )
        .catch(() => ({ rows: [] as Record<string, unknown>[] }));
      push(
        'Exam results',
        table(results.rows, [
          ['student', 'Pupil'],
          ['exam', 'Exam'],
          ['pct', '%'],
          ['grade', 'Grade'],
          ['result', 'Result'],
        ]),
      );
      const health = await q.query(
        `SELECT s.display_name AS student, h.recorded_on::text, h.height_cm::text, h.weight_kg::text, h.blood_group, h.vision_left, h.vision_right, h.dental FROM health_records h JOIN students s ON s.id = h.student_id WHERE h.student_id = ANY($1::bigint[]) ORDER BY h.recorded_on DESC`,
        [studentIds],
      );
      push(
        'Health records',
        table(health.rows, [
          ['student', 'Pupil'],
          ['recorded_on', 'Date'],
          ['height_cm', 'Height'],
          ['weight_kg', 'Weight'],
          ['blood_group', 'Blood group'],
          ['vision_left', 'Vision L'],
          ['vision_right', 'Vision R'],
          ['dental', 'Dental'],
        ]),
      );
      const clinic = await q.query(
        `SELECT s.display_name AS student, v.in_at::date::text AS on_date, v.complaint, v.treatment, v.temperature_c::text FROM clinic_visits v JOIN students s ON s.id = v.student_id WHERE v.student_id = ANY($1::bigint[]) ORDER BY v.in_at DESC LIMIT 100`,
        [studentIds],
      );
      push(
        'Clinic visits',
        table(clinic.rows, [
          ['student', 'Pupil'],
          ['on_date', 'Date'],
          ['complaint', 'Complaint'],
          ['treatment', 'Treatment'],
          ['temperature_c', '°C'],
        ]),
      );
    }

    {
      const uid = userId ?? '0';
      const consents = await q.query(
        `SELECT purpose_code, status::text, version, source, recorded_at::date::text AS on_date FROM consents WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT 100`,
        [uid],
      );
      push(
        'Consents (history)',
        table(consents.rows, [
          ['purpose_code', 'Purpose'],
          ['status', 'Status'],
          ['version', 'Version'],
          ['source', 'Recorded via'],
          ['on_date', 'Date'],
        ]),
      );
      const msgs = await q.query(
        `SELECT channel::text, COALESCE(subject, left(body, 60)) AS subject, status::text, created_at::date::text AS on_date FROM comms_messages WHERE recipient_user_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [uid],
      );
      push(
        'Messages sent to you (last 200)',
        table(msgs.rows, [
          ['channel', 'Channel'],
          ['subject', 'Subject'],
          ['status', 'Status'],
          ['on_date', 'Date'],
        ]),
      );
      const logins = await q.query(
        `SELECT occurred_at::text, method, outcome::text FROM login_events WHERE user_id = $1 ORDER BY occurred_at DESC LIMIT 50`,
        [uid],
      );
      push(
        'Sign-ins (last 50)',
        table(logins.rows, [
          ['occurred_at', 'At'],
          ['method', 'Method'],
          ['outcome', 'Outcome'],
        ]),
      );
      const requests = await q.query(
        `SELECT kind, status, received_on::text, outcome FROM data_subject_requests WHERE requested_by_user = $1 ORDER BY created_at DESC`,
        [uid],
      );
      push(
        'Your data-principal requests',
        table(requests.rows, [
          ['kind', 'Kind'],
          ['status', 'Status'],
          ['received_on', 'Received'],
          ['outcome', 'Outcome'],
        ]),
      );
    }
    const files = await q.query(
      `SELECT original_name, content_type, classification::text, created_at::date::text AS on_date FROM files WHERE owner_entity_type = $1 AND owner_entity_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`,
      [req.principal_kind, req.principal_id],
    );
    push(
      'Files held',
      table(files.rows, [
        ['original_name', 'File'],
        ['content_type', 'Type'],
        ['classification', 'Class'],
        ['on_date', 'Uploaded'],
      ]),
    );

    const body = `<header><div class="k">${esc(req.school)}</div><h1>Personal data report</h1>
<p>Prepared for <strong>${esc(name)}</strong> under the Digital Personal Data Protection Act, 2023 (request ${esc(req.id)} received on ${esc(req.received_on)}). This report lists the personal data the school holds and processes for the purposes of schooling, fee collection, safety and communication. Corrections can be requested through the parent app or the school office.</p></header>${sections.join('')}
<footer>Generated on ${new Date().toISOString().slice(0, 10)} · EduPro Next</footer>`;
    const css = `header .k{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#52606D}h1{font-size:22px;color:#00265D;margin:2px 0 8px}h2{font-size:14px;color:#00265D;margin:16px 0 6px;border-bottom:1px solid #E4E7EB;padding-bottom:2px}p{font-size:11px;color:#3E4C59}dl{display:grid;grid-template-columns:150px 1fr;gap:2px 10px;font-size:11px;margin:0}dt{color:#52606D}dd{margin:0}table{width:100%;border-collapse:collapse;font-size:10.5px}th{text-align:left;background:#F5F7FA;padding:3px 5px;border-bottom:1px solid #CBD2D9}td{padding:3px 5px;border-bottom:1px solid #E4E7EB;vertical-align:top}.muted{color:#7B8794;font-size:11px}footer{margin-top:18px;font-size:10px;color:#7B8794}`;
    return {
      html: documentHtml({ body, css, pageWidth: '210mm', pageHeight: '297mm' }),
      width: '210mm',
      height: '297mm',
    };
  });
}
