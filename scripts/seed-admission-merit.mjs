#!/usr/bin/env node
/**
 * Sample registrations for checking the merit points (docs/design/49). DEV ONLY.
 *
 *   node scripts/seed-admission-merit.mjs --yes      clear Alpha's registrations, seed 50, check
 *   node scripts/seed-admission-merit.mjs --check    only the check
 *   node scripts/seed-admission-merit.mjs --files    give the sample registrations their own files
 *
 * Needs the local database (DATABASE_MIGRATOR_URL on localhost) and the API on :4000 (the points are
 * worked out by EduPro's own Recalculate). Writes answers and numbers directly, so no message is queued
 * (nothing can reach a family when the workers start). Every family's mobile is 90000xxxxx and email
 * @example.invalid. Then the points are worked out here again, independently, and compared.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const { Client } = require(join(root, 'node_modules/.pnpm/node_modules/pg'));
const { encryptField, matchCategory } = require(join(root, 'packages/db/dist/index.js'));

const SCHOOL = '1';
const SCHOOL_NAME = 'Alpha Public School';
const CYCLE = '4';
const FORM = '1';
const API = 'http://localhost:4000/api/v1';
const H = {
  authorization: 'Bearer dev:dev-admin',
  'x-school-id': SCHOOL,
  'content-type': 'application/json',
};
const args = new Set(process.argv.slice(2));

const url = process.env.DATABASE_MIGRATOR_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
  console.error('Refused: DATABASE_MIGRATOR_URL is not the local database.');
  process.exit(1);
}
if (!args.has('--yes') && !args.has('--check') && !args.has('--files')) {
  console.error(
    'This deletes every registration of school 1. Run with --yes (or --check to only check).',
  );
  process.exit(1);
}

const api = async (m, u, b) => {
  const r = await fetch(`${API}${u}`, {
    method: m,
    headers: H,
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${m} ${u} ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};

const c = new Client({ connectionString: url });
await c.connect();
const q = async (sql, p) => (await c.query(sql, p)).rows;
const school = (await q(`SELECT name FROM schools WHERE id = $1`, [SCHOOL]))[0];
if (school?.name !== SCHOOL_NAME) {
  console.error(`Refused: school ${SCHOOL} is not ${SCHOOL_NAME}.`);
  process.exit(1);
}
const tenant = async () => {
  await c.query(
    `SELECT set_config('app.school_id', $1, true), set_config('app.user_id', '1', true),
                        set_config('app.allowed_school_ids', $2, true)`,
    [SCHOOL, `{${SCHOOL}}`],
  );
};

// ---- the registrations' own files (docs/design/51) ----------------------------------------------------
// a small grey photo and a one-page PDF, stored as uploads of the registration, so the family's portal
// and the approver's review show them like any upload
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);
const pdfOf = (title) => {
  const text = `BT /F1 18 Tf 72 720 Td (${title.replace(/[()\\]/g, '')}) Tj 0 -28 Td /F1 11 Tf (Sample document for testing - docs/design/49) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const at = [];
  objs.forEach((o, i) => {
    at.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
};
const UPLOADS = join(root, process.env.STORAGE_LOCAL_DIR ?? '.data/uploads');
async function ownFile(appId, key, label) {
  const photo = /photo/.test(key);
  const bytes = photo ? PNG : pdfOf(label);
  const ext = photo ? 'png' : 'pdf';
  const now = new Date();
  const objectKey = `school-${SCHOOL}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/sample-${appId}-${key}.${ext}`;
  mkdirSync(dirname(join(UPLOADS, objectKey)), { recursive: true });
  writeFileSync(join(UPLOADS, objectKey), bytes);
  const r = await q(
    `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, sha256, original_name, owner_entity_type,
                        owner_entity_id, classification, status, storage_driver)
     VALUES ($1, 'local', $2, $3, $4, $5, $6, 'application', $7, 'sensitive', 'ready', 'local') RETURNING id::text`,
    [
      SCHOOL,
      objectKey,
      photo ? 'image/png' : 'application/pdf',
      bytes.length,
      createHash('sha256').update(bytes).digest('hex'),
      `${key}.${ext}`,
      appId,
    ],
  );
  return r[0].id;
}
/** Every file answer of a registration that is not its own upload made its own (a sample file). */
async function ownFiles(appId, data, def) {
  const fileKeys = def.fields
    .filter((f) => f.type === 'file' || f.type === 'photo')
    .map((f) => [f.key, f.label]);
  const owned = new Set(
    (
      await q(
        `SELECT id::text FROM files WHERE owner_entity_type = 'application' AND owner_entity_id = $1`,
        [appId],
      )
    ).map((x) => x.id),
  );
  let changed = false;
  for (const [key, label] of fileKeys) {
    const v = data[key];
    if (!Array.isArray(v) || !v.length || v.every((x) => owned.has(String(x)))) continue;
    data[key] = [await ownFile(appId, key, label)];
    changed = true;
  }
  return changed;
}
async function fixFiles() {
  await c.query('BEGIN');
  await tenant();
  const apps = await q(
    `SELECT a.id::text, a.data, COALESCE(a.form_snapshot, f.def) AS def FROM applications a
                          LEFT JOIN admission_forms f ON f.id = a.form_id WHERE a.school_id = $1 AND a.cycle_id = $2`,
    [SCHOOL, CYCLE],
  );
  let n = 0;
  for (const a of apps)
    if (await ownFiles(a.id, a.data, a.def)) {
      await c.query(`UPDATE applications SET data = $2::jsonb WHERE id = $1`, [
        a.id,
        JSON.stringify(a.data),
      ]);
      n += 1;
    }
  await c.query('COMMIT');
  return n;
}

