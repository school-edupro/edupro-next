/**
 * Helpdesk (0056): a parent query goes to the class teacher, is answered, handed on, closed, reopened and
 * rated, with attachments; an unresolved ticket climbs the escalation matrix (reassigned + mailed) and is
 * marked breached after the last level; staff queries and tickets to the ERP provider (two-way, the
 * provider's senior mailed when late); who sees what; the six-month dashboard and its Excel; hypercare
 * issues now land on the provider desk.
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

describe('helpdesk (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let other: SeededUser;
  let accountant: SeededUser;
  let parent: SeededUser;
  let support: SeededUser;
  let s: string;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);

  const fileOf = async (u: SeededUser, name: string) =>
    withMigrator(async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, status, created_by)
         VALUES ($1, 'local', $2, 'application/pdf', 1200, $3, 'ready', $4) RETURNING id::text`,
        [school.id, `${s}/${name}-${String(Math.random()).slice(2)}`, name, u.id],
      );
      return r.rows[0]!.id;
    });
  const pastDue = (id: string) =>
    withMigrator((c) =>
      c.query(`UPDATE parent_queries SET due_at = now() - interval '1 minute' WHERE id = $1`, [id]),
    );

  beforeAll(async () => {
    s = stamp('HD');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      other = await seedUser(c, school, `${s}-other`, 'subject_teacher');
      accountant = await seedUser(c, school, `${s}-acct`, 'accountant');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      support = await seedUser(c, school, `${s}-erp`, 'erp_support', 'external');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, mobile, email, department, designation, user_id)
         VALUES ($1, 'T01', 'Tanvi', 'Rao', '9811100001', 'tanvi@example.com', 'Academics', 'TGT', $2),
                ($1, 'T02', 'Omar', 'Khan', '9811100002', 'omar@example.com', 'Academics', 'TGT', $3),
                ($1, 'A01', 'Asha', 'Mehta', '9811100003', 'asha@example.com', 'Accounts', 'Accountant', $4)`,
        [school.id, teacher.id, other.id, accountant.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    ids.sec = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(),
        json: { name: 'A' },
      })
    ).json().id;
    ids.secB = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(),
        json: { name: 'B' },
      })
    ).json().id;
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: `${s}-1`,
        firstName: 'Aarav',
        lastName: 'Six',
        guardians: [
          {
            guardian: { firstName: 'Suresh', lastName: 'Six', mobile: '9822200001' },
            relation: 'father',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: ids.sec },
      },
    });
    expect(st.statusCode).toBe(201);
    ids.student = st.json().id;
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $2 WHERE id = (SELECT guardian_id FROM student_guardians WHERE student_id = $1)`,
        [ids.student, parent.id],
      );
      await c.query(
        `INSERT INTO teacher_assignments (school_id, academic_year_id, employee_id, class_section_id, kind)
         SELECT $1, $2, e.id, $3, 'class_teacher' FROM employees e WHERE e.school_id = $1 AND e.employee_code = 'T01'`,
        [school.id, school.yearId, ids.sec],
      );
      // the other teacher is scoped to VI-B only
      await c.query(
        `INSERT INTO user_role_scopes (school_id, user_role_id, scope_type, scope_id)
         SELECT $1, ur.id, 'class_section', $3 FROM user_roles ur WHERE ur.user_id = $2 AND ur.school_id = $1`,
        [school.id, other.id, ids.secB],
      );
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('a parent query goes to the class teacher, is answered, handed on, closed, reopened and rated', async () => {
    const heads = await inject({
      method: 'GET',
      url: '/engagement/mine/categories',
      headers: h(parent),
    });
    expect(heads.json().data.map((x: { code: string }) => x.code)).toContain('academics');
    const file = await fileOf(parent, 'homework.pdf');
    const raised = await inject({
      method: 'POST',
      url: '/engagement/mine/queries',
      headers: h(parent),
      json: {
        studentId: ids.student,
        kind: 'query',
        categoryCode: 'academics',
        subject: 'Maths homework unclear',
        body: 'Page 12 sums are not in the book.',
        fileIds: [file],
      },
    });
    expect(raised.statusCode).toBe(201);
    ids.q = raised.json().id;

    // the class teacher owns it, with a due time from the head's SLA
    const mine = await inject({
      method: 'GET',
      url: '/helpdesk/tickets?view=assigned',
      headers: h(teacher),
    });
    const t = mine.json().data.find((x: { id: string }) => x.id === ids.q);
    expect(t).toMatchObject({
      desk: 'parent',
      assignedRole: 'class_teacher',
      assignedTo: 'Tanvi Rao',
      level: 1,
    });
    expect(t.dueAt).toBeTruthy();
    // another teacher (not of this section) cannot see it; the attachment opens for the teacher
    expect(
      (await inject({ method: 'GET', url: `/helpdesk/tickets/${ids.q}`, headers: h(other) }))
        .statusCode,
    ).toBe(404);
    const link = await inject({
      method: 'GET',
      url: `/helpdesk/tickets/${ids.q}/files/${file}`,
      headers: h(teacher),
    });
    expect(link.statusCode).toBe(200);
    expect(link.json().download.url).toBeTruthy();

    // a stranger's file cannot be attached
    const foreign = await fileOf(teacher, 'x.pdf');
    const bad = await inject({
      method: 'POST',
      url: `/engagement/mine/queries/${ids.q}/responses`,
      headers: h(parent),
      json: { body: 'see this', fileIds: [foreign] },
    });
    expect(bad.statusCode).toBe(400);

    const ans = await inject({
      method: 'POST',
      url: `/helpdesk/tickets/${ids.q}/replies`,
      headers: h(teacher),
      json: {
        body: 'Sums are in the worksheet I shared.',
        fileIds: [await fileOf(teacher, 'worksheet.pdf')],
      },
    });
    expect(ans.statusCode).toBe(201);
    expect(ans.json().status).toBe('answered');
    const back = await inject({
      method: 'POST',
      url: `/engagement/mine/queries/${ids.q}/responses`,
      headers: h(parent),
      json: { body: 'Also the fee for the book?' },
    });
    expect(back.json().status).toBe('open');

    // the teacher hands it to the accountant role with a note the family does not see
    const moved = await inject({
      method: 'POST',
      url: `/helpdesk/tickets/${ids.q}/assign`,
      headers: h(teacher),
      json: { roleCode: 'accountant', note: 'Book fee question' },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ assignedRole: 'accountant', assignedUserId: null });
    const acct = await inject({
      method: 'GET',
      url: `/helpdesk/tickets/${ids.q}`,
      headers: h(accountant),
    });
    expect(acct.json().you).toMatchObject({ handler: true, canClose: true });
    // the earlier owner still sees it
    expect(
      (await inject({ method: 'GET', url: `/helpdesk/tickets/${ids.q}`, headers: h(teacher) }))
        .statusCode,
    ).toBe(200);
    const fam = await inject({
      method: 'GET',
      url: `/engagement/mine/queries/${ids.q}/timeline`,
      headers: h(parent),
    });
    expect(fam.json().replies.some((r: { body: string }) => r.body === 'Book fee question')).toBe(
      false,
    );
    expect(fam.json().you.raiser).toBe(true);

    const closed = await inject({
      method: 'POST',
      url: `/helpdesk/tickets/${ids.q}/close`,
      headers: h(accountant),
      json: { resolution: 'Book fee is ₹250, payable with the term fee.' },
    });
    expect(closed.json()).toMatchObject({
      status: 'closed',
      resolution: 'Book fee is ₹250, payable with the term fee.',
    });
    expect(closed.json().you.canClose).toBe(false);

    const reopened = await inject({
      method: 'POST',
      url: `/engagement/mine/queries/${ids.q}/reopen`,
      headers: h(parent),
      json: { reason: 'Which term?' },
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toMatchObject({ status: 'open', reopenedCount: 1 });
    await inject({
      method: 'POST',
      url: `/helpdesk/tickets/${ids.q}/close`,
      headers: h(accountant),
      json: { resolution: 'Term 2.' },
    });
    const rated = await inject({
      method: 'POST',
      url: `/engagement/mine/queries/${ids.q}/rate`,
      headers: h(parent),
      json: { rating: 5 },
    });
    expect(rated.json().rating).toBe(5);
    const timeline = (
      await inject({ method: 'GET', url: `/helpdesk/tickets/${ids.q}`, headers: h() })
    )
      .json()
      .events.map((e: { kind: string }) => e.kind);
    expect(timeline).toEqual(
      expect.arrayContaining([
        'created',
        'replied',
        'assigned',
        'note',
        'closed',
        'reopened',
        'rated',
      ]),
    );
  });

  it('the escalation matrix reassigns and mails the next level, then marks the ticket breached', async () => {
    const setup = await inject({ method: 'GET', url: '/helpdesk/setup', headers: h() });
    expect(setup.statusCode).toBe(200);
    const fees = setup
      .json()
      .heads.find((x: { desk: string; code: string }) => x.desk === 'parent' && x.code === 'fees');
    const saved = await inject({
      method: 'PUT',
      url: `/helpdesk/setup/heads/${fees.id}`,
      headers: h(),
      json: {
        desk: 'parent',
        code: 'fees',
        name: 'Fees and payments',
        ownerType: 'role',
        ownerRole: 'accountant',
        slaHours: 4,
        levels: [
          {
            level: 2,
            hours: 8,
            assignType: 'employee',
            userId: admin.id,
            emails: ['principal@example.com'],
          },
        ],
      },
    });
    expect(saved.statusCode).toBe(200);
    const r = await inject({
      method: 'POST',
      url: '/engagement/mine/queries',
      headers: h(parent),
      json: {
        studentId: ids.student,
        kind: 'complaint',
        categoryCode: 'fees',
        subject: 'Fee charged twice',
        body: 'Paid on 1st and again on 3rd.',
      },
    });
    const id = r.json().id as string;
    expect(
      (
        await inject({ method: 'GET', url: `/helpdesk/tickets/${id}`, headers: h(accountant) })
      ).json().assignedRole,
    ).toBe('accountant');
    await pastDue(id);
    const run = await inject({ method: 'POST', url: '/helpdesk/escalate-now', headers: h() });
    expect(run.json().escalated).toBeGreaterThanOrEqual(1);
    const up = (
      await inject({ method: 'GET', url: `/helpdesk/tickets/${id}`, headers: h() })
    ).json();
    expect(up).toMatchObject({ level: 2, assignedUserId: admin.id, status: 'in_progress' });
    expect(new Date(up.dueAt).getTime()).toBeGreaterThan(Date.now());
    expect(up.events.find((e: { kind: string }) => e.kind === 'escalated').emails).toContain(
      'principal@example.com',
    );
    const mails = await withMigrator((c) =>
      c.query<{ recipient_address: string }>(
        `SELECT recipient_address FROM comms_messages WHERE school_id = $1 AND channel = 'email' AND (variables ->> 'helpdesk_query') = $2`,
        [school.id, id],
      ),
    );
    expect(mails.rows.map((m) => m.recipient_address)).toContain('principal@example.com');
    // the last level runs out too: breached once, not escalated again
    await pastDue(id);
    await inject({ method: 'POST', url: '/helpdesk/escalate-now', headers: h() });
    const late = (
      await inject({ method: 'GET', url: `/helpdesk/tickets/${id}`, headers: h() })
    ).json();
    expect(late.level).toBe(2);
    expect(late.breachedAt).toBeTruthy();
    const list = await inject({
      method: 'GET',
      url: '/helpdesk/tickets?status=overdue',
      headers: h(),
    });
    expect(list.json().data.some((x: { id: string }) => x.id === id)).toBe(true);
  });

  it('staff queries go to their owner role; tickets to the ERP provider are two-way and reach the senior when late', async () => {
    const staffHeads = await inject({
      method: 'GET',
      url: '/helpdesk/heads/staff',
      headers: h(teacher),
    });
    expect(staffHeads.json().data.map((x: { code: string }) => x.code)).toContain('it');
    const sq = await inject({
      method: 'POST',
      url: '/helpdesk/tickets',
      headers: h(teacher),
      json: {
        desk: 'staff',
        categoryCode: 'it',
        subject: 'Projector not working',
        body: 'Room 12 projector shows no signal.',
        fileIds: [await fileOf(teacher, 'photo.pdf')],
      },
    });
    expect(sq.statusCode).toBe(201);
    expect(sq.json()).toMatchObject({ desk: 'staff', assignedRole: 'school_admin' });
    expect(sq.json().number).toMatch(/^S\//);
    // the accountant is not involved
    expect(
      (
        await inject({
          method: 'GET',
          url: `/helpdesk/tickets/${sq.json().id}`,
          headers: h(accountant),
        })
      ).statusCode,
    ).toBe(404);
    const done = await inject({
      method: 'POST',
      url: `/helpdesk/tickets/${sq.json().id}/close`,
      headers: h(),
      json: { resolution: 'Cable replaced.' },
    });
    expect(done.json().status).toBe('closed');
    // the raiser cannot close someone else's handling, but can reopen
    const st = (
      await inject({ method: 'GET', url: `/helpdesk/tickets/${sq.json().id}`, headers: h(teacher) })
    ).json();
    expect(st.you).toMatchObject({ raiser: true, canClose: false, canReopen: true });

    const cfg = (await inject({ method: 'GET', url: '/helpdesk/setup', headers: h() })).json()
      .settings;
    const put = await inject({
      method: 'PUT',
      url: '/helpdesk/setup/settings',
      headers: h(),
      json: {
        ...cfg,
        providerName: 'Mobilise',
        providerEmail: 'support@provider.example',
        providerSeniorName: 'Head of support',
        providerSeniorEmail: 'senior@provider.example',
      },
    });
    expect(put.statusCode).toBe(200);
    const pt = await inject({
      method: 'POST',
      url: '/helpdesk/tickets',
      headers: h(teacher),
      json: {
        desk: 'provider',
        categoryCode: 'bug',
        subject: 'Marks entry freezes',
        body: 'Saving marks for VI-A spins forever.',
        priority: 'urgent',
        module: 'exams',
      },
    });
    expect(pt.statusCode).toBe(201);
    expect(pt.json()).toMatchObject({
      desk: 'provider',
      assignedRole: 'erp_support',
      priority: 'urgent',
    });
    const pid = pt.json().id as string;
    // the provider sees every provider ticket and answers as the provider
    const pl = await inject({
      method: 'GET',
      url: '/helpdesk/tickets?desk=provider',
      headers: h(support),
    });
    expect(pl.json().data.some((x: { id: string }) => x.id === pid)).toBe(true);
    expect(
      (await inject({ method: 'GET', url: `/helpdesk/tickets/${ids.q}`, headers: h(support) }))
        .statusCode,
    ).toBe(404);
    const pr = await inject({
      method: 'POST',
      url: `/helpdesk/tickets/${pid}/replies`,
      headers: h(support),
      json: { body: 'Looking into it; please share a screenshot.' },
    });
    expect(pr.json().replies.at(-1)).toMatchObject({ authorKind: 'provider' });
    expect(pr.json().providerStatus).toBe('triaged');
    const tr = await inject({
      method: 'POST',
      url: `/helpdesk/tickets/${pid}/replies`,
      headers: h(teacher),
      json: { body: 'Screenshot attached.', fileIds: [await fileOf(teacher, 'shot.pdf')] },
    });
    expect(tr.json().status).toBe('open');
    await pastDue(pid);
    await inject({ method: 'POST', url: '/helpdesk/escalate-now', headers: h() });
    const late = (
      await inject({ method: 'GET', url: `/helpdesk/tickets/${pid}`, headers: h() })
    ).json();
    expect(late.level).toBe(2);
    expect(late.events.find((e: { kind: string }) => e.kind === 'escalated').emails).toEqual(
      expect.arrayContaining(['senior@provider.example', 'support@provider.example']),
    );
  });

  it('the dashboard shows six months per desk and each count downloads its tickets; hypercare issues land on the provider desk', async () => {
    const d = await inject({ method: 'GET', url: '/helpdesk/dashboard', headers: h() });
    expect(d.statusCode).toBe(200);
    const months = d.json().months as Array<{
      month: string;
      desk: string;
      raised: number;
      escalated: number;
    }>;
    expect(new Set(months.map((m) => m.month)).size).toBe(6);
    expect(months).toHaveLength(18);
    const thisMonth = months.at(-1)!.month;
    const parentNow = months.find((m) => m.month === thisMonth && m.desk === 'parent')!;
    expect(parentNow.raised).toBeGreaterThanOrEqual(2);
    expect(parentNow.escalated).toBeGreaterThanOrEqual(1);
    const x = await inject({
      method: 'GET',
      url: `/helpdesk/report.xlsx?month=${thisMonth}&desk=parent&bucket=raised`,
      headers: h(),
    });
    expect(x.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.rawPayload as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(2).getCell(5).value).toBe('Student');
    expect(ws.rowCount).toBe(2 + parentNow.raised);
    // a parent's dashboard counts only their own child's queries
    const pd = await inject({ method: 'GET', url: '/helpdesk/dashboard', headers: h(parent) });
    expect(
      pd
        .json()
        .months.filter(
          (m: { desk: string; raised: number }) => m.desk !== 'parent' && m.raised > 0,
        ),
    ).toHaveLength(0);

    const hc = await inject({
      method: 'POST',
      url: '/ops/hypercare/issues',
      headers: h(),
      json: { title: 'Receipt PDF blank', module: 'fees', severity: 's2', channel: 'admin' },
    });
    expect(hc.statusCode).toBe(201);
    expect(hc.json().number).toMatch(/^HC\//);
    const prov = await inject({
      method: 'GET',
      url: '/helpdesk/tickets?desk=provider&q=Receipt',
      headers: h(),
    });
    expect(prov.json().data[0]).toMatchObject({
      desk: 'provider',
      priority: 'high',
      module: 'fees',
    });
  });
});
