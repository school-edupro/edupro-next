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

/** Digital file movement (0090): raise, approve level by level, send back, resubmit from L1, PDF, report. */
describe('file movement (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let maker: SeededUser;
  let one: SeededUser;
  let two: SeededUser;
  const emp: Record<string, string> = {};
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const get = (url: string, u: SeededUser) => inject({ method: 'GET', url, headers: h(u) });
  const post = (url: string, u: SeededUser, json: unknown = {}) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const put = (url: string, u: SeededUser, json: unknown = {}) =>
    inject({ method: 'PUT', url, headers: h(u), json });

  beforeAll(async () => {
    const s = stamp('FM');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      maker = await seedUser(c, school, `${s}-maker`, 'class_teacher');
      one = await seedUser(c, school, `${s}-one`, 'academic_coordinator');
      two = await seedUser(c, school, `${s}-two`, 'accountant');
      for (const [code, first, u] of [
        ['M1', 'Meera', maker],
        ['A1', 'Arun', one],
        ['A2', 'Bina', two],
      ] as const) {
        const e = await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, designation, email)
           VALUES ($1, $2, $3, 'Staff', $4, 'Teacher', $5) RETURNING id::text`,
          [
            school.id,
            code,
            first,
            u.id,
            `${first.toLowerCase()}.${code.toLowerCase()}@example.test`,
          ],
        );
        emp[code] = e.rows[0]!.id;
      }
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => app.close());

  it('a file moves level by level; a send-back restarts from level 1; the approved file has its PDF', async () => {
    const people = (await get('/file-movement/people', maker)).json().data as Array<{ id: string }>;
    expect(people.map((p) => p.id).sort()).toEqual([emp.A1, emp.A2].sort());
    // one's own name, and the same person twice, are refused
    expect(
      (
        await post('/file-movement', maker, {
          subject: 'Purchase of lab equipment',
          bodyHtml: '<p>Please approve.</p>',
          approverIds: [emp.M1],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post('/file-movement', maker, {
          subject: 'Purchase of lab equipment',
          bodyHtml: '<p>Please approve.</p>',
          approverIds: [emp.A1, emp.A1],
        })
      ).statusCode,
    ).toBe(400);
    const made = await post('/file-movement', maker, {
      subject: 'Purchase of lab equipment',
      bodyHtml:
        '<h2>Need</h2><p>Six <strong>microscopes</strong> for the lab.<script>alert(1)</script></p><ul><li>Quote attached</li></ul>',
      approverIds: [emp.A1, emp.A2],
    });
    expect(made.statusCode).toBe(201);
    const id = made.json().id as string;
    expect(made.json()).toMatchObject({ status: 'pending', round: 1, levels: 2, isCreator: true });
    expect(made.json().number).toMatch(/^FM-\d{4}-\d{4}$/);
    expect(made.json().bodyHtml).not.toContain('script');
    expect(made.json().waitingOn).toContain('L1 · Arun');

    // level 2 does not see it yet; level 1 does
    expect((await get('/file-movement?box=inbox', two)).json().data).toHaveLength(0);
    expect((await get(`/file-movement/${id}`, two)).statusCode).toBe(404);
    expect((await get('/file-movement?box=inbox', one)).json()).toMatchObject({ inbox: 1 });
    expect(
      (await post(`/file-movement/${id}/decide`, two, { outcome: 'approved' })).statusCode,
    ).toBe(403);
    await post(`/file-movement/${id}/decide`, one, { outcome: 'approved', remark: 'Fine' });
    // level 2 sends it back: a remark is needed, and the creator gets it
    expect(
      (await post(`/file-movement/${id}/decide`, two, { outcome: 'returned' })).statusCode,
    ).toBe(400);
    const back = await post(`/file-movement/${id}/decide`, two, {
      outcome: 'returned',
      remark: 'Attach a second quote',
    });
    expect(back.json()).toMatchObject({ status: 'returned' });
    expect((await get(`/file-movement/${id}/pdf`, maker)).statusCode).toBe(409);
    const mine = (await get(`/file-movement/${id}`, maker)).json();
    expect(mine).toMatchObject({ canResubmit: true, canDecide: false });

    // corrected: a new round, from level 1 again
    const again = await put(`/file-movement/${id}`, maker, {
      subject: 'Purchase of lab equipment (two quotes)',
      bodyHtml: '<p>Two quotes compared; the lower one is chosen.</p>',
      approverIds: [emp.A1, emp.A2],
    });
    expect(again.json()).toMatchObject({ status: 'pending', round: 2 });
    expect(again.json().waitingOn).toContain('L1 · Arun');
    await post(`/file-movement/${id}/decide`, one, { outcome: 'approved' });
    const done = await post(`/file-movement/${id}/decide`, two, {
      outcome: 'approved',
      remark: 'Approved',
    });
    expect(done.json()).toMatchObject({ status: 'approved', canDownload: true });
    expect(done.json().history.map((x: { action: string }) => x.action)).toEqual([
      'submitted',
      'approved',
      'returned',
      'resubmitted',
      'approved',
      'approved',
    ]);
    const pdf = await get(`/file-movement/${id}/pdf`, maker);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');

    // a second file is rejected for good; a third is withdrawn by its creator
    const second = await post('/file-movement', maker, {
      subject: 'Picnic to the zoo',
      bodyHtml: '<p>Class VI on the 20th.</p>',
      approverIds: [emp.A1],
    });
    await post(`/file-movement/${second.json().id}/decide`, one, {
      outcome: 'rejected',
      remark: 'Exams that week',
    });
    const third = await post('/file-movement', maker, {
      subject: 'New notice board',
      bodyHtml: '<p>For the corridor.</p>',
      approverIds: [emp.A2],
    });
    expect((await post(`/file-movement/${third.json().id}/withdraw`, one)).statusCode).toBe(404);
    expect((await post(`/file-movement/${third.json().id}/withdraw`, maker)).json().status).toBe(
      'withdrawn',
    );

    // the creator was mailed each time a file came back or closed: sent back, approved, rejected
    const mails = await withMigrator(async (c) =>
      (
        await c.query<{ subject: string }>(
          // read them and take them off the queue: these are test addresses
          `UPDATE comms_messages SET status = 'cancelled' WHERE school_id = $1 AND variables ? 'fileNote' RETURNING id, subject`,
          [school.id],
        )
      ).rows.map((x) => x.subject.split(':')[0]),
    );
    expect(mails.sort()).toEqual([
      'Your file is approved',
      'Your file is rejected',
      'Your file is sent back',
    ]);

    // the office sees every file; an approver sees what came to them; the report comes as files
    const dash = (await get('/file-movement/dashboard', admin)).json();
    expect(dash).toMatchObject({
      seesAll: true,
      counts: { total: 3, approved: 1, rejected: 1, withdrawn: 1 },
    });
    expect((await get('/file-movement?box=all', admin)).json().data).toHaveLength(3);
    // the withdrawn file had reached level 1 (Bina), so it stays in what she may see
    expect((await get('/file-movement?box=all', two)).json().data).toHaveLength(2);
    expect((await get('/file-movement?box=acted', one)).json().data).toHaveLength(2);
    expect(
      (await get('/file-movement?box=all&status=approved&q=lab', admin)).json().data,
    ).toHaveLength(1);
    for (const format of ['xlsx', 'pdf']) {
      const f = await get(`/file-movement/export?box=all&format=${format}`, admin);
      expect(f.statusCode).toBe(200);
      expect(f.headers['content-disposition']).toContain(`.${format}`);
    }
  });
});
