import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptField, type JobEnvelope } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { renderEmployeeProfile } from '../src/renderers/employee-profile';
import { newDb, seedSchool, stamp, withMigrator, type SeededSchool } from './helpers';

/** The employee profile printout (docs/design/30-employee-master.md): sections, rows, documents, masking. */
describe('employee profile printout', () => {
  const db = newDb();
  let school: SeededSchool;
  let employeeId = '';
  // no logo and no photo on file: nothing is read from storage
  const storage = {
    read: () => Promise.reject(new Error('no file')),
  } as unknown as StorageDriver;
  const envelope = (userId: string | null): JobEnvelope => ({
    schoolId: school.id,
    userId,
    requestId: null,
    kind: 'export.generate',
    payload: {},
  });

  beforeAll(async () => {
    school = await seedSchool(stamp('EPP'));
    employeeId = await withMigrator(async (c) => {
      await c.query(`SELECT app.employee_document_types_seed($1)`, [school.id]);
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      const e = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, gender, dob, department, designation, joined_on, mobile, profile, secure, address)
         VALUES ($1, 'PR001', 'MEERA', 'IYER', 'female', '1990-05-12', 'Teaching Senior', 'PGT', '2015-07-01', '9810000001',
                 '{"staff_type": "Teaching Regular", "blood_group": "B+", "marital_status": "Single", "pf_no": "DL/123"}'::jsonb,
                 $2::jsonb, '{"present": {"line1": "12 Park Street", "city": "Noida", "pin": "201301"}}'::jsonb)
         RETURNING id::text`,
        [school.id, JSON.stringify({ aadhaar: encryptField('123456789012') })],
      );
      const id = e.rows[0]!.id;
      await c.query(
        `INSERT INTO employee_education (school_id, employee_id, qualification, institution, passing_year) VALUES ($1, $2, 'M.Sc.', 'DU <Delhi>', 2012)`,
        [school.id, id],
      );
      await c.query(
        `INSERT INTO employee_languages (school_id, employee_id, language, can_read, can_speak) VALUES ($1, $2, 'Hindi', true, true)`,
        [school.id, id],
      );
      return id;
    });
  });
  afterAll(async () => db.close());

  it('prints the sections that are filled, the rows, the documents due, and masks the Aadhaar for one without the right', async () => {
    const r = await renderEmployeeProfile(db, storage, envelope(null), { employeeId });
    expect(r).toMatchObject({ width: '210mm', height: '297mm' });
    const html = r.html;
    expect(html).toContain('Employee Profile');
    expect(html).toContain('MEERA IYER');
    expect(html).toContain('PR001');
    // key facts and sections
    expect(html).toContain('12-05-1990');
    expect(html).toContain('Teaching Regular');
    expect(html).toContain('DL/123');
    expect(html).toContain('12 Park Street');
    // rows, escaped
    expect(html).toContain('M.Sc.');
    expect(html).toContain('DU &lt;Delhi&gt;');
    expect(html).toContain('Hindi');
    // the documents due for a teacher, none on file
    expect(html).toContain('B.Ed. / D.El.Ed. / NTT');
    expect(html).toContain('Not submitted');
    // masked: the job has no user holding people.sensitive.view
    expect(html).toContain('XXXX-XXXX-9012');
    expect(html).not.toContain('123456789012');
    // empty sections are left out (no bank details given)
    expect(html).not.toContain('<h3>Bank details</h3>');
  });

  it('an unknown employee fails the job', async () => {
    await expect(
      renderEmployeeProfile(db, storage, envelope(null), { employeeId: '999999999' }),
    ).rejects.toThrow('not found');
  });
});