// ---- clear -------------------------------------------------------------------------------------------
async function clear() {
  await c.query('BEGIN');
  await tenant();
  const apps = (await q(`SELECT id FROM applications WHERE school_id = $1`, [SCHOOL])).map(
    (x) => x.id,
  );
  const students = (
    await q(`SELECT student_id FROM applications WHERE school_id = $1 AND student_id IS NOT NULL`, [
      SCHOOL,
    ])
  ).map((x) => x.student_id);
  const applicants = (
    await q(`SELECT DISTINCT applicant_id FROM applications WHERE school_id = $1`, [SCHOOL])
  ).map((x) => x.applicant_id);
  const queries = (
    await q(`SELECT id FROM parent_queries WHERE application_id = ANY($1::bigint[])`, [apps])
  ).map((x) => x.id);
  const receipts = (
    await q(`SELECT id FROM misc_receipts WHERE application_id = ANY($1::bigint[])`, [apps])
  ).map((x) => x.id);
  const n = {};
  const del = async (label, sql, p) => {
    const r = await c.query(sql, p);
    n[label] = (n[label] ?? 0) + (r.rowCount ?? 0);
  };
  // messages about these registrations and queries: none can go out later
  await del(
    'messages',
    `DELETE FROM comms_messages WHERE school_id = $1 AND (variables ->> '_app' = ANY($2::text[]) OR variables ->> '_query' = ANY($3::text[]))`,
    [SCHOOL, apps.map(String), queries.map(String)],
  );
  await del('queries', `DELETE FROM parent_queries WHERE id = ANY($1::bigint[])`, [queries]);
  await c.query(
    `UPDATE admission_enquiries SET application_id = NULL, updated_at = now() WHERE application_id = ANY($1::bigint[])`,
    [apps],
  );
  await c.query(
    `UPDATE applications SET registration_receipt_id = NULL, admission_receipt_id = NULL, possible_duplicate_of = NULL, student_id = NULL WHERE id = ANY($1::bigint[])`,
    [apps],
  );
  await del('refunds', `DELETE FROM admission_refunds WHERE application_id = ANY($1::bigint[])`, [
    apps,
  ]);
  await del('offers', `DELETE FROM admission_offers WHERE application_id = ANY($1::bigint[])`, [
    apps,
  ]);
  await del('receipts', `DELETE FROM misc_receipts WHERE id = ANY($1::bigint[])`, [receipts]);
  await del('registrations', `DELETE FROM applications WHERE id = ANY($1::bigint[])`, [apps]);
  // the student admitted from a registration, and what was made for it
  for (const t of [
    'student_status_history',
    'student_guardians',
    'enrolments',
    'student_corrections',
  ])
    await del(`student ${t}`, `DELETE FROM ${t} WHERE student_id = ANY($1::bigint[])`, [students]);
  await del('students', `DELETE FROM students WHERE id = ANY($1::bigint[])`, [students]);
  // families with nothing else at the school
  await del(
    'family sign-ins',
    `DELETE FROM applicants a WHERE a.id = ANY($1::bigint[])
      AND NOT EXISTS (SELECT 1 FROM applications x WHERE x.applicant_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM appointments x WHERE x.applicant_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM visitor_log x WHERE x.applicant_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM parent_queries x WHERE x.applicant_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM admission_passcodes x WHERE x.used_by = a.id)`,
    [applicants],
  );
  await c.query(`UPDATE application_sequences SET last_serial = 0 WHERE school_id = $1`, [SCHOOL]);
  await c.query('COMMIT');
  return n;
}

