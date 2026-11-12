#!/usr/bin/env node
/**
 * Sample staff leave and attendance for the Alpha demo school (docs/design/85): October and November 2026,
 * every kind of day and every kind of leave in every state, spread over the staff (all but the user's own
 * E021 and E022), so each person's two months read like real ones.
 *
 *   Days (1 Oct – yesterday) from the staff-room biometric machine's log, as its upload records it (2–4
 *   punches a day with lunch out and back, double taps, a card nobody holds; staff with no biometric ID by
 *   the sheet upload): present on time, late in (late marks: one waived, one cleared by
 *   an approved correction, three in a month taken as a day, the rest lapsed), early going, short hours
 *   (half day), one punch only (missing punches: corrected on request or by the office, still open, or
 *   taken as a day and given back when the punches were corrected), absent (charged after 7 days — the
 *   balance by the deduction order, then loss of pay; one still waiting), salary hold, a weekly off worked
 *   (comp-off), bus duty, weekly offs and holidays from the calendar, office corrections (one day and bulk)
 *   with reasons, and correction requests waiting, approved, rejected and withdrawn.
 *   Leave (October and all of November): CL, EL, SL, HPL, CO, OD, WFH, ML, PL and LOP; full days, several
 *   days, first and second half; waiting at level 1 and level 2, approved (one, two and three levels),
 *   rejected at either level, withdrawn, cancelled by the office, cancellation asked / approved / refused,
 *   decided by the office for the approvers, trimmed, entered by the office (one replacing a leave), short of
 *   balance (part paid, part loss of pay) and the sandwich over a weekend and over a holiday. Staff who may
 *   not apply for themselves (in Alpha E013, E014, E019: no role) have their leave entered by the office.
 *   Balances: October opens with a brought-forward figure for each type and gets the half-yearly (and the
 *   contract staff's quarterly) credit; November carries October's closing; October is closed.
 *
 * How: what a person does goes through the API as that person (applying, approving, withdrawing, asking to
 * cancel, asking for a correction) and what the office does as dev-admin; what the nightly run does is done
 * by the module's own database functions, for the sample staff only (absent marks, late marks, missing
 * punches, the 7-day sweep, the month's deductions). Every step is done in date order and then dated as it
 * would have happened (an October leave applied in October and approved the next morning), and the balance
 * ledger is laid out the same way (days held in the month the leave was raised).
 *
 * No message goes out: Alpha's leave messages (e-mail, app, WhatsApp, SMS) are switched off while it runs and
 * put back as they were after, and the run checks that nothing was queued. It can be run again: it first
 * clears October and November of the sample staff (their leave, days, punches, marks, corrections and those
 * months' balances); E021 / E022 (SAMPLE_SKIP) are never touched.
 *
 * Needs the local database (DATABASE_MIGRATOR_URL and DATABASE_URL on localhost, read from .env when not
 * set) and the API on :4000. From the repository root:
 *   node scripts/seed-leave-sample.mjs           (what is there now, what would be replaced)
 *   node scripts/seed-leave-sample.mjs --yes     (replaces it with the sample)
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
const pg = require('pg');

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const SCHOOL = '1';
const OFFICE = 'dev-admin';
const SKIP = (process.env.SAMPLE_SKIP ?? 'E021,E022')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);
const WRITE = process.argv.includes('--yes');
const FROM = '2026-10-01';
const TO = '2026-11-30';
const OCT = '2026-10-01';
const NOV = '2026-11-01';

if (!process.env.DATABASE_MIGRATOR_URL || !process.env.DATABASE_URL)
  try {
    process.loadEnvFile(new URL('../.env', import.meta.url));
  } catch {
    // no .env: the checks below refuse
  }
const MIG_URL = process.env.DATABASE_MIGRATOR_URL ?? '';
const APP_URL = process.env.DATABASE_URL ?? '';
const local = (u) => /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(u);
if (!local(MIG_URL) || !local(APP_URL)) {
  console.error('Refused: DATABASE_MIGRATOR_URL / DATABASE_URL are not the local database.');
  process.exit(1);
}
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(API)) {
  console.error('Refused: API_URL is not the local API.');
  process.exit(1);
}

// ---- dates ---------------------------------------------------------------------------------------------
const istDay = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const add = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const dmy = (d) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
const ymd = (s) => `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;
const span = (a, b) => {
  const out = [];
  for (let d = a; d <= b; d = add(d, 1)) out.push(d);
  return out;
};
const TODAY = istDay();
if (TODAY < '2026-11-07') {
  console.error('Refused: the sample needs 6 November 2026 to have passed.');
  process.exit(1);
}
/** the last day with punches: yesterday (today is still running) */
const LAST = add(TODAY, -1) < TO ? add(TODAY, -1) : TO;
const hm = (mins) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.round(mins) % 60).padStart(2, '0')}`;
const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** a steady "random" 0 … n-1 for an employee and a day (the same each run) */
const jitter = (key, n) => {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h) % n;
};

// ---- the API -------------------------------------------------------------------------------------------
async function api(method, path, body, user = OFFICE) {
  for (let i = 0; ; i += 1) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer dev:${user}`,
        'x-school-id': SCHOOL,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 429 && i < 10) {
      const s = Number(res.headers.get('retry-after')) || 10;
      await res.text();
      await new Promise((r) => setTimeout(r, (s + 1) * 1000));
      continue;
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok)
      throw new Error(
        `${method} ${path} as ${user} → ${String(res.status)}: ${json?.detail ?? json?.title ?? text}`,
      );
    return json;
  }
}

// ---- the people ------------------------------------------------------------------------------------------
const mig = new pg.Client({ connectionString: MIG_URL });
const app = new pg.Client({ connectionString: APP_URL });
await mig.connect();
await app.connect();
const q = (sql, args = []) => mig.query(sql, args).then((r) => r.rows);
let adminUser = '';
/**
 * The module's own functions, as the nightly run calls them: as the school (row-level security on) and as
 * nobody, so what they change shows as the system's work, not a person's.
 */
async function tenant(fn) {
  await app.query('BEGIN');
  try {
    await app.query(
      `SELECT set_config('app.school_id', $1, true), set_config('app.user_id', '', true),
              set_config('app.allowed_school_ids', $2, true)`,
      [SCHOOL, `{${SCHOOL}}`],
    );
    const r = await fn(app);
    await app.query('COMMIT');
    return r;
  } catch (e) {
    await app.query('ROLLBACK');
    throw e;
  }
}

adminUser = (await q(`SELECT id::text FROM users WHERE oneauth_sub = $1`, [OFFICE]))[0]?.id ?? '';
if (!adminUser) {
  console.error(`Refused: no ${OFFICE} user.`);
  process.exit(1);
}
const staff = await q(
  `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.employee_type AS etype,
          e.department, e.biometric_id AS bio, u.oneauth_sub AS sub
     FROM employees e LEFT JOIN users u ON u.id = e.user_id AND u.deleted_at IS NULL
    WHERE e.school_id = $1 AND e.deleted_at IS NULL AND e.status = 'active' AND e.employee_code IS NOT NULL
    ORDER BY e.employee_code`,
  [SCHOOL],
);
const byCode = new Map(staff.map((s) => [s.code, s]));
// the staff-room biometric machine: the sample's punches come from it, as it records them
const machine =
  (
    await q(
      `SELECT id::text, code, name FROM rfid_devices WHERE school_id = $1 AND kind = 'biometric' AND status = 'active'
        ORDER BY code LIMIT 1`,
      [SCHOOL],
    )
  )[0] ?? null;
/** a card on the machine nobody in the school holds (a new joiner's, not yet on their record) */
const UNKNOWN_CARD = 'BIO-0099';
const sample = staff.filter((s) => !SKIP.includes(s.code));
const ids = sample.map((s) => s.id);
const subOf = new Map(staff.filter((s) => s.sub).map((s) => [s.code, s.sub]));
const userSubs = await q(
  `SELECT display_name AS name, oneauth_sub AS sub FROM users WHERE oneauth_sub LIKE 'dev-%' AND deleted_at IS NULL`,
);
const types = new Map(
  (
    await q(
      `SELECT code, id::text, keeps_balance AS kb, document_needed AS doc FROM staff_leave_types WHERE school_id = $1 AND status = 'active'`,
      [SCHOOL],
    )
  ).map((t) => [t.code, t]),
);

