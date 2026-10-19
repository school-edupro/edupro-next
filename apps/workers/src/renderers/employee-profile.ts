import {
  loadEmployeePolicy,
  EMPLOYEE_FIELDS,
  EMPLOYEE_SECTIONS,
  applies,
  employeeCompleteness,
  readEmployeeProfile,
  tenantForJob,
  type Db,
  type EmployeeField,
  type JobEnvelope,
  type ProfileValues,
} from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { istStamp, letterhead, type Letterhead } from './report-builder';

/**
 * The employee profile printout (A4, docs/design/30-employee-master.md): the school letterhead, the
 * photo with the key facts, every section of the profile with the fields that apply and are filled,
 * the teaching subjects, education, languages, experience and transfers, the documents for employment
 * (required / on file / checked), a declaration and signature lines. Aadhaar, PAN and the account are
 * masked unless the person who asked may see them (checked here, not taken from the request).
 */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dmy = (s: string | null | undefined) =>
  s && /^\d{4}-\d{2}-\d{2}/.test(s)
    ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`
    : (s ?? '');

async function imageUri(storage: StorageDriver, key: string | null, type: string | null) {
  if (!key || !type || !/^image\/(png|jpe?g|webp)$/.test(type)) return null;
  try {
    const bytes = await storage.read(key);
    return bytes.length <= 3 * 1024 * 1024
      ? `data:${type};base64,${bytes.toString('base64')}`
      : null;
  } catch {
    return null;
  }
}

const show = (f: EmployeeField | undefined, v: ProfileValues[string]): string => {
  if (v === null || v === undefined || v === '') return '';
  return f?.type === 'date' ? dmy(String(v)) : String(v);
};

type Row = Record<string, string | number | boolean | null>;

export async function renderEmployeeProfile(
  db: Db,
  storage: StorageDriver,
  envelope: JobEnvelope,
  params: Record<string, unknown>,
): Promise<{ html: string; width: string; height: string }> {
  const employeeId = String(params.employeeId ?? '');
  const tenant = tenantForJob(envelope);
  const data = await db.withTenant(tenant, async (c) => {
    // full ID numbers only when the requester holds people.sensitive.view today
    const perm = envelope.userId
      ? await c.query(
          `SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
            WHERE ur.user_id = $1 AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE
              AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE) AND rp.permission_code = 'people.sensitive.view'
            LIMIT 1`,
          [envelope.userId],
        )
      : { rowCount: 0 };
    // the employee's own copy (from the staff app): only their own record, their ID numbers in full,
    // and only the fields the school shows staff (docs/design/33-people-dashboards.md)
    const self = params.self === true;
    if (self) {
      const own = await c.query(`SELECT 1 FROM employees WHERE id = $1 AND user_id = $2`, [
        employeeId,
        envelope.userId,
      ]);
      if (!own.rowCount) throw new Error(`employee ${employeeId} is not the requester`);
    }
    const p = await readEmployeeProfile(c, employeeId, self || (perm.rowCount ?? 0) > 0);
    if (!p) throw new Error(`employee ${employeeId} not found`);
    if (self) {
      const policy = await loadEmployeePolicy(c);
      for (const [k, level] of Object.entries(policy.fields))
        if (level === 'hidden') delete p.values[k];
    }
    const meta = await c.query<{
      display_name: string;
      status: string;
      object_key: string | null;
      content_type: string | null;
      campus: string | null;
      reports_to: string | null;
    }>(
      `SELECT e.display_name, e.status::text, f.object_key, f.content_type,
              (SELECT cp.name FROM postings po JOIN campuses cp ON cp.id = po.campus_id
                WHERE po.employee_id = e.id ORDER BY po.valid_from DESC LIMIT 1) AS campus,
              (SELECT m.display_name || ' (' || m.employee_code || ')' FROM postings po JOIN employees m ON m.id = po.reports_to_employee_id
                WHERE po.employee_id = e.id ORDER BY po.valid_from DESC LIMIT 1) AS reports_to
         FROM employees e LEFT JOIN files f ON f.id = e.photo_file_id AND f.status = 'ready'
        WHERE e.id = $1`,
      [employeeId],
    );
    const q = async (sql: string) => (await c.query<Row>(sql, [employeeId])).rows;
    return {
      p,
      meta: meta.rows[0]!,
      subjects: await q(
        `SELECT s.name FROM employee_subjects es JOIN subjects s ON s.id = es.subject_id WHERE es.employee_id = $1 ORDER BY s.display_order, s.name`,
      ),
      education: await q(
        `SELECT qualification, specialisation, institution, passing_year, score, mode FROM employee_education
          WHERE employee_id = $1 ORDER BY passing_year NULLS LAST, id`,
      ),
      languages: await q(
        `SELECT language, can_read, can_write, can_speak FROM employee_languages WHERE employee_id = $1 ORDER BY language`,
      ),
      experience: await q(
        `SELECT organisation, designation, from_on::text, to_on::text, reason FROM employee_experience
          WHERE employee_id = $1 ORDER BY from_on NULLS LAST, id`,
      ),
      training: await q(
        `SELECT trained_on::text, topic, venue, duration, organisation FROM employee_training
          WHERE employee_id = $1 ORDER BY trained_on DESC, id`,
      ),
      transfers: await q(
        `SELECT on_date::text, from_place, to_place, order_no FROM employee_transfers WHERE employee_id = $1 ORDER BY on_date`,
      ),
      documents: await q(
        `SELECT t.name, d.required, d.valid > 0 AS on_file,
                EXISTS (SELECT 1 FROM employee_documents x WHERE x.employee_id = $1 AND x.type_id = t.id
                         AND x.deleted_at IS NULL AND x.verified_at IS NOT NULL) AS checked
           FROM app.employee_documents_due($1) d JOIN employee_document_types t ON t.id = d.type_id
          WHERE d.required OR d.on_file > 0
          ORDER BY d.required DESC, t.sort_order, t.name`,
      ),
    };
  });
  const lh: Letterhead = await letterhead(db, storage, tenant);
  const photo = await imageUri(storage, data.meta.object_key, data.meta.content_type);
  const v = data.p.values;
  // approvers by name
  for (const k of ['acr_hod', 'approver_l1', 'approver_l2', 'approver_l3'])
    if (typeof v[k] === 'string') v[k] = data.p.approvers[String(v[k])] ?? v[k];
  const byKey = new Map(EMPLOYEE_FIELDS.map((f) => [f.key, f]));
  const val = (k: string) => esc(show(byKey.get(k), v[k] ?? null));
  const code = String(v.employee_code ?? '');
  const done = employeeCompleteness(v).percent;

  const facts: Array<[string, string]> = [
    ['Employee code', val('employee_code')],
    ['Employee type', val('staff_type')],
    ['Designation', val('designation')],
    ['Department', val('department')],
    ['Date of joining', val('joined_on')],
    [
      'Years of service',
      v.service_years !== null && v.service_years !== undefined ? String(v.service_years) : '',
    ],
    [
      'Date of birth',
      `${val('dob')}${v.age !== null && v.age !== undefined ? ` (${String(v.age)} yrs)` : ''}`,
    ],
    ['Gender', val('gender')],
    ['Mobile', val('mobile')],
    ['Email', val('email')],
    ['Campus', esc(data.meta.campus ?? '')],
    ['Reports to', esc(data.meta.reports_to ?? '')],
  ];

  // every section with the filled fields that apply (the key facts above are not repeated)
  const shown = new Set([
    'employee_code',
    'first_name',
    'last_name',
    'staff_type',
    'designation',
    'department',
    'joined_on',
    'dob',
    'age',
    'gender',
    'mobile',
    'email',
    'service_years',
  ]);
  const sections = EMPLOYEE_SECTIONS.map((s) => {
    const fields = EMPLOYEE_FIELDS.filter(
      (f) =>
        f.section === s.id &&
        !shown.has(f.key) &&
        applies(f as never, v) &&
        v[f.key] !== null &&
        v[f.key] !== undefined &&
        v[f.key] !== '',
    );
    if (!fields.length) return '';
    const cells = fields
      .map((f) => `<div class="kv"><span>${esc(f.label)}</span><b>${val(f.key)}</b></div>`)
      .join('');
    return `<section class="sec"><h3>${esc(s.title)}</h3><div class="grid">${cells}</div></section>`;
  }).join('');

  const table = (title: string, head: string[], rows: string[][]) =>
    rows.length
      ? `<section class="sec"><h3>${esc(title)}</h3><table><thead><tr>${head
          .map((h) => `<th>${esc(h)}</th>`)
          .join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></section>`
      : '';
  const t = (x: unknown) => esc(x === null || x === undefined ? '' : String(x));
  const yes = (b: unknown) => (b ? 'Yes' : '—');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Employee profile ${esc(code)}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 12mm 11mm 16mm;
    @bottom-left { content: "${esc(lh.name).replace(/"/g, '')} · Employee profile ${esc(code).replace(/"/g, '')}"; font: 7.5px Arial, sans-serif; color: #52606D; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5px Arial, sans-serif; color: #52606D; }
  }
  body { font-family: "Source Sans 3", "Segoe UI", Arial, sans-serif; color: #1F2933; font-size: 9.5px; margin: 0; }
  .lh { display: flex; align-items: center; gap: 10px; border-bottom: 2px solid #00265D; padding-bottom: 6px; }
  .lh img { height: 48px; }
  .lh .school { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 16px; font-weight: 700; color: #00265D; }
  .lh .sub { color: #52606D; font-size: 9px; }
  .title { display: flex; justify-content: space-between; align-items: baseline; margin: 8px 0 6px; }
  .title h1 { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 15px; color: #00265D; margin: 0; }
  .title span { color: #52606D; font-size: 8.5px; }
  .top { display: grid; grid-template-columns: 32mm 1fr; gap: 10px; align-items: start; border: 1px solid #D9E2EC; border-radius: 6px; padding: 8px; }
  .ph { margin: 0; }
  .ph img, .ph-empty { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; border-radius: 4px; border: 1px solid #00A0C6; background: #F5F7FA; }
  .ph-empty { display: flex; align-items: center; justify-content: center; color: #9AA5B1; }
  .name { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 15px; font-weight: 700; color: #00265D; margin-bottom: 2px; }
  .status { color: #52606D; margin-bottom: 4px; }
  .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; }
  .facts div { display: flex; justify-content: space-between; border-bottom: 1px dotted #D9E2EC; padding: 1.5px 0; }
  .facts span { color: #52606D; }
  .sec { break-inside: avoid; margin-top: 7px; }
  .sec h3 { font-size: 10px; margin: 0 0 3px; padding: 3px 6px; background: #00265D; color: #fff; border-radius: 3px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
  .kv { display: flex; justify-content: space-between; gap: 8px; border-bottom: 1px solid #EEF2F6; padding: 2px; }
  .kv span { color: #52606D; }
  .kv b { font-weight: 600; text-align: right; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border-bottom: 1px solid #EEF2F6; padding: 2.5px 4px; text-align: left; }
  th { color: #52606D; font-weight: 600; }
  .decl { margin-top: 10px; break-inside: avoid; }
  .signs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 26px; text-align: center; color: #52606D; }
  .signs div { border-top: 1px solid #52606D; padding-top: 3px; }
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
  <div class="title"><h1>Employee Profile</h1><span>Printed ${esc(istStamp(new Date()))} · Profile ${String(done)}% complete</span></div>
  <div class="top">
    <figure class="ph">${photo ? `<img src="${photo}" alt="" />` : '<div class="ph-empty">Photo</div>'}</figure>
    <div>
      <div class="name">${esc(data.meta.display_name)}</div>
      <div class="status">${data.meta.status === 'active' ? 'Active' : 'Inactive'}${data.subjects.length ? ` · Teaches ${esc(data.subjects.map((x) => String(x.name)).join(', '))}` : ''}</div>
      <div class="facts">${facts.map(([k, x]) => `<div><span>${esc(k)}</span><b>${x}</b></div>`).join('')}</div>
    </div>
  </div>
  ${sections}
  ${table(
    'Education',
    ['Qualification', 'Subject', 'Board / university', 'Year', 'Marks', 'Mode'],
    data.education.map((r) => [
      t(r.qualification),
      t(r.specialisation),
      t(r.institution),
      t(r.passing_year),
      t(r.score),
      t(r.mode),
    ]),
  )}
  ${table(
    'Languages',
    ['Language', 'Read', 'Write', 'Speak'],
    data.languages.map((r) => [t(r.language), yes(r.can_read), yes(r.can_write), yes(r.can_speak)]),
  )}
  ${table(
    'Work experience before joining',
    ['Organisation', 'Designation', 'From', 'To', 'Reason for leaving'],
    data.experience.map((r) => [
      t(r.organisation),
      t(r.designation),
      esc(dmy(r.from_on as string | null)),
      esc(dmy(r.to_on as string | null)),
      t(r.reason),
    ]),
  )}
  ${table(
    'Training',
    ['Date', 'Topic', 'Venue', 'Duration', 'Organisation'],
    data.training.map((r) => [
      esc(dmy(r.trained_on as string)),
      t(r.topic),
      t(r.venue),
      t(r.duration),
      t(r.organisation),
    ]),
  )}
  ${table(
    'Transfers',
    ['On', 'From', 'To', 'Order'],
    data.transfers.map((r) => [
      esc(dmy(r.on_date as string)),
      t(r.from_place),
      t(r.to_place),
      t(r.order_no),
    ]),
  )}
  ${table(
    'Documents for employment',
    ['Document', 'Required', 'Status', 'Checked'],
    data.documents.map((r) => [
      t(r.name),
      r.required ? 'Yes' : 'Optional',
      r.on_file ? 'On file' : 'Not submitted',
      r.checked ? 'Checked' : '',
    ]),
  )}
  <div class="decl">
    I confirm that the details above are correct. I will inform the school of any change.
    <div class="signs"><div>Signature of the employee</div><div>HR / Office</div><div>Principal</div></div>
  </div>
</body></html>`;
  return { html, width: '210mm', height: '297mm' };
}
