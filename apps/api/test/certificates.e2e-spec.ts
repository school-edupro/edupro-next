/**
 * Certificate management, phase A (docs/design/87): the types made on first use; numbering per type and year under
 * concurrency, never reused; the checks and the principal's override (the right, a fresh MFA sign-in, the reason
 * recorded); duplicates and cancels; the frozen paper (a later template or record change does not change it); the TC
 * issued through the register from the register and the profile; the register's filters, figures and files.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createApp,
  headersFor,
  injector,
  seedSchool,
  seedUser,
  stamp,
  withMigrator,
  type SeededSchool,
  type SeededUser,
} from './helpers';

interface Cert {
  id: string;
  number: string;
  copyNo: number;
  status: string;
  bookNo: number | null;
  slNo: number | null;
  overrideReason: string | null;
  exportId: string | null;
  transferCertificateId: string | null;
  checks: Array<{ key: string; ok: boolean; detail: string }>;
}

describe('certificate register (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let other: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  let teacher: SeededUser;
  let outsider: SeededUser;
  let section: string;
  const pupils: Record<string, string> = {};
  let bonafide: Cert;
  let tc: Cert;

  const h = (u: SeededUser = admin, extra: Record<string, string> = {}) =>
    headersFor(u.sub, school.id, extra);
  const issue = (json: Record<string, unknown>, u: SeededUser = admin, extra = {}) =>
    inject({ method: 'POST', url: '/certificates/issue', headers: h(u, extra), json });

  beforeAll(async () => {
    const s = stamp('CRT');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      office = await seedUser(c, school, `${s}-office`, 'certificate_office');
      teacher = await seedUser(c, school, `${s}-teacher`);
      outsider = await seedUser(c, other, `${s}-outsider`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VIII', name: 'Class VIII', displayOrder: 8 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    section = sec.json().id;
    let roll = 1;
    for (const [key, first, gender] of [
      ['asha', 'Asha', 'female'],
      ['bina', 'Bina', 'female'],
      ['chet', 'Chetan', 'male'],
      ['dev', 'Dev', 'male'],
      ['esha', 'Esha', 'female'],
    ] as const) {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `${s}-${key}`,
          firstName: first,
          lastName: 'Test',
          dob: '2013-03-09',
          gender,
          guardians: [
            {
              guardian: {
                firstName: 'Ravi',
                lastName: 'Test',
                mobile: `98765${String(40000 + roll)}`,
              },
              relation: 'father',
              isPrimary: true,
            },
          ],
          enrolment: { classSectionId: section, rollNo: roll++ },
        },
      });
      if (r.statusCode !== 201) throw new Error(`student ${key}: ${r.statusCode} ${r.body}`);
      pupils[key] = r.json().id as string;
    }
    // Esha left the school earlier
    await withMigrator((c) =>
      c.query(`UPDATE students SET status = 'inactive', left_on = '2026-06-30' WHERE id = $1`, [
        pupils.esha,
      ]),
    );
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('makes the types and their ready templates on first use, with the fields each asks for', async () => {
    const r = await inject({ method: 'GET', url: '/certificates/types', headers: h() });
    expect(r.statusCode).toBe(200);
    const types = r.json().rows as Array<{
      code: string;
      template: string | null;
      usesBook: boolean;
      multiple: string;
      fields: Array<{ key: string }>;
    }>;
    expect(types.map((t) => t.code).slice(0, 4)).toEqual(['TC', 'BONAFIDE', 'CHARACTER', 'DOB']);
    expect(types).toHaveLength(21);
    expect(types.every((t) => t.template)).toBe(true);
    const tcType = types.find((t) => t.code === 'TC')!;
    expect(tcType).toMatchObject({ usesBook: true, multiple: 'ONE' });
    expect(tcType.fields.map((f) => f.key)).toEqual(
      expect.arrayContaining([
        'reason',
        'workingDays',
        'daysPresent',
        'subjects',
        'conduct',
        'struckOffDate',
      ]),
    );
    expect(r.json().can).toMatchObject({ issue: true, cancel: true, override: true, setup: true });
    // the office: issue and cancel, not override; a teacher: nothing; another school sees its own
    const officeTypes = await inject({
      method: 'GET',
      url: '/certificates/types',
      headers: h(office),
    });
    expect(officeTypes.json().can).toMatchObject({ issue: true, cancel: true, override: false });
    const t = await inject({ method: 'GET', url: '/certificates', headers: h(teacher) });
    expect(t.statusCode).toBe(403);
    // the issue screen finds students on the rolls and past ones
    const found = await inject({
      method: 'GET',
      url: '/certificates/students?q=sha',
      headers: h(office),
    });
    expect(found.json().rows.map((x: { name: string; left: boolean }) => [x.name, x.left])).toEqual(
      [
        ['Asha Test', false],
        ['Esha Test', true],
      ],
    );
    const short = await inject({
      method: 'GET',
      url: '/certificates/students?q=a',
      headers: h(office),
    });
    expect(short.statusCode).toBe(400);
  });

  it('previews a bonafide (checks, fields, the paper) without saving anything', async () => {
    const p = await inject({
      method: 'POST',
      url: '/certificates/preview',
      headers: h(office),
      json: { typeCode: 'BONAFIDE', studentId: pupils.asha, purpose: 'Bank account' },
    });
    expect(p.statusCode).toBe(201);
    expect(p.json()).toMatchObject({
      failed: 0,
      held: false,
      student: { className: 'Class VIII', section: 'A' },
    });
    const html = p.json().html as string;
    expect(html).toContain('Bonafide certificate');
    expect(html).toContain('Asha Test');
    expect(html).toContain('daughter of');
    expect(html).toContain('Ninth March two thousand thirteen');
    expect(html).toContain('BON/2026-27/(next)');
    const list = await inject({ method: 'GET', url: '/certificates', headers: h() });
    expect(list.json().total).toBe(0);
  });

  it('numbers per type and year, one at a time under load, and never twice', async () => {
    const first = await issue(
      { typeCode: 'BONAFIDE', studentId: pupils.asha, purpose: 'Bank account' },
      office,
    );
    expect(first.statusCode).toBe(201);
    bonafide = first.json() as Cert;
    expect(bonafide).toMatchObject({
      number: 'BON/2026-27/00001',
      copyNo: 0,
      status: 'issued',
      bookNo: null,
    });
    expect(bonafide.exportId).toMatch(/^\d+$/);
    // eight at once (two pupils, two types): every number taken once, each series counting on its own
    const many = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        issue(
          { typeCode: i % 2 ? 'DOB' : 'BONAFIDE', studentId: i < 4 ? pupils.bina : pupils.chet },
          office,
        ),
      ),
    );
    expect(many.map((r) => r.statusCode)).toEqual(Array(8).fill(201));
    const bon = many.filter((_, i) => i % 2 === 0).map((r) => (r.json() as Cert).number);
    const dob = many.filter((_, i) => i % 2 === 1).map((r) => (r.json() as Cert).number);
    expect(bon.sort()).toEqual([
      'BON/2026-27/00002',
      'BON/2026-27/00003',
      'BON/2026-27/00004',
      'BON/2026-27/00005',
    ]);
    expect(dob.sort()).toEqual([
      'DOB/2026-27/00001',
      'DOB/2026-27/00002',
      'DOB/2026-27/00003',
      'DOB/2026-27/00004',
    ]);
    // a cancelled number is not given again
    const cancel = await inject({
      method: 'POST',
      url: `/certificates/${(many[0]!.json() as Cert).id}/cancel`,
      headers: h(office),
      json: { reason: 'Issued in error' },
    });
    expect(cancel.json()).toMatchObject({ status: 'cancelled' });
    const next = await issue({ typeCode: 'BONAFIDE', studentId: pupils.bina }, office);
    expect((next.json() as Cert).number).toBe('BON/2026-27/00006');
  });

  it('stops a certificate whose checks fail; the principal issues it with a reason (fresh MFA, recorded)', async () => {
    // a bonafide is for a student on the rolls: Esha has left
    const stopped = await issue({ typeCode: 'BONAFIDE', studentId: pupils.esha }, office);
    expect(stopped.statusCode).toBe(409);
    expect(stopped.json()).toMatchObject({ type: 'certificate.checks_failed' });
    expect(stopped.json().checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'state', ok: false })]),
    );
    // the office has no override
    const officeOverride = await issue(
      {
        typeCode: 'BONAFIDE',
        studentId: pupils.esha,
        overrideReason: 'Needed for the scholarship form',
      },
      office,
    );
    expect(officeOverride.statusCode).toBe(403);
    // the principal, but without a fresh multi-factor sign-in
    const stale = await inject({
      method: 'POST',
      url: '/certificates/issue',
      headers: { ...h(), authorization: `Bearer dev:${admin.sub};mfa=false` },
      json: {
        typeCode: 'BONAFIDE',
        studentId: pupils.esha,
        overrideReason: 'Needed for the scholarship form',
      },
    });
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toMatchObject({ type: 'mfa-required' });
    const short = await issue({
      typeCode: 'BONAFIDE',
      studentId: pupils.esha,
      overrideReason: 'ok',
    });
    expect(short.statusCode).toBe(400);
    const ok = await issue({
      typeCode: 'BONAFIDE',
      studentId: pupils.esha,
      overrideReason: 'Needed for the scholarship form',
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ overrideReason: 'Needed for the scholarship form' });
    expect((ok.json() as Cert).checks.find((x) => x.key === 'state')).toMatchObject({ ok: false });
    // a character certificate is for any student, past or present
    const ch = await issue(
      { typeCode: 'CHARACTER', studentId: pupils.esha, fields: { conduct: 'Very good' } },
      office,
    );
    expect(ch.statusCode).toBe(201);
    const badList = await issue(
      { typeCode: 'CHARACTER', studentId: pupils.esha, fields: { conduct: 'Wonderful' } },
      office,
    );
    expect(badList.statusCode).toBe(400);
  });

  it('issues the TC from the register: its checks, the book Sl. No., the student off the rolls', async () => {
    // Dev still uses the school bus, and has no withdrawal
    await withMigrator((c) =>
      c.query(
        `INSERT INTO student_transport (school_id, student_id, academic_year_id, service, from_month, to_month, status)
         SELECT $1, $2, id, 'both', '2026-04-01', '2027-03-01', 'active' FROM academic_years WHERE school_id = $1 AND code = '2026-27'`,
        [school.id, pupils.dev],
      ),
    );
    const fields = {
      reason: 'Family moving to another city',
      conduct: 'Good',
      examResult: 'Class VII, passed',
    };
    const stopped = await issue({ typeCode: 'TC', studentId: pupils.dev, fields });
    expect(stopped.statusCode).toBe(409);
    const failed = (stopped.json().checks as Cert['checks']).filter((x) => !x.ok).map((x) => x.key);
    expect(failed.sort()).toEqual(['state', 'transport']);
    const missing = await issue({
      typeCode: 'TC',
      studentId: pupils.dev,
      fields: { conduct: 'Good' },
    });
    expect(missing.statusCode).toBe(400);
    const r = await issue({
      typeCode: 'TC',
      studentId: pupils.dev,
      fields,
      overrideReason: 'Transport ends with the month; parents asked in writing',
    });
    expect(r.statusCode).toBe(201);
    tc = r.json() as Cert;
    expect(tc).toMatchObject({ number: 'TC/2026-27/00001', bookNo: 1, slNo: 1 });
    expect(tc.transferCertificateId).toMatch(/^\d+$/);
    const student = await inject({
      method: 'GET',
      url: `/people/students/${pupils.dev}`,
      headers: h(),
    });
    expect(student.json().status).toBe('inactive');
    // the TC's own list shows it under the same number
    const tcs = await inject({
      method: 'GET',
      url: `/people/students/${pupils.dev}/tc`,
      headers: h(),
    });
    expect(tcs.json().data[0]).toMatchObject({
      tcNo: 'TC/2026-27/00001',
      status: 'issued',
      lastClass: 'VIII-A',
    });
    // what it printed is frozen: the 24 fields' data
    const d = await inject({ method: 'GET', url: `/certificates/${tc.id}`, headers: h() });
    expect(d.json().data.tc).toMatchObject({
      reason: 'Family moving to another city',
      examResult: 'Class VII, passed',
      lastClass: 'Class VIII – A',
      lastClassWords: 'Eighth',
      failed: 'No',
    });
    expect(d.json().data.student).toMatchObject({
      dobWords: 'Ninth March two thousand thirteen',
      fatherName: 'Ravi Test',
    });
    // one live TC a student: a second is refused even by the principal
    const again = await issue({
      typeCode: 'TC',
      studentId: pupils.dev,
      fields,
      overrideReason: 'Trying a second one',
    });
    expect(again.statusCode).toBe(409);
    const ex = await inject({
      method: 'GET',
      url: `/reports/exports/${tc.exportId}`,
      headers: h(),
    });
    expect(ex.json().export.dataset).toBe('certificate_doc');
  });

  it('issues the TC from the profile through the same register, the Sl. No. counting on', async () => {
    const r = await inject({
      method: 'POST',
      url: `/people/students/${pupils.chet}/tc`,
      headers: h(),
      json: {
        reason: 'Admission elsewhere',
        conduct: 'Good',
        fields: { workingDays: 180, daysPresent: 171 },
        overrideReason: 'Withdrawal signed by the parents at the desk',
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ tcNo: 'TC/2026-27/00002' });
    const reg = await inject({ method: 'GET', url: '/certificates?type=TC', headers: h() });
    const row = (reg.json().rows as Cert[]).find((x) => x.number === 'TC/2026-27/00002')!;
    expect(row).toMatchObject({ bookNo: 1, slNo: 2, transferCertificateId: r.json().id });
    expect(row.overrideReason).toContain('Withdrawal signed');
    const d = await inject({ method: 'GET', url: `/certificates/${row.id}`, headers: h() });
    expect(d.json().data.tc).toMatchObject({
      workingDays: 180,
      daysPresent: 171,
      reason: 'Admission elsewhere',
    });
  });

  it('prints a duplicate: the same number and paper, copy 1, 2 …', async () => {
    const d1 = await inject({
      method: 'POST',
      url: `/certificates/${tc.id}/duplicate`,
      headers: h(office),
      json: { reason: 'Original lost by the parents' },
    });
    expect(d1.statusCode).toBe(201);
    expect(d1.json()).toMatchObject({
      number: tc.number,
      copyNo: 1,
      bookNo: 1,
      slNo: 1,
      status: 'issued',
    });
    // a duplicate of the duplicate is a copy of the original
    const d2 = await inject({
      method: 'POST',
      url: `/certificates/${(d1.json() as Cert).id}/duplicate`,
      headers: h(office),
      json: { reason: 'Second copy for the new school' },
    });
    expect(d2.json()).toMatchObject({ number: tc.number, copyNo: 2 });
    const detail = await inject({ method: 'GET', url: `/certificates/${tc.id}`, headers: h() });
    expect(detail.json().copies.map((x: Cert) => x.copyNo)).toEqual([0, 1, 2]);
  });

  it('keeps the paper it was made with when the template or the record changes later', async () => {
    const before = await withMigrator((c) =>
      c.query<{ template_version_id: string; name: string }>(
        `SELECT template_version_id::text, data->'student'->>'name' AS name FROM certificates WHERE id = $1`,
        [bonafide.id],
      ),
    );
    const tpl = await withMigrator((c) =>
      c.query<{ id: string }>(
        `SELECT template_id::text AS id FROM certificate_types WHERE school_id = $1 AND code = 'BONAFIDE'`,
        [school.id],
      ),
    );
    const patch = await inject({
      method: 'PATCH',
      url: `/platform/templates/${tpl.rows[0]!.id}`,
      headers: h(),
      json: {
        bodyHtml: '<div class="cert"><h2>Bonafide (new layout)</h2><p>{{student.name}}</p></div>',
      },
    });
    expect(patch.statusCode).toBe(200);
    await inject({
      method: 'PATCH',
      url: `/people/students/${pupils.asha}`,
      headers: h(),
      json: { firstName: 'Ashaa' },
    });
    const after = await withMigrator((c) =>
      c.query<{ template_version_id: string; name: string }>(
        `SELECT template_version_id::text, data->'student'->>'name' AS name FROM certificates WHERE id = $1`,
        [bonafide.id],
      ),
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(after.rows[0]!.name).toBe('Asha Test');
    // a new one is made with the new version
    const fresh = await issue({ typeCode: 'BONAFIDE', studentId: pupils.asha }, office);
    const v = await withMigrator((c) =>
      c.query<{ template_version_id: string }>(
        `SELECT template_version_id::text FROM certificates WHERE id = $1`,
        [(fresh.json() as Cert).id],
      ),
    );
    expect(v.rows[0]!.template_version_id).not.toBe(before.rows[0]!.template_version_id);
    // the reprint of the old one is the old paper
    const again = await inject({
      method: 'POST',
      url: `/certificates/${bonafide.id}/render`,
      headers: h(),
    });
    expect(again.statusCode).toBe(201);
    expect(again.json().exportId).not.toBe(bonafide.exportId);
  });

  it('cancels a TC with its duplicates and its TC row; the number stays used', async () => {
    const c = await inject({
      method: 'POST',
      url: `/certificates/${tc.id}/cancel`,
      headers: h(office),
      json: { reason: 'Parents decided to stay' },
    });
    expect(c.json()).toMatchObject({ status: 'cancelled' });
    const detail = await inject({ method: 'GET', url: `/certificates/${tc.id}`, headers: h() });
    expect(detail.json().copies.map((x: Cert) => x.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    const tcs = await inject({
      method: 'GET',
      url: `/people/students/${pupils.dev}/tc`,
      headers: h(),
    });
    expect(tcs.json().data[0]).toMatchObject({ status: 'cancelled' });
    const twice = await inject({
      method: 'POST',
      url: `/certificates/${tc.id}/cancel`,
      headers: h(office),
      json: { reason: 'again' },
    });
    expect(twice.statusCode).toBe(409);
    const dup = await inject({
      method: 'POST',
      url: `/certificates/${tc.id}/duplicate`,
      headers: h(office),
      json: { reason: 'Copy please' },
    });
    expect(dup.statusCode).toBe(409);
    // a TC cancelled from its own screen takes its register row with it
    const reg = await inject({
      method: 'GET',
      url: '/certificates?type=TC&status=issued',
      headers: h(),
    });
    const other = (reg.json().rows as Cert[])[0]!;
    await inject({
      method: 'POST',
      url: `/people/tc/${other.transferCertificateId}/cancel`,
      headers: h(),
      json: { reason: 'issued in error' },
    });
    const gone = await inject({ method: 'GET', url: `/certificates/${other.id}`, headers: h() });
    expect(gone.json().status).toBe('cancelled');
  });

  it('lists the register with filters, figures and pages, and gives it as Excel and PDF', async () => {
    const all = await inject({ method: 'GET', url: '/certificates?size=5', headers: h() });
    expect(all.statusCode).toBe(200);
    const total = all.json().total as number;
    expect(all.json().rows).toHaveLength(5);
    expect(all.json().figures).toMatchObject({ duplicates: 2 });
    expect(all.json().years).toEqual(['2026-27']);
    const dups = await inject({ method: 'GET', url: '/certificates?copy=duplicate', headers: h() });
    expect(dups.json().total).toBe(2);
    const over = await inject({ method: 'GET', url: '/certificates?override=yes', headers: h() });
    expect(over.json().total).toBe(3);
    const q = await inject({ method: 'GET', url: '/certificates?q=Bina', headers: h() });
    expect(q.json().total).toBe(5);
    const cancelled = await inject({
      method: 'GET',
      url: '/certificates?status=cancelled',
      headers: h(),
    });
    expect(cancelled.json().figures.cancelled).toBe(cancelled.json().total);
    const page2 = await inject({ method: 'GET', url: '/certificates?size=5&page=2', headers: h() });
    expect(page2.json().total).toBe(total);
    const mine = await inject({
      method: 'GET',
      url: `/certificates/student/${pupils.esha}`,
      headers: h(),
    });
    expect(mine.json().rows).toHaveLength(2);
    for (const format of ['xlsx', 'pdf']) {
      const f = await inject({
        method: 'GET',
        url: `/certificates/file?format=${format}&type=BONAFIDE`,
        headers: h(),
      });
      expect(f.statusCode).toBe(200);
      expect(f.json().filename).toMatch(new RegExp(`certificate-register.*\\.${format}$`));
      expect(Buffer.from(f.json().base64 as string, 'base64').length).toBeGreaterThan(500);
    }
    // another school sees none of it
    const outside = await inject({
      method: 'GET',
      url: `/certificates/${bonafide.id}`,
      headers: headersFor(outsider.sub, other.id),
    });
    expect(outside.statusCode).toBe(404);
  });
});
