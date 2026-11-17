import { amountInWords, decryptField, maskValue, type PoolClient } from '@edupro/db';

/**
 * What a certificate prints (docs/design/87, "the field catalogue"): the school, the student (identity, parents, the
 * IDs, admission, class), the year's attendance, the subjects studied and the TC's fee facts. Read at issue and frozen
 * into the certificate's `data`, so a reprint never changes.
 */
type Row = Record<string, unknown>;

const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORD = [
  '',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
  'sixteenth',
  'seventeenth',
  'eighteenth',
  'nineteenth',
  'twentieth',
  'twenty-first',
  'twenty-second',
  'twenty-third',
  'twenty-fourth',
  'twenty-fifth',
  'twenty-sixth',
  'twenty-seventh',
  'twenty-eighth',
  'twenty-ninth',
  'thirtieth',
  'thirty-first',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const below100 = (n: number): string =>
  n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]!}${n % 10 ? ` ${ONES[n % 10]!}` : ''}`;
const yearWords = (y: number) => {
  // 2014 → two thousand fourteen; 1999 → nineteen hundred ninety-nine
  if (y >= 2000) return `two thousand${y % 1000 ? ` ${below100(y % 100)}` : ''}`;
  return `${below100(Math.floor(y / 100))} hundred${y % 100 ? ` ${below100(y % 100)}` : ''}`;
};

/** 2014-03-09 → "Ninth March two thousand fourteen" */
export function dateInWords(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  return cap(`${ORD[d] ?? String(d)} ${MONTHS[m - 1] ?? ''} ${yearWords(y)}`);
}
/** "VIII" / "8" / "Class 8" → "Eighth"; anything else as it is */
export function classInWords(cls: string | null | undefined): string {
  if (!cls) return '';
  const roman: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    VII: 7,
    VIII: 8,
    IX: 9,
    X: 10,
    XI: 11,
    XII: 12,
  };
  const s = cls
    .trim()
    .replace(/^class\s+/i, '')
    .split(/[-\s]/)[0]!
    .toUpperCase();
  const n = roman[s] ?? (/^\d{1,2}$/.test(s) ? Number(s) : null);
  if (n === null) {
    const named: Record<string, string> = {
      NUR: 'Nursery',
      NURSERY: 'Nursery',
      LKG: 'Lower KG',
      UKG: 'Upper KG',
      KG: 'Kindergarten',
    };
    return named[s] ?? cls;
  }
  return cap(ORD[n] ?? String(n));
}
const dmy = (iso: string | null | undefined) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso)
    ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`
    : '';
const addressLine = (a: unknown): string => {
  if (!a || typeof a !== 'object') return '';
  const o = a as Record<string, unknown>;
  return ['line1', 'line2', 'city', 'state', 'pin']
    .map((k) => o[k])
    .filter((v) => typeof v === 'string' && v.trim() !== '')
    .join(', ');
};

/** "Class VIII – A" (the word Class once, whether or not the class's name carries it) */
const classLabel = (name: string | null, section: string | null) => {
  if (!name) return '';
  const n = /^class\b/i.test(name.trim()) ? name.trim() : `Class ${name.trim()}`;
  return section ? `${n} – ${section}` : n;
};

/**
 * The words for a person by gender: "son of", "he", "him", "his" … (`pronounCap` stays the possessive "His", as the
 * first certificates printed it; `pronounSubjCap` is "He").
 */
export function pronouns(gender: string | null | undefined) {
  const g = (gender ?? '').toLowerCase();
  const f = g.startsWith('f');
  const m = g.startsWith('m');
  const pick = (a: string, b: string, c: string) => (f ? a : m ? b : c);
  return {
    childOf: pick('daughter', 'son', 'ward'),
    honorific: pick('Ms.', 'Mr.', 'Mx.'),
    pronoun: pick('she', 'he', 'they'),
    pronounObj: pick('her', 'him', 'them'),
    pronounPoss: pick('her', 'his', 'their'),
    pronounCap: pick('Her', 'His', 'Their'),
    pronounPossCap: pick('Her', 'His', 'Their'),
    pronounSubjCap: pick('She', 'He', 'They'),
  };
}

