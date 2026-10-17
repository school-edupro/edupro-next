/**
 * Hostel module H4 (0150): hostel complaints on the helpdesk's hostel desk (a parent's goes to the head
 * warden of the child's hostel; staff raise for a room), the incident register (parent told when ticked,
 * shown in the portal; a serious one to the principal), the warden's sick-bay note as a clinic visit, and
 * the hostel dashboard.
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

const ist = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

describe('hostel module H4 (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let warden: SeededUser;
  let other: SeededUser;
  let parent: SeededUser;
  let accountant: SeededUser;
  const ids: Record<string, string> = {};
  const today = ist();
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const post = (url: string, u: SeededUser, json: unknown = {}) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const put = (url: string, u: SeededUser, json: unknown) =>
    inject({ method: 'PUT', url, headers: h(u), json });
  const get = async (url: string, u: SeededUser = admin) =>
    (await inject({ method: 'GET', url, headers: h(u) })).json();

  beforeAll(async () => {
    const s = stamp('HS4');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      warden = await seedUser(c, school, `${s}-warden`, 'warden');
      other = await seedUser(c, school, `${s}-other`, 'warden');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      // an auditor only views tickets: never a hand-over choice
      await seedUser(c, school, `${s}-aud`, 'auditor');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post('/academics/classes', admin, {
      code: 'IX',
      name: 'Class IX',
      displayOrder: 9,
    });
    const sec = await post(`/academics/classes/${cls.json().id as string}/sections`, admin, {
      name: 'A',
    });
    const st = await post('/people/students', admin, {
      admissionNo: 'HS4-1',
      firstName: 'Vir',
      lastName: 'Boarder',
      gender: 'male',
      dob: '2012-01-01',
      guardians: [
        {
          guardian: { firstName: 'Papa', lastName: 'V', mobile: '9876500091' },
          relation: 'father',
          isPrimary: true,
        },
      ],
      enrolment: { classSectionId: sec.json().id, rollNo: 1 },
    });
    ids.vir = st.json().id as string;
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876500091' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
    for (const [code, user] of [
      ['W1', warden],
      ['W2', other],
    ] as const) {
      const e = await post('/people/employees', admin, {
        employeeCode: code,
        firstName: code,
        lastName: 'Warden',
        employeeType: 'non_teaching',
        designation: 'Warden',
        posting: {},
      });
      ids[code] = e.json().id as string;
      await withMigrator((c) =>
        c.query(`UPDATE employees SET user_id = $1 WHERE id = $2`, [user.id, ids[code]]),
      );
    }
    ids.bh = (
      await post('/hostel/hostels', admin, { name: 'Boys Hostel', code: 'BH', gender: 'boys' })
    ).json().id as string;
    ids.oh = (await post('/hostel/hostels', admin, { name: 'Other Hostel', code: 'OH' })).json()
      .id as string;
    await put(`/hostel/hostels/${ids.bh}/wardens`, admin, {
      wardens: [{ employeeId: ids.W1, isHead: true }],
    });
    await put(`/hostel/hostels/${ids.oh}/wardens`, admin, {
      wardens: [{ employeeId: ids.W2, isHead: true }],
    });
    const t = await post('/hostel/room-types', admin, { name: 'Double', seater: 2 });
    ids.room = (
      await post('/hostel/rooms', admin, { hostelId: ids.bh, roomNo: '7', roomTypeId: t.json().id })
    ).json().id as string;
    const bed = (await get(`/hostel/rooms?hostelId=${ids.bh}`)).data[0].beds[0].id as string;
    expect(
      (await post('/hostel/allotments', admin, { studentId: ids.vir, bedId: bed, fromDate: today }))
        .statusCode,
    ).toBe(201);
  });
  afterAll(async () => {
    await withMigrator((c) =>
      c.query(
        `UPDATE comms_messages SET status = 'cancelled' WHERE school_id = $1 AND status IN ('queued', 'sending')`,
        [school.id],
      ),
    ).catch(() => undefined);
    if (app) await app.close();
  });

  it('a parent’s complaint goes to the head warden of the child’s hostel; staff raise for a room', async () => {
    const heads = (await get('/hostel/mine/complaint-heads', parent)).data.map(
      (x: { code: string }) => x.code,
    );
    expect(heads).toEqual(expect.arrayContaining(['electrical', 'plumbing', 'mess', 'other']));
    const raised = await post('/hostel/mine/complaints', parent, {
      studentId: ids.vir,
      categoryCode: 'electrical',
      subject: 'Fan not working',
      body: 'The ceiling fan in room 7 stopped yesterday.',
    });
    expect(raised.statusCode).toBe(201);
    expect(raised.json().number).toMatch(/^H\//);
    ids.complaint = raised.json().id as string;
    const row = await withMigrator((c) =>
      c.query<{
        assigned_user_id: string;
        hostel_id: string;
        hostel_room_id: string;
        due: boolean;
      }>(
        `SELECT assigned_user_id::text, hostel_id::text, hostel_room_id::text, due_at > now() AS due FROM parent_queries WHERE id = $1`,
        [ids.complaint],
      ),
    );
    expect(row.rows[0]).toEqual({
      assigned_user_id: warden.id,
      hostel_id: ids.bh,
      hostel_room_id: ids.room,
      due: true,
    });
    // the warden sees it (hostel list and helpdesk), the other hostel's warden does not
    expect((await get('/hostel/complaints', warden)).data.map((x: { id: string }) => x.id)).toEqual(
      [ids.complaint],
    );
    expect((await get('/hostel/complaints', other)).data).toEqual([]);
    const desk = await get('/helpdesk/tickets?desk=hostel', warden);
    expect(JSON.stringify(desk)).toContain(ids.complaint);
    expect(
      (await get(`/hostel/mine/complaints?studentId=${ids.vir}`, parent)).data[0],
    ).toMatchObject({
      head: 'Electrical (lights, fan, switch)',
      room: '7',
      status: 'open',
    });
    // a member of staff raises one for a room on the helpdesk
    const staff = await post('/helpdesk/tickets', warden, {
      desk: 'hostel',
      categoryCode: 'plumbing',
      subject: 'Leaking tap',
      body: 'Wash area tap leaks.',
      hostelRoomId: ids.room,
    });
    expect(staff.statusCode).toBe(201);
    expect(
      (
        await post('/helpdesk/tickets', warden, {
          desk: 'hostel',
          categoryCode: 'plumbing',
          subject: 'Where?',
          body: 'No room',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('a complaint is handed over only to someone who can answer it (an auditor only views)', async () => {
    const who = await get('/helpdesk/assignees', warden);
    const codes = who.roles.map((r: { code: string }) => r.code);
    expect(codes).toContain('accountant');
    expect(codes).not.toContain('auditor');
    expect(who.roles.find((r: { code: string }) => r.code === 'accountant').people).toBeTruthy();
    const toAuditor = await post(`/helpdesk/tickets/${ids.complaint}/assign`, warden, {
      roleCode: 'auditor',
    });
    expect(toAuditor.json()).toMatchObject({
      type: expect.stringContaining('helpdesk.cannot_answer'),
    });
    const toAccounts = await post(`/helpdesk/tickets/${ids.complaint}/assign`, warden, {
      roleCode: 'accountant',
      note: 'A broken cupboard: please arrange the carpenter',
    });
    expect(toAccounts.statusCode).toBe(200);
    // the accountant now has it with them
    expect(
      JSON.stringify(await get('/helpdesk/tickets?desk=hostel&view=assigned', accountant)),
    ).toContain(ids.complaint);
  });

  it('incidents: the parent sees only what was shared; a serious one goes to the principal', async () => {
    const quiet = await post('/hostel/incidents', warden, {
      studentId: ids.vir,
      category: 'discipline',
      what: 'Talking after lights out.',
      action: 'Warned.',
    });
    expect(quiet.json()).toMatchObject({ parentTold: false, principalTold: false });
    const told = await post('/hostel/incidents', warden, {
      studentId: ids.vir,
      category: 'safety',
      severity: 'serious',
      what: 'Climbed the boundary wall.',
      action: 'Parents called.',
      tellParent: true,
    });
    expect(told.json()).toMatchObject({ parentTold: true, principalTold: true });
    expect(
      (
        await post('/hostel/incidents', other, {
          studentId: ids.vir,
          category: 'other',
          what: 'Not my hostel.',
        })
      ).statusCode,
    ).toBe(403);
    const fam = (await get(`/hostel/mine/incidents?studentId=${ids.vir}`, parent)).data;
    expect(fam.map((x: { what: string }) => x.what)).toEqual(['Climbed the boundary wall.']);
    expect((await get('/hostel/incidents', warden)).data).toHaveLength(2);
    expect((await get('/hostel/incidents', other)).data).toHaveLength(0);
    ids.quiet = quiet.json().id as string;
    ids.serious = told.json().id as string;
  });

  it('incident follow-up: notes move it on, a photo goes with it, closing needs a remark; Excel and PDF', async () => {
    // a photo of the damage, uploaded by the warden
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const reg = await post('/platform/files', warden, {
      fileName: 'wall.png',
      contentType: 'image/png',
      sizeBytes: png.length,
    });
    const target = reg.json().upload as { url: string; headers?: Record<string, string> };
    const put = await inject({
      method: 'PUT',
      url: target.url,
      headers: { ...(target.headers ?? {}) },
      raw: { body: png, contentType: 'image/png' },
    } as never);
    expect(put.statusCode).toBe(200);
    const fileId = reg.json().file.id as string;
    // a serious incident cannot be closed when recorded
    expect(
      (
        await post('/hostel/incidents', warden, {
          studentId: ids.vir,
          category: 'property',
          severity: 'serious',
          what: 'Broke the window pane.',
          closeNow: true,
        })
      ).json(),
    ).toMatchObject({ type: expect.stringContaining('hostel.incident_serious_open') });
    const minor = await post('/hostel/incidents', warden, {
      studentId: ids.vir,
      category: 'property',
      what: 'Spilt ink on the desk.',
      action: 'Cleaned it.',
      closeNow: true,
      fileIds: [fileId],
    });
    expect(minor.json()).toMatchObject({ status: 'closed' });
    // the list: open ones first, counts by status, filters
    const list = await get('/hostel/incidents?size=10', warden);
    expect(list.counts).toEqual({ open: 2, follow_up: 0, closed: 1 });
    expect(list.data[list.data.length - 1].status).toBe('closed');
    expect((await get('/hostel/incidents?severity=serious', warden)).total).toBe(1);
    expect((await get('/hostel/incidents?status=not_closed', warden)).total).toBe(2);
    // follow-up on the serious one, then closing with the remark
    const n1 = await post(`/hostel/incidents/${ids.serious}/notes`, warden, {
      body: 'Met the parents; counselling arranged.',
      statusTo: 'follow_up',
    });
    expect(n1.json()).toMatchObject({ status: 'follow_up' });
    const closed = await post(`/hostel/incidents/${ids.serious}/notes`, warden, {
      body: 'Counselling done; no repeat in two weeks.',
      statusTo: 'closed',
    });
    expect(closed.json()).toMatchObject({
      status: 'closed',
      closingRemark: 'Counselling done; no repeat in two weeks.',
    });
    expect(closed.json().notes.map((x: { statusTo: string | null }) => x.statusTo)).toEqual([
      'follow_up',
      'closed',
    ]);
    // a closed incident takes a note only when reopened
    expect(
      (
        await post(`/hostel/incidents/${ids.serious}/notes`, warden, { body: 'One more thing.' })
      ).json(),
    ).toMatchObject({ type: expect.stringContaining('hostel.incident_closed') });
    expect(
      (
        await post(`/hostel/incidents/${ids.serious}/notes`, warden, {
          body: 'Seen again near the wall.',
          statusTo: 'open',
        })
      ).json(),
    ).toMatchObject({ status: 'open', closedAt: null });
    // the other hostel's warden cannot open it; the family sees the status
    expect(
      (await inject({ method: 'GET', url: `/hostel/incidents/${ids.serious}`, headers: h(other) }))
        .statusCode,
    ).toBe(404);
    expect((await get(`/hostel/incidents/${minor.json().id as string}`, warden)).fileIds).toEqual([
      fileId,
    ]);
    for (const format of ['xlsx', 'pdf'])
      expect((await get(`/hostel/incidents/file?format=${format}`, warden)).filename).toBe(
        `hostel-incident-register.${format}`,
      );
  });

  it('the warden’s sick-bay note is a clinic visit of the boarder', async () => {
    const sb = await post('/hostel/sickbay', warden, {
      studentId: ids.vir,
      complaint: 'Fever and headache',
      temperatureC: 38.6,
      treatment: 'Paracetamol, rest',
      outcome: 'rest',
    });
    expect(sb.statusCode).toBe(201);
    const v = await withMigrator((c) =>
      c.query<{ complaint: string; remark: string }>(
        `SELECT complaint, remark FROM clinic_visits WHERE student_id = $1`,
        [ids.vir],
      ),
    );
    expect(v.rows[0]).toMatchObject({
      complaint: 'Fever and headache',
      remark: 'Hostel sick bay (Boys Hostel)',
    });
    expect((await get('/hostel/sickbay', warden)).data[0]).toMatchObject({
      complaint: 'Fever and headache',
      hostel: 'Boys Hostel',
    });
    expect(
      (await post('/hostel/sickbay', other, { studentId: ids.vir, complaint: 'Cold' })).statusCode,
    ).toBe(403);
  });

  it('dashboard: today per hostel, the last days, and the hostel fee', async () => {
    const d = await get('/hostel/dashboard?days=7', warden);
    expect(d.hostels).toHaveLength(1);
    expect(d.hostels[0]).toMatchObject({
      name: 'Boys Hostel',
      beds: 2,
      boarders: 1,
      openComplaints: 2,
    });
    expect(d.trends).toHaveLength(7);
    expect(d.trends[6]).toMatchObject({ day: today, complaintsRaised: 2, incidents: 3 });
    expect(Array.isArray(d.fee)).toBe(true);
    expect((await get('/hostel/dashboard', admin)).hostels).toHaveLength(2);
  });
});