// ---- what is there now -------------------------------------------------------------------------------
const now = await q(
  `SELECT 'leave' AS what, count(*)::int AS n FROM staff_leave_requests
    WHERE employee_id = ANY($1::bigint[]) AND from_date <= $3::date AND to_date >= $2::date
   UNION ALL SELECT 'days', count(*)::int FROM staff_attendance_days WHERE employee_id = ANY($1::bigint[]) AND day BETWEEN $2::date AND $3::date
   UNION ALL SELECT 'punches', count(*)::int FROM staff_punches WHERE employee_id = ANY($1::bigint[])
              AND punched_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND punched_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
   UNION ALL SELECT 'late marks', count(*)::int FROM staff_late_marks WHERE employee_id = ANY($1::bigint[]) AND day BETWEEN $2::date AND $3::date
   UNION ALL SELECT 'missing punches', count(*)::int FROM staff_missing_punches WHERE employee_id = ANY($1::bigint[]) AND day BETWEEN $2::date AND $3::date
   UNION ALL SELECT 'corrections asked', count(*)::int FROM staff_regularisations WHERE employee_id = ANY($1::bigint[]) AND day BETWEEN $2::date AND $3::date
   UNION ALL SELECT 'day changes', count(*)::int FROM staff_attendance_history WHERE employee_id = ANY($1::bigint[]) AND day BETWEEN $2::date AND $3::date
   UNION ALL SELECT 'balance rows', count(*)::int FROM staff_leave_balances WHERE employee_id = ANY($1::bigint[]) AND month BETWEEN $2::date AND $3::date`,
  [ids, FROM, TO],
);
console.log(
  `Alpha, ${String(sample.length)} sample staff (not ${SKIP.join(', ')}), ${dmy(FROM)} to ${dmy(TO)} now:`,
);
for (const r of now) console.log(`  ${r.what.padEnd(18)} ${String(r.n)}`);

// ---- the calendar and each one's timing -----------------------------------------------------------------
const cal = new Map(); // `${emp}|${day}` → { off, s, e, grace, ph, hh, bus }
await tenant(async (c) => {
  const r = await c.query(
    `SELECT e.id::text AS emp, g.d::date::text AS day,
            CASE WHEN app.staff_is_weekoff(e.id, g.d::date) THEN 'WO' WHEN app.staff_is_holiday(e.id, g.d::date, false) THEN 'H' END AS off,
            to_char(t.starts_at, 'HH24:MI') AS s, to_char(t.ends_at, 'HH24:MI') AS e, t.grace, t.present_hours::float AS ph,
            t.half_day_hours::float AS hh, t.bus_duty AS bus
       FROM employees e CROSS JOIN generate_series($1::date, $2::date, interval '1 day') g(d)
       CROSS JOIN LATERAL app.staff_timing(e.id, g.d::date) t
      WHERE e.id = ANY($3::bigint[])`,
    [FROM, TO, ids],
  );
  for (const x of r.rows) cal.set(`${x.emp}|${x.day}`, x);
});
const off = (code, day) => cal.get(`${byCode.get(code).id}|${day}`)?.off ?? null;

// =========================================================================================================
// The sample: each leave and what happens to it, the days that are not plain present, and the office's and
// the staff's corrections. Times are India time; everything is replayed in time order.
// =========================================================================================================
const LEAVES = [];
const L = (key, code, type, from, to, applied, reason, steps = [], o = {}) =>
  LEAVES.push({ key, code, type, from, to, applied, reason, steps, ...o });