// ---- seed --------------------------------------------------------------------------------------------
// a small seeded random, so the same 50 come every run
let seed = 4902;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (l) => l[Math.floor(rnd() * l.length)];
const FIRST_M = [
  'Aarav',
  'Vihaan',
  'Arjun',
  'Reyansh',
  'Kabir',
  'Ishaan',
  'Advait',
  'Dhruv',
  'Ayaan',
  'Rudra',
  'Atharv',
  'Shaurya',
  'Krish',
  'Vivaan',
  'Aryan',
];
const FIRST_F = [
  'Ananya',
  'Diya',
  'Saanvi',
  'Aadhya',
  'Myra',
  'Kiara',
  'Ira',
  'Navya',
  'Anika',
  'Pari',
  'Riya',
  'Siya',
  'Avni',
  'Tara',
  'Meher',
];
const LAST = [
  'Sharma',
  'Verma',
  'Gupta',
  'Malhotra',
  'Bansal',
  'Mehta',
  'Kapoor',
  'Arora',
  'Chawla',
  'Bhatia',
  'Agarwal',
  'Saxena',
  'Khanna',
  'Sethi',
  'Goel',
];
const FATHER = [
  'Rajesh',
  'Amit',
  'Sanjay',
  'Vikas',
  'Manoj',
  'Rahul',
  'Deepak',
  'Sunil',
  'Anil',
  'Naveen',
];
const MOTHER = [
  'Priya',
  'Neha',
  'Pooja',
  'Sunita',
  'Kavita',
  'Anjali',
  'Ritu',
  'Shalini',
  'Meena',
  'Nisha',
];

