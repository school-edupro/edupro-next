/**
 * Recruitment, part 1 (0197, docs/design/34-recruitment.md): the school's screening stages, vacancies raised
 * by the office or an HOD, approved through the school's levels, published for a period, closed, cancelled.
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

describe('recruitment: vacancies and their approval (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let hod: SeededUser;
  let teacher: SeededUser;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  /** A date-and-time box's value (India time), `ms` from now. */
  const ist = (ms: number) => new Date(Date.now() + 330 * 60_000 + ms).toISOString().slice(0, 16);
  const DAY = 86_400_000;

  beforeAll(async () => {
    const s = stamp('REC');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      hod = await seedUser(c, school, `${s}-hod`, 'academic_coordinator');
      teacher = await seedUser(c, school, `${s}-teach`, 'subject_teacher');
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => app.close());

  let stageIds: string[] = [];

  it('a school starts with five stages; only recruitment people see them; the stage list is saved at once', async () => {
    const s = (await call(admin, 'GET', '/people/recruitment/setup')).json();
    expect(s.stages.map((x: { name: string; kind: string }) => [x.name, x.kind])).toEqual([
      ['Shortlisting', 'shortlist'],
      ['Written test', 'test'],
      ['Demo class', 'test'],
      ['Interview', 'interview'],
      ['Final round', 'final'],
    ]);
    expect(s.can).toEqual({ raise: true, manage: true });
    expect((await call(teacher, 'GET', '/people/recruitment/setup')).statusCode).toBe(403);
    const hodView = (await call(hod, 'GET', '/people/recruitment/setup')).json();
    expect(hodView.can).toEqual({ raise: true, manage: false });
    const st = s.stages as Array<{
      id: string;
      name: string;
      kind: string;
      maxMarks: number | null;
    }>;
    expect(
      (await call(hod, 'PUT', '/people/recruitment/setup/stages', { stages: st })).statusCode,
    ).toBe(403);
    // the demo class renamed, the written test dropped (switched off), a medical check added
    const body = {
      stages: [
        { id: st[0]!.id, name: 'Shortlisting', kind: 'shortlist' },
        { id: st[2]!.id, name: 'Demo lesson', kind: 'test', maxMarks: 25 },
        { id: st[3]!.id, name: 'Interview', kind: 'interview', maxMarks: 30 },
        { name: 'Medical check', kind: 'shortlist' },
        { id: st[4]!.id, name: 'Final round', kind: 'final' },
      ],
    };
    expect((await call(admin, 'PUT', '/people/recruitment/setup/stages', body)).statusCode).toBe(
      200,
    );
    const s2 = (await call(admin, 'GET', '/people/recruitment/setup')).json();
    const active = (s2.stages as Array<{ id: string; name: string; active: boolean }>).filter(
      (x) => x.active,
    );
    expect(active.map((x) => x.name)).toEqual([
      'Shortlisting',
      'Demo lesson',
      'Interview',
      'Medical check',
      'Final round',
    ]);
    expect(s2.stages.find((x: { name: string }) => x.name === 'Written test')).toMatchObject({
      active: false,
    });
    const twice = await call(admin, 'PUT', '/people/recruitment/setup/stages', {
      stages: [
        { name: 'Interview', kind: 'interview' },
        { name: 'interview', kind: 'interview' },
      ],
    });
    expect(twice.statusCode).toBe(400);
    stageIds = active.filter((x) => x.name !== 'Medical check').map((x) => x.id);
  });

  let vacancyId = '';

  it('an HOD raises a vacancy; it needs its stages; sent for approval it waits with the Principal; approved, the office publishes and closes it', async () => {
    const bad = await call(hod, 'POST', '/people/recruitment/vacancies', {
      title: 'PGT Physics',
      stageIds: ['999999999'],
    });
    expect(bad.statusCode).toBe(400);
    const empty = await call(hod, 'POST', '/people/recruitment/vacancies', {
      title: 'PGT Physics',
    });
    expect(empty.statusCode).toBe(201);
    const noStages = await call(
      hod,
      'POST',
      `/people/recruitment/vacancies/${empty.json().id as string}/submit`,
    );
    expect(noStages.statusCode).toBe(400);
    const r = await call(hod, 'POST', '/people/recruitment/vacancies', {
      title: 'PGT Physics',
      department: 'Science',
      subject: 'Physics',
      employeeType: 'Teaching Regular',
      posts: 2,
      qualification: 'M.Sc. Physics, B.Ed.',
      experience: 'Three years teaching XI–XII',
      payBand: 'Level 8',
      description: 'Teach physics to classes XI and XII; run the lab.',
      stageIds,
    });
    expect(r.statusCode).toBe(201);
    vacancyId = r.json().id as string;
    const v0 = (await call(hod, 'GET', `/people/recruitment/vacancies/${vacancyId}`)).json();
    expect(v0).toMatchObject({
      status: 'draft',
      posts: 2,
      stages: ['Shortlisting', 'Demo lesson', 'Interview', 'Final round'],
    });
    expect(v0.code).toMatch(/^VAC-\d{4}-\d{3}$/);
    expect(v0.can).toMatchObject({ edit: true, submit: true, publish: false });
    // an HOD may not publish; the vacancy goes for approval
    expect(
      (
        await call(hod, 'POST', `/people/recruitment/vacancies/${vacancyId}/publish`, {
          opensAt: ist(DAY),
          closesAt: ist(30 * DAY),
        })
      ).statusCode,
    ).toBe(403);
    const sent = await call(hod, 'POST', `/people/recruitment/vacancies/${vacancyId}/submit`);
    expect(sent.statusCode).toBe(200);
    const v1 = (await call(admin, 'GET', `/people/recruitment/vacancies/${vacancyId}`)).json();
    expect(v1.status).toBe('pending');
    expect(v1.waitingWith).toMatch(/Principal approval/);
    expect(v1.can.edit).toBe(false);
    expect(
      (
        await call(hod, 'PUT', `/people/recruitment/vacancies/${vacancyId}`, {
          title: 'X post',
          stageIds,
        })
      ).statusCode,
    ).toBe(409);
    // the Principal approves from the approvals inbox
    const inbox = (await call(admin, 'GET', '/workflow/inbox')).json().data as Array<{
      id: string;
      instance: { entityType: string; entityId: string };
    }>;
    const step = inbox.find(
      (x) => x.instance.entityType === 'vacancy' && x.instance.entityId === vacancyId,
    )!;
    expect(step).toBeTruthy();
    expect(
      (await call(admin, 'POST', `/workflow/steps/${step.id}/approve`, { note: 'Go ahead' }))
        .statusCode,
    ).toBe(201);
    const v2 = (await call(admin, 'GET', `/people/recruitment/vacancies/${vacancyId}`)).json();
    expect(v2.status).toBe('approved');
    expect(v2.can.publish).toBe(true);
    // published for a period; the closing date is on or after the opening date
    expect(
      (
        await call(admin, 'POST', `/people/recruitment/vacancies/${vacancyId}/publish`, {
          opensAt: ist(30 * DAY),
          closesAt: ist(DAY),
        })
      ).statusCode,
    ).toBe(400);
    const pub = await call(admin, 'POST', `/people/recruitment/vacancies/${vacancyId}/publish`, {
      opensAt: ist(0),
      closesAt: ist(30 * DAY),
    });
    expect(pub.statusCode).toBe(200);
    const list = (await call(hod, 'GET', '/people/recruitment/vacancies')).json();
    expect(list.counts).toMatchObject({ published: 1, draft: 1 });
    expect(
      (await call(hod, 'GET', '/people/recruitment/vacancies?status=published'))
        .json()
        .data.map((x: { id: string }) => x.id),
    ).toEqual([vacancyId]);
    const closed = await call(admin, 'POST', `/people/recruitment/vacancies/${vacancyId}/close`, {
      note: 'Enough applications',
    });
    expect(closed.statusCode).toBe(200);
    const v3 = (await call(admin, 'GET', `/people/recruitment/vacancies/${vacancyId}`)).json();
    expect(v3.events.map((e: { what: string }) => e.what)).toEqual([
      'raised',
      'submitted',
      'approved',
      'published',
      'closed',
    ]);
  });

  it('sent back by the approver it is editable again with the note; a vacancy waiting for approval can be cancelled', async () => {
    const r = await call(hod, 'POST', '/people/recruitment/vacancies', {
      title: 'Accountant',
      department: 'Accounts',
      employeeType: 'Non-Teaching Regular',
      stageIds: [stageIds[0]!, stageIds[2]!, stageIds[3]!],
    });
    const id = r.json().id as string;
    await call(hod, 'POST', `/people/recruitment/vacancies/${id}/submit`);
    const inbox = (await call(admin, 'GET', '/workflow/inbox')).json().data as Array<{
      id: string;
      instance: { entityType: string; entityId: string };
    }>;
    const step = inbox.find(
      (x) => x.instance.entityType === 'vacancy' && x.instance.entityId === id,
    )!;
    expect(
      (await call(admin, 'POST', `/workflow/steps/${step.id}/reject`, { note: 'Say the pay band' }))
        .statusCode,
    ).toBe(201);
    const v = (await call(admin, 'GET', `/people/recruitment/vacancies/${id}`)).json();
    expect(v).toMatchObject({ status: 'rejected', decisionNote: 'Say the pay band' });
    expect(v.can.edit).toBe(true);
    const fixed = await call(hod, 'PUT', `/people/recruitment/vacancies/${id}`, {
      title: 'Accountant',
      department: 'Accounts',
      employeeType: 'Non-Teaching Regular',
      payBand: 'Level 5',
      stageIds: [stageIds[0]!, stageIds[2]!, stageIds[3]!],
    });
    expect(fixed.statusCode).toBe(200);
    expect((await call(hod, 'POST', `/people/recruitment/vacancies/${id}/submit`)).statusCode).toBe(
      200,
    );
    // cancelled while waiting: the approval is withdrawn from the inbox
    expect(
      (
        await call(admin, 'POST', `/people/recruitment/vacancies/${id}/cancel`, {
          note: 'Post frozen',
        })
      ).statusCode,
    ).toBe(200);
    const after = (await call(admin, 'GET', '/workflow/inbox')).json().data as Array<{
      instance: { entityType: string; entityId: string };
    }>;
    expect(
      after.some((x) => x.instance.entityType === 'vacancy' && x.instance.entityId === id),
    ).toBe(false);
    expect((await call(admin, 'GET', `/people/recruitment/vacancies/${id}`)).json().status).toBe(
      'cancelled',
    );
  });
});