// a person's own leave: steps are [action, when, words?]; approve / reject act at the level waiting
L(
  'e001-od',
  'E001',
  'OD',
  '2026-10-15',
  '2026-10-15',
  '2026-10-13T16:20',
  'CBSE regional meeting at Chandigarh',
  [['approve', '2026-10-13T18:05']],
  { doc: 'meeting-letter.pdf' },
);
L(
  'e001-cl',
  'E001',
  'CL',
  '2026-11-20',
  '2026-11-20',
  '2026-11-06T11:00',
  'Personal work at the bank',
);
L(
  'e002-cl',
  'E002',
  'CL',
  '2026-10-23',
  '2026-10-23',
  '2026-10-22T14:10',
  "Parent-teacher meeting at my son's school",
  [['approve', '2026-10-22T17:30']],
  { half: 'second' },
);
L(
  'e002-el',
  'E002',
  'EL',
  '2026-11-26',
  '2026-11-27',
  '2026-11-05T10:30',
  'Family wedding in Lucknow',
);
L(
  'e003-sl',
  'E003',
  'SL',
  '2026-10-13',
  '2026-10-14',
  '2026-10-15T09:05',
  "Viral fever; the doctor's certificate is attached",
  [['approve', '2026-10-15T12:40']],
  { doc: 'medical-certificate.pdf' },
);
L(
  'e003-el',
  'E003',
  'EL',
  '2026-11-16',
  '2026-11-18',
  '2026-11-03T15:00',
  'Travel to my home town',
  [['approve', '2026-11-04T09:20']],
);
L(
  'e004-cl',
  'E004',
  'CL',
  '2026-10-05',
  '2026-10-06',
  '2026-10-01T09:12',
  'Family function in Jaipur',
  [
    ['approve', '2026-10-01T15:40'],
    ['approve', '2026-10-02T10:05'],
  ],
);
L('e004-cl2', 'E004', 'CL', '2026-11-17', '2026-11-18', '2026-11-06T13:25', 'Shifting house');
L(
  'e005-cl',
  'E005',
  'CL',
  '2026-10-07',
  '2026-10-07',
  '2026-10-06T16:45',
  'Vehicle registration at the RTO in the morning',
  [
    ['approve', '2026-10-06T17:30'],
    ['approve', '2026-10-07T07:50'],
  ],
  { half: 'first' },
);
L(
  'e005-el',
  'E005',
  'EL',
  '2026-10-26',
  '2026-10-28',
  '2026-10-16T11:00',
  'Trip to Rishikesh with the family',
  [
    ['approve', '2026-10-16T15:10'],
    ['reject', '2026-10-17T10:20', 'Unit tests that week: please take it after the exams'],
  ],
);
L(
  'e005-pl',
  'E005',
  'PL',
  '2026-11-19',
  '2026-12-03',
  '2026-11-05T09:40',
  'Paternity leave: our baby is due on 18 November',
  [['approve', '2026-11-05T13:15']],
  { doc: 'hospital-letter.pdf' },
);
L(
  'e006-sl',
  'E006',
  'SL',
  '2026-10-09',
  '2026-10-10',
  '2026-10-12T08:50',
  'Food poisoning; the prescription is attached',
  [
    ['approve', '2026-10-12T11:00'],
    ['approve', '2026-10-12T15:30'],
    ['approve', '2026-10-13T09:10'],
  ],
  { doc: 'prescription.pdf' },
);
L(
  'e006-wfh',
  'E006',
  'WFH',
  '2026-10-22',
  '2026-10-22',
  '2026-10-17T12:00',
  'Setting the half-yearly English paper',
  [
    ['approve', '2026-10-17T15:00'],
    ['approve', '2026-10-17T18:00'],
    ['approve', '2026-10-17T19:30'],
  ],
);
L(
  'e007-cl',
  'E007',
  'CL',
  '2026-10-29',
  '2026-10-29',
  '2026-10-26T10:00',
  'Bank loan paperwork',
  [
    ['approve', '2026-10-26T12:00'],
    ['approve', '2026-10-26T16:00'],
    ['askcancel', '2026-10-28T09:30', 'The bank work got done on Saturday; I will come in'],
    ['cancelok', '2026-10-28T14:00'],
    ['cancelok', '2026-10-28T16:20'],
    ['cancelok', '2026-10-28T16:25'],
  ],
  { worked: true },
);
L(
  'e008-el',
  'E008',
  'EL',
  '2026-10-01',
  '2026-10-03',
  '2026-10-05T09:30',
  "At my sister's wedding in Patna",
  [
    ['approve', '2026-10-05T12:00'],
    ['approve', '2026-10-06T10:00'],
  ],
);
L('e008-cl', 'E008', 'CL', '2026-11-13', '2026-11-14', '2026-11-04T12:00', "Sister's engagement", [
  ['approve', '2026-11-05T10:00'],
]);
L(
  'e009-cl',
  'E009',
  'CL',
  '2026-10-27',
  '2026-10-27',
  '2026-10-28T08:45',
  'My child was unwell; I could not inform in time',
  [
    ['approve', '2026-10-28T10:30'],
    ['approve', '2026-10-28T15:00'],
  ],
);
L('e009-cl2', 'E009', 'CL', '2026-11-21', '2026-11-21', '2026-11-06T09:00', "Cousin's wedding", [
  ['reject', '2026-11-06T12:30', 'Annual day rehearsal that Saturday'],
]);
L(
  'e010-el',
  'E010',
  'EL',
  '2026-10-24',
  '2026-10-26',
  '2026-10-14T10:10',
  'Visiting my parents in Dehradun',
  [
    ['approve', '2026-10-14T13:00'],
    ['approve', '2026-10-15T09:45'],
  ],
);
L('e011-cl', 'E011', 'CL', '2026-11-18', '2026-11-18', '2026-11-02T10:00', 'Ration card office', [
  ['withdraw', '2026-11-03T09:15', 'Not needed now'],
]);
L(
  'e011-cl2',
  'E011',
  'CL',
  '2026-11-25',
  '2026-11-25',
  '2026-11-05T16:00',
  "Parent-teacher meeting at my daughter's school",
);
L(
  'e012-od',
  'E012',
  'OD',
  '2026-10-31',
  '2026-10-31',
  '2026-10-29T15:00',
  'Inter-school athletics meet at the district stadium',
  [
    ['approve', '2026-10-29T17:00'],
    ['approve', '2026-10-30T10:00'],
  ],
  { doc: 'meet-circular.pdf' },
);
L(
  'e012-co',
  'E012',
  'CO',
  '2026-11-06',
  '2026-11-06',
  '2026-11-03T09:00',
  'Comp-off for Sunday 25 October (sports meet)',
  [
    ['approve', '2026-11-03T12:00'],
    ['approve', '2026-11-03T16:30'],
  ],
);
L(
  'e013-cl',
  'E013',
  'CL',
  '2026-11-02',
  '2026-11-02',
  '2026-10-31T11:30',
  'Diwali shopping trip with the family (form given to the office)',
  [],
  { by: 'office' },
);
L(
  'e014-cl',
  'E014',
  'CL',
  '2026-10-15',
  '2026-10-16',
  '2026-10-12T10:00',
  'Counselling workshop in Delhi (personal; form given to the office)',
  [],
  { by: 'office' },
);
L(
  'e014-cl2',
  'E014',
  'CL',
  '2026-11-04',
  '2026-11-05',
  '2026-11-03T09:30',
  "My mother's surgery (phoned the office)",
  [],
  { split: true, by: 'office' },
);
L(
  'e016-hpl',
  'E016',
  'HPL',
  '2026-10-26',
  '2026-10-27',
  '2026-10-23T12:00',
  'Back pain; physiotherapy advised',
  [['approve', '2026-10-23T16:00']],
  { doc: 'physio-advice.pdf' },
);
L(
  'e016-el',
  'E016',
  'EL',
  '2026-11-16',
  '2026-11-20',
  '2026-11-06T15:30',
  'Annual family trip to Goa',
);
L(
  'e019-cl',
  'E019',
  'CL',
  '2026-10-07',
  '2026-10-07',
  '2026-10-05T11:00',
  'Personal work (form given to the office)',
  [['cancel', '2026-10-07T10:30', 'He came to work: the leave was not taken']],
  { worked: true, by: 'office' },
);
L(
  'e020-cl',
  'E020',
  'CL',
  '2026-10-22',
  '2026-10-22',
  '2026-10-17T10:00',
  "Nephew's naming ceremony",
  [['approve', '2026-10-17T13:00']],
);
L(
  'e020-ml',
  'E020',
  'ML',
  '2026-11-23',
  add('2026-11-23', 181),
  '2026-11-06T10:00',
  'Maternity leave from 23 November (expected delivery 7 December)',
  [],
  { doc: 'maternity-certificate.pdf' },
);
L(
  'po01-el',
  'PO01',
  'EL',
  '2026-10-12',
  '2026-10-16',
  '2026-10-06T10:00',
  'Family visit to Mysuru',
  [
    ['approve', '2026-10-06T14:00'],
    [
      'trim',
      '2026-10-15T09:00',
      'Came back early: rejoined on 15 October',
      '2026-10-12',
      '2026-10-14',
    ],
  ],
);
L(
  'po01-cl',
  'PO01',
  'CL',
  '2026-11-13',
  '2026-11-13',
  '2026-11-05T12:00',
  'Visit to the passport office',
  [['override', '2026-11-06T09:30', 'The Vice Principal is away: approved by the office']],
);
L(
  'sk01-cl',
  'SK01',
  'CL',
  '2026-10-31',
  '2026-10-31',
  '2026-10-27T11:00',
  'Festival in my village',
  [['reject', '2026-10-27T16:00', 'Stock count on 31 October: please pick another day']],
);
L('sk01-cl2', 'SK01', 'CL', '2026-11-19', '2026-11-19', '2026-11-02T10:00', "Relative's wedding", [
  ['approve', '2026-11-02T15:00'],
  ['askcancel', '2026-11-05T09:00', 'The wedding is postponed'],
]);
L(
  'sk01-cl3',
  'SK01',
  'CL',
  '2026-11-21',
  '2026-11-21',
  '2026-11-02T10:05',
  "Relative's wedding reception",
  [
    ['approve', '2026-11-02T15:05'],
    ['askcancel', '2026-11-05T09:05', 'The reception is postponed too'],
    ['cancelno', '2026-11-05T15:00', 'Relief staff are already arranged for that day'],
  ],
);
// the office's entries for an employee (approved at once; the last replaces a waiting leave)
L(
  'e017-cl',
  'E017',
  'CL',
  '2026-11-03',
  '2026-11-03',
  '2026-11-03T09:10',
  'Called in sick in the morning (phoned the office)',
  [],
  { by: 'office' },
);
L(
  'e018-sl',
  'E018',
  'SL',
  '2026-10-12',
  '2026-10-14',
  '2026-10-15T10:00',
  'In hospital with dengue; the papers are with the office',
  [],
  { by: 'office' },
);
L(
  'e011-od',
  'E011',
  'OD',
  '2026-11-25',
  '2026-11-25',
  '2026-11-06T10:30',
  'District sports meet with the school team',
  [],
  { by: 'office' },
);

// the days that are not plain present: late:M, early:M, short, onein (no OUT), oneout (no IN), none, worked
const DAYS = {
  E004: { '2026-10-12': 'late:22', '2026-10-14': 'late:15', '2026-10-16': 'late:12' },
  E006: { '2026-11-06': 'none' },
  E007: { '2026-10-15': 'onein' },
  E008: { '2026-10-16': 'oneout' },
  E009: { '2026-10-09': 'short', '2026-10-13': 'none' },
  E010: { '2026-10-15': 'early:25' },
  E011: { '2026-10-22': 'late:18', '2026-10-28': 'short' },
  E012: { '2026-10-25': 'worked' },
  E013: { '2026-10-22': 'none', '2026-10-23': 'none', '2026-11-05': 'onein' },
  E015: {
    '2026-10-06': 'late:20',
    '2026-10-07': 'late:18',
    '2026-10-08': 'late:25',
    '2026-10-09': 'late:31',
  },
  E016: { '2026-10-17': 'onein' },
  E017: {
    '2026-10-26': 'onein',
    '2026-10-27': 'onein',
    '2026-10-29': 'onein',
    '2026-10-31': 'onein',
  },
  E018: { '2026-10-29': 'none' },
  E019: {
    '2026-10-27': 'none',
    '2026-10-28': 'none',
    '2026-10-29': 'none',
    '2026-11-02': 'none',
    '2026-11-03': 'none',
    '2026-11-04': 'none',
  },
  E020: { '2026-11-05': 'late:35' },
  WD01: {
    '2026-10-08': 'late:9',
    '2026-10-24': 'late:40',
    '2026-11-02': 'none',
    '2026-11-03': 'none',
  },
};
// the office: [when, what, body]
const OFFICE_ACTS = [
  [
    '2026-10-17T10:00',
    'waive',
    {
      code: 'E004',
      day: '2026-10-16',
      reason: 'Stopped at the gate by a parent; the Principal was told',
    },
  ],
  [
    '2026-10-22T09:30',
    'bulk',
    {
      department: 'Transport',
      from: '2026-10-18',
      to: '2026-10-18',
      dayType: 'P',
      reason: 'School trip to Shimla: bus duty on Sunday',
    },
  ],
  [
    '2026-10-22T10:05',
    'day',
    {
      code: 'E016',
      day: '2026-10-17',
      in: null,
      out: '15:35',
      reason: 'OUT punch missed; signed the register at 3:35 pm',
    },
  ],
  [
    '2026-10-31T09:40',
    'day',
    {
      code: 'E018',
      day: '2026-10-29',
      dayType: 'P',
      reason: 'On the Class VIII field trip to the science centre',
    },
  ],
  [
    '2026-10-31T11:00',
    'day',
    {
      code: 'E019',
      day: '2026-10-27',
      dayType: 'HOLD',
      reason: 'Salary on hold: absent without information',
    },
  ],
  [
    '2026-10-31T11:01',
    'day',
    {
      code: 'E019',
      day: '2026-10-28',
      dayType: 'HOLD',
      reason: 'Salary on hold: absent without information',
    },
  ],
  [
    '2026-10-31T11:02',
    'day',
    {
      code: 'E019',
      day: '2026-10-29',
      dayType: 'HOLD',
      reason: 'Salary on hold: absent without information',
    },
  ],
  [
    '2026-11-02T11:00',
    'adjust',
    {
      code: 'E012',
      type: 'CO',
      days: 1,
      reason: 'Comp-off: worked on Sunday 25 October (inter-house sports meet)',
    },
  ],
];
// the staff's correction requests: [when, code, day, body, then?]
const REGS = [
  [
    '2026-10-16T08:20',
    'E007',
    '2026-10-15',
    { out: '15:40', reason: 'Forgot to punch out after the PTM' },
    ['approve', '2026-10-16T11:00'],
  ],
  [
    '2026-10-16T16:00',
    'E008',
    '2026-10-16',
    { in: '07:58', reason: 'The device did not read my finger in the morning' },
    ['reject', '2026-10-17T09:30', 'Not in the gate register that morning'],
  ],
  [
    '2026-10-22T10:00',
    'E011',
    '2026-10-22',
    { in: '08:00', reason: 'Stuck in a traffic jam near the flyover' },
    ['withdraw', '2026-10-22T12:30', 'I will take the late mark'],
  ],
  [
    '2026-10-24T13:00',
    'WD01',
    '2026-10-24',
    { in: '08:00', reason: 'Hostel night duty till 6 am (warden on call)' },
    ['approve', '2026-10-26T10:00'],
  ],
  [
    '2026-11-02T09:00',
    'E017',
    '2026-10-27',
    { out: '15:40', reason: 'Bus maintenance in the evening: left after the last trip' },
    ['approve', '2026-11-02T12:00'],
  ],
  [
    '2026-11-02T09:02',
    'E017',
    '2026-10-29',
    { out: '15:45', reason: 'Bus maintenance in the evening: left after the last trip' },
    ['approve', '2026-11-02T12:01'],
  ],
  [
    '2026-11-02T09:04',
    'E017',
    '2026-10-31',
    { out: '15:42', reason: 'Bus maintenance in the evening: left after the last trip' },
    ['approve', '2026-11-02T12:02'],
  ],
  [
    '2026-11-05T11:00',
    'E020',
    '2026-11-05',
    { in: '08:00', reason: 'With a student in the medical room from 7:50' },
    null,
  ],
];
// balance brought forward into October, by employee type (E014 has a day of CL)
const OPENING = {
  CL: { teaching: 3, non_teaching: 2, contract: 0 },
  EL: { teaching: 10, non_teaching: 18 },
  SL: { teaching: 5, non_teaching: 5, contract: 5, visiting: 5, '': 5 },
  HPL: { teaching: 20, non_teaching: 20 },
};
const OPENING_OWN = { 'E014|CL': 1 };

