import type { PoolClient } from '@edupro/db';

/**
 * Who a message reaches (communication v2). One engine for every way of choosing people: everyone,
 * students, employees, classes, sections, routes, a master-wise rule (house, category, gender, stream,
 * religion, department, designation, employee type), groups (kept by hand, uploaded or rule based),
 * individuals and a one-time list from Excel. Students are then expanded by "send to": the family's
 * primary contact, both parents, the student's own mobile / email, or the student and the parents.
 * Every recipient carries the variables its templates can use ({{student_name}}, {{fee_due}}...).
 */

export type Channel = 'sms' | 'whatsapp' | 'email';
export type SendTo = 'primary' | 'parents' | 'student' | 'student_parents';
export type Audience =
  | 'everyone'
  | 'students'
  | 'employees'
  | 'class'
  | 'class_section'
  | 'route'
  | 'group'
  | 'individuals'
  | 'filter'
  | 'upload';

export interface AudienceRule {
  /** Which people the rule picks; groups take it from their kind. */
  people?: 'students' | 'employees' | 'both';
  classIds?: string[];
  sectionIds?: string[];
  houses?: string[];
  categories?: string[];
  genders?: string[];
  streams?: string[];
  religions?: string[];
  routeIds?: string[];
  departments?: string[];
  designations?: string[];
  employeeTypes?: string[];
}

export interface UploadRow {
  name: string;
  mobile?: string | null;
  email?: string | null;
  vars?: Record<string, string>;
}

export interface AudienceInput {
  yearId: string;
  audience: Audience;
  targets: Array<{ type: string; id: string }>;
  rule?: AudienceRule | null;
  upload?: UploadRow[] | null;
  sendTo: SendTo;
  channels: Channel[];
  /** general messages respect withdrawn consent; service messages (fees, attendance, safety) do not */
  category: 'service' | 'general';
}

export type PersonType = 'student' | 'employee' | 'guardian' | 'contact' | 'user' | 'upload';

export interface Recipient {
  channel: Channel;
  address: string;
  name: string;
  personType: PersonType;
  personId: string | null;
  userId: string | null;
  studentId: string | null;
  vars: Record<string, string>;
}
export type Skipped = Omit<Recipient, 'address'> & { address: string | null; reason: string };

const MOBILE = /^\d{10}$/;