async function seedAll() {
  const meta = await api('GET', '/admissions/forms/meta');
  const O = meta.options;
  const form = await api('GET', `/admissions/forms/${FORM}`);
  const tables = await api('GET', '/admissions/score-tables');
  const localities = tables.options.locality.filter((x) =>
    tables.locality.some((r) => r.name === x),
  );
  const students = await q(
    `SELECT admission_no, first_name, last_name FROM students WHERE school_id = $1 AND deleted_at IS NULL AND status = 'active' ORDER BY id LIMIT 30`,
    [SCHOOL],
  );
  const fileId =
    (await q(`SELECT id::text FROM files WHERE school_id = $1 ORDER BY id LIMIT 1`, [SCHOOL]))[0]
      ?.id ?? '1';
  const setup = await api('GET', '/admissions/setup');
  const categories = setup.categories.filter((k) => k.status === 'active');
  const fees = await q(
    `SELECT class_id::text, category_id::text, registration_fee::text FROM admission_fees WHERE cycle_id = $1`,
    [CYCLE],
  );
  const processes = await q(
    `SELECT pc.class_id::text, p.id::text, p.steps FROM admission_process_classes pc JOIN admission_processes p ON p.id = pc.process_id AND p.status = 'active' WHERE pc.school_id = $1`,
    [SCHOOL],
  );
  const plan = [
    ...Array.from({ length: 20 }, () => ({ cls: '164', name: 'Class I', year: 2021 })),
    ...Array.from({ length: 15 }, () => ({ cls: '169', name: 'Class VI', year: 2016 })),
    ...Array.from({ length: 15 }, () => ({ cls: '172', name: 'Class IX', year: 2013 })),
  ];
  await c.query('BEGIN');
  await tenant();
  const made = [];
  for (const [i, p] of plan.entries()) {
    const girl = i % 9 === 1 || i % 9 === 4 || i % 9 === 6 || i % 9 === 8;
    const first = girl ? FIRST_F[i % FIRST_F.length] : FIRST_M[i % FIRST_M.length];
    const last = LAST[(i * 7) % LAST.length];
    const fatherName = `${FATHER[i % FATHER.length]} ${last}`;
    const motherName = `${MOTHER[(i * 3) % MOTHER.length]} ${last}`;
    const mobile = `90000${String(41000 + i).padStart(5, '0')}`;
    const email = `merit.sample${i + 1}@example.invalid`;
    // the cases each criterion needs, spread over the 50
    const sibling = i % 3 === 0; // a third have a sibling
    const siblingNotFound = i === 9 || i === 33; // two give a number that is not a student
    const staff = !sibling && i % 5 === 2 ? pick(['Father', 'Mother', 'Both']) : 'No';
    const fAlum = i % 4 === 1 || i % 11 === 0;
    const mAlum = i % 6 === 3 || i % 11 === 0; // i % 11 === 0: both parents alumni (the cap)
    const cwsn = [5, 17, 28, 41].includes(i);
    const cwsnProof = i === 5 || i === 28;
    const locality =
      i === 12 || i === 37 ? 'Not in the list' : localities[(i * 5) % localities.length];
    const ews = i === 15 || i === 44;
    const singleParent = i === 20 ? 'Mother Only' : i === 31 ? 'Father Only' : 'Not Applicable';
    const sib = sibling
      ? siblingNotFound
        ? [
            {
              admissionNo: `ZZ${String(9000 + i)}`,
              name: `${pick(FIRST_M)} ${last}`,
              classSection: 'V-A',
            },
          ]
        : [
            {
              admissionNo: students[i % students.length]?.admission_no ?? 'A2404',
              name: `${students[i % students.length]?.first_name ?? 'Sibling'} ${last}`,
              classSection: 'IV-B',
            },
          ]
      : [];
    const dob = `${p.year}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + ((i * 3) % 27)).padStart(2, '0')}`;
    const edu = O.Education;
    const data = {
      first_name: first.toUpperCase(),
      last_name: last.toUpperCase(),
      dob,
      gender: girl ? 'Female' : 'Male',
      sms_mobile: mobile,
      primary_email: email,
      mother_tongue: pick(O.MotherTongue.slice(0, 4)),
      aadhaar_no: `enc:${encryptField(String(400000000000 + i * 7919))}`,
      udise_no: String(6000000000 + i * 37).slice(0, 11),
      single_parent: singleParent,
      transport_required: i % 2 ? 'Yes' : 'No',
      previous_class: p.cls === '164' ? 'KG' : p.cls === '169' ? 'V' : 'VIII',
      previous_school: pick([
        'Little Angels School',
        'Modern Public School',
        'St. Mary Convent',
        'Green Valley School',
      ]),
      second_language: 'Hindi',
      third_language_studied: 'Sanskrit',
      third_language: 'Sanskrit',
      staff_child: staff,
      ...(staff === 'Father' || staff === 'Both'
        ? { father_staff_school: pick(O.GroupSchool) }
        : {}),
      ...(staff === 'Mother' || staff === 'Both'
        ? { mother_staff_school: pick(O.GroupSchool) }
        : {}),
      cwsn: cwsn ? 'Yes' : 'No',
      ...(cwsn ? { type_of_disability: pick(O.Disability.slice(0, 6)) } : {}),
      ews: ews ? 'Yes' : 'No',
      residential_address: `House ${100 + i}, ${locality === 'Not in the list' ? 'Sector 86' : locality}`,
      residential_city: 'Faridabad',
      residential_pin_code: String(121001 + (i % 9)),
      permanent_same_box: true,
      permanent_address: `House ${100 + i}, Faridabad`,
      locality,
      siblings: { count: sib.length, list: sib },
      ...(singleParent !== 'Mother Only'
        ? {
            father_name: fatherName.toUpperCase(),
            father_education: edu[(i * 3) % edu.length],
            father_occupation: pick(O.Occupation.slice(0, 8)),
            father_designation: 'Manager',
            father_organisation: 'Sample Pvt Ltd',
            father_mobile: `90000${String(51000 + i)}`,
            father_email: `father${i + 1}@example.invalid`,
            father_nationality: 'Indian',
            father_alumnus: fAlum ? 'Yes' : 'No',
            ...(fAlum
              ? {
                  father_cbse_roll: String(7000000 + i),
                  father_passout_year: String(1995 + (i % 10)),
                  father_alumni_school:
                    i % 11 === 0
                      ? SCHOOL_NAME
                      : pick([SCHOOL_NAME, 'Beta Public School', 'DPS - Faridabad']),
                  father_alumni_class: i % 2 ? 'XII' : 'X',
                }
              : {}),
          }
        : {}),
      ...(singleParent !== 'Father Only'
        ? {
            mother_name: motherName.toUpperCase(),
            mother_education: edu[(i * 5 + 2) % edu.length],
            mother_occupation: pick(O.Occupation.slice(0, 8)),
            mother_designation: 'Teacher',
            mother_organisation: 'Sample School',
            mother_mobile: `90000${String(61000 + i)}`,
            mother_email: `mother${i + 1}@example.invalid`,
            mother_nationality: 'Indian',
            mother_alumnus: mAlum ? 'Yes' : 'No',
            ...(mAlum
              ? {
                  mother_maiden_name: `${MOTHER[i % MOTHER.length]} Rao`.toUpperCase(),
                  mother_cbse_roll: String(8000000 + i),
                  mother_passout_year: String(1997 + (i % 10)),
                  mother_alumni_school:
                    i % 11 === 0 ? SCHOOL_NAME : pick([SCHOOL_NAME, 'DPS - Faridabad']),
                  mother_alumni_class: 'XII',
                }
              : {}),
          }
        : {}),
      student_photo: [fileId],
      ...(singleParent !== 'Mother Only' ? { father_photo: [fileId] } : {}),
      ...(singleParent !== 'Father Only' ? { mother_photo: [fileId] } : {}),
      birth_certificate: [fileId],
      address_proof_1: [fileId],
      ...(fAlum ? { father_alumni_proof: [fileId] } : {}),
      ...(mAlum ? { mother_alumni_proof: [fileId] } : {}),
      ...(sib.length ? { sibling_proof: [fileId] } : {}),
      ...(cwsnProof ? { cwsn_certificate: [fileId] } : {}),
      agree: true,
    };
    const cat = matchCategory(categories, data);
    const fee =
      fees.find((f) => f.class_id === p.cls && f.category_id === cat?.id)?.registration_fee ?? '0';
    const applicant = (
      await q(
        `INSERT INTO applicants (school_id, mobile, name, email) VALUES ($1, $2, $3, $4) RETURNING id::text`,
        [SCHOOL, mobile, motherName, email],
      )
    )[0].id;
    const no = (await q(`SELECT * FROM app.next_application_no($1)`, [CYCLE]))[0];
    const proc = processes.find((x) => x.class_id === p.cls);
    const at = new Date(Date.now() - (50 - i) * 3600_000 * 5);
    const app = (
      await q(
        `INSERT INTO applications (school_id, cycle_id, class_id, applicant_id, application_no, serial, status, child_first_name, child_last_name,
                                 child_dob, child_gender, data, form_id, form_snapshot, category_id, registration_fee, registered_at, submitted_at,
                                 progress, candidate_name, contact_mobile, contact_email, process_id, process_steps, stage_no, level_no, level_since, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'registered', $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb, $14, $15, $16, $16, 100, $17, $18, $19,
               $20, $21::jsonb, $22, $23, $16, $16)
       RETURNING id::text`,
        [
          SCHOOL,
          CYCLE,
          p.cls,
          applicant,
          no.application_no,
          no.serial,
          data.first_name,
          data.last_name,
          dob,
          girl ? 'female' : 'male',
          JSON.stringify(data),
          FORM,
          JSON.stringify(form.def),
          cat?.id ?? null,
          fee,
          at,
          `${data.first_name} ${data.last_name}`,
          mobile,
          email,
          proc?.id ?? null,
          proc ? JSON.stringify(proc.steps) : null,
          proc ? 0 : null,
          proc ? 1 : null,
        ],
      )
    )[0].id;
    await c.query(
      `INSERT INTO application_events (school_id, application_id, from_status, to_status, note, created_at)
                   VALUES ($1, $2, 'submitted', 'registered', $3, $4)`,
      [SCHOOL, app, `Registered: ${no.application_no} (sample data, docs/design/49)`, at],
    );
    made.push(app);
  }
  await c.query('COMMIT');
  return made.length;
}

