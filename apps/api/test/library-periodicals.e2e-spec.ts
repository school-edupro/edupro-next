/**
 * Library, part 6 (0211, docs/design/36-library.md): periodical subscriptions. Issues expected from the
 * frequency (a month keeps its day); received one by one or many at once, marked missing, undone; late
 * after the grace days; the issues to receive; the list's figures; a change of dates or frequency that
 * keeps the issues received; a special issue; renewal for the next period; cancellation; the claims list
 * for the vendor; what is refused; the rights. Dates are counted from the database's today.
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

describe('library periodical subscriptions (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  const h = (u?: SeededUser) => headersFor((u ?? admin).sub, school.id);
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown, u?: SeededUser) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const s = stamp('LPS');
  const ids: Record<string, string> = {};
  let today = '';
  const day = (d: string, n: number) =>
    new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const month = (d: string, n: number) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCMonth(x.getUTCMonth() + n);
    return x.toISOString().slice(0, 10);
  };
  let monthly: Record<string, unknown> = {};

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      today = (await c.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`)).rows[0]!.d;
    });
    app = await createApp();
    inject = injector(app);
    await call('GET', '/library/subscriptions/setup');
    const m = (master: string, values: Record<string, unknown>) =>
      call('POST', `/masters/${master}/rows`, { values });
    await m('library_vendors', { code: 'NA', name: 'News Agency' });
    await m('library_periodicals', {
      name: 'Science Reporter',
      kind: 'Magazine',
      frequency: 'Monthly',
      vendor_id: 'NA',
    });
    await m('library_periodicals', { name: 'The Hindu', kind: 'Newspaper', frequency: 'Daily' });
    await m('library_periodicals', { name: 'Nature', kind: 'Journal' });
    const setup = (await call('GET', '/library/subscriptions/setup')).json();
    ids.main = setup.libraries[0].id;
    for (const p of setup.periodicals as Array<{ id: string; name: string }>) ids[p.name] = p.id;
    ids.vendor = setup.vendors[0].id;
    const start = `${month(today, -4).slice(0, 8)}01`;
    monthly = {
      periodicalId: ids['Science Reporter'],
      libraryId: ids.main,
      startsOn: start,
      endsOn: day(month(start, 12), -1),
      copies: 2,
      cost: 1200,
      orderNo: 'PO-7',
    };
  });
  afterAll(async () => app.close());

  it('a monthly subscription: twelve issues from the frequency, the vendor of the periodical', async () => {
    const r = await call('POST', '/library/subscriptions', monthly);
    expect(r.statusCode).toBe(201);
    expect(r.json().issues).toBe(12);
    ids.monthly = r.json().id;
    const v = (await call('GET', `/library/subscriptions/${ids.monthly}`)).json();
    expect(v).toMatchObject({
      periodical: 'Science Reporter',
      frequency: 'Monthly',
      vendor: 'News Agency',
      state: 'current',
      copies: 2,
    });
    expect(v.issues[0]).toMatchObject({
      expectedOn: monthly.startsOn,
      status: 'expected',
      late: true,
    });
    expect(v.issues[0].label).toMatch(/^[A-Z][a-z]+ \d{4}$/);
    expect(v.issues.filter((i: { expectedOn: string }) => i.expectedOn <= today)).toHaveLength(5);
    const late = v.issues.filter((i: { late: boolean }) => i.late).length;
    expect(late).toBe(Number(today.slice(8, 10)) > 8 ? 5 : 4);
    ids.i1 = v.issues[0].id;
    ids.i2 = v.issues[1].id;
    ids.i3 = v.issues[2].id;
    ids.i4 = v.issues[3].id;
  });

  it('issues received, many at once, marked missing, undone; the issues to receive; the figures', async () => {
    expect(
      (
        await call('POST', `/library/issues/${ids.i1!}/receive`, {
          on: today,
          volume: '62',
          issueNo: '4',
        })
      ).json(),
    ).toEqual({ id: ids.i1, status: 'received' });
    expect(
      (await call('POST', `/library/issues/${ids.i1!}/receive`, { on: today })).statusCode,
    ).toBe(409);
    expect(
      (await call('POST', `/library/issues/${ids.i2!}/receive`, { on: day(today, 1) })).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', '/library/issues/receive', { ids: [ids.i2, ids.i3], on: today })).json(),
    ).toEqual({
      received: 2,
    });
    expect(
      (
        await call('POST', `/library/issues/${ids.i4!}/missing`, { remarks: 'Not delivered' })
      ).json().status,
    ).toBe('missing');
    expect((await call('POST', `/library/issues/${ids.i3!}/undo`)).json().status).toBe('expected');
    const v = (await call('GET', `/library/subscriptions/${ids.monthly!}`)).json();
    expect(v.issues[0]).toMatchObject({
      status: 'received',
      receivedOn: today,
      copiesReceived: 2,
      volume: '62',
      issueNo: '4',
    });
    expect(v.issues[1]).toMatchObject({ status: 'received', copiesReceived: 2 });
    expect(v.issues[2]).toMatchObject({ status: 'expected' });
    expect(v.issues[3]).toMatchObject({ status: 'missing', remarks: 'Not delivered' });
    const due = (await call('GET', '/library/issues/due')).json().data;
    expect(due.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([ids.i3]));
    expect(due.every((x: { periodical: string }) => x.periodical === 'Science Reporter')).toBe(
      true,
    );
    expect(due).toHaveLength(2);
    const list = (await call('GET', '/library/subscriptions', undefined, coordinator)).json();
    expect(list.figures).toMatchObject({ current: 1, toReceive: 2, cost: 1200 });
    expect(list.data[0]).toMatchObject({ due: 5, received: 2, missing: 1, issues: 12 });
    // the claims list: late and missing issues by vendor
    const claims = (
      await call('GET', `/library/subscriptions/claims?vendorId=${ids.vendor!}`)
    ).json();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(claims.base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(1).getCell(1).value).toBe('Vendor');
    const what = [] as string[];
    for (let i = 2; i <= ws.rowCount; i += 1) what.push(String(ws.getRow(i).getCell(7).value));
    expect(what).toContain('Missing');
    expect(claims.rows).toBe(what.length);
  });

  it('a change keeps the issues received; a special issue; what does not fit is refused', async () => {
    // eighteen months, then quarterly: the received and missing stay, the expected follow
    const longer = { ...monthly, endsOn: day(month(String(monthly.startsOn), 18), -1) };
    expect((await call('PUT', `/library/subscriptions/${ids.monthly!}`, longer)).statusCode).toBe(
      200,
    );
    let v = (await call('GET', `/library/subscriptions/${ids.monthly!}`)).json();
    expect(v.issues).toHaveLength(18);
    expect(
      (
        await call('PUT', `/library/subscriptions/${ids.monthly!}`, {
          ...longer,
          frequency: 'Quarterly',
        })
      ).statusCode,
    ).toBe(200);
    v = (await call('GET', `/library/subscriptions/${ids.monthly!}`)).json();
    const kept = v.issues.filter((i: { status: string }) => i.status !== 'expected');
    expect(kept.map((i: { id: string }) => i.id).sort()).toEqual([ids.i1, ids.i2, ids.i4].sort());
    // six quarterly days in eighteen months; the first and the third fall on issues received or missing
    expect(v.issues.filter((i: { status: string }) => i.status === 'expected')).toHaveLength(4);
    // ending before an issue received: refused
    expect(
      (
        await call('PUT', `/library/subscriptions/${ids.monthly!}`, {
          ...longer,
          endsOn: day(String(monthly.startsOn), 20),
        })
      ).statusCode,
    ).toBe(400);
    const special = await call('POST', `/library/subscriptions/${ids.monthly!}/issues`, {
      expectedOn: day(today, 3),
      label: 'Diwali special',
    });
    expect(special.statusCode).toBe(201);
    expect(
      (
        await call('POST', `/library/subscriptions/${ids.monthly!}/issues`, {
          expectedOn: day(today, 3),
          label: 'Diwali special',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call('POST', `/library/subscriptions/${ids.monthly!}/issues`, {
          expectedOn: day(String(monthly.startsOn), -1),
          label: 'Before',
        })
      ).statusCode,
    ).toBe(400);
    const ahead = (await call('GET', '/library/issues/due?ahead=5')).json().data;
    expect(
      ahead.some(
        (x: { label: string; special: boolean }) => x.label === 'Diwali special' && x.special,
      ),
    ).toBe(true);
  });

  it('renewed for the next period; cancelled from a day; refused when it does not make sense', async () => {
    const renewed = await call('POST', `/library/subscriptions/${ids.monthly!}/renew`);
    expect(renewed.statusCode).toBe(201);
    ids.next = renewed.json().id;
    const n = (await call('GET', `/library/subscriptions/${ids.next!}`)).json();
    const was = (await call('GET', `/library/subscriptions/${ids.monthly!}`)).json();
    expect(n).toMatchObject({
      startsOn: day(was.endsOn, 1),
      frequency: 'Quarterly',
      copies: 2,
      cost: '1200.00',
      renewedFrom: ids.monthly,
      state: 'upcoming',
    });
    expect(n.endsOn).toBe(day(month(day(was.endsOn, 1), 18), -1));
    expect(was.renewedBy).toBe(ids.next);
    expect((await call('POST', `/library/subscriptions/${ids.monthly!}/renew`)).statusCode).toBe(
      409,
    );
    const cancel = await call('POST', `/library/subscriptions/${ids.next!}/cancel`, {
      on: day(n.startsOn, 10),
      reason: 'Budget cut',
    });
    expect(cancel.json().removed).toBe(n.issues.length - 1);
    expect(
      (
        await call('POST', `/library/subscriptions/${ids.next!}/cancel`, {
          on: n.startsOn,
          reason: 'Again',
        })
      ).statusCode,
    ).toBe(409);
    const cancelled = (await call('GET', '/library/subscriptions?status=cancelled')).json().data;
    expect(cancelled.map((x: { id: string }) => x.id)).toEqual([ids.next]);
    // a daily newspaper: 30 issues, seven of them due
    const daily = await call('POST', '/library/subscriptions', {
      periodicalId: ids['The Hindu'],
      libraryId: ids.main,
      startsOn: day(today, -6),
      endsOn: day(today, 23),
      graceDays: 0,
    });
    expect(daily.json().issues).toBe(30);
    const due = (await call('GET', '/library/issues/due')).json().data;
    expect(due.filter((x: { periodical: string }) => x.periodical === 'The Hindu')).toHaveLength(7);
    // refused: no frequency, a first issue outside, more than five years, the wrong order of days
    const bad = (body: Record<string, unknown>) =>
      call('POST', '/library/subscriptions', {
        libraryId: ids.main,
        startsOn: today,
        endsOn: day(today, 30),
        ...body,
      });
    expect((await bad({ periodicalId: ids.Nature })).statusCode).toBe(400);
    expect((await bad({ periodicalId: ids.Nature, frequency: 'Monthly' })).statusCode).toBe(201);
    expect(
      (await bad({ periodicalId: ids['The Hindu'], firstIssueOn: day(today, 40) })).statusCode,
    ).toBe(400);
    expect(
      (await bad({ periodicalId: ids['The Hindu'], endsOn: day(today, 2000) })).statusCode,
    ).toBe(400);
    expect((await bad({ periodicalId: ids['The Hindu'], endsOn: day(today, -1) })).statusCode).toBe(
      400,
    );
    expect(
      (
        await bad({ periodicalId: ids['The Hindu'] }).then(() =>
          call('POST', '/library/subscriptions', monthly, coordinator),
        )
      ).statusCode,
    ).toBe(403);
  });
});