/** The school's head of the paper. */
export async function schoolData(c: PoolClient): Promise<Row> {
  const r = await c.query<Row>(
    `SELECT name, affiliation_no AS "affiliationNo", board, address, contact->>'phone' AS phone,
            contact->>'email' AS email, branding->>'schoolNo' AS "schoolNo"
       FROM schools WHERE id = app.current_school_id()`,
  );
  const s = r.rows[0] ?? {};
  const { address, ...rest } = s;
  return { ...rest, addressLine: addressLine(address) };
}

/**
 * The student as a certificate prints them, as of the year given (the attendance and subjects of that year): identity,
 * parents, IDs, admission, the last class, the year's working days and days present, the subjects studied, the TC's fee
 * facts (the month the dues are paid to, any concession). Nothing secret: Aadhaar is never printed.
 */
export async function studentData(
  c: PoolClient,
  studentId: string,
  yearId: string | null,
): Promise<{ student: Row; attendance: Row; subjects: string; fees: Row } | null> {
  const s = (
    await c.query<{
      id: string;
      name: string;
      first_name: string;
      admission_no: string;
      gender: string | null;
      dob: string | null;
      category: string | null;
      house: string | null;
      admitted_on: string | null;
      left_on: string | null;
      status: string;
      profile: Record<string, unknown> | null;
      address: unknown;
      father: string | null;
      mother: string | null;
      guardian: string | null;
      secure: Record<string, unknown> | null;
      father_secure: Record<string, unknown> | null;
      mother_secure: Record<string, unknown> | null;
      contact_mobile: string | null;
      contact_email: string | null;
      class_id: string | null;
      class_code: string | null;
      class_name: string | null;
      section: string | null;
      roll_no: string | null;
      year_code: string | null;
      year_id: string | null;
      section_id: string | null;
      admission_class: string | null;
    }>(
      `SELECT s.id::text, s.display_name AS name, s.first_name, s.admission_no, s.gender::text, s.dob::text, s.category,
              s.house, s.admitted_on::text, s.left_on::text, s.status::text, s.profile, s.address, s.secure,
              (SELECT g.secure FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = s.id AND sg.relation = 'father' ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS father_secure,
              (SELECT g.secure FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = s.id AND sg.relation = 'mother' ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS mother_secure,
              (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = s.id AND g.mobile IS NOT NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS contact_mobile,
              (SELECT g.email FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = s.id AND g.email IS NOT NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS contact_email,
              (SELECT g.display_name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = s.id AND sg.relation = 'father' ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS father,
              (SELECT g.display_name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = s.id AND sg.relation = 'mother' ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS mother,
              (SELECT g.display_name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS guardian,
              c.id::text AS class_id, c.code AS class_code, c.name AS class_name, cs.name AS section, e.roll_no::text AS roll_no,
              y.code AS year_code, y.id::text AS year_id, cs.id::text AS section_id,
              (SELECT c2.name FROM enrolments e2 JOIN class_sections cs2 ON cs2.id = e2.class_section_id
                 JOIN classes c2 ON c2.id = cs2.class_id JOIN academic_years y2 ON y2.id = e2.academic_year_id
                WHERE e2.student_id = s.id ORDER BY y2.start_date, e2.id LIMIT 1) AS admission_class
         FROM students s
         LEFT JOIN LATERAL (
           SELECT e.* FROM enrolments e JOIN academic_years y ON y.id = e.academic_year_id
            WHERE e.student_id = s.id AND e.status <> 'cancelled'
              AND ($2::bigint IS NULL OR y.start_date <= (SELECT start_date FROM academic_years WHERE id = $2::bigint))
            ORDER BY y.start_date DESC, e.id DESC LIMIT 1) e ON true
         LEFT JOIN class_sections cs ON cs.id = e.class_section_id
         LEFT JOIN classes c ON c.id = cs.class_id
         LEFT JOIN academic_years y ON y.id = e.academic_year_id
        WHERE s.id = $1 AND s.deleted_at IS NULL`,
      [studentId, yearId],
    )
  ).rows[0];
  if (!s) return null;
  const p = s.profile ?? {};
  const str = (k: string) => (typeof p[k] === 'string' ? String(p[k]) : '');
  const att = s.section_id
    ? (
        await c.query<{ working: number; present: number }>(
          `SELECT count(DISTINCT a.id)::int AS working,
                  count(DISTINCT a.id) FILTER (WHERE m.code IN ('P', 'L'))::int AS present
             FROM attendance_sessions a
             LEFT JOIN attendance_marks m ON m.session_id = a.id AND m.student_id = $2
            WHERE a.class_section_id = $1 AND a.kind = 'day' AND a.academic_year_id = $3
              AND a.on_date <= COALESCE($4::date, CURRENT_DATE)`,
          [s.section_id, studentId, s.year_id, s.left_on],
        )
      ).rows[0]
    : undefined;
  // the subjects the student chose that year; else the class's compulsory subjects
  const subjectList = s.year_id
    ? ((
        await c.query<{ names: string[] | null }>(
          `SELECT COALESCE(
                    (SELECT array_agg(sub.name ORDER BY sub.display_order, sub.name)
                       FROM student_subjects ss JOIN subjects sub ON sub.id = ss.subject_id
                      WHERE ss.student_id = $1 AND ss.academic_year_id = $2),
                    (SELECT array_agg(sub.name ORDER BY cs.sort_order, sub.display_order, sub.name)
                       FROM class_subjects cs JOIN subjects sub ON sub.id = cs.subject_id
                      WHERE cs.class_id = $3 AND cs.academic_year_id = $2 AND NOT cs.is_elective)) AS names`,
          [studentId, s.year_id, s.class_id],
        )
      ).rows[0]?.names ?? [])
    : [];
  const subjects = subjectList.length ? subjectList.join(', ') : null;
  // the fee facts: the month every demand is paid to (the last period wholly paid), and any concession
  const fees = (
    await c.query<{ paid_to: string | null; concession: string | null }>(
      `WITH per AS (
         SELECT fp.name, fp.sequence, bool_and(d.paid >= d.net) AS paid
           FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id
          WHERE d.student_id = $1 AND ($2::bigint IS NULL OR d.academic_year_id = $2::bigint)
            AND d.status NOT IN ('cancelled', 'carried')
          GROUP BY fp.name, fp.sequence)
       SELECT (SELECT name FROM per p WHERE p.paid AND NOT EXISTS (SELECT 1 FROM per q WHERE q.sequence < p.sequence AND NOT q.paid)
                ORDER BY sequence DESC LIMIT 1) AS paid_to,
              (SELECT CASE WHEN sum(d.discount) > 0 THEN 'Yes: ' || sum(d.discount)::text || ' in the year' END
                 FROM fee_demands d WHERE d.student_id = $1 AND ($2::bigint IS NULL OR d.academic_year_id = $2::bigint)
                  AND d.status NOT IN ('cancelled', 'carried')) AS concession`,
      [studentId, s.year_id],
    )
  ).rows[0];
  return {
    student: {
      id: s.id,
      name: s.name,
      firstName: s.first_name,
      admissionNo: s.admission_no,
      gender: s.gender ?? '',
      dob: dmy(s.dob),
      dobWords: dateInWords(s.dob),
      nationality: str('nationality') || 'Indian',
      religion: str('religion'),
      category: s.category ?? '',
      caste: str('sub_caste'),
      motherTongue: str('mother_tongue'),
      placeOfBirth: str('place_of_birth'),
      pen: str('pen_no'),
      apaar: str('apaar_id'),
      srn: str('srn_no'),
      registrationNo: str('registration_no'),
      fatherName: s.father ?? '',
      motherName: s.mother ?? '',
      guardianName: s.guardian ?? '',
      house: s.house ?? '',
      admittedOn: dmy(s.admitted_on),
      admissionClass: s.admission_class ?? '',
      leftOn: dmy(s.left_on),
      left: s.status !== 'active',
      classCode: s.class_code ?? '',
      className: s.class_name ?? '',
      classWords: classInWords(s.class_code ?? s.class_name),
      classLabel: classLabel(s.class_name, s.section),
      admissionClassLabel: classLabel(s.admission_class, null),
      section: s.section ?? '',
      rollNo: s.roll_no ?? '',
      academicYear: s.year_code ?? '',
      address: addressLine(s.address),
      ...pronouns(s.gender),
      // the Board exam registration form's details (17 Nov 2026)
      sex: s.gender === 'male' ? 'M' : s.gender === 'female' ? 'F' : s.gender ? 'Other' : '',
      mobile: s.contact_mobile ?? (str('sms_mobile') || str('whatsapp_no')),
      email: str('primary_email') || (s.contact_email ?? ''),
      familyIncome: incomeOf(p.family_income),
      cwsn: cwsnOf(str('cwsn'), str('type_of_disability')),
      singleChild: yesNo(p.single_child),
      minority: minorityOf(str('religion')),
      // Aadhaar only ever masked to its last four digits (UIDAI): the full number is never on a paper
      aadhaar: maskedAadhaar(s.secure),
      fatherAadhaar: maskedAadhaar(s.father_secure),
      motherAadhaar: maskedAadhaar(s.mother_secure),
      // the subjects of the year one by one: five, then an additional one
      subject1: subjectList[0] ?? '',
      subject2: subjectList[1] ?? '',
      subject3: subjectList[2] ?? '',
      subject4: subjectList[3] ?? '',
      subject5: subjectList[4] ?? '',
      additionalSubject: subjectList.slice(5).join(', '),
    },
    attendance: {
      workingDays: att?.working ?? 0,
      present: att?.present ?? 0,
      percent: att?.working ? Math.round((att.present / att.working) * 1000) / 10 : '',
    },
    subjects: subjects ?? '',
    fees: { paidTo: fees?.paid_to ?? '', concession: fees?.concession ?? 'No' },
  };
}

