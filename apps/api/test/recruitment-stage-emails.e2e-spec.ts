/**
 * Recruitment, part 9 (0204, docs/design/34-recruitment.md): which stages tell the candidate by email (a
 * switch for the schedule and one for the result, per stage; "cleared" is a new email with the next
 * stage), and the candidates as an Excel workbook (the list's filters or the ticked ones; a sheet per
 * list; Aadhaar and PAN masked without the sensitive right; in the audit log).
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

describe('recruitment: stage emails and the Excel export (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let hod: SeededUser;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const R = '/people/recruitment';
  let vacancyId = '';
  const stage: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const ist = (ms: number) => new Date(Date.now() + 330 * 60_000 + ms).toISOString().slice(0, 16);
  /** The recruitment emails queued so far, oldest first. */
  const mails = async () =>
    (
      await withMigrator((c) =>
        c.query<{ code: string; to: string }>(
          `SELECT t.code, m.recipient_address AS to FROM comms_messages m JOIN comms_templates t ON t.id = m.template_id
            WHERE m.school_id = $1 AND t.code LIKE 'recruitment_%' AND m.channel = 'email' ORDER BY m.id`,
          [school.id],
        ),
      )
    ).rows.map((x) => `${x.code} ${x.to}`);

  beforeAll(async () => {
    const s = stamp('RSE');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      hod = await seedUser(c, school, `${s}-hod`, 'academic_coordinator');
    });
    app = await createApp();
    inject = injector(app);
    const setup = (await call(admin, 'GET', `${R}/setup`)).json();
    for (const st of setup.stages as Array<{ id: string; name: string }>) stage[st.name] = st.id;
  });
  afterAll(async () => app.close());

  it('each stage has two email switches, on to start with; the school admin sets them', async () => {
    const setup = (await call(admin, 'GET', `${R}/setup`)).json();
    const st = setup.stages as Array<{
      id: string;
      name: string;
      kind: string;
      maxMarks: number | null;
      active: boolean;
      emailScheduled: boolean;
      emailResult: boolean;
    }>;
    expect(st.every((x) => x.emailScheduled && x.emailResult)).toBe(true);
    // shortlisting tells no result; the interview's date goes by SMS only
    const body = {
      stages: st
        .filter((x) => x.active)
        .map((x) => ({
          id: x.id,
          name: x.name,
          kind: x.kind,
          maxMarks: x.maxMarks,
          emailScheduled: x.name !== 'Interview',
          emailResult: x.name !== 'Shortlisting',
        })),
    };
    expect((await call(hod, 'PUT', `${R}/setup/stages`, body)).statusCode).toBe(403);
    expect((await call(admin, 'PUT', `${R}/setup/stages`, body)).statusCode).toBe(200);
    const after = (await call(admin, 'GET', `${R}/setup`)).json().stages as typeof st;
    expect(after.find((x) => x.name === 'Interview')).toMatchObject({
      emailScheduled: false,
      emailResult: true,
    });
    expect(after.find((x) => x.name === 'Shortlisting')).toMatchObject({
      emailScheduled: true,
      emailResult: false,
    });
  });

  it('the candidate is told by email only at the stages that tell', async () => {
    vacancyId = (
      await call(admin, 'POST', `${R}/vacancies`, {
        title: 'PGT Chemistry',
        posts: 1,
        stageIds: [stage.Shortlisting, stage.Interview, stage['Final round']],
      })
    ).json().id as string;
    await call(admin, 'POST', `${R}/vacancies/${vacancyId}/submit`);
    await call(admin, 'POST', `${R}/vacancies/${vacancyId}/publish`, {
      opensAt: ist(0),
      closesAt: ist(300 * 86_400_000),
    });
    // rejection notices on, so the switches are what decide
    const n = (await call(admin, 'GET', `${R}/setup/notices`)).json();
    await call(admin, 'PUT', `${R}/setup/notices`, { ...n, rejected: true });
    for (const [k, first, mobile] of [
      ['A', 'Anu', '9800000001'],
      ['B', 'Bela', '9800000002'],
      ['C', 'Charu', '9800000003'],
    ] as const) {
      const r = await call(admin, 'POST', `${R}/applications`, {
        vacancyId,
        firstName: first,
        gender: 'Female',
        dob: '1991-02-03',
        mobile,
        email: `${first.toLowerCase()}@example.invalid`,
      });
      expect(r.statusCode).toBe(201);
      ids[k] = r.json().id as string;
    }
    const at = (id: string, st: string, json: unknown) =>
      call(admin, 'POST', `${R}/applications/${id}/stages/${st}`, json);
    const before = (await mails()).length;
    // A clears shortlisting (no email: its result is not told), the interview is fixed (no email: its
    // schedule is not told), A clears the interview (an email: cleared, the final round next)
    expect((await at(ids.A!, stage.Shortlisting!, { result: 'pass' })).statusCode).toBe(200);
    expect(
      (await at(ids.A!, stage.Interview!, { scheduledAt: ist(2 * 86_400_000), venue: 'Room 4' }))
        .statusCode,
    ).toBe(200);
    expect((await at(ids.A!, stage.Interview!, { result: 'pass' })).statusCode).toBe(200);
    // B not through shortlisting: not told; C cleared, then not taken forward at the interview: told
    expect((await at(ids.B!, stage.Shortlisting!, { result: 'fail' })).statusCode).toBe(200);
    expect((await at(ids.C!, stage.Shortlisting!, { result: 'pass' })).statusCode).toBe(200);
    expect(
      (await call(admin, 'POST', `${R}/applications/${ids.C}/reject`, { note: 'Late' })).statusCode,
    ).toBe(200);
    expect((await mails()).slice(before)).toEqual([
      'recruitment_passed anu@example.invalid',
      'recruitment_not_selected charu@example.invalid',
    ]);
    // the cleared email names the stage and the next one
    const body = await withMigrator((c) =>
      c.query<{ subject: string; body: string }>(
        `SELECT m.subject, m.body FROM comms_messages m JOIN comms_templates t ON t.id = m.template_id
          WHERE m.school_id = $1 AND t.code = 'recruitment_passed' ORDER BY m.id DESC LIMIT 1`,
        [school.id],
      ),
    );
    expect(body.rows[0]!.subject).toContain('Interview');
    expect(body.rows[0]!.body).toContain('Final round');
  });

  it('the candidates come out as an Excel workbook: as filtered, or the ticked ones', async () => {
    const out = async (u: SeededUser, json: unknown) => {
      const r = await call(u, 'POST', `${R}/applications/export`, json);
      expect(r.statusCode).toBe(200);
      const j = r.json();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(j.base64, 'base64') as unknown as ArrayBuffer);
      return { j, wb };
    };
    const { j, wb } = await out(hod, { vacancy: vacancyId });
    expect(j.filename).toMatch(/^Candidates-VAC-\d{4}-\d{3}-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(j.rows).toBe(3);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Candidates',
      'Qualifications',
      'Experience',
      'Training and workshops',
      'Children',
      'References',
      'About this export',
    ]);
    const ws = wb.getWorksheet('Candidates')!;
    const head = (ws.getRow(1).values as Array<string | undefined>).slice(1);
    for (const col of [
      'Application no.',
      'Name',
      'Status',
      'Interview: result',
      'Interview: marks',
      'First name',
      'Email',
      'Aadhaar number',
      'Documents given',
    ])
      expect(head).toContain(col);
    expect(ws.rowCount).toBe(4);
    const rowOf = (name: string) => {
      for (let i = 2; i <= ws.rowCount; i += 1)
        if (ws.getRow(i).getCell(head.indexOf('Name') + 1).value === name) return ws.getRow(i);
      throw new Error(`no row for ${name}`);
    };
    const anu = rowOf('ANU');
    expect(anu.getCell(head.indexOf('Shortlisting: result') + 1).value).toBe('Passed');
    expect(anu.getCell(head.indexOf('Interview: result') + 1).value).toBe('Passed');
    expect(anu.getCell(head.indexOf('Current stage') + 1).value).toBe('Final round');
    expect(anu.getCell(head.indexOf('Interview: date') + 1).value).toBeInstanceOf(Date);
    expect(rowOf('BELA').getCell(head.indexOf('Status') + 1).value).toBe('Not taken forward');
    const about = wb.getWorksheet('About this export')!;
    const facts = Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((i) => [
        about.getCell(`A${String(i)}`).value,
        about.getCell(`B${String(i)}`).value,
      ]),
    );
    expect(facts).toMatchObject({ Rows: 3, 'Aadhaar and PAN': 'Masked' });
    expect(String(facts.Candidates)).toContain('PGT Chemistry');
    // the ticked ones only; a status filter
    expect((await out(hod, { ids: [ids.A, ids.C] })).j.rows).toBe(2);
    expect((await out(hod, { vacancy: vacancyId, status: 'rejected' })).j.rows).toBe(2);
    expect((await call(hod, 'POST', `${R}/applications/export`, { ids: ['x'] })).statusCode).toBe(
      400,
    );
    const audit = await withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_logs WHERE school_id = $1 AND action = 'people.recruitment.export'`,
        [school.id],
      ),
    );
    expect(audit.rows[0]!.n).toBe(3);
  });
});
