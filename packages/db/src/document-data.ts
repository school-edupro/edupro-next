import type { PoolClient } from 'pg';
import type { TemplateData } from './template-engine';

/** Entities a document template can be filled from. */
export type DocumentEntity = 'student' | 'transfer_certificate' | 'employee';
export const DOCUMENT_ENTITIES: DocumentEntity[] = ['student', 'transfer_certificate', 'employee'];

type Row = Record<string, unknown>;

const addressLine = (a: unknown): string => {
  if (!a || typeof a !== 'object') return '';
  const o = a as Record<string, unknown>;
  return ['line1', 'line2', 'city', 'state', 'pin']
    .map((k) => o[k])
    .filter((v) => typeof v === 'string' && v.trim() !== '')
    .join(', ');
};

async function school(c: PoolClient): Promise<Row> {
  const r = await c.query<Row>(
    `SELECT name, short_name AS "shortName", affiliation_no AS "affiliationNo", board, address, contact->>'phone' AS phone, contact->>'email' AS email
       FROM schools WHERE id = app.current_school_id()`,
  );
  const s = r.rows[0] ?? {};
  return { ...s, addressLine: addressLine(s.address) };
}

async function student(c: PoolClient, id: string): Promise<Row | null> {
  const r = await c.query<Row>(
    `SELECT s.id::text, s.display_name AS name, s.first_name AS "firstName", s.last_name AS "lastName", s.admission_no AS "admissionNo",
            to_char(s.dob, 'DD Mon YYYY') AS dob, s.gender, s.category, s.blood_group AS "bloodGroup", s.house,
            to_char(s.admitted_on, 'DD Mon YYYY') AS "admittedOn", to_char(s.left_on, 'DD Mon YYYY') AS "leftOn", s.status,
            g.display_name AS "guardianName", g.mobile AS "guardianMobile", sg.relation::text AS "guardianRelation",
            c.code AS "classCode", c.name AS "className", cs.name AS section, e.roll_no AS "rollNo", y.code AS "academicYear",
            to_char(e.joined_on, 'DD Mon YYYY') AS "joinedOn"
       FROM students s
       LEFT JOIN LATERAL (SELECT sg.guardian_id, sg.relation FROM student_guardians sg WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC, sg.id LIMIT 1) sg ON true
       LEFT JOIN guardians g ON g.id = sg.guardian_id
       LEFT JOIN LATERAL (SELECT * FROM enrolments e WHERE e.student_id = s.id ORDER BY e.academic_year_id DESC, e.id DESC LIMIT 1) e ON true
       LEFT JOIN class_sections cs ON cs.id = e.class_section_id
       LEFT JOIN classes c ON c.id = cs.class_id
       LEFT JOIN academic_years y ON y.id = e.academic_year_id
      WHERE s.id = $1 AND s.deleted_at IS NULL`,
    [id],
  );
  return r.rows[0] ?? null;
}

async function employee(c: PoolClient, id: string): Promise<Row | null> {
  const r = await c.query<Row>(
    `SELECT id::text, display_name AS name, employee_code AS "employeeCode", designation, department, to_char(joined_on, 'DD Mon YYYY') AS "joinedOn",
            to_char(dob, 'DD Mon YYYY') AS dob, gender, mobile, email
       FROM employees WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return r.rows[0] ?? null;
}

/** Loads the data a template of the given entity can reference, under the caller's tenant context. */
export async function loadDocumentData(
  c: PoolClient,
  entity: DocumentEntity,
  entityId: string,
): Promise<TemplateData> {
  const today = await c.query<{ today: string }>(
    `SELECT to_char(CURRENT_DATE, 'DD Mon YYYY') AS today`,
  );
  const base: TemplateData = { school: await school(c), today: today.rows[0]!.today };
  if (entity === 'student') {
    const s = await student(c, entityId);
    if (!s) throw new Error(`student ${entityId} not found`);
    return { ...base, student: s };
  }
  if (entity === 'employee') {
    const e = await employee(c, entityId);
    if (!e) throw new Error(`employee ${entityId} not found`);
    return { ...base, employee: e };
  }
  const tc = await c.query<Row>(
    `SELECT t.id::text, t.tc_no AS "no", t.serial, to_char(t.issued_on, 'DD Mon YYYY') AS "issuedOn", t.reason, t.last_class AS "lastClass",
            t.conduct, t.promotion_status AS "promotionStatus", t.dues_cleared AS "duesCleared", t.remarks, t.snapshot, t.student_id::text AS "studentId",
            y.code AS "academicYear", u.display_name AS "issuedBy"
       FROM transfer_certificates t JOIN academic_years y ON y.id = t.academic_year_id LEFT JOIN users u ON u.id = t.issued_by
      WHERE t.id = $1`,
    [entityId],
  );
  const row = tc.rows[0];
  if (!row) throw new Error(`transfer certificate ${entityId} not found`);
  const snapshot = (row.snapshot ?? {}) as Row;
  const live = await student(c, String(row.studentId));
  return { ...base, tc: row, student: { ...(live ?? {}), ...snapshot } };
}

/** Canned data for the template editor's preview. */
export function sampleDocumentData(entity: DocumentEntity): TemplateData {
  const school = {
    name: 'Alpha Public School',
    shortName: 'APS',
    affiliationNo: '1130123',
    board: 'CBSE',
    addressLine: 'Sector 21, Pune 411045',
    phone: '020 2222 3333',
    email: 'office@alpha.example.test',
  };
  const student = {
    name: 'Aarav Sharma',
    firstName: 'Aarav',
    lastName: 'Sharma',
    admissionNo: 'A2401',
    dob: '14 Jun 2015',
    gender: 'male',
    category: 'GEN',
    bloodGroup: 'B+',
    house: 'Blue',
    admittedOn: '05 Apr 2021',
    guardianName: 'Suresh Sharma',
    guardianMobile: '9876543210',
    guardianRelation: 'father',
    classCode: 'VI',
    className: 'Class VI',
    section: 'A',
    rollNo: 1,
    academicYear: '2026-27',
    joinedOn: '06 Apr 2026',
  };
  const base = { school, today: '27 Sep 2026' };
  if (entity === 'employee')
    return {
      ...base,
      employee: {
        name: 'Anita Deshmukh',
        employeeCode: 'E006',
        designation: 'TGT English',
        department: 'English',
        joinedOn: '01 Jun 2015',
      },
    };
  if (entity === 'student') return { ...base, student };
  return {
    ...base,
    student,
    tc: {
      no: 'TC/2026-27/0007',
      serial: 7,
      issuedOn: '27 Sep 2026',
      reason: 'Family relocated to Bengaluru',
      lastClass: 'VI-A',
      conduct: 'Good',
      promotionStatus: 'Promoted to Class VII',
      duesCleared: true,
      remarks: 'All library books returned',
      academicYear: '2026-27',
      issuedBy: 'Meena Iyer',
    },
  };
}