/** An Aadhaar number from a secure profile, masked to its last four digits (XXXX-XXXX-1234), or ''. */
export function maskedAadhaar(secure: Record<string, unknown> | null | undefined): string {
  const stored = secure?.aadhaar_no;
  if (typeof stored !== 'string' || !stored) return '';
  const plain = (decryptField(stored) ?? '').replace(/\D/g, '');
  return plain.length >= 4 ? maskValue(plain, 'digits12') : '';
}
/** Any typed Aadhaar number masked the same way (the full number is never printed). */
export const maskAadhaarText = (v: string): string => {
  const d = v.replace(/\D/g, '');
  return d.length >= 4 ? maskValue(d, 'digits12') : v;
};

/** The religions notified as minorities (the National Commission for Minorities Act): a Yes with the religion. */
const MINORITIES = ['Muslim', 'Sikh', 'Jain', 'Buddhist', 'Christian', 'Parsi'];
function minorityOf(religion: string): string {
  if (!religion) return '';
  const r = religion.trim().toLowerCase();
  const m = MINORITIES.find(
    (x) =>
      r === x.toLowerCase() ||
      (x === 'Parsi' && /zoroastrian|parsee/.test(r)) ||
      (x === 'Muslim' && r === 'islam'),
  );
  return m ? `Yes — ${m}` : 'No';
}
function cwsnOf(cwsn: string, kind: string): string {
  if (!cwsn) return '';
  return /^y/i.test(cwsn) ? `Yes${kind ? ` — ${kind}` : ''}` : 'No';
}
function yesNo(v: unknown): string {
  if (v === true || (typeof v === 'string' && /^y/i.test(v))) return 'Yes';
  if (v === false || (typeof v === 'string' && /^n/i.test(v))) return 'No';
  return '';
}
function incomeOf(v: unknown): string {
  if (typeof v === 'number') return `₹${v.toLocaleString('en-IN')}`;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()))
    return `₹${Number(v).toLocaleString('en-IN')}`;
  return typeof v === 'string' ? v.trim() : '';
}

