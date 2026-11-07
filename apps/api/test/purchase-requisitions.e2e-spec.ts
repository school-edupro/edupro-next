/**
 * Purchase, part 3 (docs/design/83): the Purchase Requisition — indents of two departments combined
 * (the same item added up, each indent line kept as the source; the purchase office's department
 * approves a combined PR), sourcing by tier (direct with the certificate; the committee's three quotes,
 * L1 and a reason for a dearer choice, the members' signatures cleared when the statement changes; a
 * tender's reference and documents), a line issued from the store closing its indent, rejecting and
 * cancelling giving the indents back, closing an indent, reopening an approved PR, and who sees what;
 * a rate contract filling a line in (no quote needed, left out of the band; dearer needs a reason).
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

describe('purchase requisitions (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let office: SeededUser;
  let teacher: SeededUser;
  let hod: SeededUser;
  let principal: SeededUser;
  let c1: SeededUser;
  let c2: SeededUser;
  let c3: SeededUser;
  const ids: Record<string, string> = {};
  const s = stamp('PR');
  const call = (
    u: SeededUser,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    json?: unknown,
  ) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const get = async (u: SeededUser, id: string) =>
    (await call(u, 'GET', `/purchase/requisitions/${id}`)).json();
  const missing = (r: { json: () => { missing?: Array<{ key: string }> } }) =>
    (r.json().missing ?? []).map((m) => m.key);
  /** An approved indent waiting for a requisition (as part 2 leaves it). */
  const indent = async (
    dept: string,
    by: SeededUser,
    lines: Array<[string | null, string | null, number, number]>,
  ) =>
    withMigrator(async (c) => {
      const n = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM purchase_indents WHERE school_id = $1`,
        [school.id],
      );
      const pi = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_indents (school_id, number, department_id, raised_by, purpose, status, route, decided_at, estimate)
           VALUES ($1, $2, $3, $4, 'Needed', 'approved', 'to_requisition', now(), 0) RETURNING id::text`,
          [school.id, `PI/T/${String(n.rows[0]!.n + 1).padStart(4, '0')}`, ids[dept], by.id],
        )
      ).rows[0]!.id;
      for (const [i, [item, words, qty, rate]] of lines.entries())
        await c.query(
          `INSERT INTO purchase_indent_lines (school_id, indent_id, seq, item_id, free_text, quantity, uom_id, est_rate, rate_source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'typed')`,
          [school.id, pi, i + 1, item, words, qty, ids.NOS, rate],
        );
      return pi;
    });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      office = await seedUser(c, school, `${s}-po`, 'purchase_office');
      teacher = await seedUser(c, school, `${s}-t`, 'subject_teacher');
      hod = await seedUser(c, school, `${s}-hod`, 'subject_teacher');
      principal = await seedUser(c, school, `${s}-pr`, 'class_teacher');
      c1 = await seedUser(c, school, `${s}-c1`, 'subject_teacher');
      c2 = await seedUser(c, school, `${s}-c2`, 'subject_teacher');
      c3 = await seedUser(c, school, `${s}-c3`, 'subject_teacher');
      for (const [code, name, designation, dept, u] of [
        ['O1', 'Om Office', 'Purchase Officer', 'Administration', office],
        ['T1', 'Tara Teacher', 'TGT', 'Science', teacher],
        ['H1', 'Hari Head', 'PGT', 'Science', hod],
        ['P1', 'Prem Principal', 'Principal', 'Administration', principal],
        ['C1', 'Chitra One', 'PGT', 'Administration', c1],
        ['C2', 'Chetan Two', 'PGT', 'Administration', c2],
        ['C3', 'Charu Three', 'PGT', 'Administration', c3],
        ['S1', 'Sam Sports', 'PET', 'Sports', null],
      ] as const) {
        const e = await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, department, user_id)
           VALUES ($1, $2, $3, 'E2E', $4, $5, $6) RETURNING id::text`,
          [school.id, `${s}${code}`, name, designation, dept, u?.id ?? null],
        );
        ids[code] = e.rows[0]!.id;
      }
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      await c.query(`SELECT app.purchase_seed_masters($1)`, [school.id]);
      for (const d of ['Science', 'Sports', 'Administration'])
        ids[d] = (
          await c.query<{ id: string }>(
            `SELECT id::text FROM departments WHERE school_id = $1 AND name = $2`,
            [school.id, d],
          )
        ).rows[0]!.id;
      await c.query(`UPDATE departments SET hod_employee_id = $2 WHERE id = $1`, [
        ids.Science,
        ids.H1,
      ]);
      ids.NOS = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM purchase_uoms WHERE school_id = $1 AND code = 'NOS'`,
          [school.id],
        )
      ).rows[0]!.id;
      const cat = await c.query<{ id: string }>(
        `INSERT INTO purchase_item_categories (school_id, code, name) VALUES ($1, 'GEN', 'General') RETURNING id::text`,
        [school.id],
      );
      for (const [code, name, gst] of [
        ['PEN', 'Ball pen', 18],
        ['PAPER', 'A4 paper ream', 12],
        ['CHAIR', 'Student chair', 18],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO purchase_items (school_id, code, name, item_type, category_id, uom_id, gst_rate)
             VALUES ($1, $2, $3, 'consumable', $4, $5, $6) RETURNING id::text`,
            [school.id, code, name, cat.rows[0]!.id, ids.NOS, gst],
          )
        ).rows[0]!.id;
      for (const [code, name, gstStatus, gstin, status] of [
        ['V1', 'Regular Traders', 'regular', '27AAPFU0939F1ZV', 'active'],
        ['V2', 'Local Supplies', 'unregistered', null, 'active'],
        ['V3', 'City Furniture', 'unregistered', null, 'active'],
        ['V4', 'Waiting Vendor', 'unregistered', null, 'pending'],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO vendors (school_id, code, legal_name, gst_status, gstin, state_code, status) VALUES ($1, $2, $3, $4, $5, '27', $6) RETURNING id::text`,
            [school.id, code, name, gstStatus, gstin, status],
          )
        ).rows[0]!.id;
      for (const k of ['C1', 'C2', 'C3'])
        await c.query(
          `INSERT INTO purchase_committee_members (school_id, employee_id) VALUES ($1, $2)`,
          [school.id, ids[k]],
        );
      await c.query(`UPDATE purchase_settings SET committee_signatures = 2 WHERE school_id = $1`, [
        school.id,
      ]);
      ids.file = (
        await c.query<{ id: string }>(
          `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, status, created_by)
           VALUES ($1, 'test', $2, 'application/pdf', 1200, 'tender.pdf', 'ready', $3) RETURNING id::text`,
          [school.id, `${s}/tender.pdf`, office.id],
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const admin = await withMigrator((c) => seedUser(c, school, `${s}-admin`, 'school_admin'));
    // Science's PRs: its HOD; a combined PR: the Administration (purchase office) department's Principal
    for (const [dept, levels] of [
      ['Science', [{ name: 'HOD', by: 'hod' }]],
      ['Administration', [{ name: 'Principal', by: 'designation', designation: 'Principal' }]],
    ] as const)
      expect(
        (await call(admin, 'PUT', `/purchase/approvals/${ids[dept]!}/requisition`, { levels }))
          .statusCode,
      ).toBe(200);
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('combines indents of two departments: the same item added up, every indent line kept', async () => {
    ids.A = await indent('Science', teacher, [
      [ids.PEN!, null, 100, 10],
      [ids.PAPER!, null, 20, 300],
    ]);
    ids.B = await indent('Science', teacher, [[ids.PEN!, null, 50, 10]]);
    ids.C = await indent('Sports', teacher, [
      [ids.PEN!, null, 30, 12],
      [null, 'Football size 5', 10, 500],
    ]);
    const cand = (await call(office, 'GET', '/purchase/requisition-candidates')).json();
    expect(cand.data.map((x: { id: string }) => x.id).sort()).toEqual([ids.A, ids.B, ids.C].sort());
    expect(
      (await call(teacher, 'POST', '/purchase/requisitions', { indentIds: [ids.A] })).statusCode,
    ).toBe(403);
    // a combined PR needs the purchase office's department
    const no = await call(office, 'POST', '/purchase/requisitions', {
      indentIds: [ids.A, ids.B, ids.C],
    });
    expect(no.statusCode).toBe(409);
    expect(no.json().type).toBe('purchase.no_purchase_department');
    await withMigrator((c) =>
      c.query(`UPDATE purchase_settings SET purchase_department_id = $2 WHERE school_id = $1`, [
        school.id,
        ids.Administration,
      ]),
    );
    const r = await call(office, 'POST', '/purchase/requisitions', {
      indentIds: [ids.A, ids.B, ids.C],
    });
    expect(r.statusCode).toBe(201);
    ids.pr1 = r.json().id;
    const pr = await get(office, ids.pr1!);
    expect(pr).toMatchObject({
      combined: true,
      department: 'Administration',
      status: 'draft',
      tier: 'direct',
    });
    const pen = pr.lineItems.find((l: { itemId: string }) => l.itemId === ids.PEN);
    expect(pen.quantity).toBe(180);
    expect(pen.sources).toHaveLength(3);
    expect(pr.lineItems).toHaveLength(3);
    expect(
      (await call(office, 'GET', '/purchase/requisition-candidates')).json().data,
    ).toHaveLength(0);
    const pi = (await call(office, 'GET', `/purchase/indents/${ids.A!}`)).json();
    expect(pi).toMatchObject({ route: 'in_requisition' });
  });

  it('direct purchase: one vendor and the reasonable-price certificate, then the combined PR’s approvers', async () => {
    let sub = await call(office, 'POST', `/purchase/requisitions/${ids.pr1!}/submit`);
    expect(sub.statusCode).toBe(409);
    expect(missing(sub)).toEqual(expect.arrayContaining(['chosen', 'certificate']));
    const pr = await get(office, ids.pr1!);
    // no quote: the agreed rate is given; the pending vendor is refused
    const lines = pr.lineItems.map((l: { id: string }, i: number) => ({
      lineId: l.id,
      vendorId: ids.V2,
      rate: [9, 290, 480][i],
    }));
    expect(
      (
        await call(office, 'PUT', `/purchase/requisitions/${ids.pr1!}/choices`, {
          lines: [{ ...lines[0], vendorId: ids.V4 }],
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await call(office, 'PUT', `/purchase/requisitions/${ids.pr1!}/choices`, { lines }))
        .statusCode,
    ).toBe(200);
    sub = await call(office, 'POST', `/purchase/requisitions/${ids.pr1!}/submit`);
    expect(missing(sub)).toEqual(['certificate']);
    expect(
      (
        await call(office, 'PUT', `/purchase/requisitions/${ids.pr1!}/certificate`, {
          text: pr.certificateText,
        })
      ).statusCode,
    ).toBe(200);
    sub = await call(office, 'POST', `/purchase/requisitions/${ids.pr1!}/submit`);
    expect(sub.statusCode).toBe(201);
    expect(sub.json()).toMatchObject({
      tier: 'direct',
      number: expect.stringMatching(/^PR\/\d{4}-\d{2}\/\d{4}$/),
    });
    const after = await get(office, ids.pr1!);
    expect(after.waitingWith).toContain('Prem Principal');
    expect(after.estimate).toBe(180 * 9 + 20 * 290 + 10 * 480);
    expect(
      (
        await call(office, 'POST', `/purchase/requisitions/${ids.pr1!}/decide`, {
          action: 'approve',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call(principal, 'GET', '/purchase/requisitions?view=waiting')).json().waitingForMe,
    ).toBe(1);
    const done = (
      await call(principal, 'POST', `/purchase/requisitions/${ids.pr1!}/decide`, {
        action: 'approve',
      })
    ).json();
    expect(done).toMatchObject({ status: 'approved', can: { reopen: false } });
  });

  it('committee tier: three quotes, L1 and a reason for a dearer choice, two signatures cleared by a change', async () => {
    const r = await call(office, 'POST', '/purchase/requisitions', {
      departmentId: ids.Science,
      purpose: 'Chairs for the new lab',
      lines: [{ itemId: ids.CHAIR, quantity: 10, estRate: 12000 }],
    });
    ids.pr2 = r.json().id;
    let pr = await get(office, ids.pr2!);
    expect(pr).toMatchObject({ tier: 'committee', combined: false, department: 'Science' });
    const line = pr.lineItems[0].id as string;
    const quote = (vendor: string, rate: number) =>
      call(office, 'POST', `/purchase/requisitions/${ids.pr2!}/quotes`, {
        vendorId: vendor,
        quoteRef: `Q-${vendor}`,
        quoteDate: '2026-11-01',
        validUntil: '2027-03-31',
        deliveryDays: 15,
        lines: [{ lineId: line, rate }],
      });
    expect((await quote(ids.V1!, 11000)).statusCode).toBe(201);
    expect((await quote(ids.V2!, 12500)).statusCode).toBe(201);
    expect((await quote(ids.V4!, 9000)).statusCode).toBe(409);
    pr = await get(office, ids.pr2!);
    // the regular vendor charges the item's GST (18%): 12,980 a chair; the unregistered one none: L1
    expect(
      pr.quotes.find((q: { vendorId: string }) => q.vendorId === ids.V1).lines[0],
    ).toMatchObject({ gstRate: 18, landed: 12980 });
    expect(pr.lineItems[0].l1).toEqual({ landed: 12500, vendorIds: [ids.V2] });
    const dear = await call(office, 'PUT', `/purchase/requisitions/${ids.pr2!}/choices`, {
      lines: [{ lineId: line, vendorId: ids.V1 }],
    });
    expect(dear.statusCode).toBe(400);
    expect(dear.json().type).toBe('purchase.choice_reason');
    expect(
      (
        await call(office, 'PUT', `/purchase/requisitions/${ids.pr2!}/choices`, {
          lines: [
            {
              lineId: line,
              vendorId: ids.V1,
              reason: 'Five-year warranty; the cheaper chair failed last year',
            },
          ],
        })
      ).statusCode,
    ).toBe(200);
    let sub = await call(office, 'POST', `/purchase/requisitions/${ids.pr2!}/submit`);
    expect(missing(sub)).toEqual(expect.arrayContaining(['quotes', 'signatures']));
    expect(missing(sub)).not.toContain('reasons');
    expect((await quote(ids.V3!, 12800)).statusCode).toBe(201);
    // the committee signs; someone not on it cannot
    expect(
      (await call(teacher, 'POST', `/purchase/requisitions/${ids.pr2!}/sign`, {})).statusCode,
    ).toBe(404);
    expect((await call(c1, 'GET', '/purchase/requisitions?view=sign')).json().toSign).toBe(1);
    expect((await call(c1, 'POST', `/purchase/requisitions/${ids.pr2!}/sign`, {})).statusCode).toBe(
      201,
    );
    expect(
      (await call(c2, 'POST', `/purchase/requisitions/${ids.pr2!}/sign`, { note: 'Agreed' }))
        .statusCode,
    ).toBe(201);
    // the choice changes to L1: the signatures go
    await call(office, 'PUT', `/purchase/requisitions/${ids.pr2!}/choices`, {
      lines: [{ lineId: line, vendorId: ids.V2 }],
    });
    pr = await get(office, ids.pr2!);
    expect(
      pr.committee.members.filter((m: { signedAt: string | null }) => m.signedAt),
    ).toHaveLength(0);
    expect(pr.lineItems[0]).toMatchObject({
      vendorId: ids.V2,
      rate: 12500,
      gstRate: 0,
      dearer: false,
      choiceReason: null,
    });
    sub = await call(office, 'POST', `/purchase/requisitions/${ids.pr2!}/submit`);
    expect(missing(sub)).toEqual(['signatures']);
    await call(c1, 'POST', `/purchase/requisitions/${ids.pr2!}/sign`, {});
    await call(c3, 'POST', `/purchase/requisitions/${ids.pr2!}/sign`, {});
    sub = await call(office, 'POST', `/purchase/requisitions/${ids.pr2!}/submit`);
    expect(sub.statusCode).toBe(201);
    expect(sub.json().tier).toBe('committee');
    expect(
      (
        await call(hod, 'POST', `/purchase/requisitions/${ids.pr2!}/decide`, { action: 'approve' })
      ).json(),
    ).toMatchObject({
      status: 'approved',
    });
  });

  it('tender: the reference and its documents; the larger of the estimate and the chosen rates sets the tier', async () => {
    const r = await call(office, 'POST', '/purchase/requisitions', {
      departmentId: ids.Science,
      purpose: 'Furniture for the new block',
      lines: [{ itemId: ids.CHAIR, quantity: 40, estRate: 10000 }],
    });
    ids.pr3 = r.json().id;
    const pr = await get(office, ids.pr3!);
    await call(office, 'PUT', `/purchase/requisitions/${ids.pr3!}/choices`, {
      lines: [{ lineId: pr.lineItems[0].id, vendorId: ids.V3, rate: 6000 }],
    });
    let sub = await call(office, 'POST', `/purchase/requisitions/${ids.pr3!}/submit`);
    expect(missing(sub)).toEqual(['tender_ref', 'tender_files']);
    expect((await get(office, ids.pr3!)).tier).toBe('tender');
    await call(office, 'PUT', `/purchase/requisitions/${ids.pr3!}/tender`, {
      tenderRef: 'GeM/2026/B/123456',
    });
    expect(
      (
        await call(office, 'POST', `/purchase/requisitions/${ids.pr3!}/files`, {
          fileId: ids.file,
          kind: 'tender',
        })
      ).statusCode,
    ).toBe(201);
    sub = await call(office, 'POST', `/purchase/requisitions/${ids.pr3!}/submit`);
    expect(sub.statusCode).toBe(201);
    expect(sub.json().tier).toBe('tender');
    // the approver sends it back; the office changes it and it is no longer submitted
    expect(
      (
        await call(hod, 'POST', `/purchase/requisitions/${ids.pr3!}/decide`, {
          action: 'send_back',
          note: 'Only 30 chairs',
        })
      ).json(),
    ).toMatchObject({
      status: 'sent_back',
      decisionNote: 'Only 30 chairs',
    });
  });

  it('a line from the store closes its indent on approval; rejecting or cancelling gives the indents back', async () => {
    ids.D = await indent('Science', teacher, [[ids.PAPER!, null, 5, 300]]);
    const r = await call(office, 'POST', '/purchase/requisitions', { indentIds: [ids.D] });
    ids.pr4 = r.json().id;
    const pr = await get(office, ids.pr4!);
    const line = pr.lineItems[0];
    const bad = await call(office, 'PUT', `/purchase/requisitions/${ids.pr4!}`, {
      purpose: pr.purpose,
      lines: [{ id: line.id, quantity: 5, fulfil: 'store' }],
    });
    expect(bad.statusCode).toBe(400);
    // a kept-in-stock item comes from a store holding it: 8 reams in the main store
    const main = (await call(office, 'GET', '/purchase/stores')).json().data[0].id as string;
    await call(office, 'POST', `/purchase/stores/${main}/opening`, {
      lines: [{ itemId: ids.PAPER, qty: 8, rate: 250 }],
    });
    expect(
      (
        await call(office, 'PUT', `/purchase/requisitions/${ids.pr4!}`, {
          purpose: pr.purpose,
          lines: [{ id: line.id, quantity: 5, fulfil: 'store', storeId: main }],
        })
      ).statusCode,
    ).toBe(200);
    // a line from an indent cannot be dropped
    expect(
      (
        await call(office, 'PUT', `/purchase/requisitions/${ids.pr4!}`, {
          purpose: pr.purpose,
          lines: [{ itemId: ids.PEN, quantity: 1 }],
        })
      ).statusCode,
    ).toBe(400);
    expect((await get(office, ids.pr4!)).tier).toBe('none');
    expect(
      (await call(office, 'POST', `/purchase/requisitions/${ids.pr4!}/submit`)).statusCode,
    ).toBe(201);
    await call(hod, 'POST', `/purchase/requisitions/${ids.pr4!}/decide`, { action: 'approve' });
    expect((await call(office, 'GET', `/purchase/indents/${ids.D!}`)).json()).toMatchObject({
      route: 'closed',
      bypassNote: expect.stringContaining('From the store'),
    });
    // rejected: its indent waits for a PR again, with why
    ids.E = await indent('Science', teacher, [[ids.PEN!, null, 10, 10]]);
    ids.pr5 = (
      await call(office, 'POST', '/purchase/requisitions', { indentIds: [ids.E] })
    ).json().id;
    const p5 = await get(office, ids.pr5!);
    await call(office, 'PUT', `/purchase/requisitions/${ids.pr5!}/choices`, {
      lines: [{ lineId: p5.lineItems[0].id, vendorId: ids.V2, rate: 10 }],
    });
    await call(office, 'PUT', `/purchase/requisitions/${ids.pr5!}/certificate`, {
      text: p5.certificateText,
    });
    await call(office, 'POST', `/purchase/requisitions/${ids.pr5!}/submit`);
    expect(
      (await call(hod, 'POST', `/purchase/requisitions/${ids.pr5!}/decide`, { action: 'reject' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call(hod, 'POST', `/purchase/requisitions/${ids.pr5!}/decide`, {
          action: 'reject',
          note: 'Pens are in stock',
        })
      ).json(),
    ).toMatchObject({ status: 'rejected' });
    expect((await call(office, 'GET', `/purchase/indents/${ids.E!}`)).json()).toMatchObject({
      route: 'to_requisition',
      bypassNote: expect.stringContaining('Pens are in stock'),
    });
    // the office closes the indent it will not buy
    expect(
      (await call(teacher, 'POST', `/purchase/indents/${ids.E!}/close`, { reason: 'In stock' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call(office, 'POST', `/purchase/indents/${ids.E!}/close`, {
          reason: 'In stock: issued',
        })
      ).statusCode,
    ).toBe(201);
    expect((await call(office, 'GET', `/purchase/indents/${ids.E!}`)).json().route).toBe('closed');
    // cancelled: the same
    ids.F = await indent('Science', teacher, [[ids.PEN!, null, 3, 10]]);
    ids.pr6 = (
      await call(office, 'POST', '/purchase/requisitions', { indentIds: [ids.F] })
    ).json().id;
    expect(
      (
        await call(office, 'POST', `/purchase/requisitions/${ids.pr6!}/cancel`, {
          reason: 'Made by mistake',
        })
      ).json(),
    ).toMatchObject({
      cancelled: true,
      indentsReleased: 1,
    });
    expect((await call(office, 'GET', `/purchase/indents/${ids.F!}`)).json().route).toBe(
      'to_requisition',
    );
  });

  it('an approved PR reopened goes back to draft (approved again when sent); who sees what', async () => {
    const r = await call(office, 'POST', `/purchase/requisitions/${ids.pr2!}/reopen`, {
      reason: 'The vendor raised the price',
    });
    expect(r.json()).toMatchObject({ revision: 1 });
    expect((await get(office, ids.pr2!)).status).toBe('draft');
    // the purchase office sees them all; an approver theirs; a committee member the committee's; others none
    expect((await call(office, 'GET', '/purchase/requisitions')).json().total).toBe(6);
    expect((await call(hod, 'GET', '/purchase/requisitions')).json().total).toBeGreaterThanOrEqual(
      3,
    );
    expect(
      (await call(c2, 'GET', '/purchase/requisitions'))
        .json()
        .data.map((x: { id: string }) => x.id),
    ).toContain(ids.pr2);
    // the raiser of an indent follows the requisitions it is on (read-only)
    const mine = (await call(teacher, 'GET', '/purchase/requisitions')).json();
    expect(mine.data.map((x: { id: string }) => x.id).sort()).toEqual([ids.pr1, ids.pr4].sort());
    expect((await get(teacher, ids.pr1!)).can).toMatchObject({
      edit: false,
      decide: false,
      sign: false,
    });
    expect((await call(teacher, 'GET', `/purchase/requisitions/${ids.pr3!}`)).statusCode).toBe(404);
    expect(
      (
        await call(teacher, 'PUT', `/purchase/requisitions/${ids.pr2!}`, {
          purpose: 'x',
          lines: [],
        })
      ).statusCode,
    ).toBe(403);
  });
  it('a rate contract: the line starts on it, needs no quote and stays out of the band; dearer needs a reason', async () => {
    await withMigrator((c) =>
      c.query(
        `INSERT INTO purchase_rate_contracts (school_id, vendor_id, item_id, rate, valid_from, valid_to)
         VALUES ($1, $2, $3, 8.50, CURRENT_DATE - 30, CURRENT_DATE + 300)`,
        [school.id, ids.V1, ids.PEN],
      ),
    );
    ids.G = await indent('Science', teacher, [
      [ids.PEN!, null, 100, 9],
      [ids.PAPER!, null, 5, 300],
    ]);
    const made = await call(office, 'POST', '/purchase/requisitions', { indentIds: [ids.G] });
    expect(made.statusCode).toBe(201);
    const id = made.json().id as string;
    ids.prG = id;
    let pr = await get(office, id);
    const pen = () => pr.lineItems.find((l: { itemId: string }) => l.itemId === ids.PEN);
    // the pens start on the contract: its vendor, rate and the GST a regular vendor charges
    expect(pen()).toMatchObject({
      vendorId: ids.V1,
      rate: 8.5,
      gstRate: 18,
      fromContract: true,
      contractInForce: true,
      contract: { vendorId: ids.V1, rate: 8.5, landed: 10.03 },
    });
    // only the paper (5 x 300) sets the band
    expect(pr).toMatchObject({ tier: 'direct', value: 1500, contractValue: 850 });
    const line = pen().id as string;
    const choose = (x: Record<string, unknown>) =>
      call(office, 'PUT', `/purchase/requisitions/${id}/choices`, {
        lines: [{ lineId: line, ...x }],
      });
    // another vendor dearer than the contract (with GST): the reason
    const dear = await choose({ vendorId: ids.V2, rate: 11 });
    expect(dear.statusCode).toBe(400);
    expect(dear.json().type).toBe('purchase.choice_reason');
    expect(
      (await choose({ vendorId: ids.V2, rate: 11, reason: 'The contract vendor is out of stock' }))
        .statusCode,
    ).toBe(200);
    pr = await get(office, id);
    expect(pen()).toMatchObject({
      vendorId: ids.V2,
      fromContract: false,
      aboveContract: true,
      choiceReason: 'The contract vendor is out of stock',
    });
    // off the contract the line joins the band
    expect(pr.value).toBe(2600);
    // cheaper than the contract: no reason
    expect((await choose({ vendorId: ids.V2, rate: 9 })).statusCode).toBe(200);
    pr = await get(office, id);
    expect(pen()).toMatchObject({ aboveContract: false, choiceReason: null });
    // back on the contract: picked, or its vendor named without a rate
    expect((await choose({ useContract: true })).statusCode).toBe(200);
    pr = await get(office, id);
    expect(pen()).toMatchObject({ vendorId: ids.V1, rate: 8.5, fromContract: true });
    await choose({ vendorId: ids.V2, rate: 9 });
    expect((await choose({ vendorId: ids.V1 })).statusCode).toBe(200);
    pr = await get(office, id);
    expect(pen()).toMatchObject({ fromContract: true, rate: 8.5 });
    // no contract for the paper: asking for one is refused
    const paper = pr.lineItems.find((l: { itemId: string }) => l.itemId === ids.PAPER).id as string;
    expect(
      (
        await call(office, 'PUT', `/purchase/requisitions/${id}/choices`, {
          lines: [{ lineId: paper, useContract: true }],
        })
      ).statusCode,
    ).toBe(400);
    // a PR of contract lines only: nothing to source, sent without a certificate or quotes
    ids.H = await indent('Science', teacher, [[ids.PEN!, null, 40, 9]]);
    const only = (
      await call(office, 'POST', '/purchase/requisitions', { indentIds: [ids.H] })
    ).json().id as string;
    expect((await get(office, only)).tier).toBe('none');
    const sent = await call(office, 'POST', `/purchase/requisitions/${only}/submit`);
    expect(sent.statusCode).toBe(201);
    expect((await get(hod, only)).lineItems[0]).toMatchObject({ fromContract: true, rate: 8.5 });
  });
  it('the list filters by indent, vendor, department and dates; its file; the printed PR', async () => {
    const book = async (b64: string) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(b64, 'base64') as unknown as ExcelJS.Buffer);
      return wb;
    };
    // the letterhead's four lines, a blank row, then the column heads
    const heads = (ws: ExcelJS.Worksheet) =>
      (ws.getRow(6).values as unknown[]).filter((v) => typeof v === 'string') as string[];
    const pi = (
      await withMigrator((c) =>
        c.query<{ number: string }>(`SELECT number FROM purchase_indents WHERE id = $1`, [ids.G]),
      )
    ).rows[0]!.number;
    const list = async (qs: string) =>
      (await call(office, 'GET', `/purchase/requisitions?${qs}`))
        .json()
        .data.map((x: { id: string }) => x.id) as string[];
    expect(await list(`indent=${encodeURIComponent(pi)}`)).toEqual([ids.prG]);
    expect(await list(`vendorId=${ids.V1!}`)).toContain(ids.prG);
    expect(await list(`departmentId=${ids.Science!}`)).toContain(ids.prG);
    expect(await list(`departmentId=${ids.Sports!}`)).not.toContain(ids.prG);
    expect(await list('from=2099-01-01')).toEqual([]);
    const f = await call(
      office,
      'GET',
      `/purchase/requisitions/export?format=xlsx&indent=${encodeURIComponent(pi)}`,
    );
    expect(f.statusCode).toBe(200);
    const wb = await book(f.json().base64 as string);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Purchase Requisitions', 'Lines']);
    expect(String(wb.worksheets[0]!.getRow(4).getCell(1).value)).toContain(`Indent: ${pi}`);
    const lines = wb.worksheets[1]!;
    const col = heads(lines).indexOf('On rate contract') + 1;
    const flags: string[] = [];
    lines.eachRow((r, n) => {
      if (n > 6) flags.push(String(r.getCell(col).value ?? ''));
    });
    expect(flags).toContain('Yes');
    expect(
      (await call(office, 'GET', '/purchase/requisitions/export?format=pdf')).json().filename,
    ).toMatch(/\.pdf$/);
    // the printed PR: those who may see it (the indent's raiser too); not someone else
    const pdf = await call(teacher, 'GET', `/purchase/requisitions/${ids.prG!}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await call(c3, 'GET', `/purchase/requisitions/${ids.prG!}/pdf`)).statusCode).toBe(404);
  });
  it('a direct requisition by the purchase office within the limit is approved by the system; over it or split it needs approval', async () => {
    // only the direct right makes a direct requisition (a school admin without it is refused)
    const admin2 = await withMigrator((c) => seedUser(c, school, `${s}-adm2`, 'school_admin'));
    const make = (u: SeededUser, qty: number) =>
      call(u, 'POST', '/purchase/requisitions', {
        departmentId: ids.Science,
        purpose: 'Office paper',
        lines: [{ itemId: ids.PAPER, quantity: qty, estRate: 300 }],
      });
    expect((await make(admin2, 1)).statusCode).toBe(403);
    const ready = async (qty: number) => {
      const id = (await make(office, qty)).json().id as string;
      const pr = await get(office, id);
      await call(office, 'PUT', `/purchase/requisitions/${id}/choices`, {
        lines: [{ lineId: pr.lineItems[0].id, vendorId: ids.V2, rate: 290 }],
      });
      await call(office, 'PUT', `/purchase/requisitions/${id}/certificate`, {
        text: pr.certificateText,
      });
      return id;
    };
    // within the limit (default 50,000): sending approves it by the system; the draft PO at once
    const small = await ready(10);
    expect((await get(office, small)).noApproval).toEqual({ limit: 50000, applies: true });
    const sent = await call(office, 'POST', `/purchase/requisitions/${small}/submit`);
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ approvedBySystem: true });
    const done = await get(office, small);
    expect(done).toMatchObject({ status: 'approved', direct: true, steps: [] });
    expect(done.noApprovalNote).toContain('within the limit of ₹50,000');
    expect(done.orders).toHaveLength(1);
    // the split check: with it, a second of the same category goes over a 5,000 limit
    await withMigrator((c) =>
      c.query(`UPDATE purchase_settings SET direct_pr_limit = 5000 WHERE school_id = $1`, [
        school.id,
      ]),
    );
    const split = await ready(10);
    const second = (await call(office, 'POST', `/purchase/requisitions/${split}/submit`)).json();
    expect(second.approvedBySystem).toBe(false);
    expect(second.note).toContain('Sent for approval: with');
    expect((await get(office, split)).status).toBe('submitted');
    // over the limit
    await withMigrator((c) =>
      c.query(`UPDATE purchase_settings SET direct_pr_limit = 1000 WHERE school_id = $1`, [
        school.id,
      ]),
    );
    const big = await ready(10);
    const third = (await call(office, 'POST', `/purchase/requisitions/${big}/submit`)).json();
    expect(third).toMatchObject({ approvedBySystem: false });
    expect(third.note).toContain('over the limit');
    // a PR from indents is never approved this way
    expect(((await get(office, ids.prG!)) as { direct: boolean }).direct).toBe(false);
    await withMigrator((c) =>
      c.query(`UPDATE purchase_settings SET direct_pr_limit = 50000 WHERE school_id = $1`, [
        school.id,
      ]),
    );
  });
});
