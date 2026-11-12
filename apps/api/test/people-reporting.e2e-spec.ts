/**
 * Reporting managers (docs/design/30, "reporting lines"): the list with its figures and filters, ticked
 * employees given a manager, one by one, a loop or an employee as their own manager refused, a manager's
 * whole team moved, the posting tab clearing a manager (it used to keep the old one), and the same from
 * Excel — checked old → new with the refused rows, then the good rows saved; the rights.
 */
import ExcelJS from 'exceljs';
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

describe('reporting managers (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  const ids: Record<string, string> = {};
  const s = stamp('RM');
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const managerOf = async (code: string) =>
    (await call(admin, 'GET', `/people/reporting?q=${s}${code}&size=25`)).json().rows[0].manager
      ?.id ?? null;

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-t`, 'subject_teacher');
      for (const code of ['A', 'B', 'C', 'D', 'E'])
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation)
             VALUES ($1, $2, $2, 'E2E', 'Science', 'Teacher') RETURNING id::text`,
            [school.id, `${s}${code}`],
          )
        ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('ticked employees given a manager, one by one, the loops refused, a team moved, a manager cleared', async () => {
    const empty = (await call(admin, 'GET', '/people/reporting')).json();
    expect(empty.figures).toMatchObject({ staff: 5, set: 0, none: 5, managers: 0 });
    // B and C (ticked) report to A
    const two = (
      await call(admin, 'POST', '/people/reporting/assign', {
        employeeIds: [ids.B, ids.C],
        managerId: ids.A,
      })
    ).json();
    expect(two).toMatchObject({ changed: 2, unchanged: 0, waiting: 0 });
    const list = (await call(admin, 'GET', `/people/reporting?managerId=${ids.A!}`)).json();
    expect(list.rows.map((r: { code: string }) => r.code).sort()).toEqual([`${s}B`, `${s}C`]);
    expect(list.figures).toMatchObject({ set: 2, none: 3, managers: 1 });
    expect(list.lists.managers).toEqual([expect.objectContaining({ id: ids.A, reportees: 2 })]);
    expect((await call(admin, 'GET', '/people/reporting?managerId=none')).json().total).toBe(3);
    // the same again changes nothing
    expect(
      (
        await call(admin, 'POST', '/people/reporting/assign', {
          employeeIds: [ids.B],
          managerId: ids.A,
        })
      ).json(),
    ).toMatchObject({ changed: 0, unchanged: 1 });
    // one by one: D reports to B
    await call(admin, 'POST', '/people/reporting/assign', {
      employeeIds: [ids.D],
      managerId: ids.B,
    });
    expect(await managerOf('D')).toBe(ids.B);
    // A to D would go round a loop (D → B → A); A to A is themselves
    const loop = await call(admin, 'POST', '/people/reporting/assign', {
      employeeIds: [ids.A],
      managerId: ids.D,
    });
    expect(loop.statusCode).toBe(409);
    expect(loop.json().detail).toMatch(/report to someone who reports to them/);
    expect(
      (
        await call(admin, 'POST', '/people/reporting/assign', {
          employeeIds: [ids.A],
          managerId: ids.A,
        })
      ).statusCode,
    ).toBe(400);
    // the posting tab refuses the loop too
    expect(
      (
        await call(admin, 'PUT', `/people/employees/${ids.A!}/postings`, {
          reportsToEmployeeId: ids.D,
        })
      ).statusCode,
    ).toBe(409);
    // A's whole team (B, C) moves to E
    const moved = (
      await call(admin, 'POST', '/people/reporting/move', {
        fromManagerId: ids.A,
        toManagerId: ids.E,
      })
    ).json();
    expect(moved).toMatchObject({ team: 2, changed: 2 });
    expect(await managerOf('B')).toBe(ids.E);
    expect(
      (
        await call(admin, 'POST', '/people/reporting/move', {
          fromManagerId: ids.A,
          toManagerId: ids.E,
        })
      ).statusCode,
    ).toBe(409);
    // the posting tab clears a manager (empty: nobody), and keeps it when the field is not sent
    await call(admin, 'PUT', `/people/employees/${ids.C!}/postings`, { designation: 'PGT' });
    expect(await managerOf('C')).toBe(ids.E);
    await call(admin, 'PUT', `/people/employees/${ids.C!}/postings`, { reportsToEmployeeId: null });
    expect(await managerOf('C')).toBeNull();
    // only those who edit employees change it
    expect(
      (
        await call(teacher, 'POST', '/people/reporting/assign', {
          employeeIds: [ids.C],
          managerId: ids.A,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('from Excel: the sheet filled with the managers now, checked old → new with the refused rows, then saved', async () => {
    const f = (await call(admin, 'GET', '/people/reporting/format')).json();
    expect(f.filename).toBe('reporting-managers.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(f.base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const rowOf = new Map<string, ExcelJS.Row>();
    ws.eachRow((row, n) => {
      if (n > 1) rowOf.set(String(row.getCell(1).value), row);
    });
    // the managers now: B and D report to E and B
    expect(rowOf.get(`${s}B`)!.getCell(5).value).toBe(`${s}E`);
    expect(rowOf.get(`${s}D`)!.getCell(5).value).toBe(`${s}B`);
    rowOf.get(`${s}C`)!.getCell(5).value = `${s}A`; // a change
    rowOf.get(`${s}A`)!.getCell(5).value = 'NOPE'; // an unknown code
    rowOf.get(`${s}E`)!.getCell(5).value = `${s}E`; // themselves
    const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const dry = (
      await call(admin, 'POST', '/people/reporting/import', { file, dryRun: true })
    ).json();
    expect(dry.counts).toEqual({ change: 1, same: 2, error: 2 });
    const change = dry.rows.find((r: { status: string }) => r.status === 'change');
    expect(change.employee).toContain(`(${s}C)`);
    expect(change.from).toBeNull();
    expect(change.to).toContain(`(${s}A)`);
    expect(
      dry.rows
        .filter((r: { status: string }) => r.status === 'error')
        .map((r: { error: string }) => r.error),
    ).toEqual(
      expect.arrayContaining([
        'NOPE is not on the active staff list',
        'An employee cannot report to themselves',
      ]),
    );
    expect(await managerOf('C')).toBeNull();
    const saved = (
      await call(admin, 'POST', '/people/reporting/import', { file, dryRun: false })
    ).json();
    expect(saved.saved).toBe(1);
    expect(await managerOf('C')).toBe(ids.A);
    // the same sheet again changes nothing
    expect(
      (await call(admin, 'POST', '/people/reporting/import', { file, dryRun: false })).json().saved,
    ).toBe(0);
  });
});