/** What the student paid in a year, by fee head (the fee paid certificate). */
export async function feePaidData(
  c: PoolClient,
  studentId: string,
  yearId: string | null,
): Promise<Row> {
  const year = yearId
    ? (await c.query<{ code: string }>(`SELECT code FROM academic_years WHERE id = $1`, [yearId]))
        .rows[0]?.code
    : undefined;
  const r = await c.query<{ name: string; paid: string }>(
    `SELECT h.name, sum(d.paid)::numeric(14, 2)::text AS paid
       FROM fee_demands d JOIN fee_heads h ON h.id = d.head_id
      WHERE d.student_id = $1 AND d.academic_year_id = $2 AND d.status NOT IN ('cancelled', 'carried')
      GROUP BY h.name, h.sort_order HAVING sum(d.paid) > 0
      ORDER BY h.sort_order, h.name`,
    [studentId, yearId],
  );
  const total = r.rows.reduce((n, x) => n + Number(x.paid), 0);
  const money = (n: number) =>
    n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    year: year ?? '',
    heads: r.rows.map((x) => ({ name: x.name, amount: money(Number(x.paid)) })),
    total: money(total),
    totalWords: total > 0 ? amountInWords(total.toFixed(2)) : '',
  };
}

/**
 * The employee as a staff certificate prints them: name, employee code, designation and department, joining and
 * leaving dates, father's name, the words for them by gender. Nothing secret (no PAN, Aadhaar or bank).
 */
