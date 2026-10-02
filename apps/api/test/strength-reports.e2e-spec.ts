/**
 * Student strength reports: class-wise with concessions, category F / M / T (short codes such as GEN
 * count as General, other values get their own column), one concession per class, age as on a date;
 * class and section filters, class + stream grouping, left students, the students behind a count and
 * the Excel / PDF export queue.
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

interface Table {
  columns: Array<{ key: string; label: string; group?: string }>;
  rows: Array<{ label: string; kind: string; values: Record<string, number> }>;
  meta: { students: number };
}

describe('student strength reports (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let yearId: string;
  let s: string;
  const ids: Record<string, string> = {};
  const h = () => headersFor(admin.sub, school.id);
  const get = async (qs: string) => {
    const r = await inject({ method: 'GET', url: `/reports/strength?${qs}`, headers: h() });
    expect(r.statusCode).toBe(200);
    return r.json() as Table;
  };
  const total = (t: Table) => t.rows.find((r) => r.kind === 'total')!.values;

  beforeAll(async () => {
    s = stamp('ST');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
    const mk = async (code: string, order: number, names: string[]) => {
      const cls = await inject({
        method: 'POST',
        url: '/academics/classes',
        headers: h(),
        json: { code, name: `Class ${code}`, displayOrder: order },
      });
      ids[`c${code}`] = cls.json().id;
      for (const n of names) {
        const sec = await inject({
          method: 'POST',
          url: `/academics/classes/${cls.json().id}/sections`,
          headers: h(),
          json: { name: n },
        });
        ids[`${code}${n}`] = sec.json().id;
      }
    };
    await mk('V', 5, ['A', 'B']);
    await mk('XI', 11, ['A', 'B']);
    const add = async (
      key: string,
      first: string,
      gender: string,
      dob: string,
      category: string,
      section: string,
      stream?: string,
    ) => {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `${s}-${key}`,
          firstName: first,
          lastName: 'Strength',
          gender,
          dob,
          category,
          enrolment: { classSectionId: ids[section] },
        },
      });
      expect(r.statusCode).toBe(201);
      ids[key] = r.json().id;
      if (stream)
        await withMigrator((c) =>
          c.query(
            `UPDATE students SET profile = profile || jsonb_build_object('stream', $2::text) WHERE id = $1`,
            [ids[key], stream],
          ),
        );
    };
    await add('a', 'Asha', 'female', '2016-05-10', 'GEN', 'VA');
    await add('b', 'Bhanu', 'male', '2016-08-01', 'OBC', 'VA');
    await add('c', 'Chitra', 'female', '2015-12-20', 'EWS', 'VB');
    await add('d', 'Dev', 'male', '2009-04-02', 'SC', 'XIA', 'Science (PCM)');
    await add('e', 'Esha', 'female', '2009-07-15', 'General', 'XIB', 'Commerce');
    yearId = (
      await withMigrator((c) =>
        c.query<{ id: string }>(
          `SELECT academic_year_id::text AS id FROM class_sections WHERE id = $1`,
          [ids.VA],
        ),
      )
    ).rows[0]!.id;
    // a concession for Chitra
    await withMigrator(async (c) => {
      const d = await c.query<{ id: string }>(
        `INSERT INTO fee_discounts (school_id, academic_year_id, code, name, percent) VALUES ($1, $2, 'EWS', 'EWS (25%)', 25) RETURNING id::text`,
        [school.id, yearId],
      );
      ids.ews = d.rows[0]!.id;
      await c.query(
        `INSERT INTO student_fee_profiles (school_id, student_id, academic_year_id, discount_id) VALUES ($1, $2, $3, $4)`,
        [school.id, ids.c, yearId, ids.ews],
      );
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('class-wise: sections with class totals, male / female and one column per concession plus General', async () => {
    const t = await get(`report=classwise&groupBy=section&academicYearId=${yearId}`);
    expect(t.columns.map((c) => c.label)).toEqual([
      'Total',
      'Male',
      'Female',
      'EWS (25%)',
      'General',
    ]);
    expect(t.rows.map((r) => `${r.kind}:${r.label}`)).toEqual([
      'row:V-A',
      'row:V-B',
      'subtotal:V TOTAL',
      'row:XI-A',
      'row:XI-B',
      'subtotal:XI TOTAL',
      'total:GRAND TOTAL',
    ]);
    expect(total(t)).toMatchObject({ T: 5, M: 2, F: 3, [`d:${ids.ews}`]: 1, 'd:none': 4 });
  });

  it('category: F / M / T per category; GEN counts as General, EWS gets its own column; class + stream', async () => {
    const t = await get(`report=category&groupBy=class_stream&academicYearId=${yearId}`);
    const groups = [...new Set(t.columns.map((c) => c.group))];
    expect(groups).toEqual(expect.arrayContaining(['General', 'OBC', 'SC', 'EWS', 'TOTAL']));
    expect(t.rows.map((r) => r.label)).toEqual(['V', 'XI-SC', 'XI-COM', 'GRAND TOTAL']);
    expect(total(t)).toMatchObject({
      'General|T': 2,
      'General|F': 2,
      'EWS|T': 1,
      'SC|M': 1,
      'TOTAL|T': 5,
    });
  });

  it('discount: the chosen concession per class; age: ages as on the date entered', async () => {
    const d = await get(
      `report=discount&groupBy=class&discountId=${ids.ews}&academicYearId=${yearId}`,
    );
    expect(d.rows.map((r) => r.label)).toEqual(['V', 'GRAND TOTAL']);
    expect(total(d)).toMatchObject({ T: 1, F: 1 });
    const missing = await inject({
      method: 'GET',
      url: `/reports/strength?report=age&groupBy=class&academicYearId=${yearId}`,
      headers: h(),
    });
    expect(missing.statusCode).toBe(400);
    const a = await get(`report=age&groupBy=class&asOn=2026-10-02&academicYearId=${yearId}`);
    // Asha (2016-05-10) is 10, Bhanu (2016-08-01) 10, Chitra (2015-12-20) 10; Dev 17, Esha 17
    expect(total(a)).toMatchObject({ '10|T': 3, '17|T': 2, 'TOTAL|T': 5 });
  });

  it('filters by class and section, shows empty sections, and lists the students behind a count', async () => {
    const t = await get(
      `report=classwise&groupBy=section&classIds=${ids.cV}&sectionIds=${ids.VB}&academicYearId=${yearId}`,
    );
    expect(t.rows.map((r) => r.label)).toEqual(['V-B', 'V TOTAL', 'GRAND TOTAL']);
    const empty = await inject({
      method: 'POST',
      url: `/academics/classes/${ids.cV}/sections`,
      headers: h(),
      json: { name: 'C' },
    });
    expect(empty.statusCode).toBe(201);
    const withEmpty = await get(
      `report=classwise&groupBy=section&classIds=${ids.cV}&showEmpty=true&academicYearId=${yearId}`,
    );
    expect(withEmpty.rows.map((r) => r.label)).toContain('V-C');
    const list = await inject({
      method: 'GET',
      url: `/reports/strength/students?report=classwise&groupBy=section&academicYearId=${yearId}&column=F&classId=${ids.cV}&classSectionId=${ids.VA}`,
      headers: h(),
    });
    expect(list.json().data.map((x: { name: string }) => x.name)).toEqual(['Asha Strength']);
  });

  it('queues the Excel and the PDF through the export pipeline', async () => {
    for (const format of ['xlsx', 'pdf']) {
      const r = await inject({
        method: 'POST',
        url: '/reports/strength/export',
        headers: h(),
        json: { report: 'classwise', groupBy: 'section', academicYearId: yearId, format },
      });
      expect(r.statusCode).toBe(201);
      const e = await inject({
        method: 'GET',
        url: `/reports/exports/${r.json().exportId}`,
        headers: h(),
      });
      expect(e.json().export).toMatchObject({ dataset: 'strength_report', format });
    }
  });
});