/** Indian mobiles to their last ten digits; anything else is not a usable number. */
export function normaliseMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return MOBILE.test(ten) && /^[6-9]/.test(ten) ? ten : null;
}
export function normaliseEmail(raw: string | null | undefined): string | null {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

interface StudentRow {
  id: string;
  name: string;
  admission_no: string;
  user_id: string | null;
  cls: string;
  sec: string;
  roll_no: number | null;
  gender: string | null;
  sms: string | null;
  wa: string | null;
  em: string | null;
  own_m: string | null;
  own_e: string | null;
  u_mobile: string | null;
  u_email: string | null;
}
interface GuardianRow {
  student_id: string;
  id: string;
  relation: string;
  is_primary: boolean;
  notify: boolean;
  name: string;
  mobile: string | null;
  email: string | null;
  user_id: string | null;
}
interface EmployeeRow {
  id: string;
  name: string;
  code: string;
  designation: string | null;
  department: string | null;
  mobile: string | null;
  email: string | null;
  user_id: string | null;
}

const ids = (targets: AudienceInput['targets'], type: string) =>
  targets.filter((t) => t.type === type).map((t) => t.id);

/** The SQL condition and parameters for the student part of a rule (s, e, cs, k are joined). */
function studentWhere(rule: AudienceRule, params: unknown[]): string {
  const parts: string[] = [];
  const add = (values: string[] | undefined, sql: (p: string) => string) => {
    if (!values?.length) return;
    params.push(values);
    parts.push(sql(`$${String(params.length)}`));
  };
  add(rule.classIds, (p) => `k.id = ANY(${p}::bigint[])`);
  add(rule.sectionIds, (p) => `cs.id = ANY(${p}::bigint[])`);
  add(rule.houses, (p) => `s.house = ANY(${p}::text[])`);
  add(rule.categories, (p) => `s.category = ANY(${p}::text[])`);
  add(rule.genders, (p) => `s.gender::text = ANY(${p}::text[])`);
  add(rule.streams, (p) => `s.profile->>'stream' = ANY(${p}::text[])`);
  add(rule.religions, (p) => `s.profile->>'religion' = ANY(${p}::text[])`);
  add(
    rule.routeIds,
    (p) =>
      // eslint-disable-next-line no-restricted-syntax -- p is a numbered placeholder; the value is a bound parameter
      `EXISTS (SELECT 1 FROM student_route_assignments ra WHERE ra.student_id = s.id AND ra.academic_year_id = e.academic_year_id AND ra.route_id = ANY(${p}::bigint[]))`,
  );
  return parts.length ? parts.join(' AND ') : 'true';
}

function employeeWhere(rule: AudienceRule, params: unknown[]): string {
  const parts: string[] = [];
  const add = (values: string[] | undefined, sql: (p: string) => string) => {
    if (!values?.length) return;
    params.push(values);
    parts.push(sql(`$${String(params.length)}`));
  };
  add(rule.departments, (p) => `e.department = ANY(${p}::text[])`);
  add(rule.designations, (p) => `e.designation = ANY(${p}::text[])`);
  add(rule.employeeTypes, (p) => `e.employee_type::text = ANY(${p}::text[])`);
  return parts.length ? parts.join(' AND ') : 'true';
}

/** Student ids matching a rule in the year (active enrolments only). */
export async function studentsByRule(
  c: PoolClient,
  yearId: string,
  rule: AudienceRule,
): Promise<string[]> {
  const params: unknown[] = [yearId];
  const where = studentWhere(rule, params);
  const r = await c.query<{ id: string }>(
    // eslint-disable-next-line no-restricted-syntax -- where is built from fixed fragments; values are bound parameters
    `SELECT DISTINCT s.id::text FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
      WHERE e.academic_year_id = $1::bigint AND e.status = 'active' AND ${where}`,
    params,
  );
  return r.rows.map((x) => x.id);
}

export async function employeesByRule(c: PoolClient, rule: AudienceRule): Promise<string[]> {
  const params: unknown[] = [];
  const where = employeeWhere(rule, params);
  const r = await c.query<{ id: string }>(
    // eslint-disable-next-line no-restricted-syntax -- where is built from fixed fragments; values are bound parameters
    `SELECT e.id::text FROM employees e WHERE e.deleted_at IS NULL AND e.status = 'active' AND ${where}`,
    params,
  );
  return r.rows.map((x) => x.id);
}

const hasStudentFilter = (r: AudienceRule) =>
  Boolean(
    r.classIds?.length ||
    r.sectionIds?.length ||
    r.houses?.length ||
    r.categories?.length ||
    r.genders?.length ||
    r.streams?.length ||
    r.religions?.length ||
    r.routeIds?.length,
  );
const hasEmployeeFilter = (r: AudienceRule) =>
  Boolean(r.departments?.length || r.designations?.length || r.employeeTypes?.length);

/** Which kinds of people a rule picks when it does not say: from the filters it uses. */
export function rulePeople(rule: AudienceRule): 'students' | 'employees' | 'both' {
  if (rule.people) return rule.people;
  if (hasEmployeeFilter(rule) && !hasStudentFilter(rule)) return 'employees';
  if (hasStudentFilter(rule) && !hasEmployeeFilter(rule)) return 'students';
  return 'both';
}

interface People {
  students: Set<string>;
  employees: Set<string>;
  guardians: Set<string>;
  contacts: Set<string>;
  users: Set<string>;
}

async function applyRule(c: PoolClient, yearId: string, rule: AudienceRule, into: People) {
  const who = rulePeople(rule);
  if (who !== 'employees')
    for (const id of await studentsByRule(c, yearId, rule)) into.students.add(id);
  if (who !== 'students') for (const id of await employeesByRule(c, rule)) into.employees.add(id);
}

/** The members of groups: hand-kept and uploaded members, or the group's rule today. */
export async function groupPeople(
  c: PoolClient,
  yearId: string,
  groupIds: string[],
  into: People,
): Promise<void> {
  if (!groupIds.length) return;
  const groups = await c.query<{
    id: string;
    kind: string;
    mode: string;
    rule: AudienceRule | null;
  }>(
    `SELECT id::text, kind, mode, rule FROM comms_groups WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
    [groupIds],
  );
  for (const g of groups.rows) {
    if (g.mode === 'rule' && g.rule) {
      const people =
        g.kind === 'student' ? 'students' : g.kind === 'employee' ? 'employees' : 'both';
      await applyRule(c, yearId, { ...g.rule, people: g.rule.people ?? people }, into);
    }
  }
  const members = await c.query<{ person_type: string; person_id: string }>(
    `SELECT person_type, person_id::text FROM comms_group_members WHERE group_id = ANY($1::bigint[])`,
    [groupIds],
  );
  for (const m of members.rows) {
    const set =
      m.person_type === 'student'
        ? into.students
        : m.person_type === 'employee'
          ? into.employees
          : m.person_type === 'guardian'
            ? into.guardians
            : m.person_type === 'contact'
              ? into.contacts
              : into.users;
    set.add(m.person_id);
  }
}

/** Expands an audience to one recipient per channel and address, with the reasons people were skipped. */
export async function resolveAudience(
  c: PoolClient,
  input: AudienceInput,
): Promise<{ send: Recipient[]; skipped: Skipped[] }> {
  const people: People = {
    students: new Set(),
    employees: new Set(),
    guardians: new Set(),
    contacts: new Set(),
    users: new Set(),
  };
  const t = input.targets;
  switch (input.audience) {
    case 'everyone':
      await applyRule(c, input.yearId, { people: 'both' }, people);
      break;
    case 'students':
      await applyRule(c, input.yearId, { people: 'students' }, people);
      break;
    case 'employees':
      await applyRule(c, input.yearId, { people: 'employees' }, people);
      break;
    case 'class':
      await applyRule(c, input.yearId, { people: 'students', classIds: ids(t, 'class') }, people);
      break;
    case 'class_section':
      await applyRule(
        c,
        input.yearId,
        { people: 'students', sectionIds: ids(t, 'class_section') },
        people,
      );
      break;
    case 'route':
      await applyRule(c, input.yearId, { people: 'students', routeIds: ids(t, 'route') }, people);
      break;
    case 'filter':
      await applyRule(c, input.yearId, input.rule ?? {}, people);
      break;
    case 'group':
      await groupPeople(c, input.yearId, ids(t, 'group'), people);
      break;
    case 'individuals':
      for (const id of ids(t, 'student')) people.students.add(id);
      for (const id of ids(t, 'employee')) people.employees.add(id);
      for (const id of ids(t, 'guardian')) people.guardians.add(id);
      for (const id of ids(t, 'contact')) people.contacts.add(id);
      for (const id of ids(t, 'user')) people.users.add(id);
      break;
    case 'upload':
      break;
  }

  const school = await c.query<{ name: string }>(
    `SELECT name FROM schools WHERE id = app.current_school_id()`,
  );
  const base: Record<string, string> = {
    school: school.rows[0]?.name ?? '',
    date: new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
  };
  // candidates before consent and duplicates: [channel, address|null, recipient fields]
  const out: Array<Omit<Recipient, 'address'> & { address: string | null }> = [];
  const push = (
    r: Omit<Recipient, 'address' | 'channel'>,
    addr: Record<Channel, string | null | undefined>,
  ) => {
    for (const ch of input.channels) {
      const raw = addr[ch];
      out.push({
        ...r,
        channel: ch,
        address: ch === 'email' ? normaliseEmail(raw) : normaliseMobile(raw),
      });
    }
  };

  // ---- students, expanded by "send to"
  if (people.students.size) {
    const sIds = [...people.students];
    const st = await c.query<StudentRow>(
      `SELECT s.id::text, s.display_name AS name, s.admission_no, s.user_id::text, k.code AS cls, cs.name AS sec, e.roll_no, s.gender::text AS gender,
              s.profile->>'sms_mobile' AS sms, s.profile->>'whatsapp_no' AS wa, s.profile->>'primary_email' AS em,
              s.profile->>'student_own_mobile' AS own_m, s.profile->>'student_own_email' AS own_e, u.mobile AS u_mobile, u.email::text AS u_email
         FROM students s
         LEFT JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = $2::bigint AND e.status = 'active'
         LEFT JOIN class_sections cs ON cs.id = e.class_section_id LEFT JOIN classes k ON k.id = cs.class_id
         LEFT JOIN users u ON u.id = s.user_id
        WHERE s.id = ANY($1::bigint[]) AND s.deleted_at IS NULL
        ORDER BY k.display_order NULLS LAST, cs.name, e.roll_no NULLS LAST, s.display_name`,
      [sIds, input.yearId],
    );
    const gs = await c.query<GuardianRow>(
      `SELECT sg.student_id::text, g.id::text, sg.relation::text, sg.is_primary, sg.receives_notifications AS notify, g.display_name AS name, g.mobile, g.email::text, g.user_id::text
         FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
        WHERE sg.student_id = ANY($1::bigint[])
        ORDER BY sg.is_primary DESC, g.id`,
      [sIds],
    );
    const dues = await c.query<{ student_id: string; due: string }>(
      `SELECT student_id::text, sum(net - paid)::text AS due FROM fee_demands
        WHERE student_id = ANY($1::bigint[]) AND academic_year_id = $2::bigint AND due_on <= CURRENT_DATE AND net > paid
        GROUP BY student_id`,
      [sIds, input.yearId],
    );
    const dueOf = new Map(dues.rows.map((d) => [d.student_id, Number(d.due)]));
    const byStudent = new Map<string, GuardianRow[]>();
    for (const g of gs.rows)
      byStudent.set(g.student_id, [...(byStudent.get(g.student_id) ?? []), g]);
    for (const s of st.rows) {
      const gl = byStudent.get(s.id) ?? [];
      const father = gl.find((g) => g.relation === 'father');
      const mother = gl.find((g) => g.relation === 'mother');
      const primary = gl.find((g) => g.is_primary) ?? gl.find((g) => g.notify) ?? gl[0];
      const vars: Record<string, string> = {
        ...base,
        student_name: s.name,
        admission_no: s.admission_no,
        class: s.cls ? `${s.cls}-${s.sec}` : '',
        class_name: s.cls ?? '',
        section: s.sec ?? '',
        roll_no: s.roll_no ? String(s.roll_no) : '',
        father_name: father?.name ?? '',
        mother_name: mother?.name ?? '',
        guardian_name: primary?.name ?? '',
        fee_due: (dueOf.get(s.id) ?? 0).toLocaleString('en-IN'),
      };
      const common = { personId: s.id, studentId: s.id };
      if (input.sendTo === 'primary') {
        push(
          {
            ...common,
            personType: 'student',
            userId: primary?.user_id ?? null,
            name: primary?.name ?? s.name,
            vars: { ...vars, recipient_name: primary?.name ?? s.name },
          },
          {
            sms: s.sms ?? primary?.mobile,
            whatsapp: s.wa ?? s.sms ?? primary?.mobile,
            email: s.em ?? primary?.email,
          },
        );
      }
      if (input.sendTo === 'parents' || input.sendTo === 'student_parents') {
        const parents = [father, mother].filter((g): g is GuardianRow => Boolean(g));
        const list = parents.length ? parents : primary ? [primary] : [];
        if (!list.length)
          push(
            { ...common, personType: 'student', userId: null, name: s.name, vars },
            { sms: null, whatsapp: null, email: null },
          );
        for (const g of list)
          push(
            {
              ...common,
              personType: 'guardian',
              personId: g.id,
              userId: g.user_id,
              name: g.name,
              vars: { ...vars, recipient_name: g.name },
            },
            { sms: g.mobile, whatsapp: g.mobile, email: g.email },
          );
      }
      if (input.sendTo === 'student' || input.sendTo === 'student_parents') {
        push(
          {
            ...common,
            personType: 'student',
            userId: s.user_id,
            name: s.name,
            vars: { ...vars, recipient_name: s.name },
          },
          {
            sms: s.own_m ?? s.u_mobile,
            whatsapp: s.own_m ?? s.u_mobile,
            email: s.own_e ?? s.u_email,
          },
        );
      }
    }
  }

  // ---- employees
  if (people.employees.size) {
    const em = await c.query<EmployeeRow>(
      `SELECT e.id::text, e.display_name AS name, e.employee_code AS code, e.designation, e.department, e.mobile, e.email::text, e.user_id::text
         FROM employees e WHERE e.id = ANY($1::bigint[]) AND e.deleted_at IS NULL ORDER BY e.display_name`,
      [[...people.employees]],
    );
    for (const e of em.rows)
      push(
        {
          personType: 'employee',
          personId: e.id,
          userId: e.user_id,
          studentId: null,
          name: e.name,
          vars: {
            ...base,
            recipient_name: e.name,
            employee_name: e.name,
            employee_code: e.code,
            designation: e.designation ?? '',
            department: e.department ?? '',
          },
        },
        { sms: e.mobile, whatsapp: e.mobile, email: e.email },
      );
  }

  // ---- guardians added to a group directly
  if (people.guardians.size) {
    const gr = await c.query<{
      id: string;
      name: string;
      mobile: string | null;
      email: string | null;
      user_id: string | null;
      student: string | null;
    }>(
      `SELECT g.id::text, g.display_name AS name, g.mobile, g.email::text, g.user_id::text,
              (SELECT s.display_name FROM student_guardians sg JOIN students s ON s.id = sg.student_id WHERE sg.guardian_id = g.id AND s.status = 'active' ORDER BY s.id LIMIT 1) AS student
         FROM guardians g WHERE g.id = ANY($1::bigint[]) AND g.deleted_at IS NULL`,
      [[...people.guardians]],
    );
    for (const g of gr.rows)
      push(
        {
          personType: 'guardian',
          personId: g.id,
          userId: g.user_id,
          studentId: null,
          name: g.name,
          vars: {
            ...base,
            recipient_name: g.name,
            guardian_name: g.name,
            student_name: g.student ?? '',
          },
        },
        { sms: g.mobile, whatsapp: g.mobile, email: g.email },
      );
  }

  // ---- external contacts
  if (people.contacts.size) {
    const ct = await c.query<{
      id: string;
      name: string;
      mobile: string | null;
      email: string | null;
      extra: Record<string, string>;
    }>(
      `SELECT id::text, name, mobile, email::text, extra FROM comms_contacts WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY name`,
      [[...people.contacts]],
    );
    for (const x of ct.rows)
      push(
        {
          personType: 'contact',
          personId: x.id,
          userId: null,
          studentId: null,
          name: x.name,
          vars: { ...base, ...x.extra, recipient_name: x.name },
        },
        { sms: x.mobile, whatsapp: x.mobile, email: x.email },
      );
  }

  // ---- logins (members of older groups, individual users)
  if (people.users.size) {
    const us = await c.query<{
      id: string;
      name: string;
      mobile: string | null;
      email: string | null;
    }>(
      `SELECT u.id::text, u.display_name AS name, u.mobile, u.email::text FROM users u
         JOIN user_school_memberships m ON m.user_id = u.id AND m.school_id = app.current_school_id() AND m.deleted_at IS NULL
        WHERE u.id = ANY($1::bigint[]) AND u.deleted_at IS NULL`,
      [[...people.users]],
    );
    for (const u of us.rows)
      push(
        {
          personType: 'user',
          personId: u.id,
          userId: u.id,
          studentId: null,
          name: u.name,
          vars: { ...base, recipient_name: u.name },
        },
        { sms: u.mobile, whatsapp: u.mobile, email: u.email },
      );
  }

  // ---- one-time list from Excel
  for (const row of input.upload ?? [])
    push(
      {
        personType: 'upload',
        personId: null,
        userId: null,
        studentId: null,
        name: row.name,
        vars: { ...base, ...(row.vars ?? {}), recipient_name: row.name },
      },
      { sms: row.mobile, whatsapp: row.mobile, email: row.email },
    );

  // ---- consent and duplicates
  const withdrawn = new Map<Channel, Set<string>>();
  if (input.category === 'general') {
    for (const ch of input.channels) {
      const w = await c.query<{ id: string }>(
        `SELECT x.user_id::text AS id FROM consents x
          WHERE x.purpose_code = $1 AND x.id = (SELECT y.id FROM consents y WHERE y.user_id = x.user_id AND y.purpose_code = $1 ORDER BY y.recorded_at DESC, y.id DESC LIMIT 1)
            AND x.status = 'withdrawn'`,
        [`comms.${ch}`],
      );
      withdrawn.set(ch, new Set(w.rows.map((x) => x.id)));
    }
  }
  const seen = new Set<string>();
  const send: Recipient[] = [];
  const skipped: Skipped[] = [];
  for (const r of out) {
    if (!r.address) skipped.push({ ...r, reason: 'no_address' });
    else if (r.userId && withdrawn.get(r.channel)?.has(r.userId))
      skipped.push({ ...r, reason: 'consent_withdrawn' });
    else if (seen.has(`${r.channel}:${r.address}`)) skipped.push({ ...r, reason: 'duplicate' });
    else {
      seen.add(`${r.channel}:${r.address}`);
      send.push(r as Recipient);
    }
  }
  return { send, skipped };
}

/** Variables every template may use, with where they come from (the template editor's picker). */
export const TEMPLATE_VARIABLES: Array<{ key: string; label: string; for: string }> = [
  { key: 'recipient_name', label: 'Recipient name', for: 'everyone' },
  { key: 'school', label: 'School name', for: 'everyone' },
  { key: 'date', label: 'Today’s date', for: 'everyone' },
  { key: 'student_name', label: 'Student name', for: 'students' },
  { key: 'admission_no', label: 'Admission number', for: 'students' },
  { key: 'class', label: 'Class-section (e.g. VI-A)', for: 'students' },
  { key: 'class_name', label: 'Class', for: 'students' },
  { key: 'section', label: 'Section', for: 'students' },
  { key: 'roll_no', label: 'Roll number', for: 'students' },
  { key: 'father_name', label: 'Father’s name', for: 'students' },
  { key: 'mother_name', label: 'Mother’s name', for: 'students' },
  { key: 'guardian_name', label: 'Primary guardian', for: 'students' },
  { key: 'fee_due', label: 'Fee due today (₹)', for: 'students' },
  { key: 'employee_name', label: 'Employee name', for: 'employees' },
  { key: 'employee_code', label: 'Employee code', for: 'employees' },
  { key: 'designation', label: 'Designation', for: 'employees' },
  { key: 'department', label: 'Department', for: 'employees' },
  { key: 'title', label: 'Message title (from compose)', for: 'everyone' },
  { key: 'body', label: 'Message text (from compose)', for: 'everyone' },
];
