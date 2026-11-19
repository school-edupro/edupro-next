/**
 * The approvals inbox (docs/design/89 §5.4, phase C): everything a person may decide, gathered on the server from the
 * routes the web apps use, in one shape; a decision goes through that kind's own route as the person (its rules,
 * refusals and audit), so the inbox adds none of its own. Every name and number here is made up.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createApp,
  headersFor,
  injector,
  seedSchool,
  seedUser,
  stamp,
  type SeededSchool,
  type SeededUser,
  withMigrator,
} from './helpers';
import { APPROVAL_SOURCES } from '../src/modules/approvals/sources';

interface Item {
  kind: string;
  id: string;
  title: string;
  detail: string | null;
  by: string | null;
  at: string | null;
  href: string;
  app: string;
  decideHere: boolean;
  reasonOnReject: boolean;
  approveAs: string;
  rejectAs: string | null;
  url: string | null;
}

describe('approvals inbox (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let other: SeededUser;
  let parent: SeededUser;
  /** holds every right a kind of the inbox is asked by, and nothing else */
  let rights: SeededUser;
  let section = '';
  let kid = '';
  const s = stamp('APX');
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, who: SeededUser, json?: unknown) =>
    inject({ method, url, headers: headersFor(who.sub, school.id), ...(json ? { json } : {}) });
  const inbox = async (who: SeededUser) => {
    const r = await call('GET', '/approvals/inbox', who);
    expect(r.statusCode).toBe(200);
    return r.json() as {
      total: number;
      kinds: Array<{ kind: string; label: string; count: number }>;
      items: Item[];
      unavailable: Array<{ kind: string }>;
    };
  };
  const applyLeave = async (reason: string, from = 1) => {
    const r = await call('POST', '/attendance/leaves/mine', parent, {
      studentId: kid,
      leaveType: 'family',
      fromDate: day(from),
      toDate: day(from),
      reason,
    });
    expect(r.statusCode).toBe(201);
    return r.json().id as string;
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`);
      other = await seedUser(c, school, `${s}-other`, 'class_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      rights = await seedUser(c, school, `${s}-rights`);
      const role = await c.query<{ id: string }>(
        `INSERT INTO roles (school_id, code, name, kind) VALUES ($1, 'zz_inbox_rights', 'Inbox rights', 'module') RETURNING id::text`,
        [school.id],
      );
      const codes = [
        ...new Set(APPROVAL_SOURCES.flatMap((x) => [...x.permissions, ...(x.needsAll ?? [])])),
      ];
      await c.query(
        `INSERT INTO role_permissions (role_id, permission_code) SELECT $1, unnest($2::text[])`,
        [role.rows[0]!.id, codes],
      );
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason) VALUES ($1, $2, $3, 'e2e')`,
        [school.id, rights.id, role.rows[0]!.id],
      );
      for (const [code, u] of [
        ['T1', teacher],
        ['T2', other],
      ] as const)
        await c.query(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, $2, 'Tara', 'Teacher', $3)`,
          [school.id, code, u.id],
        );
    });
    app = await createApp();
    inject = injector(app);
    await call('PUT', '/platform/settings/attendance.weekly_off', admin, { value: [] });
    const cls = await call('POST', '/academics/classes', admin, {
      code: 'VI',
      name: 'Class VI',
      displayOrder: 6,
    });
    section = (
      await call('POST', `/academics/classes/${cls.json().id}/sections`, admin, { name: 'A' })
    ).json().id;
    const st = await call('POST', '/people/students', admin, {
      admissionNo: `${s}-1`,
      firstName: 'Ana',
      lastName: 'Sample',
      guardians: [
        {
          guardian: { firstName: 'Pia', lastName: 'Sample', mobile: '9876533301' },
          relation: 'mother',
          isPrimary: true,
        },
      ],
      enrolment: { classSectionId: section, rollNo: 1 },
    });
    expect(st.statusCode).toBe(201);
    kid = st.json().id;
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876533301' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
    const emp = await withMigrator((c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE school_id = $1 AND employee_code = 'T1'`,
        [school.id],
      ),
    );
    expect(
      (
        await call('POST', '/academics/teacher-assignments', admin, {
          employeeId: emp.rows[0]!.id,
          classSectionId: section,
          kind: 'class_teacher',
        })
      ).statusCode,
    ).toBe(201);
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(
        `UPDATE comms_messages SET status = 'cancelled' WHERE school_id = $1 AND status IN ('queued', 'sending')`,
        [school.id],
      ),
    );
    if (app) await app.close();
  });

  it("an administrator's inbox reads every kind's list route without a fault", async () => {
    const box = await inbox(admin);
    // every list route answered (a wrong address or query would show here as unavailable)
    expect(box.unavailable).toEqual([]);
    // the kinds' counts add up to the total; the items read are never more
    expect(box.total).toBe(box.kinds.reduce((n, k) => n + k.count, 0));
    expect(box.items.length).toBeLessThanOrEqual(box.total);
    // the counts alone: the same total, no items
    const counts = await call('GET', '/approvals/inbox?view=counts', admin);
    expect(counts.json()).toMatchObject({ total: box.total, items: [] });
  });

  it("no kind's list refuses a person who holds the rights the inbox asks that kind by", async () => {
    // a person given exactly those rights (an approver who raises nothing: fees.adjustment.approve without
    // .request, a department that clears withdrawals): each list they are asked must answer, not refuse
    const refused: string[] = [];
    for (const src of APPROVAL_SOURCES.filter((x) => x.permissions.length > 0)) {
      const r = await call(src.list.method as 'GET', src.list.url, rights);
      if (r.statusCode === 403) refused.push(`${src.kind}: ${src.list.url}`);
    }
    expect(refused).toEqual([]);
    const box = await inbox(rights);
    expect(box.unavailable).toEqual([]);
    // the fee lists open to those who decide fee requests, still not to everyone
    for (const url of ['/fees/adjustments?status=pending', '/fees/requests?status=pending'])
      expect((await call('GET', url, other)).statusCode).toBe(403);
  });

  it('the class teacher sees a leave applied for a pupil, in the one shape, and approves it there', async () => {
    const id = await applyLeave('A family wedding');
    const box = await inbox(teacher);
    const it = box.items.find((x) => x.kind === 'leave' && x.id === id)!;
    expect(it).toMatchObject({
      title: expect.stringContaining('Ana'),
      detail: expect.stringContaining('A family wedding'),
      app: 'teacher',
      href: `/leaves?tab=inbox&open=${id}`,
      decideHere: true,
      reasonOnReject: true,
      approveAs: 'approve',
      rejectAs: 'reject',
      url: null,
    });
    expect(box.kinds).toContainEqual({ kind: 'leave', label: 'Student leave', count: 1 });

    const before = await withMigrator(async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM audit_logs WHERE school_id = $1`,
            [school.id],
          )
        ).rows[0]!.n,
      ),
    );
    const ok = await call('POST', `/approvals/leave/${id}/decision`, teacher, {
      decision: 'approve',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ kind: 'leave', id, decision: 'approve' });
    expect(ok.json().result).toMatchObject({ status: 'approved' });
    // one audit row: the leave route's own (the inbox writes none)
    const after = await withMigrator(async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM audit_logs WHERE school_id = $1`,
            [school.id],
          )
        ).rows[0]!.n,
      ),
    );
    expect(after - before).toBe(1);
    expect((await inbox(teacher)).items.some((x) => x.id === id)).toBe(false);
  });

  it("a rejection needs its reason; the kind's own refusals come back as they are", async () => {
    const id = await applyLeave('Visiting grandparents', 2);
    const bare = await call('POST', `/approvals/leave/${id}/decision`, teacher, {
      decision: 'reject',
    });
    expect(bare.statusCode).toBe(400);
    expect(bare.json()).toMatchObject({ type: 'validation-failed' });
    // another teacher is not the approver: the leave route refuses, and its refusal is passed on
    const notMine = await call('POST', `/approvals/leave/${id}/decision`, other, {
      decision: 'approve',
    });
    expect(notMine.statusCode).toBe(403);
    const no = await call('POST', `/approvals/leave/${id}/decision`, teacher, {
      decision: 'reject',
      reason: 'Exams that week',
    });
    expect(no.statusCode).toBe(200);
    expect(no.json().result).toMatchObject({ status: 'rejected' });
    // decided already: the route's own conflict
    const again = await call('POST', `/approvals/leave/${id}/decision`, teacher, {
      decision: 'approve',
    });
    expect(again.statusCode).toBe(409);
  });

  it('a kind decided on its own page, or no such kind, is refused by the inbox', async () => {
    const own = await call('POST', '/approvals/receipt/1/decision', admin, { decision: 'approve' });
    expect(own.statusCode).toBe(409);
    expect(own.json()).toMatchObject({ type: 'approvals.own_page' });
    const none = await call('POST', '/approvals/nothing/1/decision', admin, {
      decision: 'approve',
    });
    expect(none.statusCode).toBe(404);
  });

  it('a family member has nothing to decide', async () => {
    const box = await inbox(parent);
    expect(box.total).toBe(0);
    expect(box.unavailable).toEqual([]);
  });
  it("every kind's list and decision routes exist and take the inbox's request as it sends it", async () => {
    const h = { ...headersFor(admin.sub, school.id) };
    // the check below sees a body a route refuses: a known bad one is caught
    const control = await inject({
      method: 'POST',
      url: '/attendance/leaves/999999999/decide',
      headers: h,
      json: { outcome: 'nope' },
    });
    expect(control.statusCode).toBe(400);
    expect(control.json()).toMatchObject({ type: 'validation-failed', errors: expect.anything() });
    const faults: string[] = [];
    for (const src of APPROVAL_SOURCES) {
      const l = await inject({ method: src.list.method, url: src.list.url, headers: h });
      if (l.statusCode === 404 && /Cannot (GET|POST)/.test(l.body))
        faults.push(`${src.kind}: list route missing`);
      if (l.statusCode === 400) faults.push(`${src.kind}: list ${l.body}`);
      if (!src.decide) continue;
      for (const d of ['approve', 'reject'] as const) {
        if (d === 'reject' && src.rejectAs === null) continue;
        const id = src.kind === 'vendor' ? 'vendor-999999999' : '999999999';
        const c = src.decide(id, d, 'Checking the route');
        const r = await inject({
          method: c.method,
          url: c.url,
          headers: h,
          ...(c.body === undefined ? {} : { json: c.body }),
        });
        if (r.statusCode === 404 && /Cannot (GET|POST|PUT)/.test(r.body))
          faults.push(`${src.kind} ${d}: route missing (${c.url})`);
        // the route's own validator refusing the body the inbox sends
        if (r.statusCode === 400 && r.json().type === 'validation-failed' && r.json().errors)
          faults.push(`${src.kind} ${d}: ${r.body.slice(0, 300)}`);
      }
    }
    expect(faults).toEqual([]);
  });
});
