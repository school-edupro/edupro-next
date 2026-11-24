/**
 * Queries in Approvals (docs/design/24): a query with a person — handed to them, or to a role of theirs — is in their
 * Approvals inbox (admin header, staff website, staff app) as "Queries to answer" until it is closed, with its page in
 * the admin app and the staff app; the person who raised it does not see it there. Handing over (or taking over) an
 * answered query makes it in progress again: it waits on the new person.
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

interface Inbox {
  total: number;
  kinds: Array<{ kind: string; label: string; count: number }>;
  items: Array<{
    kind: string;
    id: string;
    title: string;
    adminHref: string | null;
    staffUrl: string | null;
    decideHere: boolean;
  }>;
}

describe('queries in Approvals (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let raiser: SeededUser;
  let helper: SeededUser;
  let ticket: string;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const inbox = async (u: SeededUser) => {
    const r = await inject({ method: 'GET', url: '/approvals/inbox', headers: h(u) });
    expect(r.statusCode).toBe(200);
    return r.json() as Inbox;
  };
  const queries = (b: Inbox) => b.items.filter((i) => i.kind === 'query');
  const status = async () =>
    (
      (
        await inject({ method: 'GET', url: `/helpdesk/tickets/${ticket}`, headers: h(admin) })
      ).json() as {
        status: string;
      }
    ).status;

  beforeAll(async () => {
    const s = stamp('QA');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      raiser = await seedUser(c, school, `${s}-raiser`, 'class_teacher');
      helper = await seedUser(c, school, `${s}-helper`, 'class_teacher');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, mobile, email, department, designation, user_id)
         VALUES ($1, 'Q01', 'Ria', 'Sample', '9811100011', 'ria@example.com', 'Academics', 'TGT', $2),
                ($1, 'Q02', 'Dev', 'Sample', '9811100012', 'dev@example.com', 'Academics', 'TGT', $3)`,
        [school.id, raiser.id, helper.id],
      );
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a staff query is in the Approvals of the role it went to, not of the person who raised it', async () => {
    const r = await inject({
      method: 'POST',
      url: '/helpdesk/tickets',
      headers: h(raiser),
      json: {
        desk: 'staff',
        categoryCode: 'it',
        subject: 'Laptop broken',
        body: 'It does not start.',
      },
    });
    expect(r.statusCode).toBe(201);
    ticket = (r.json() as { id: string }).id;
    const mine = queries(await inbox(admin));
    expect(mine.map((i) => i.id)).toContain(ticket);
    const it = mine.find((i) => i.id === ticket)!;
    expect(it.title).toContain('Laptop broken');
    expect(it.decideHere).toBe(false);
    expect(it.adminHref).toBe(`/engagement/helpdesk/staff/${ticket}`);
    expect(it.staffUrl).toMatch(new RegExp(`/queries/t/${ticket}$`));
    expect((await inbox(admin)).kinds).toContainEqual(
      expect.objectContaining({ kind: 'query', label: 'Queries to answer' }),
    );
    expect(queries(await inbox(raiser)).map((i) => i.id)).not.toContain(ticket);
    expect(queries(await inbox(helper)).map((i) => i.id)).not.toContain(ticket);
  });

  it('answered, then handed over: in progress again, and in the new person’s Approvals', async () => {
    const reply = await inject({
      method: 'POST',
      url: `/helpdesk/tickets/${ticket}/replies`,
      headers: h(admin),
      json: { body: 'We are looking at it.' },
    });
    expect(reply.statusCode).toBe(201);
    expect(await status()).toBe('answered');
    const hand = await inject({
      method: 'POST',
      url: `/helpdesk/tickets/${ticket}/assign`,
      headers: h(admin),
      json: { userId: helper.id, note: 'Please check the laptop.' },
    });
    expect(hand.statusCode).toBe(200);
    expect(await status()).toBe('in_progress');
    expect(queries(await inbox(helper)).map((i) => i.id)).toContain(ticket);
    // now with the helper, not the admin's role
    expect(queries(await inbox(admin)).map((i) => i.id)).not.toContain(ticket);
    // the counts the headers read
    const counts = await inject({
      method: 'GET',
      url: '/approvals/inbox?view=counts',
      headers: h(helper),
    });
    expect((counts.json() as Inbox).kinds).toContainEqual(
      expect.objectContaining({ kind: 'query', count: 1 }),
    );
  });

  it('answered by the new person it stays with them until closed; closed, it leaves Approvals', async () => {
    await inject({
      method: 'POST',
      url: `/helpdesk/tickets/${ticket}/replies`,
      headers: h(helper),
      json: { body: 'Replaced the charger.' },
    });
    expect(await status()).toBe('answered');
    expect(queries(await inbox(helper)).map((i) => i.id)).toContain(ticket);
    const close = await inject({
      method: 'POST',
      url: `/helpdesk/tickets/${ticket}/close`,
      headers: h(helper),
      json: { resolution: 'Working again.' },
    });
    expect(close.statusCode).toBe(200);
    expect(queries(await inbox(helper)).map((i) => i.id)).not.toContain(ticket);
  });
});