// ---- what the days are -----------------------------------------------------------------------------------
const finalStates = new Map(); // leave key → covers its days at the end?
for (const l of LEAVES) {
  const acts = l.steps.map((s) => s[0]);
  const gone =
    acts.includes('reject') ||
    acts.includes('withdraw') ||
    acts.includes('cancel') ||
    acts.includes('cancelok') ||
    l.worked;
  finalStates.set(l.key, !gone);
}
// leave replaced by the office's entry on the same days
finalStates.set('e011-cl2', false);
/** day kind of an employee: present, or a sample day, or no punches under a leave */
function kindOf(code, day) {
  const own = DAYS[code]?.[day];
  if (own) return own;
  if (off(code, day)) return 'off';
  for (const l of LEAVES) {
    if (l.code !== code || day < l.from || day > l.to || !finalStates.get(l.key)) continue;
    const trim = l.steps.find((s) => s[0] === 'trim');
    if (trim && (day < trim[3] || day > trim[4])) continue;
    if (l.half === 'first') return 'halfpm';
    if (l.half === 'second') return 'halfam';
    return 'none';
  }
  return 'present';
}
function punches(code, day) {
  const k = kindOf(code, day);
  const t = cal.get(`${byCode.get(code).id}|${day}`);
  const s = mins(t.s);
  const e = mins(t.e);
  const j = (n, salt = '') => jitter(`${code}|${day}|${salt}`, n);
  if (k === 'off' || k === 'none') return null;
  if (k === 'worked') return { in: '08:30', out: '13:05' };
  if (k === 'present') return { in: hm(s - 2 - j(11, 'i')), out: hm(e + 1 + j(25, 'o')) };
  // a late comer stays on to make up the hours (the day stays a full one; only the late mark is left)
  if (k.startsWith('late:'))
    return { in: hm(s + Number(k.slice(5))), out: hm(e + Number(k.slice(5)) + 3 + j(12, 'o')) };
  if (k.startsWith('early:')) return { in: hm(s - 3 - j(7, 'i')), out: hm(e - Number(k.slice(6))) };
  if (k === 'short') return { in: hm(s - 4), out: hm(s - 4 + Math.round((t.hh + 0.6) * 60)) };
  if (k === 'halfam') return { in: hm(s - 3), out: hm(s + 230) };
  if (k === 'halfpm') return { in: hm(s + 235), out: hm(e + 4) };
  if (k === 'onein') return { in: hm(s - 4 - j(6, 'i')), out: null };
  if (k === 'oneout') return { in: null, out: hm(e + 2 + j(10, 'o')) };
  throw new Error(`no punches for ${k}`);
}

// ---- the plan in time order --------------------------------------------------------------------------------
const EVENTS = [];
const ev = (at, label, run) => EVENTS.push({ at, label, run, seq: EVENTS.length });
const working = span(FROM, LAST);

if (!WRITE) {
  const counts = { leave: LEAVES.length, office: OFFICE_ACTS.length, corrections: REGS.length };
  console.log(
    `\nThe sample: ${String(counts.leave)} leaves (with their decisions), ${String(counts.office)} office actions, ${String(counts.corrections)} correction requests,`,
  );
  console.log(
    `punches for every working day ${dmy(FROM)} – ${dmy(LAST)}, the nightly marks, the 7-day sweep, October's deductions and balances.`,
  );
  const missing = [...new Set([...LEAVES.map((l) => l.code), ...Object.keys(DAYS)])].filter(
    (c) => !byCode.has(c) || SKIP.includes(c),
  );
  if (missing.length)
    console.log(`Not in this school (their part is left out): ${missing.join(', ')}`);
  console.log('\nRun with --yes to replace October and November of the sample staff with it.');
  await mig.end();
  await app.end();
  process.exit(0);
}

// ---- messages off while it runs ----------------------------------------------------------------------------
const before = (await api('GET', '/leave/setup/settings')).settings;
const { updatedAt: _u, ...settings } = before;
let restored = false;
async function restore() {
  if (restored) return;
  restored = true;
  await api('PUT', '/leave/setup/settings', settings);
  console.log(
    `Leave messages put back: e-mail ${settings.sendEmail ? 'on' : 'off'}, app ${settings.sendApp ? 'on' : 'off'}, WhatsApp ${settings.sendWhatsapp ? 'on' : 'off'}, SMS ${settings.sendSms ? 'on' : 'off'}.`,
  );
}
process.on('SIGINT', () => {
  void restore().finally(() => process.exit(130));
});
await api('PUT', '/leave/setup/settings', {
  ...settings,
  sendEmail: false,
  sendApp: false,
  sendWhatsapp: false,
  sendSms: false,
});
console.log('\nLeave messages switched off while the sample is made.');
const commsBefore = (
  await q(`SELECT COALESCE(max(id), 0)::text AS id FROM comms_messages WHERE school_id = $1`, [
    SCHOOL,
  ])
)[0].id;

