/**
 * Fee set-up grids (0103): the class fee structure month by month, a discount head by head, their Excel
 * and PDF files, upload of the same Excel, clone to other classes, and the class calendar file.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
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

const MONTHS = [
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
  'January',
  'February',
  'March',
];
async function sheet(headers: string[], rows: Array<Array<string | number>>): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet');
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}

describe('fee set-up grids (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let classId: string;
  let otherClassId: string;
  let studentId: string;
  const heads: Record<string, string> = {};

  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const net = async () =>
    (
      (
        await inject({ method: 'GET', url: `/fees/students/${studentId}/ledger`, headers: h() })
      ).json() as {
        instalments: Array<{ net: string }>;
      }
    ).instalments.map((i) => i.net);
  const regenerate = () =>
    inject({ method: 'POST', url: `/fees/students/${studentId}/demands/regenerate`, headers: h() });

  beforeAll(async () => {
    const s = stamp('FGR');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
    });
    app = await createApp();
    inject = injector(app);
    const mk = async (code: string, order: number) => {
      const cls = await inject({
        method: 'POST',
        url: '/academics/classes',
        headers: h(),
        json: { code, name: `Class ${code}`, displayOrder: order },
      });
      const sec = await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(),
        json: { name: 'A' },
      });
      return [cls.json().id as string, sec.json().id as string] as const;
    };
    const [c1, s1] = await mk('I', 1);
    classId = c1;
    [otherClassId] = await mk('II', 2);
    for (const [code, name, i] of [
      ['TUI', 'Tuition fees', 1],
      ['ANN', 'Annual charges', 2],
    ] as const) {
      const r = await inject({
        method: 'POST',
        url: '/fees/heads',
        headers: h(),
        json: { code, name, sortOrder: i },
      });
      heads[code] = r.json().id;
    }
    await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 1 },
    });
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: 'FGR-1',
        firstName: 'Grid',
        lastName: 'Pupil',
        dob: '2015-01-01',
        admittedOn: '2025-04-05',
        enrolment: { classSectionId: s1, rollNo: 1 },
      },
    });
    studentId = st.json().id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('a head is charged its own amount each month; 0 means not charged', async () => {
    const empty = await inject({
      method: 'GET',
      url: `/fees/grids/structure?classId=${classId}`,
      headers: h(teacher),
    });
    expect(empty.statusCode).toBe(403);
    const save = await inject({
      method: 'PUT',
      url: '/fees/grids/structure',
      headers: h(),
      json: {
        classId,
        rows: [
          { headId: heads.TUI, amounts: Array(12).fill(14290) },
          { headId: heads.ANN, amounts: [3000, 0, 0, 0, 0, 0, 1500, 0, 0, 0, 0, 0] },
        ],
      },
    });
    expect(save.statusCode).toBe(200);
    expect(save.json()).toMatchObject({
      feeGroup: 'general',
      studentType: 'all',
      total: '175980.00',
    });
    expect(save.json().monthTotals[0]).toBe('17290.00');
    await inject({
      method: 'POST',
      url: `/fees/students/${studentId}/demands/generate`,
      headers: h(),
    });
    const n = await net();
    expect(n[0]).toBe('17290.00');
    expect(n[1]).toBe('14290.00');
    expect(n[6]).toBe('15790.00');
  });

  it('a discount gives its own percentage or fixed amount on each head', async () => {
    const d = await inject({
      method: 'POST',
      url: '/fees/discounts',
      headers: h(),
      json: { code: 'BUS', name: 'Staff concession', percent: 0 },
    });
    expect(d.statusCode).toBe(201);
    const both = await inject({
      method: 'PUT',
      url: `/fees/grids/discount/${d.json().id}`,
      headers: h(),
      json: { rows: [{ headId: heads.TUI, percent: 10, amount: 100 }] },
    });
    expect(both.statusCode).toBe(422);
    const lines = await inject({
      method: 'PUT',
      url: `/fees/grids/discount/${d.json().id}`,
      headers: h(),
      json: {
        rows: [
          { headId: heads.TUI, percent: 10 },
          { headId: heads.ANN, amount: 500 },
        ],
      },
    });
    expect(lines.statusCode).toBe(200);
    expect(lines.json().rows[0]).toMatchObject({ code: 'TUI', percent: '10.00', amount: null });
    await inject({
      method: 'PUT',
      url: `/fees/students/${studentId}/profile`,
      headers: h(),
      json: { studentType: 'old', discountId: d.json().id },
    });
    expect((await regenerate()).statusCode).toBe(201);
    const n = await net();
    expect(n[0]).toBe('15361.00'); // 14 290 − 1 429 and 3 000 − 500
    expect(n[1]).toBe('12861.00');
    const pdf = await inject({
      method: 'GET',
      url: `/fees/grids/discount/${d.json().id}/file?format=pdf`,
      headers: h(),
    });
    expect(pdf.statusCode).toBe(200);
    const up = await inject({
      method: 'POST',
      url: `/fees/grids/discount/${d.json().id}/import`,
      headers: h(),
      json: {
        fileBase64: await sheet(
          ['Head code', 'Percentage', 'Fix amount'],
          [
            ['TUI', 20, ''],
            ['ANN', '', ''],
          ],
        ),
      },
    });
    expect(up.json()).toMatchObject({ saved: 2, bad: [] });
    await regenerate();
    expect((await net())[0]).toBe('14432.00'); // 14 290 − 2 858 and the full 3 000
  });

  it('the structure downloads as Excel and PDF, uploads back, and clones to another class', async () => {
    for (const format of ['xlsx', 'pdf']) {
      const f = await inject({
        method: 'GET',
        url: `/fees/grids/structure/file?classId=${classId}&format=${format}`,
        headers: h(),
      });
      expect(f.statusCode).toBe(200);
      expect(f.rawPayload.length).toBeGreaterThan(1000);
    }
    const bad = await inject({
      method: 'POST',
      url: '/fees/grids/structure/import',
      headers: h(),
      json: {
        classId,
        fileBase64: await sheet(
          ['Head code', ...MONTHS],
          [
            ['TUI', ...Array(12).fill(15000)],
            ['NOPE', ...Array(12).fill(1)],
          ],
        ),
      },
    });
    expect(bad.json().saved).toBe(0);
    expect(bad.json().bad[0].error).toContain('NOPE');
    const good = await inject({
      method: 'POST',
      url: '/fees/grids/structure/import',
      headers: h(),
      json: {
        classId,
        fileBase64: await sheet(['Head code', ...MONTHS], [['TUI', ...Array(12).fill(15000)]]),
      },
    });
    expect(good.json()).toMatchObject({ saved: 1, bad: [] });
    const clone = await inject({
      method: 'POST',
      url: '/fees/grids/structure/clone',
      headers: h(),
      json: { classId, toClassIds: [otherClassId] },
    });
    expect(clone.statusCode).toBe(201);
    const copy = await inject({
      method: 'GET',
      url: `/fees/grids/structure?classId=${otherClassId}`,
      headers: h(),
    });
    expect(copy.json().rows.find((r: { code: string }) => r.code === 'TUI').amounts[11]).toBe(
      '15000.00',
    );
    expect(copy.json().rows.find((r: { code: string }) => r.code === 'ANN').amounts[6]).toBe(
      '1500.00',
    );
    // a different student type has its own grid
    const fresh = await inject({
      method: 'GET',
      url: `/fees/grids/structure?classId=${classId}&studentType=new`,
      headers: h(),
    });
    expect(fresh.json().total).toBe('0.00');
  });

  it('the class calendar downloads and uploads as Excel', async () => {
    const f = await inject({
      method: 'GET',
      url: `/fees/grids/calendar/file?classId=${classId}`,
      headers: h(),
    });
    expect(f.statusCode).toBe(200);
    const pdf = await inject({
      method: 'GET',
      url: `/fees/grids/calendar/file?classId=${classId}&format=pdf`,
      headers: h(),
    });
    expect(pdf.statusCode).toBe(200);
    const cols = [
      'Month no.',
      'Quarter',
      'Start fees date',
      'Last fees date',
      'Late fees',
      'Last date 1',
      'Late fee 1',
      'Last date 2',
      'Late fee 2',
      'Last date 3',
      'Late fee 3',
      'Challan date',
      'Bounce',
      'Fee pay',
      'Show',
    ];
    const up = await inject({
      method: 'POST',
      url: '/fees/grids/calendar/import',
      headers: h(),
      json: {
        classId,
        fileBase64: await sheet(cols, [
          [
            1,
            1,
            '01-04-2026',
            '15-04-2026',
            100,
            '20-04-2026',
            500,
            '25-04-2026',
            1000,
            '',
            '',
            '01-04-2026',
            250,
            'Yes',
            'Yes',
          ],
          [2, 1, '', '', '', '', '', '', '', '', '', '', '', 'Yes', 'No'],
        ]),
      },
    });
    expect(up.json()).toMatchObject({ saved: 2, bad: [] });
    const rules = (
      await inject({ method: 'GET', url: `/fees/class-rules/${classId}`, headers: h() })
    ).json().data;
    expect(rules.periods[0]).toMatchObject({
      dueOn: '2026-04-15',
      lateFeeAmount: '100.00',
      bounceCharge: '250.00',
      instalment: 1,
    });
    expect(rules.periods[0].slabs).toHaveLength(2);
    expect(rules.periods[1].show).toBe(false);
  });
});