// ---- check -------------------------------------------------------------------------------------------
// the old formula worked out here on its own, from the answers and the tables
async function check() {
  const tables = await api('GET', '/admissions/score-tables');
  const pts = await api('GET', `/admissions/cycles/${CYCLE}/points`);
  const max = pts.max ?? null;
  const low = (s) =>
    String(s ?? '')
      .trim()
      .toLowerCase();
  const pk = (s) => ({ x: '10', 10: '10', xii: '12', 12: '12' })[low(s)] ?? low(s);
  const qual = (name, role) => {
    const r = tables.qualification.find((x) => low(x.name) === low(name));
    return r ? (role === 'father' ? r.fatherScore : r.motherScore) : null;
  };
  const apps = await q(
    `SELECT a.id::text, a.application_no, a.candidate_name, a.class_id::text, cl.name AS class_name, a.data, a.form_points::text,
                               a.points_breakdown, k.name AS category
                          FROM applications a JOIN classes cl ON cl.id = a.class_id LEFT JOIN admission_fee_categories k ON k.id = a.category_id
                         WHERE a.school_id = $1 AND a.cycle_id = $2 ORDER BY a.id`,
    [SCHOOL, CYCLE],
  );
  const known = new Set(
    (
      await q(
        `SELECT lower(admission_no) AS n FROM students WHERE school_id = $1 AND deleted_at IS NULL AND status = 'active'`,
        [SCHOOL],
      )
    ).map((x) => x.n),
  );
  const crit = pts.session.map((r) => r.name);
  const stats = Object.fromEntries(
    crit.map((k) => [k, { scored: 0, min: Infinity, max: -Infinity, checks: 0 }]),
  );
  const bad = [];
  for (const a of apps) {
    const d = a.data;
    const loc = tables.locality.find(
      (x) => low(x.name) === low(d.locality) && (x.classId === a.class_id || !x.classId),
    );
    const alum = (school, cls) => {
      if (!cls) return 0;
      const r = tables.alumni_school.find(
        (x) => low(x.name) === low(school || SCHOOL_NAME) && pk(x.passoutClass) === pk(cls),
      );
      return r ? r.score : 0;
    };
    const fAlum =
      d.father_alumnus === 'Yes' ? alum(d.father_alumni_school, d.father_alumni_class) : 0;
    const mAlum =
      d.mother_alumnus === 'Yes' ? alum(d.mother_alumni_school, d.mother_alumni_class) : 0;
    const sibs = (d.siblings?.list ?? []).map((x) => low(x.admissionNo)).filter(Boolean);
    const want = {
      "Parents' education": Math.min(
        20,
        (d.father_education ? (qual(d.father_education, 'father') ?? 0) : 0) +
          (d.mother_education ? (qual(d.mother_education, 'mother') ?? 0) : 0),
      ),
      'Distance (locality)': Math.min(30, loc ? loc.score : 0),
      'Alumni parents (school list)': Math.min(20, fAlum + mAlum),
      'Sibling studies here (checked)': sibs.some((n) => known.has(n)) ? 26 : 0,
      'Child of a staff member': ['Father', 'Mother', 'Both'].includes(d.staff_child) ? 25 : 0,
      'Girl child': d.gender === 'Female' ? 5 : 0,
      'Single girl child': d.gender === 'Female' && (d.siblings?.count ?? 0) === 0 ? 10 : 0,
      'Child with special needs':
        d.cwsn === 'Yes' && Array.isArray(d.cwsn_certificate) && d.cwsn_certificate.length ? 5 : 0,
    };
    const lines = a.points_breakdown ?? [];
    for (const k of crit) {
      const got = lines.find((l) => l.name === k);
      const w = want[k] ?? 0;
      if (!got || Number(got.points) !== w)
        bad.push(`${a.application_no} ${k}: expected ${w}, EduPro ${got ? got.points : 'no line'}`);
      if (got?.check) stats[k].checks += 1;
      if (w > 0) stats[k].scored += 1;
      stats[k].min = Math.min(stats[k].min, w);
      stats[k].max = Math.max(stats[k].max, w);
    }
    const total = Object.values(want).reduce((s, v) => s + v, 0);
    const wantTotal = max ? Math.min(total, max) : total;
    if (Number(a.form_points ?? 0) !== wantTotal)
      bad.push(`${a.application_no} total: expected ${wantTotal}, EduPro ${a.form_points}`);
    a.total = Number(a.form_points ?? 0);
  }
  console.log(
    `\n${apps.length} registrations checked against the formula worked out here; total out of ${max ?? '-'}`,
  );
  console.table(
    Object.fromEntries(
      crit.map((k) => [
        k,
        {
          scored: stats[k].scored,
          lowest: stats[k].min === Infinity ? '-' : stats[k].min,
          highest: stats[k].max === -Infinity ? '-' : stats[k].max,
          'to check': stats[k].checks,
        },
      ]),
    ),
  );
  console.log(
    bad.length
      ? `MISMATCHES (${bad.length}):\n${bad.join('\n')}`
      : 'Mismatches: 0 — every line and total agrees.',
  );
  const cats = {};
  for (const a of apps) cats[a.category ?? '-'] = (cats[a.category ?? '-'] ?? 0) + 1;
  console.log('Fee categories:', JSON.stringify(cats));
  for (const cls of [...new Set(apps.map((a) => a.class_name))]) {
    const top = apps
      .filter((a) => a.class_name === cls)
      .sort((x, y) => y.total - x.total)
      .slice(0, 10);
    console.log(
      `\nTop ${top.length} of ${cls}: ${top.map((a) => `${a.candidate_name} ${a.total}`).join(' · ')}`,
    );
  }
  return bad.length;
}

try {
  if (args.has('--yes')) {
    const n = await clear();
    console.log('Removed:', JSON.stringify(n));
    console.log('Seeded:', await seedAll(), 'registrations');
    const r = await api('POST', `/admissions/cycles/${CYCLE}/points/recalculate`, {});
    console.log(`Points worked out by EduPro for ${r.recalculated} registrations`);
  }
  if (args.has('--files')) console.log('Registrations given their own files:', await fixFiles());
  const bad = args.has('--files') && !args.has('--check') && !args.has('--yes') ? 0 : await check();
  process.exitCode = bad ? 2 : 0;
} catch (e) {
  await c.query('ROLLBACK').catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await c.end();
}
