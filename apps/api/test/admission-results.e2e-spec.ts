/**
 * Test results by part (0266, docs/design/57, part 2): the grid of a session, class and Test stage with
 * marks per part of the class's paper, total, % and below cut-off; saved on the screen or by the class's
 * sheet (.xlsx or .csv) with Select / Hold decided at the level the candidate waits at; a decided
 * candidate's marks change only with a reason (the decision's marks and merit follow); a decision made
 * elsewhere carries the uploaded total; exported as Excel and PDF.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { PowService } from '../src/modules/admissions/public/pow.service';
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

describe('admission test results by part (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  const s = stamp('ARS');
  const ids: Record<string, string> = {};
  const nos = [`${s}/1`, `${s}/2`, `${s}/3`];
  const apps: string[] = [];
  const parts: Record<string, string> = {};
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown, u?: SeededUser) =>
    inject({
      method,
      url,
      headers: headersFor((u ?? admin).sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const place = () => ({ cycleId: ids.cycle!, classId: ids.cls!, stageId: ids.test! });
  const qs = (x: Record<string, string> = {}) =>
    new URLSearchParams({ ...place(), ...x }).toString();
  const grid = async (x: Record<string, string> = {}) =>
    (await call('GET', `/admissions/results?${qs(x)}`)).json();
  const rowOf = async (id: string) =>
    (await grid()).rows.find((r: { id: string }) => r.id === id) as Record<string, unknown>;
  const upload = (bytes: Buffer, apply: boolean, contentType: string) =>
    inject({
      method: 'POST',
      url: `/admissions/results/sheet${apply ? '?apply=1' : ''}`,
      headers: headersFor(admin.sub, school.id),
      raw: { body: bytes, contentType },
    });
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const app0 = async (id: string) =>
    withMigrator(async (c) => {
      const a = await c.query<{ merit: string | null; status: string; stage_no: number }>(
        `SELECT merit::text, status::text, stage_no FROM applications WHERE id = $1`,
        [id],
      );
      const r = await c.query<{
        decision: string;
        marks: string | null;
        attendance: string | null;
      }>(
        `SELECT decision, marks::text, attendance FROM admission_stage_results
          WHERE application_id = $1 AND stage_id = $2 AND undone_at IS NULL ORDER BY decided_at DESC, id DESC`,
        [id, ids.test],
      );
      return { ...a.rows[0]!, results: r.rows };
    });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
    });
    app = await createApp();
    inject = injector(app);
    ids.cls = (
      await call('POST', '/academics/classes', { code: 'IX', name: 'Class IX', displayOrder: 9 })
    ).json().id as string;
    const setup = (await call('GET', '/admissions/process-setup')).json();
    for (const st of setup.stages as Array<{ id: string; kind: string }>) ids[st.kind] = st.id;
    const proc = await call('POST', '/admissions/processes', {
      name: 'Class IX process',
      steps: [
        { stageId: ids.test, levels: [{ name: 'Test cell', by: 'anyone' }] },
        { stageId: ids.interview, levels: [{ name: 'Panel', by: 'anyone' }] },
        { stageId: ids.selection, levels: [{ name: 'Committee', by: 'anyone' }] },
      ],
      classIds: [ids.cls],
    });
    expect(proc.statusCode).toBe(201);
    await withMigrator(async (c) => {
      const def = JSON.stringify({ fields: [] });
      ids.form = (
        await c.query<{ id: string }>(
          `INSERT INTO admission_forms (school_id, name, def) VALUES ($1, 'Mini form', $2::jsonb) RETURNING id::text`,
          [school.id, def],
        )
      ).rows[0]!.id;
      ids.cycle = (
        await c.query<{ id: string }>(
          `INSERT INTO admission_cycles (school_id, academic_year_id, code, name, opens_at, closes_at)
           VALUES ($1, $2, 'ADM27', 'Admissions 2027-28', now() - interval '10 days', now() + interval '20 days') RETURNING id::text`,
          [school.id, school.yearId],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO admission_class_criteria (school_id, cycle_id, class_id, seats, form_id) VALUES ($1, $2, $3, 10, $4)`,
        [school.id, ids.cycle, ids.cls, ids.form],
      );
      for (const [i, name] of ['ASHA', 'BALU', 'CHITRA'].entries()) {
        const ap = await c.query<{ id: string }>(
          `INSERT INTO applicants (school_id) VALUES ($1) RETURNING id::text`,
          [school.id],
        );
        const a = await c.query<{ id: string }>(
          `INSERT INTO applications (school_id, cycle_id, class_id, applicant_id, child_first_name, candidate_name, application_no,
                                     status, form_id, form_snapshot, data, submitted_at)
           VALUES ($1, $2, $3, $4, $5, $5, $6, 'registered', $7, $8::jsonb, '{}'::jsonb, now()) RETURNING id::text`,
          [school.id, ids.cycle, ids.cls, ap.rows[0]!.id, name, nos[i], ids.form, def],
        );
        apps.push(a.rows[0]!.id);
      }
    });
    // opening a registration starts its class's process
    for (const id of apps)
      expect((await call('GET', `/admissions/registrations/${id}`)).statusCode).toBe(200);
  });
  afterAll(async () => app.close());

  it('needs a paper for the class; lists the sessions, classes and stages', async () => {
    const o = (await call('GET', '/admissions/results/options')).json();
    // each session and class with the candidates who reached a test or interview (docs/design/58)
    expect(o.cycles).toEqual([
      expect.objectContaining({
        id: ids.cycle,
        candidates: 3,
        classes: [{ id: ids.cls, name: 'Class IX', candidates: 3 }],
      }),
    ]);
    expect(o.stages.map((x: { kind: string }) => x.kind)).toEqual(['test', 'interview']);
    const none = await grid();
    expect(none.place.paper).toBeNull();
    expect(none.rows).toEqual([]);
    const sheet = await call('GET', `/admissions/results/sheet?${qs()}`);
    expect(sheet.statusCode).toBe(409);
    expect(sheet.json().type).toBe('admissions.no_paper');
    // the paper's subjects come from the school's list (docs/design/57, follow-up)
    const list = (await call('GET', '/admissions/paper-items')).json().items as Array<{
      id: string;
      name: string;
      kind: string;
    }>;
    expect(
      (
        await call('PUT', '/admissions/paper-items', {
          items: [
            ...list.map(({ id, name, kind }) => ({ id, name, kind })),
            { name: 'English', kind: 'test' },
            { name: 'Maths', kind: 'test' },
          ],
        })
      ).statusCode,
    ).toBe(200);
    const paper = await call('PUT', `/admissions/stages/${ids.test!}/papers/${ids.cls!}`, {
      minPercent: 40,
      parts: [
        { name: 'English', maxMarks: 50, passMarks: 20 },
        { name: 'Maths', maxMarks: 50 },
      ],
    });
    for (const p of paper.json().paper.parts as Array<{ id: string; name: string }>)
      parts[p.name] = p.id;
    const g = await grid();
    expect(g.counts).toEqual({ all: 3, waiting: 3, marked: 0, below: 0 });
    expect(g.rows.map((r: { number: string }) => r.number)).toEqual(nos);
    expect(g.rows[0]).toMatchObject({ state: 'waiting', level: 'Test cell', total: null });
    // the Excel decisions sheet leaves out its marks column for a class with a paper
    const dec = await call(
      'GET',
      `/admissions/approvals/sheet?${new URLSearchParams({ ...place(), level: '1' }).toString()}`,
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(dec.json().base64, 'base64') as unknown as ArrayBuffer);
    const head = (wb.worksheets[0]!.getRow(5).values as unknown[]).map(String);
    expect(head.some((x) => x.startsWith('Marks'))).toBe(false);
  });

  it('saves marks on the screen: total, %, below cut-off; refuses marks over the maximum', async () => {
    const r = await call('PUT', '/admissions/results', {
      ...place(),
      rows: [
        { applicationId: apps[0], marks: { [parts.English!]: 40, [parts.Maths!]: 45 } },
        {
          applicationId: apps[1],
          marks: { [parts.English!]: 10, [parts.Maths!]: 30 },
          remark: 'Weak in English',
        },
        { applicationId: apps[2], marks: { [parts.English!]: 60, [parts.Maths!]: 20 } },
      ],
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      saved: 2,
      errors: [{ applicationId: apps[2], error: 'English: marks from 0 to 50' }],
    });
    expect(await rowOf(apps[0]!)).toMatchObject({
      total: 85,
      percent: 85,
      below: false,
      marked: true,
    });
    expect(await rowOf(apps[1]!)).toMatchObject({
      total: 40,
      percent: 40,
      below: true,
      remark: 'Weak in English',
    });
    expect((await grid({ cutoff: 'below' })).rows.map((x: { id: string }) => x.id)).toEqual([
      apps[1],
    ]);
    expect((await grid({ band: '81-90' })).rows.map((x: { id: string }) => x.id)).toEqual([
      apps[0],
    ]);
    expect((await grid({ state: 'unmarked' })).rows.map((x: { id: string }) => x.id)).toEqual([
      apps[2],
    ]);
    // marking needs the tests and interviews right
    expect(
      (
        await call(
          'PUT',
          '/admissions/results',
          { ...place(), rows: [{ applicationId: apps[0], marks: {} }] },
          coordinator,
        )
      ).statusCode,
    ).toBe(403);
    // no decision yet: nothing recorded at the stage
    expect((await app0(apps[0]!)).results).toEqual([]);
  });

  it('the sheet: checked first, then Select / Hold decided with the marks; unknown numbers named', async () => {
    const dl = await call('GET', `/admissions/results/sheet?${qs()}`);
    expect(dl.statusCode).toBe(200);
    expect(dl.json().rows).toBe(3);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(dl.json().base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(String(ws.getCell('A3').value)).toBe(`EPMARK:${ids.cycle!}:${ids.cls!}:${ids.test!}`);
    const head = (ws.getRow(5).values as unknown[]).slice(1).map(String);
    expect(head).toEqual([
      'Registration no.',
      'Candidate',
      'Roll no.',
      'Category',
      'English (50)',
      'Maths (50)',
      'Absent (Y)',
      'Total (100)',
      '%',
      'Decision',
      'Remark',
      'Reason for change',
    ]);
    expect(ws.getRow(6).getCell(5).value).toBe(40);
    // ASHA: Select (marks kept); BALU: Maths 35 and Hold; CHITRA: absent, Hold; a number not in the class
    ws.getRow(6).getCell(10).value = 'Select';
    ws.getRow(7).getCell(6).value = 35;
    ws.getRow(7).getCell(10).value = 'Hold';
    ws.getRow(8).getCell(7).value = 'Y';
    ws.getRow(8).getCell(10).value = 'Hold';
    ws.getRow(9).values = ['NOPE/9', 'Nobody', '', '', 10, 10];
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    const check = await upload(bytes, false, XLSX);
    expect(check.statusCode).toBe(201);
    expect(check.json()).toMatchObject({ applied: false, ok: 3, errors: 1, notFound: ['NOPE/9'] });
    expect((await app0(apps[0]!)).results).toEqual([]);
    const done = await upload(bytes, true, XLSX);
    expect(done.json()).toMatchObject({ applied: true, done: 3, errors: 1 });
    const a = await app0(apps[0]!);
    expect(a).toMatchObject({ merit: '85.00', stage_no: 1 });
    expect(a.results[0]).toMatchObject({
      decision: 'approved',
      marks: '85.00',
      attendance: 'present',
    });
    const b = await app0(apps[1]!);
    expect(b.results[0]).toMatchObject({ decision: 'hold', marks: '45.00' });
    const ch = await app0(apps[2]!);
    expect(ch.results[0]).toMatchObject({ decision: 'hold', marks: null, attendance: 'absent' });
    expect(await rowOf(apps[0]!)).toMatchObject({ state: 'selected' });
    expect(await rowOf(apps[1]!)).toMatchObject({ state: 'held', total: 45, below: true });
    expect(await rowOf(apps[2]!)).toMatchObject({ state: 'held', absent: true, total: null });
    // decided candidates stay on a new sheet, to be changed again with a reason (docs/design/58)
    expect((await call('GET', `/admissions/results/sheet?${qs()}`)).json().rows).toBe(3);
  });

  it("a decided candidate's marks change only with a reason; the decision's marks and merit follow", async () => {
    const no = await call('PUT', '/admissions/results', {
      ...place(),
      rows: [{ applicationId: apps[0], marks: { [parts.Maths!]: 48 } }],
    });
    expect(no.json().errors[0].error).toBe(
      'Already selected: give the reason for changing the marks',
    );
    const yes = await call('PUT', '/admissions/results', {
      ...place(),
      rows: [
        {
          applicationId: apps[0],
          marks: { [parts.Maths!]: 48 },
          reason: 'Re-checked the Maths paper',
        },
      ],
    });
    expect(yes.json()).toEqual({ saved: 1, errors: [] });
    const a = await app0(apps[0]!);
    expect(a).toMatchObject({ merit: '88.00' });
    expect(a.results[0]).toMatchObject({ decision: 'approved', marks: '88.00' });
    const ev = await withMigrator((c) =>
      c.query<{ note: string }>(
        `SELECT note FROM application_events WHERE application_id = $1 ORDER BY id DESC LIMIT 1`,
        [apps[0]],
      ),
    );
    expect(ev.rows[0]!.note).toBe(
      'Written test: marks corrected to 88/100 · Re-checked the Maths paper',
    );
  });

  it('a decision made on the review carries the uploaded total; a CSV sheet is read too', async () => {
    const d = await call('POST', `/admissions/registrations/${apps[1]!}/decide`, {
      decision: 'approve',
      remarks: 'Passed on review',
    });
    expect(d.statusCode).toBe(201);
    const b = await app0(apps[1]!);
    expect(b).toMatchObject({ merit: '45.00', stage_no: 1 });
    expect(b.results[0]).toMatchObject({ decision: 'approved', marks: '45.00' });
    // CHITRA, absent before, sat a later paper: the same sheet saved as CSV
    const csv = [
      'Results sheet,,,,,,,,,,',
      'note,,,,,,,,,,',
      `EPMARK:${ids.cycle!}:${ids.cls!}:${ids.test!},,,,,,,,,,`,
      ',,,,,,,,,,',
      'Registration no.,Candidate,Roll no.,Category,English (50),Maths (50),Absent (Y),Total (100),%,Decision,Remark',
      `${nos[2]!},CHITRA,,,30,32,N,,,Select,"Late paper, 5 Nov"`,
    ].join('\r\n');
    const r = await upload(Buffer.from(csv, 'utf8'), true, 'text/csv');
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ done: 1, errors: 0 });
    const ch = await app0(apps[2]!);
    expect(ch).toMatchObject({ merit: '62.00', stage_no: 1 });
    expect(await rowOf(apps[2]!)).toMatchObject({
      state: 'selected',
      absent: false,
      total: 62,
      remark: 'Late paper, 5 Nov',
    });
  });

  it("the registration's steps show the marks by part", async () => {
    const r = (await call('GET', `/admissions/registrations/${apps[0]!}`)).json();
    expect(r.process.steps[0]).toMatchObject({
      kind: 'test',
      byPart: {
        parts: [
          { name: 'English', max: 50, marks: 40 },
          { name: 'Maths', max: 50, marks: 48 },
        ],
        total: 88,
        maxTotal: 100,
        absent: false,
      },
    });
    expect(r.process.steps[1].byPart).toBeNull();
  });

  it('exports the grid as filtered, as Excel and PDF', async () => {
    const x = (
      await call('GET', `/admissions/results/export?${qs({ format: 'xlsx', band: '81-90' })}`)
    ).json();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(x.base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect((ws.getRow(4).values as unknown[]).slice(1)).toEqual([
      'Roll no.',
      'Registration no.',
      'Candidate',
      'English (50)',
      'Maths (50)',
      'Total',
      '%',
      'Cut-off',
      'Stands',
    ]);
    expect((ws.getRow(5).values as unknown[]).slice(2, 7)).toEqual([
      nos[0],
      'ASHA',
      '40',
      '48',
      '88',
    ]);
    expect(ws.rowCount).toBe(5);
    const p = (await call('GET', `/admissions/results/export?${qs({ format: 'pdf' })}`)).json();
    expect(p.contentType).toBe('application/pdf');
    expect(Buffer.from(p.base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
  });

  // ---- part 3: the interview's parameters; marks by part on a slot and on the registration ----------
  it("an interview slot takes the class's parameters part by part; the decision carries the total", async () => {
    const iv = await call('PUT', `/admissions/stages/${ids.interview!}/papers/${ids.cls!}`, {
      parts: [
        { name: 'Communication', maxMarks: 10 },
        { name: 'Confidence', maxMarks: 10 },
      ],
    });
    for (const p of iv.json().paper.parts as Array<{ id: string; name: string }>)
      parts[p.name] = p.id;
    const slot = await call('POST', `/admissions/cycles/${ids.cycle!}/slots`, {
      stageId: ids.interview,
      classId: ids.cls,
      startsAt: '2027-01-10T10:00:00+05:30',
      venue: 'Room 1',
      capacity: 10,
    });
    expect(slot.statusCode).toBe(201);
    ids.slot = slot.json().id as string;
    const allot = await call('POST', `/admissions/slots/${ids.slot}/allot`, {
      applicationIds: [apps[0], apps[1]],
      notify: false,
    });
    expect(allot.statusCode).toBe(201);
    const detail = (await call('GET', `/admissions/slots/${ids.slot}`)).json();
    expect(detail.candidates[0]).toMatchObject({
      parts: [
        { name: 'Communication', maxMarks: 10 },
        { name: 'Confidence', maxMarks: 10 },
      ],
      partMarks: {},
    });
    const over = await call('PUT', `/admissions/slots/${ids.slot}/results`, {
      rows: [
        {
          applicationId: apps[0],
          attendance: 'present',
          parts: { [parts.Communication!]: 12 },
          decision: 'approve',
        },
      ],
    });
    expect(over.statusCode).toBe(400);
    expect(over.json().detail).toBe('Communication: marks from 0 to 10');
    const saved = await call('PUT', `/admissions/slots/${ids.slot}/results`, {
      rows: [
        {
          applicationId: apps[0],
          attendance: 'present',
          parts: { [parts.Communication!]: 8, [parts.Confidence!]: 9 },
          decision: 'approve',
          remarks: 'Confident speaker',
        },
        { applicationId: apps[1], attendance: 'absent', parts: {}, decision: 'approve' },
      ],
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().saved).toBe(2);
    const at = await withMigrator(async (c) => {
      const r = await c.query<{
        id: string;
        decision: string;
        marks: string | null;
        attendance: string | null;
      }>(
        `SELECT application_id::text AS id, decision, marks::text, attendance FROM admission_stage_results
          WHERE stage_id = $1 AND undone_at IS NULL ORDER BY application_id`,
        [ids.interview],
      );
      const m = await c.query<{ id: string; merit: string }>(
        `SELECT id::text, merit::text FROM applications WHERE id = ANY($1::bigint[])`,
        [apps],
      );
      return { results: r.rows, merit: Object.fromEntries(m.rows.map((x) => [x.id, x.merit])) };
    });
    expect(at.results).toEqual([
      { id: apps[0], decision: 'approved', marks: '17.00', attendance: 'present' },
      // absent: held, no marks
      { id: apps[1], decision: 'hold', marks: null, attendance: 'absent' },
    ]);
    expect(at.merit[apps[0]!]).toBe('105.00');
    const g = (
      await call(
        'GET',
        `/admissions/results?${new URLSearchParams({ ...place(), stageId: ids.interview! }).toString()}`,
      )
    ).json();
    expect(g.place).toMatchObject({ kind: 'interview', paper: { total: 20 } });
    // the slot's own sheet (Tests and interviews): only its candidates still to be marked or decided
    const ivPlace = { ...place(), stageId: ids.interview! };
    const slotSheet = (
      await call(
        'GET',
        `/admissions/results/sheet?${new URLSearchParams({ ...ivPlace, slotId: ids.slot }).toString()}`,
      )
    ).json();
    expect(slotSheet.rows).toBe(2);
    // the slot page's Marks tab: the grid of the slot's candidates only, with where each stands
    const slotGrid = (
      await call(
        'GET',
        `/admissions/results?${new URLSearchParams({ ...ivPlace, slotId: ids.slot }).toString()}`,
      )
    ).json();
    expect(slotGrid.rows).toHaveLength(2);
    expect(
      slotGrid.rows.every(
        (r: { slotId: string; current: unknown }) => r.slotId === ids.slot && 'current' in r,
      ),
    ).toBe(true);
    expect(slotSheet.filename).toBe('Results-Interview-Class-IX-slot-' + ids.slot + '.xlsx');
    expect(
      (
        await call('GET', `/admissions/results/sheet?${new URLSearchParams(ivPlace).toString()}`)
      ).json().rows,
    ).toBe(3);
    expect(
      (
        await call(
          'GET',
          `/admissions/results/sheet?${new URLSearchParams({ ...place(), slotId: ids.slot }).toString()}`,
        )
      ).statusCode,
    ).toBe(404);
    expect(g.rows.find((r: { id: string }) => r.id === apps[0])).toMatchObject({
      total: 17,
      percent: 85,
      state: 'selected',
    });
  });

  it('the registration page decides with marks by part', async () => {
    const r = (await call('GET', `/admissions/registrations/${apps[2]!}`)).json();
    expect(r.process.current).toMatchObject({
      kind: 'interview',
      maxMarks: 20,
      paper: { total: 20, parts: [{ name: 'Communication' }, { name: 'Confidence' }] },
      partMarks: null,
    });
    const d = await call('POST', `/admissions/registrations/${apps[2]!}/decide`, {
      decision: 'approve',
      attendance: 'present',
      parts: { [parts.Communication!]: 6, [parts.Confidence!]: 7 },
      remarks: 'Fine',
    });
    expect(d.statusCode).toBe(201);
    const a = await app0(apps[2]!);
    expect(a.merit).toBe('75.00');
    expect(d.json().process.steps[1].byPart).toMatchObject({
      parts: [
        { name: 'Communication', marks: 6 },
        { name: 'Confidence', marks: 7 },
      ],
      total: 13,
    });
  });

  it('the Admissions list has the test and interview marks, %, and by part', async () => {
    const grid = await call('POST', '/admissions/registrations/grid', {
      columns: [
        { key: 'test_marks' },
        { key: 'test_percent' },
        { key: 'test_detail' },
        { key: 'interview_marks' },
        { key: 'interview_percent' },
        { key: 'interview_detail' },
      ],
      status: 'all',
      page: 1,
      size: 50,
    });
    expect(grid.statusCode).toBe(201);
    const row = (id: string) => grid.json().rows.find((r: { __id: string }) => r.__id === id);
    expect(row(apps[0]!)).toMatchObject({
      test_marks: 88,
      test_percent: 88,
      test_detail: 'English 40/50 · Maths 48/50',
      interview_marks: 17,
      interview_percent: 85,
      interview_detail: 'Communication 8/10 · Confidence 9/10',
    });
    expect(row(apps[1]!)).toMatchObject({ interview_marks: null, interview_detail: 'Absent' });
  });

  // ---- part 4: results to families after a release time ---------------------------------------------
  it('families see the marks only after the release time; the families are told once it has passed', async () => {
    const mobile = `9${String(Date.now()).slice(-9)}`;
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE applicants SET mobile = $2 WHERE id = (SELECT applicant_id FROM applications WHERE id = $1)`,
        [apps[0], mobile],
      );
      await c.query(
        `UPDATE applications SET contact_email = 'asha.family@example.invalid' WHERE id = $1`,
        [apps[0]],
      );
    });
    const ch = await inject({ method: 'POST', url: '/public/admissions/challenge', headers: {} });
    const nonce = PowService.solve(ch.json().challenge, ch.json().difficulty);
    const code = await inject({
      method: 'POST',
      url: '/public/admission/code',
      headers: {},
      json: { schoolCode: school.code, identifier: mobile, challenge: ch.json().challenge, nonce },
    });
    expect(code.statusCode).toBe(201);
    const ok = await inject({
      method: 'POST',
      url: '/public/admission/code/verify',
      headers: {},
      json: { schoolCode: school.code, identifier: mobile, code: code.json().devCode },
    });
    const token = ok.json().token as string;
    const seen = async () =>
      (
        await inject({
          method: 'GET',
          url: `/public/admission/me/applications/${apps[0]!}`,
          headers: { authorization: `Bearer ${token}` },
        })
      ).json().results;
    expect(await seen()).toEqual([]);
    const past = await call('PUT', '/admissions/results/release', {
      ...place(),
      releaseAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    expect(past.statusCode).toBe(400);
    const later = await call('PUT', '/admissions/results/release', {
      ...place(),
      releaseAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(later.statusCode).toBe(200);
    expect(later.json().release).toMatchObject({ passed: false, toldAt: null });
    expect(await seen()).toEqual([]);
    const early = await call('POST', '/admissions/results/release/tell', place());
    expect(early.statusCode).toBe(409);
    expect(early.json().type).toBe('admissions.results_not_released');
    // before its time: taken back without a reason
    expect(
      (await call('POST', '/admissions/results/release/withdraw', place())).json().release,
    ).toBeNull();
    expect((await grid()).release).toBeNull();
    const now = await call('PUT', '/admissions/results/release', {
      ...place(),
      releaseAt: new Date().toISOString(),
    });
    expect(now.statusCode).toBe(200);
    expect(await seen()).toEqual([
      {
        stage: 'Written test',
        kind: 'test',
        absent: false,
        parts: [
          { name: 'English', max: 50, marks: 40 },
          { name: 'Maths', max: 50, marks: 48 },
        ],
        total: 88,
        maxTotal: 100,
        percent: 88,
      },
    ]);
    const told = await call('POST', '/admissions/results/release/tell', place());
    expect(told.statusCode).toBe(201);
    expect(told.json()).toMatchObject({ told: 3, release: { passed: true, toldCount: 3 } });
    const mail = await withMigrator((c) =>
      c.query<{ subject: string }>(
        `SELECT m.subject FROM comms_messages m JOIN comms_templates t ON t.id = m.template_id
          WHERE m.school_id = $1 AND t.code = 'admission_result' AND m.channel = 'email' AND m.variables ->> '_app' = $2`,
        [school.id, apps[0]],
      ),
    );
    expect(mail.rows.map((x) => x.subject)).toEqual(['Admission result of ASHA']);
    // out: moved later only with a reason (docs/design/59); the marks leave the portal until then
    const bare = await call('PUT', '/admissions/results/release', {
      ...place(),
      releaseAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(bare.statusCode).toBe(400);
    expect(bare.json().type).toBe('admissions.reason_required');
    const moved = await call('PUT', '/admissions/results/release', {
      ...place(),
      releaseAt: new Date(Date.now() + 3_600_000).toISOString(),
      reason: 'Paper rechecking',
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().release).toMatchObject({ passed: false, toldAt: null, toldCount: null });
    expect(await seen()).toEqual([]);
    expect((await call('POST', '/admissions/results/release/tell', place())).statusCode).toBe(409);
    // back out at once
    expect(
      (
        await call('PUT', '/admissions/results/release', {
          ...place(),
          releaseAt: new Date().toISOString(),
          reason: 'Rechecked',
        })
      ).json().release,
    ).toMatchObject({ passed: true });
    expect(await seen()).toHaveLength(1);
    // the interview is not released: the family does not see it
    expect((await seen()).map((x: { stage: string }) => x.stage)).toEqual(['Written test']);
    // out: taken back only with a reason
    const keep = await call('POST', '/admissions/results/release/withdraw', place());
    expect(keep.statusCode).toBe(400);
    expect(keep.json().type).toBe('admissions.reason_required');
    const back = await call('POST', '/admissions/results/release/withdraw', {
      ...place(),
      reason: 'Wrong class released',
    });
    expect(back.statusCode).toBe(201);
    expect(back.json().release).toBeNull();
    expect(await seen()).toEqual([]);
    expect(
      (
        await call('PUT', '/admissions/results/release', {
          ...place(),
          releaseAt: new Date().toISOString(),
        })
      ).statusCode,
    ).toBe(200);
    // the history, newest first
    const log = (await grid()).releaseLog as Array<{
      what: string;
      wasOut: boolean;
      reason: string | null;
      by: string | null;
    }>;
    expect(log.map((x) => x.what)).toEqual([
      'set',
      'taken_back',
      'moved',
      'moved',
      'told',
      'set',
      'taken_back',
      'set',
    ]);
    expect(log[1]).toMatchObject({ wasOut: true, reason: 'Wrong class released' });
    expect(log[3]).toMatchObject({ wasOut: true, reason: 'Paper rechecking' });
    expect(log[6]).toMatchObject({ wasOut: false, reason: null });
    expect(log.every((x) => x.by)).toBe(true);
    expect(await seen()).toHaveLength(1);
  });

  // ---- docs/design/58, part 1: change after upload, one candidate or many by Excel -----------------
  it("a decided candidate's decision changes with a reason; a later stage stops it", async () => {
    const iv = { ...place(), stageId: ids.interview! };
    const save = (stageId: string, row: Record<string, unknown>) =>
      call('PUT', '/admissions/results', { ...place(), stageId, rows: [row] });
    // CHITRA was selected at the interview (13 of 20): Selected -> Hold needs the reason
    const bare = await save(ids.interview!, {
      applicationId: apps[2],
      marks: {},
      decision: 'hold',
    });
    expect(bare.json().errors[0].error).toBe(
      'Already selected: give the reason for the new decision',
    );
    const held = await save(ids.interview!, {
      applicationId: apps[2],
      marks: {},
      decision: 'hold',
      reason: 'Panel asked to see her again',
    });
    expect(held.json()).toEqual({ saved: 1, errors: [] });
    const g = (
      await call('GET', `/admissions/results?${new URLSearchParams(iv).toString()}`)
    ).json();
    expect(g.rows.find((r: { id: string }) => r.id === apps[2])).toMatchObject({
      state: 'held',
      current: 'hold',
      total: 13,
    });
    const hist = await withMigrator((c) =>
      c.query<{ note: string }>(
        `SELECT note FROM application_events WHERE application_id = $1 ORDER BY id DESC LIMIT 2`,
        [apps[2]],
      ),
    );
    expect(hist.rows.map((x) => x.note)).toContain(
      'Interview: Selected undone · Panel asked to see her again',
    );
    // the written test was decided before the interview: it can no longer change here
    const later = await save(ids.test!, {
      applicationId: apps[0],
      marks: {},
      decision: 'hold',
      reason: 'Re-check',
    });
    expect(later.json().errors[0].error).toBe('Decided at Interview since: undo it there first');
  });

  it('a sheet uploaded again changes several candidates; decided ones need the reason', async () => {
    const iv = { ...place(), stageId: ids.interview! };
    const dl = (
      await call('GET', `/admissions/results/sheet?${new URLSearchParams(iv).toString()}`)
    ).json();
    expect(dl.rows).toBe(3);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(dl.base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect((ws.getRow(5).values as unknown[]).slice(1).map(String).slice(-3)).toEqual([
      'Decision',
      'Remark',
      'Reason for change',
    ]);
    const rowOfNo = (no: string) => {
      for (let n = 6; n <= ws.rowCount; n += 1)
        if (String(ws.getRow(n).getCell(1).value) === no) return ws.getRow(n);
      throw new Error(no);
    };
    const asha = rowOfNo(nos[0]!);
    const balu = rowOfNo(nos[1]!);
    const chitra = rowOfNo(nos[2]!);
    // the decisions as they stand are filled in
    expect([asha.getCell(10).value, balu.getCell(10).value, chitra.getCell(10).value]).toEqual([
      'Select',
      'Hold',
      'Hold',
    ]);
    // ASHA (selected): Communication 8 -> 9, first without a reason
    asha.getCell(5).value = 9;
    // BALU (held, absent): not selected
    balu.getCell(10).value = 'Not selected';
    // CHITRA (held): Communication 6 -> 7 and selected
    chitra.getCell(5).value = 7;
    chitra.getCell(10).value = 'Select';
    const first = await upload(Buffer.from(await wb.xlsx.writeBuffer()), false, XLSX);
    const line = (no: string) => first.json().rows.find((r: { number: string }) => r.number === no);
    expect(line(nos[0]!)).toMatchObject({
      status: 'error',
      reason: 'Already selected: write the Reason for change for changing the marks',
    });
    expect(line(nos[1]!)).toMatchObject({ status: 'ok', change: 'Decision Held → Not selected' });
    expect(line(nos[2]!)).toMatchObject({
      status: 'ok',
      change: 'Decision Held → Selected · Marks changed',
      total: 14,
    });
    asha.getCell(12).value = 'Panel re-scored';
    const done = await upload(Buffer.from(await wb.xlsx.writeBuffer()), true, XLSX);
    expect(done.json()).toMatchObject({ done: 3, errors: 0 });
    const g = (
      await call('GET', `/admissions/results?${new URLSearchParams(iv).toString()}`)
    ).json();
    const by = (id: string) => g.rows.find((r: { id: string }) => r.id === id);
    expect(by(apps[0]!)).toMatchObject({ state: 'selected', total: 18 });
    expect(by(apps[1]!)).toMatchObject({ state: 'rejected', current: 'reject' });
    expect(by(apps[2]!)).toMatchObject({ state: 'selected', total: 14 });
    // merit follows: ASHA 88 + 18, CHITRA 62 + 14
    expect((await app0(apps[0]!)).merit).toBe('106.00');
    expect((await app0(apps[2]!)).merit).toBe('76.00');
  });

  // ---- docs/design/58, part 3: the session's overview and its whole export --------------------------
  it("the session's overview matches each grid; the whole session exports as Excel and PDF", async () => {
    const o = await call('GET', `/admissions/results/overview?cycleId=${ids.cycle!}`);
    expect(o.statusCode).toBe(200);
    const view = o.json();
    expect(view.cycle).toBe('Admissions 2027-28');
    expect(view.rows.map((r: { kind: string; outOf: number }) => [r.kind, r.outOf])).toEqual([
      ['test', 100],
      ['interview', 20],
    ]);
    for (const r of view.rows) {
      const g = (
        await call(
          'GET',
          `/admissions/results?${new URLSearchParams({ ...place(), stageId: r.stageId }).toString()}`,
        )
      ).json();
      expect(r).toMatchObject({
        classId: ids.cls,
        className: 'Class IX',
        candidates: g.counts.all,
        marked: g.counts.marked,
        below: g.counts.below,
      });
      expect(r.waiting + r.held).toBe(g.counts.waiting);
    }
    expect((await call('GET', '/admissions/results/overview?cycleId=999999999')).statusCode).toBe(
      404,
    );

    const x = (
      await call('GET', `/admissions/results/export-session?cycleId=${ids.cycle!}&format=xlsx`)
    ).json();
    expect(x.filename).toBe('results-admissions-2027-28.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(x.base64, 'base64') as unknown as ArrayBuffer);
    expect(wb.worksheets).toHaveLength(3);
    expect(wb.worksheets[0]!.name).toBe('Overview');
    expect((wb.worksheets[0]!.getRow(4).values as unknown[]).slice(1, 4)).toEqual([
      'Class',
      'Stage',
      'Out of',
    ]);
    expect((wb.worksheets[0]!.getRow(5).values as unknown[]).slice(1, 5)).toEqual([
      'Class IX',
      view.rows[0].stage,
      '100',
      String(view.rows[0].candidates),
    ]);
    expect(wb.worksheets[1]!.name).toBe(`Class IX ${String(view.rows[0].stage)}`.slice(0, 26));
    // the session download names each candidate's slot (docs/design/60)
    expect((wb.worksheets[1]!.getRow(4).values as unknown[]).slice(4, 7)).toEqual([
      'Slot',
      'English (50)',
      'Maths (50)',
    ]);
    const p = (
      await call('GET', `/admissions/results/export-session?cycleId=${ids.cycle!}&format=pdf`)
    ).json();
    expect(p.contentType).toBe('application/pdf');
    const pdf = await PDFDocument.load(Buffer.from(p.base64, 'base64'));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);
  });

  // ---- docs/design/60, part 1: the class download by slot --------------------------------------------
  it('the class download has a section per slot with its date, venue and note; one slot chosen: its own', async () => {
    const iv = { ...place(), stageId: ids.interview! };
    const sheetOf = async (x: Record<string, string>) => {
      const r = (
        await call(
          'GET',
          `/admissions/results/export?${new URLSearchParams({ ...iv, ...x, format: 'xlsx' }).toString()}`,
        )
      ).json();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(r.base64, 'base64') as unknown as ArrayBuffer);
      return wb;
    };
    const pagesOf = async (x: Record<string, string>) => {
      const r = (
        await call(
          'GET',
          `/admissions/results/export?${new URLSearchParams({ ...iv, ...x, format: 'pdf' }).toString()}`,
        )
      ).json();
      return (await PDFDocument.load(Buffer.from(r.base64, 'base64'))).getPageCount();
    };
    // all three sat in Room 1 (the third given the slot automatically, docs/design/59): one moves to
    // a second slot, one is taken out of the slots
    const second = await call('POST', `/admissions/cycles/${ids.cycle!}/slots`, {
      stageId: ids.interview,
      classId: ids.cls,
      startsAt: '2027-01-11T09:30:00+05:30',
      venue: 'Room 2',
      capacity: 10,
    });
    await withMigrator(async (c) => {
      await c.query(`UPDATE admission_slots SET notes = 'Bring the admit card' WHERE id = $1`, [
        ids.slot,
      ]);
      await c.query(
        `UPDATE admission_slot_allotments SET slot_id = $2 WHERE application_id = $1 AND stage_id = $3`,
        [apps[1], second.json().id, ids.interview],
      );
      await c.query(
        `DELETE FROM admission_slot_allotments WHERE application_id = $1 AND stage_id = $2`,
        [apps[2], ids.interview],
      );
    });
    const all = await sheetOf({});
    expect(all.worksheets.map((w) => w.name)).toEqual(['10 Jan 10.00', '11 Jan 09.30', 'No slot']);
    const first = all.worksheets[0]!;
    expect(String(first.getRow(2).getCell(1).value)).toContain('1 candidate ·');
    expect(first.getRow(3).getCell(1).value).toBe(
      'Slot: Sun, 10 Jan, 2027, 10:00 am · 60 minutes · Room 1',
    );
    expect(first.getRow(4).getCell(1).value).toBe('Note: Bring the admit card');
    expect((first.getRow(6).values as unknown[]).slice(1, 3)).toEqual([
      'Roll no.',
      'Registration no.',
    ]);
    expect(all.worksheets[1]!.getRow(3).getCell(1).value).toBe(
      'Slot: Mon, 11 Jan, 2027, 9:30 am · 60 minutes · Room 2',
    );
    expect(all.worksheets[2]!.getRow(3).getCell(1).value).toBe(
      'No slot: not allotted to a slot of this stage',
    );
    expect(await pagesOf({})).toBe(3);
    // one slot chosen: that slot's heading only
    const one = await sheetOf({ slotId: ids.slot! });
    expect(one.worksheets.map((w) => w.name)).toEqual(['Results']);
    expect(String(one.worksheets[0]!.getRow(3).getCell(1).value)).toMatch(/^Slot: .* Room 1$/);
    expect(await pagesOf({ slotId: ids.slot! })).toBe(1);
  });

  // ---- docs/design/61, part 1: the score report by subject ------------------------------------------
  it('the score report has a column per subject and parameter with stage totals; search keeps the rank', async () => {
    const o = (await call('GET', '/admissions/score-report/options')).json();
    expect(o.cycles).toEqual([
      expect.objectContaining({
        id: ids.cycle,
        registrations: 3,
        classes: [{ id: ids.cls, name: 'Class IX', registrations: 3 }],
      }),
    ]);
    const q = new URLSearchParams({ cycleId: ids.cycle!, classId: ids.cls! }).toString();
    const rep = (await call('GET', `/admissions/score-report?${q}`)).json();
    expect(
      rep.marks.map((m: { stage: string; label: string; max: number; kind: string }) => [
        m.stage,
        m.label,
        m.max,
        m.kind,
      ]),
    ).toEqual([
      ['Written test', 'English', 50, 'part'],
      ['Written test', 'Maths', 50, 'part'],
      ['Written test', 'Written test total', 100, 'total'],
      ['Interview', 'Communication', 10, 'part'],
      ['Interview', 'Confidence', 10, 'part'],
      ['Interview', 'Interview total', 20, 'total'],
    ]);
    // the cells are the grid's marks, part by part, and the totals (AB when absent)
    for (const [stageId, at] of [
      [ids.test!, 0],
      [ids.interview!, 3],
    ] as const) {
      const g = (
        await call(
          'GET',
          `/admissions/results?${new URLSearchParams({ ...place(), stageId }).toString()}`,
        )
      ).json();
      const partIds = (g.place.paper.parts as Array<{ id: string }>).map((x) => x.id);
      for (const row of rep.rows as Array<{ id: string; cells: unknown[] }>) {
        const gr = (
          g.rows as Array<{
            id: string;
            absent: boolean;
            total: number | null;
            marks: Record<string, number | null>;
          }>
        ).find((x) => x.id === row.id);
        if (!gr) continue;
        expect(row.cells.slice(at, at + partIds.length)).toEqual(
          partIds.map((pid) => (gr.absent ? 'AB' : (gr.marks[pid] ?? null))),
        );
        expect(row.cells[at + partIds.length]).toEqual(gr.absent ? 'AB' : gr.total);
      }
    }
    // a name: the class's rank kept
    const asha = (rep.rows as Array<{ candidate: string; rank: number | null }>).find(
      (x) => x.candidate === 'ASHA',
    )!;
    const one = (await call('GET', `/admissions/score-report?${q}&q=ash`)).json();
    expect(
      one.rows.map((x: { candidate: string; rank: number | null }) => [x.candidate, x.rank]),
    ).toEqual([['ASHA', asha.rank]]);
    expect(
      (await call('GET', `/admissions/score-report?${q}&q=${encodeURIComponent(nos[1]!)}`)).json()
        .rows,
    ).toHaveLength(1);
    // the downloads carry the same columns
    const x = await call('GET', `/admissions/score-report.xlsx?${q}`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.rawPayload as unknown as ArrayBuffer);
    const head = (wb.worksheets[0]!.getRow(4).values as unknown[]).map(String);
    expect(head).toEqual(
      expect.arrayContaining([
        'Written test · English (50)',
        'Written test total (100)',
        'Interview total (20)',
      ]),
    );
    const pdf = await call('GET', `/admissions/score-report.pdf?${q}&q=ash`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  // ---- docs/design/62, part 1: the score report's views --------------------------------------------
  it("the score report's views: the merit list, the written test's result and the interview's", async () => {
    const q = new URLSearchParams({ cycleId: ids.cycle!, classId: ids.cls! }).toString();
    const merit = (await call('GET', `/admissions/score-report?${q}`)).json();
    expect(merit.view).toEqual({ id: 'merit', name: 'Merit list', kind: 'merit' });
    expect(merit.views).toEqual([
      { id: 'merit', name: 'Merit list', kind: 'merit' },
      { id: ids.test, name: 'Written test', kind: 'test' },
      { id: ids.interview, name: 'Interview', kind: 'interview' },
    ]);
    const wt = (await call('GET', `/admissions/score-report?${q}&view=${ids.test!}`)).json();
    expect(wt.view).toEqual({ id: ids.test, name: 'Written test', kind: 'test' });
    expect(wt.criteria).toEqual([]);
    expect(wt.marks.map((m: { label: string }) => m.label)).toEqual([
      'English',
      'Maths',
      'Written test total',
    ]);
    // ranked by the written total, high to low; equal totals share a rank; the % of 100
    const g = (await grid()).rows as Array<{ id: string; total: number | null; absent: boolean }>;
    const rows = wt.rows as Array<{
      id: string;
      total: number | null;
      rank: number | null;
      percent: number | null;
    }>;
    for (const r of rows) {
      const gr = g.find((x) => x.id === r.id)!;
      expect(r.total).toBe(gr.absent ? null : gr.total);
      expect(r.percent).toBe(r.total);
      const t = r.total;
      if (t !== null)
        expect(r.rank).toBe(
          g.filter((x) => !x.absent && x.total !== null && x.total > t).length + 1,
        );
    }
    expect(wt.rows[0].rank).toBe(1);
    const iv = (await call('GET', `/admissions/score-report?${q}&view=${ids.interview!}`)).json();
    expect(iv.marks.map((m: { label: string }) => m.label)).toEqual([
      'Communication',
      'Confidence',
      'Interview total',
    ]);
    expect(iv.levels.every((l: string) => l.startsWith('Interview'))).toBe(true);
    expect((await call('GET', `/admissions/score-report?${q}&view=999999`)).statusCode).toBe(404);
    // the downloads follow the view
    const x = await call('GET', `/admissions/score-report.xlsx?${q}&view=${ids.test!}`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.rawPayload as unknown as ArrayBuffer);
    expect(String(wb.worksheets[0]!.getRow(1).getCell(1).value)).toMatch(
      /^Written test result: Class IX/,
    );
    expect((wb.worksheets[0]!.getRow(4).values as unknown[]).slice(6, 10)).toEqual([
      'English (50)',
      'Maths (50)',
      'Written test total (100)',
      '%',
    ]);
    const pdf = await call('GET', `/admissions/score-report.pdf?${q}&view=${ids.interview!}`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-disposition']).toContain('score-report-Class-IX-Interview.pdf');
  });
});