try {
  // ---- clear October and November of the sample staff ------------------------------------------------------
  await mig.query('BEGIN');
  try {
    const reqs = (
      await mig.query(
        `SELECT id FROM staff_leave_requests WHERE school_id = $1 AND employee_id = ANY($2::bigint[])
            AND from_date <= $4::date AND to_date >= $3::date`,
        [SCHOOL, ids, FROM, TO],
      )
    ).rows.map((r) => r.id);
    const wf = (
      await mig.query(
        `SELECT unnest(ARRAY[workflow_instance_id, cancel_instance_id]) AS id FROM staff_leave_requests WHERE id = ANY($1::bigint[])
         UNION SELECT workflow_instance_id FROM staff_regularisations WHERE employee_id = ANY($2::bigint[]) AND day BETWEEN $3::date AND $4::date`,
        [reqs, ids, FROM, TO],
      )
    ).rows
      .map((r) => r.id)
      .filter(Boolean);
    const del = async (sql, args) => (await mig.query(sql, args)).rowCount;
    const n = {};
    n.lateMarks = await del(
      `DELETE FROM staff_late_marks WHERE employee_id = ANY($1::bigint[]) AND (day BETWEEN $2::date AND $3::date OR request_id = ANY($4::bigint[]))`,
      [ids, FROM, TO, reqs],
    );
    n.missing = await del(
      `DELETE FROM staff_missing_punches WHERE employee_id = ANY($1::bigint[]) AND (day BETWEEN $2::date AND $3::date OR request_id = ANY($4::bigint[]))`,
      [ids, FROM, TO, reqs],
    );
    await mig.query(
      `UPDATE staff_leave_requests SET linked_request_id = NULL WHERE linked_request_id = ANY($1::bigint[])`,
      [reqs],
    );
    await del(`DELETE FROM staff_leave_days WHERE request_id = ANY($1::bigint[])`, [reqs]);
    await del(`DELETE FROM staff_leave_edits WHERE request_id = ANY($1::bigint[])`, [reqs]);
    n.leave = await del(`DELETE FROM staff_leave_requests WHERE id = ANY($1::bigint[])`, [reqs]);
    n.corrections = await del(
      `DELETE FROM staff_regularisations WHERE employee_id = ANY($1::bigint[]) AND day BETWEEN $2::date AND $3::date`,
      [ids, FROM, TO],
    );
    await del(`DELETE FROM workflow_instances WHERE id = ANY($1::bigint[])`, [wf]);
    n.history = await del(
      `DELETE FROM staff_attendance_history WHERE employee_id = ANY($1::bigint[]) AND day BETWEEN $2::date AND $3::date`,
      [ids, FROM, TO],
    );
    n.days = await del(
      `DELETE FROM staff_attendance_days WHERE employee_id = ANY($1::bigint[]) AND day BETWEEN $2::date AND $3::date`,
      [ids, FROM, TO],
    );
    n.punches = await del(
      `DELETE FROM staff_punches WHERE employee_id = ANY($1::bigint[])
          AND punched_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND punched_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
      [ids, FROM, TO],
    );
    n.machine = await del(
      `DELETE FROM punch_logs WHERE school_id = $1 AND (employee_id = ANY($2::bigint[]) OR biometric_id = $5)
          AND punched_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND punched_at < (($4::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
      [SCHOOL, ids, FROM, TO, UNKNOWN_CARD],
    );
    n.balances = await del(
      `DELETE FROM staff_leave_balances WHERE employee_id = ANY($1::bigint[]) AND month BETWEEN $2::date AND $3::date`,
      [ids, OCT, NOV],
    );
    await del(
      `DELETE FROM staff_attendance_runs WHERE school_id = $1 AND month BETWEEN $2::date AND $3::date`,
      [SCHOOL, OCT, NOV],
    );
    await del(
      `DELETE FROM staff_month_locks WHERE school_id = $1 AND month BETWEEN $2::date AND $3::date`,
      [SCHOOL, OCT, NOV],
    );
    // leave numbers carry on from the highest left
    await mig.query(
      `UPDATE staff_leave_counters SET last = COALESCE((SELECT max(substring(number FROM '(\\d+)$')::int)
                                                          FROM staff_leave_requests WHERE school_id = $1 AND number LIKE 'LV/' || fy || '/%'), 0)
        WHERE school_id = $1`,
      [SCHOOL],
    );
    await mig.query('COMMIT');
    console.log(
      `Cleared: ${String(n.leave)} leave, ${String(n.days)} days, ${String(n.punches)} punches (${String(n.machine)} machine log rows), ${String(n.lateMarks)} late marks, ${String(n.missing)} missing punches, ${String(n.corrections)} correction requests, ${String(n.balances)} balance rows.`,
    );
  } catch (e) {
    await mig.query('ROLLBACK');
    throw e;
  }

  // ---- the plan ---------------------------------------------------------------------------------------------
  const leaveIds = new Map(); // key → { id, number }
  const releases = new Map(); // number → [intended dates of actions that give days back]
  const adjustDates = new Map(); // reason → date
  const sweeps = [];
  // October and November–December weekly offs and holidays (written for the month ahead, as the nightly run)
  ev('2026-10-01T00:05', 'weekly offs and holidays, October', () =>
    tenant((c) =>
      c.query(`SELECT app.staff_mark_offdays($1::date, $2::date)`, [OCT, '2026-10-31']),
    ),
  );
  ev('2026-11-01T00:05', 'weekly offs and holidays, November–December', () =>
    tenant((c) =>
      c.query(`SELECT app.staff_mark_offdays($1::date, $2::date)`, [NOV, '2026-12-31']),
    ),
  );
  // October's balances: brought forward, then the month's credit (only the sample staff keep October rows)
  ev('2026-10-01T00:10', 'October balances and credit', () =>
    tenant(async (c) => {
      const kb = [...types.values()].filter((t) => t.kb && t.code !== 'LOP');
      for (const s of sample)
        for (const t of kb) {
          await c.query(`SELECT app.staff_leave_balance_row($1, $2, $3::date)`, [s.id, t.id, OCT]);
          const v = OPENING_OWN[`${s.code}|${t.code}`] ?? OPENING[t.code]?.[s.etype ?? ''] ?? 0;
          await c.query(
            `UPDATE staff_leave_balances SET opening = $3 WHERE employee_id = $1 AND leave_type_id = $2 AND month = '2026-10-01'`,
            [s.id, t.id, v],
          );
        }
      const keep = await c.query(
        `SELECT employee_id::text, leave_type_id::text, month::text, opening::text, credited::text, held::text, correction::text
           FROM staff_leave_balances WHERE employee_id <> ALL($1::bigint[]) ORDER BY 1, 2, 3`,
        [ids],
      );
      await c.query(`SELECT app.staff_leave_credit('2026-10-01'::date)`);
      await c.query(
        `DELETE FROM staff_leave_balances WHERE employee_id <> ALL($1::bigint[]) AND month = '2026-10-01'`,
        [ids],
      );
      const after = await c.query(
        `SELECT employee_id::text, leave_type_id::text, month::text, opening::text, credited::text, held::text, correction::text
           FROM staff_leave_balances WHERE employee_id <> ALL($1::bigint[]) ORDER BY 1, 2, 3`,
        [ids],
      );
      if (JSON.stringify(keep.rows) !== JSON.stringify(after.rows))
        throw new Error("October's credit would change another employee's balance: stopped");
    }),
  );
  // each day: the machine's punches (staff with a biometric ID) and the sheet upload (the others) in the
  // evening, then the night's marks (absent, late, missing punch)
  for (const day of working) {
    const rows = [];
    const taps = []; // [biometric id, 'HH:MM:SS']
    for (const s of sample) {
      const p = punches(s.code, day);
      if (!p) continue;
      if (!machine || !s.bio) {
        rows.push(`${s.code},${day},${p.in ?? ''},${p.out ?? ''}`);
        continue;
      }
      const j = (n, salt) => jitter(`${s.code}|${day}|${salt}`, n);
      if (p.in) {
        taps.push([s.bio, `${p.in}:${String(10 + j(40, 's')).padStart(2, '0')}`]);
        // now and then the finger is put twice: the machine keeps the second as a double tap
        if (j(12, 'dt') === 0)
          taps.push([s.bio, `${p.in}:${String(52 + j(7, 'd2')).padStart(2, '0')}`]);
      }
      // a third of the staff punch out for lunch and back on full days
      const k = kindOf(s.code, day);
      if (
        p.in &&
        p.out &&
        jitter(s.code, 3) === 0 &&
        (k === 'present' || k.startsWith('late') || k.startsWith('early'))
      ) {
        const out = 12 * 60 + 25 + j(25, 'lo');
        taps.push([s.bio, `${hm(out)}:${String(j(60, 'ls')).padStart(2, '0')}`]);
        taps.push([s.bio, `${hm(out + 22 + j(15, 'li'))}:${String(j(60, 'lt')).padStart(2, '0')}`]);
      }
      if (p.out) taps.push([s.bio, `${p.out}:${String(5 + j(50, 'o')).padStart(2, '0')}`]);
    }
    // the unknown card: working days from 22 October (a new joiner whose ID is not on their record yet)
    if (machine && day >= '2026-10-22' && sample[0] && !off(sample[0].code, day)) {
      taps.push([UNKNOWN_CARD, `08:0${String(jitter(day, 9))}:14`]);
      taps.push([UNKNOWN_CARD, `16:1${String(jitter(`${day}o`, 9))}:40`]);
    }
    if (taps.length)
      ev(`${day}T23:20`, `machine punches ${dmy(day)}`, () =>
        tenant(async (c) => {
          // as the machine's upload records them: matched by the biometric ID, a second tap within a
          // minute kept as a double, an ID nobody holds kept as unknown; recorded ones become staff punches
          taps.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
          for (const [bio, t] of taps) {
            const at = `${day}T${t}+05:30`;
            const emp =
              (
                await c.query(
                  `SELECT id::text FROM employees WHERE biometric_id = $1 AND deleted_at IS NULL AND status = 'active'`,
                  [bio],
                )
              ).rows[0]?.id ?? null;
            let outcome = emp ? 'recorded' : 'unknown_id';
            if (emp) {
              const dup = await c.query(
                `SELECT 1 FROM punch_logs WHERE employee_id = $1 AND outcome = 'recorded'
                    AND punched_at BETWEEN $2::timestamptz - interval '60 seconds' AND $2::timestamptz + interval '60 seconds'`,
                [emp, at],
              );
              if (dup.rowCount) outcome = 'duplicate';
            }
            await c.query(
              `INSERT INTO punch_logs (school_id, device_id, employee_id, biometric_id, punched_at, outcome, raw)
               VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7::jsonb) ON CONFLICT (device_id, biometric_id, punched_at) DO NOTHING`,
              [SCHOOL, machine.id, emp, bio, at, outcome, JSON.stringify({ id: bio, at })],
            );
          }
          // the machine was in touch then (as its upload stamps it), and the punches are worked into the
          // days, as the sync does every few minutes
          await c.query(
            `UPDATE rfid_devices SET last_seen_at = GREATEST(COALESCE(last_seen_at, $2::timestamptz), $2::timestamptz) WHERE id = $1`,
            [machine.id, `${day}T23:20:00+05:30`],
          );
          await c.query(`SELECT app.staff_attendance_sync(5000)`);
        }),
      );
    if (rows.length)
      ev(`${day}T23:30`, `punches ${dmy(day)}`, async () => {
        const file = Buffer.from(`Employee,Date,In,Out\n${rows.join('\n')}\n`).toString('base64');
        const r = await api('POST', '/staff-attendance/sheets/punches/import', {
          file,
          dryRun: false,
        });
        const bad = r.rows.filter((x) => !x.ok);
        if (bad.length)
          throw new Error(
            `punches ${day}: ${bad.map((x) => `${String(x.row)} ${x.error}`).join('; ')}`,
          );
      });
    ev(`${add(day, 1)}T01:00`, `absent marks ${dmy(day)}`, () =>
      tenant(async (c) => {
        const r = await c.query(
          `SELECT e.id FROM employees e
            WHERE e.id = ANY($1::bigint[]) AND (e.joined_on IS NULL OR e.joined_on <= $2::date)
              AND NOT EXISTS (SELECT 1 FROM staff_attendance_days a WHERE a.employee_id = e.id AND a.day = $2::date)
              AND NOT EXISTS (SELECT 1 FROM staff_leave_days x WHERE x.employee_id = e.id AND x.day = $2::date AND x.status IN ('pending', 'approved'))
              AND NOT EXISTS (SELECT 1 FROM staff_regularisations g WHERE g.employee_id = e.id AND g.day = $2::date AND g.status = 'pending')
              AND NOT EXISTS (SELECT 1 FROM staff_punches p WHERE p.employee_id = e.id AND (p.punched_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date)
              AND NOT app.staff_is_weekoff(e.id, $2::date) AND NOT app.staff_is_holiday(e.id, $2::date, false)`,
          [ids, day],
        );
        for (const x of r.rows)
          await c.query(
            `SELECT app.staff_day_write(jsonb_populate_record(NULL::staff_attendance_days,
                      jsonb_build_object('school_id', $1::bigint, 'employee_id', $2::bigint, 'day', $3::date, 'day_type', 'A',
                                         'source', 'absent', 'remark', 'No punch recorded')), 'marked absent')`,
            [SCHOOL, x.id, day],
          );
      }),
    );
    ev(`${add(day, 1)}T01:05`, `late marks ${dmy(day)}`, () =>
      tenant((c) => c.query(`SELECT app.staff_late_marks($1::date)`, [day])),
    );
    ev(`${add(day, 1)}T01:10`, `missing punches ${dmy(day)}`, () =>
      tenant((c) => c.query(`SELECT app.staff_missing_detect($1::date, $1::date)`, [day])),
    );
    // after 7 days an absent day with no leave is charged (the balance by the deduction order, else LOP)
    const sweepAt = `${add(day, 8)}T02:00`;
    if (add(day, 8) <= TODAY && day < add(TODAY, -7))
      ev(sweepAt, `7-day sweep ${dmy(day)}`, () =>
        tenant(async (c) => {
          const r = await c.query(
            `SELECT a.employee_id FROM staff_attendance_days a
              WHERE a.employee_id = ANY($1::bigint[]) AND a.day = $2::date AND a.day_type = 'A'
                AND NOT EXISTS (SELECT 1 FROM staff_leave_days x WHERE x.employee_id = a.employee_id AND x.day = a.day AND x.status IN ('pending', 'approved'))
                AND NOT EXISTS (SELECT 1 FROM staff_regularisations g WHERE g.employee_id = a.employee_id AND g.day = a.day AND g.status = 'pending')`,
            [ids, day],
          );
          for (const x of r.rows) {
            const id = (
              await c.query(
                `SELECT app.staff_leave_auto_deduct($1, $2::date, 1, 'auto_absent', format('Absent on %s with no leave applied', to_char($2::date, 'DD-MM-YYYY'))) AS id`,
                [x.employee_id, day],
              )
            ).rows[0].id;
            if (id) {
              await c.query(`SELECT app.staff_attendance_apply_leave($1)`, [id]);
              sweeps.push(day);
            }
          }
        }),
      );
  }
  // October's late marks and missing punches taken as days (the nightly run of 1 November)
  ev('2026-11-01T01:30', "October's deductions", () =>
    api('POST', '/staff-attendance/run', { what: 'deduct', month: '2026-10' }),
  );

  // the leave
  const detailOf = (id) => api('GET', `/leave/requests/${id}`);
  const subFor = (person) => {
    const m = /^(\S+) — /.exec(person) ?? /\((\w+)\)$/.exec(person);
    if (m && subOf.has(m[1])) return subOf.get(m[1]);
    return userSubs.find((u) => u.name === person)?.sub ?? null;
  };
  const actor = (steps, current) => {
    const step = steps.find(
      (s) => s.status === 'pending' && (current == null || s.level === current),
    );
    for (const p of step?.people ?? []) {
      const sub = subFor(p);
      if (sub) return sub;
    }
    throw new Error(
      `nobody to act at level ${String(step?.level ?? '?')}: ${JSON.stringify(step)}`,
    );
  };
  const pdf = (name) =>
    Buffer.from(
      `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%% ${name} (sample)\n%%EOF\n`,
    );
  async function upload(user, name) {
    const bytes = pdf(name);
    const r = await api(
      'POST',
      '/platform/files',
      {
        fileName: name,
        contentType: 'application/pdf',
        sizeBytes: bytes.length,
        classification: 'personal',
      },
      user,
    );
    const url = r.upload.url.startsWith('http')
      ? r.upload.url
      : `${new URL(API).origin}${r.upload.url.startsWith('/api/') ? '' : new URL(API).pathname}${r.upload.url}`;
    const headers = new Headers({ 'content-type': 'application/pdf' });
    for (const [k, v] of Object.entries(r.upload.headers ?? {})) headers.set(k, v);
    const put = await fetch(url, { method: r.upload.method ?? 'PUT', headers, body: bytes });
    if (!put.ok) throw new Error(`upload ${name}: ${String(put.status)} ${await put.text()}`);
    return r.file.id;
  }
  const give = (number, at) =>
    releases.set(number, [...(releases.get(number) ?? []), at.slice(0, 10)]);
  for (const l of LEAVES) {
    const emp = byCode.get(l.code);
    if (!emp || SKIP.includes(l.code)) continue;
    const type = types.get(l.type);
    ev(
      l.applied,
      `${l.key}: ${l.by === 'office' ? 'entered by the office' : 'applied'}`,
      async () => {
        const body = {
          leaveTypeId: type.id,
          from: l.from,
          to: l.to,
          halfDay: !!l.half,
          session: l.half ?? null,
          reason: l.reason,
          splitOk: !!l.split,
        };
        let out;
        // the document the type asks for: the person's own, or one the office holds
        const doc = l.doc ?? (type.doc ? `${l.type.toLowerCase()}-papers.pdf` : null);
        if (l.by === 'office') {
          if (doc) body.documentFileId = await upload(OFFICE, doc);
          out = await api('POST', '/leave/on-behalf', { ...body, employeeId: emp.id });
        } else {
          if (!emp.sub) throw new Error(`${l.code} has no sign-in to apply with`);
          if (doc) body.documentFileId = await upload(emp.sub, doc);
          out = await api('POST', '/leave/apply', body, emp.sub);
        }
        if (out.confirm) throw new Error(`${l.key}: asked to confirm — ${out.confirm.message}`);
        leaveIds.set(l.key, { id: out.id, number: out.number });
        for (const n of out.replaced ?? []) give(n, l.applied);
      },
    );
    for (const [act, at, words, a, b] of l.steps)
      ev(at, `${l.key}: ${act}`, async () => {
        const { id, number } = leaveIds.get(l.key);
        const d = await detailOf(id);
        if (act === 'approve' || act === 'reject') {
          if (d.status !== 'pending') return; // the same person at the next level is not asked again
          const who = actor(d.approval, d.level);
          await api(
            'POST',
            `/leave/requests/${id}/decide`,
            { outcome: act === 'approve' ? 'approved' : 'rejected', note: words ?? '' },
            who,
          );
          if (act === 'reject') give(number, at);
        } else if (act === 'withdraw') {
          await api(
            'POST',
            `/leave/requests/${id}/withdraw`,
            { reason: words ?? '' },
            byCode.get(l.code).sub,
          );
          give(number, at);
        } else if (act === 'cancel') {
          await api('POST', `/leave/requests/${id}/cancel`, { reason: words });
          give(number, at);
        } else if (act === 'askcancel') {
          await api(
            'POST',
            `/leave/requests/${id}/cancel-request`,
            { reason: words },
            byCode.get(l.code).sub,
          );
        } else if (act === 'cancelok' || act === 'cancelno') {
          if (d.cancelStatus !== 'pending') return; // decided at an earlier level already
          const who = actor(d.cancellation, null);
          await api(
            'POST',
            `/leave/requests/${id}/cancel-decide`,
            { outcome: act === 'cancelok' ? 'approved' : 'rejected', note: words ?? '' },
            who,
          );
          const after = await detailOf(id);
          if (after.status === 'cancelled') give(number, at);
        } else if (act === 'override') {
          await api('POST', `/leave/requests/${id}/override`, {
            outcome: 'approved',
            reason: words,
          });
        } else if (act === 'trim') {
          await api('POST', `/leave/requests/${id}/trim`, { from: a, to: b, reason: words });
          give(number, at);
        } else throw new Error(`unknown step ${act}`);
      });
  }
  // the office
  for (const [at, what, b] of OFFICE_ACTS) {
    if (b.code && (!byCode.has(b.code) || SKIP.includes(b.code))) continue;
    ev(at, `office: ${what} ${b.code ?? b.department}`, async () => {
      const emp = b.code ? byCode.get(b.code) : null;
      if (what === 'day')
        await api('POST', '/staff-attendance/days', {
          employeeId: emp.id,
          day: b.day,
          dayType: b.dayType ?? null,
          in: b.in === undefined ? undefined : b.in,
          out: b.out === undefined ? undefined : b.out,
          reason: b.reason,
        });
      else if (what === 'bulk')
        await api('POST', '/staff-attendance/days/bulk', {
          department: b.department,
          from: b.from,
          to: b.to,
          dayType: b.dayType,
          reason: b.reason,
        });
      else if (what === 'waive') {
        const r = await api(
          'GET',
          `/staff-attendance/exceptions?kind=late&month=${b.day.slice(0, 7)}&employeeId=${emp.id}&size=100`,
        );
        const mark = r.rows.find((x) => x.day === b.day);
        if (!mark) throw new Error(`no late mark of ${b.code} on ${b.day}`);
        await api('POST', `/staff-attendance/late-marks/${mark.id}/waive`, { reason: b.reason });
      } else if (what === 'adjust') {
        await api('POST', '/leave/balances/adjust', {
          employeeId: emp.id,
          leaveTypeId: types.get(b.type).id,
          days: b.days,
          reason: b.reason,
        });
        adjustDates.set(b.reason, at.slice(0, 10));
      } else throw new Error(`unknown office act ${what}`);
    });
  }
  // the staff's correction requests
  const regApprover = new Map();
  for (const [at, code, day, b, then] of REGS) {
    const emp = byCode.get(code);
    if (!emp || SKIP.includes(code)) continue;
    let regId = null;
    ev(at, `${code}: correction asked for ${dmy(day)}`, async () => {
      regId = (
        await api(
          'POST',
          '/staff-attendance/regularisations',
          { day, in: b.in ?? null, out: b.out ?? null, reason: b.reason },
          emp.sub,
        )
      ).id;
    });
    if (then)
      ev(then[1], `${code}: correction ${then[0]}`, async () => {
        if (then[0] === 'withdraw') {
          await api(
            'POST',
            `/staff-attendance/regularisations/${regId}/withdraw`,
            { reason: then[2] ?? '' },
            emp.sub,
          );
          return;
        }
        if (!regApprover.has(code)) {
          const p = await api(
            'GET',
            `/leave/setup/approvals/preview?employeeId=${emp.id}&kind=regularisation&days=1`,
          );
          const sub = (p.levels?.[0]?.people ?? [])
            .map((x) => {
              const m = /\((\w+)\)$/.exec(x);
              return m ? subOf.get(m[1]) : userSubs.find((u) => u.name === x)?.sub;
            })
            .find(Boolean);
          regApprover.set(code, sub);
        }
        await api(
          'POST',
          `/staff-attendance/regularisations/${regId}/decide`,
          { outcome: then[0] === 'approve' ? 'approved' : 'rejected', note: then[2] ?? '' },
          regApprover.get(code),
        );
      });
  }

  // ---- run it, in time order ---------------------------------------------------------------------------------
  EVENTS.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq));
  const late = EVENTS.filter((e) => e.at.slice(0, 10) > TODAY);
  if (late.length)
    throw new Error(`steps dated after today: ${late.map((e) => e.label).join(', ')}`);
  const timeline = [];
  const started = (await q(`SELECT clock_timestamp()::text AS t`))[0].t;
  let done = 0;
  for (const e of EVENTS) {
    const real = (await q(`SELECT clock_timestamp()::text AS t`))[0].t;
    timeline.push([real, `${e.at}:00+05:30`]);
    try {
      await e.run();
    } catch (err) {
      throw new Error(`${e.at} ${e.label}: ${err.message}`);
    }
    done += 1;
    if (done % 50 === 0)
      process.stdout.write(`  ${String(done)} of ${String(EVENTS.length)} steps\n`);
  }
  console.log(
    `Replayed ${String(EVENTS.length)} steps (${String(sweeps.length)} absent days charged by the 7-day sweep).`,
  );

  // ---- date each step as it happened -------------------------------------------------------------------------
  await mig.query('BEGIN');
  try {
    await mig.query(`CREATE TEMP TABLE tl (real timestamptz, intended timestamptz) ON COMMIT DROP`);
    await mig.query(
      `INSERT INTO tl SELECT r::timestamptz, i::timestamptz FROM unnest($1::text[], $2::text[]) AS x(r, i)`,
      [timeline.map((t) => t[0]), timeline.map((t) => t[1])],
    );
    await mig.query(`CREATE INDEX ON tl (real)`);
    await mig.query(
      `CREATE FUNCTION pg_temp.m(t timestamptz) RETURNS timestamptz LANGUAGE sql STABLE AS $$
         SELECT CASE WHEN t IS NULL OR t < (SELECT min(real) FROM tl) THEN t
                     ELSE (SELECT x.intended + (t - x.real) FROM tl x WHERE x.real <= t ORDER BY x.real DESC LIMIT 1) END $$`,
    );
    const mine = `employee_id = ANY($1::bigint[])`;
    const wf = `SELECT unnest(ARRAY[workflow_instance_id, cancel_instance_id]) FROM staff_leave_requests WHERE ${mine}
                UNION SELECT workflow_instance_id FROM staff_regularisations WHERE ${mine}`;
    const upd = [
      `UPDATE staff_leave_requests SET created_at = pg_temp.m(created_at), updated_at = pg_temp.m(updated_at),
              decided_at = pg_temp.m(decided_at), cancel_raised_at = pg_temp.m(cancel_raised_at) WHERE ${mine}`,
      `UPDATE workflow_steps SET due_at = due_at + (pg_temp.m(created_at) - created_at), created_at = pg_temp.m(created_at),
              acted_at = pg_temp.m(acted_at), reminded_at = pg_temp.m(reminded_at), escalated_at = pg_temp.m(escalated_at)
        WHERE instance_id IN (${wf})`,
      `UPDATE workflow_events SET occurred_at = pg_temp.m(occurred_at) WHERE instance_id IN (${wf})`,
      `UPDATE workflow_instances SET requested_at = pg_temp.m(requested_at), completed_at = pg_temp.m(completed_at),
              created_at = pg_temp.m(created_at), updated_at = pg_temp.m(updated_at) WHERE id IN (${wf})`,
      `UPDATE staff_regularisations SET created_at = pg_temp.m(created_at), decided_at = pg_temp.m(decided_at) WHERE ${mine}`,
      `UPDATE staff_attendance_history SET changed_at = pg_temp.m(changed_at) WHERE ${mine}`,
      `UPDATE staff_attendance_days SET updated_at = pg_temp.m(updated_at) WHERE ${mine}`,
      `UPDATE staff_late_marks SET created_at = pg_temp.m(created_at) WHERE ${mine}`,
      `UPDATE staff_missing_punches SET created_at = pg_temp.m(created_at), mailed_at = pg_temp.m(mailed_at) WHERE ${mine}`,
      `UPDATE staff_leave_edits SET edited_at = pg_temp.m(edited_at) WHERE request_id IN (SELECT id FROM staff_leave_requests WHERE ${mine})`,
      `UPDATE staff_punches SET created_at = pg_temp.m(created_at) WHERE ${mine}`,
      `UPDATE punch_logs SET received_at = pg_temp.m(received_at) WHERE (${mine} OR biometric_id = '${UNKNOWN_CARD}') AND school_id = ${SCHOOL}`,
      `UPDATE staff_leave_balances SET updated_at = pg_temp.m(updated_at) WHERE ${mine}`,
    ];
    for (const sql of upd) await mig.query(sql, [ids]);

    // ---- the ledger as it would read: held in the month the leave was raised ---------------------------------
    // every type has its November row (opened as the nightly run would on 1 November)
    await mig.query(
      `SELECT app.staff_leave_balance_row(b.employee_id, b.leave_type_id, '2026-11-01'::date)
         FROM staff_leave_balances b WHERE b.employee_id = ANY($1::bigint[]) AND b.month = '2026-10-01'`,
      [ids],
    );
    const raised = new Map(
      (
        await mig.query(
          `SELECT number, to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day FROM staff_leave_requests WHERE ${mine}`,
          [ids],
        )
      ).rows.map((r) => [r.number, r.day]),
    );
    const rows = (
      await mig.query(
        `SELECT id, employee_id::text AS emp, leave_type_id::text AS type, month::text AS month, opening::float AS opening,
                credited::float AS credited, trail FROM staff_leave_balances
          WHERE ${mine} AND month IN ('2026-10-01', '2026-11-01') ORDER BY month`,
        [ids],
      )
    ).rows;
    const pairs = new Map();
    for (const r of rows) {
      const k = `${r.emp}|${r.type}`;
      pairs.set(k, { ...(pairs.get(k) ?? {}), [r.month === OCT ? 'oct' : 'nov']: r });
    }
    const moved = new Set();
    const gb = new Map([...releases].map(([n, d]) => [n, [...d]]));
    for (const { oct, nov } of pairs.values()) {
      if (!oct || !nov) continue;
      const lines = { [OCT]: [], [NOV]: [] };
      let credit = [];
      for (const line of [...oct.trail, ...nov.trail]) {
        const m = /^(\d\d-\d\d-\d{4}) (.*)$/.exec(line);
        if (!m) continue;
        const rest = m[2];
        if (rest.startsWith('opened with') || rest.startsWith('opening now')) continue;
        if (rest.startsWith('credited ')) {
          credit.push(`01-10-2026 ${rest}`);
          continue;
        }
        const num = /LV\/\d{4}-\d{2}\/\d+/.exec(rest)?.[0];
        let day = ymd(m[1]);
        let month = oct.trail.includes(line) ? OCT : NOV;
        if (num && raised.has(num)) {
          month = `${raised.get(num).slice(0, 7)}-01`;
          if (rest.startsWith('held ')) day = raised.get(num);
          else if (rest.startsWith('given back ')) day = gb.get(num)?.shift() ?? day;
          if (month === OCT) moved.add(num);
        } else if (rest.startsWith('correction ')) {
          const reason = rest.split(' — ').slice(1).join(' — ');
          day = adjustDates.get(reason) ?? day;
        }
        lines[month].push([day, rest]);
      }
      const sum = (ls, re) => ls.reduce((a, [, t]) => a + (Number(re.exec(t)?.[1]) || 0), 0);
      const total = (ls) => sum(ls, /^held ([\d.]+)/) - sum(ls, /^given back ([\d.]+)/);
      const corr = (ls) => sum(ls, /^correction ([+-]?[\d.]+)/);
      const order = (ls) =>
        ls
          .map((x, i) => [...x, i])
          .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[2] - b[2]))
          .map(([d, t]) => `${dmy(d)} ${t}`);
      const octHeld = total(lines[OCT]);
      const octCorr = corr(lines[OCT]);
      const novOpen = Math.round((oct.opening + oct.credited + octCorr - octHeld) * 100) / 100;
      await mig.query(
        `UPDATE staff_leave_balances SET held = $2, correction = $3, trail = $4 WHERE id = $1`,
        [
          oct.id,
          octHeld,
          octCorr,
          [
            `01-10-2026 opened with ${String(oct.opening)} (brought forward)`,
            ...credit,
            ...order(lines[OCT]),
          ],
        ],
      );
      await mig.query(
        `UPDATE staff_leave_balances SET opening = $2, held = $3, correction = $4, trail = $5 WHERE id = $1`,
        [
          nov.id,
          novOpen,
          total(lines[NOV]),
          corr(lines[NOV]),
          [`01-11-2026 opened with ${String(novOpen)} carried from Oct 2026`, ...order(lines[NOV])],
        ],
      );
    }
    // a leave's days are held in the month it was raised
    await mig.query(
      `UPDATE staff_leave_requests SET held_month = date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata')::date
        WHERE ${mine} AND held_month IS NOT NULL AND from_date <= $3::date AND to_date >= $2::date`,
      [ids, FROM, TO],
    );
    void moved;
    await mig.query('COMMIT');
  } catch (e) {
    await mig.query('ROLLBACK');
    throw e;
  }
  // October closed (as the nightly run of 1 November); its closing line dated so
  await api('POST', '/leave/balances/run-month', {});
  await mig.query(
    `UPDATE staff_leave_balances SET trail = ARRAY(SELECT CASE WHEN l ~ '^\\d\\d-\\d\\d-\\d{4} closed at ' THEN '01-11-2026' || substr(l, 11) ELSE l END
                                                    FROM unnest(trail) WITH ORDINALITY AS u(l, i) ORDER BY i)
      WHERE employee_id = ANY($1::bigint[]) AND month = '2026-10-01'`,
    [ids],
  );

  // ---- what it made ------------------------------------------------------------------------------------------
  const sent = (
    await q(
      `SELECT count(*)::int AS n FROM comms_messages WHERE school_id = $1 AND id > $2::bigint`,
      [SCHOOL, commsBefore],
    )
  )[0].n;
  const made = await q(
    `SELECT 'leave: ' || r.status || COALESCE(' (cancellation ' || r.cancel_status || ')', '') AS what, count(*)::int AS n
       FROM staff_leave_requests r WHERE r.employee_id = ANY($1::bigint[]) AND r.from_date <= $3::date AND r.to_date >= $2::date GROUP BY 1
     UNION ALL SELECT 'days: ' || day_type, count(*)::int FROM staff_attendance_days WHERE employee_id = ANY($1::bigint[]) AND day BETWEEN $2::date AND $3::date GROUP BY day_type
     UNION ALL SELECT 'late marks: ' || status, count(*)::int FROM staff_late_marks WHERE employee_id = ANY($1::bigint[]) AND day BETWEEN $2::date AND $3::date GROUP BY status
     UNION ALL SELECT 'missing punches: ' || status, count(*)::int FROM staff_missing_punches WHERE employee_id = ANY($1::bigint[]) AND day BETWEEN $2::date AND $3::date GROUP BY status
     UNION ALL SELECT 'correction requests: ' || status, count(*)::int FROM staff_regularisations WHERE employee_id = ANY($1::bigint[]) AND day BETWEEN $2::date AND $3::date GROUP BY status
     ORDER BY 1`,
    [ids, FROM, TO],
  );
  console.log('\nThe sample now:');
  for (const r of made) console.log(`  ${r.what.padEnd(40)} ${String(r.n)}`);
  console.log(
    sent
      ? `\nWARNING: ${String(sent)} message(s) were queued for Alpha while it ran — look at comms_messages before starting the workers.`
      : '\nNo message was queued.',
  );
  void started;
} finally {
  await restore();
  await mig.end();
  await app.end();
}