export async function employeeData(c: PoolClient, employeeId: string): Promise<Row | null> {
  const e = (
    await c.query<{
      id: string;
      name: string;
      code: string;
      gender: string | null;
      dob: string | null;
      designation: string | null;
      department: string | null;
      joined_on: string | null;
      left_on: string | null;
      status: string;
      profile: Record<string, unknown> | null;
      employee_type: string | null;
      exit_left_on: string | null;
    }>(
      `SELECT e.id::text, e.display_name AS name, e.employee_code AS code, e.gender::text, e.dob::text,
              COALESCE(p.designation, e.designation) AS designation, COALESCE(p.department, e.department) AS department,
              e.joined_on::text, e.left_on::text, e.status::text, e.profile, e.employee_type::text,
              (SELECT x.left_on::text FROM employee_exits x WHERE x.employee_id = e.id AND x.left_on IS NOT NULL
                ORDER BY x.left_on DESC LIMIT 1) AS exit_left_on
         FROM employees e
         LEFT JOIN LATERAL (SELECT designation, department FROM postings p
                             WHERE p.employee_id = e.id ORDER BY p.valid_from DESC NULLS LAST, p.id DESC LIMIT 1) p ON true
        WHERE e.id = $1 AND e.deleted_at IS NULL`,
      [employeeId],
    )
  ).rows[0];
  if (!e) return null;
  const p = e.profile ?? {};
  const str = (k: string) => (typeof p[k] === 'string' ? String(p[k]) : '');
  return {
    id: e.id,
    name: e.name,
    code: e.code,
    gender: e.gender ?? '',
    dob: dmy(e.dob),
    designation: e.designation ?? '',
    department: e.department ?? '',
    employeeType: e.employee_type ?? '',
    joinedOn: dmy(e.joined_on),
    leftOn: dmy(e.left_on ?? e.exit_left_on),
    left: e.status !== 'active',
    fatherName: str('father_name'),
    nationality: str('nationality') || 'Indian',
    ...pronouns(e.gender),
  };
}
