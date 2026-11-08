/**
 * Purchase, part 2 (docs/design/83): the Purchase Indent on the workflow engine — the department's PI
 * levels (HOD, then everyone with the Principal designation), nobody approving their own (their level
 * passes on; the last to the school admin), send back and resubmit, reject with a reason, a purchase-only
 * delegation, withdrawing, no approvers set, and the bypass rules: every line on a rate contract, under
 * the department's limit, and the split-indent guard; rates hidden from the raiser (approvers and the
 * purchase office see them), the stores' free stock when raised, a reason when they can cover the
 * quantity, and the printed PI.
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

describe('purchase indents (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let hod: SeededUser;
  let principal: SeededUser;
  let deputy: SeededUser;
  let outsider: SeededUser;
  const ids: Record<string, string> = {};
  const s = stamp('PI');
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
  const raise = async (u: SeededUser, lines: unknown[], extra: Record<string, unknown> = {}) => {
    const r = await call(u, 'POST', '/purchase/indents', {
      purpose: 'For the lab',
      lines,
      ...extra,
    });
    expect(r.statusCode).toBe(201);
    return r.json().id as string;
  };
  const decide = (u: SeededUser, id: string, action: string, note?: string) =>
    call(u, 'POST', `/purchase/indents/${id}/decide`, { action, ...(note ? { note } : {}) });
  const get = async (u: SeededUser, id: string) =>
    (await call(u, 'GET', `/purchase/indents/${id}`)).json();

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-t`, 'subject_teacher');
      hod = await seedUser(c, school, `${s}-hod`, 'subject_teacher');
      principal = await seedUser(c, school, `${s}-pr`, 'class_teacher');
      deputy = await seedUser(c, school, `${s}-dep`, 'subject_teacher');
      outsider = await seedUser(c, school, `${s}-out`);
      for (const [code, name, designation, dept, u] of [
        ['T1', 'Tara Teacher', 'TGT', 'Science', teacher],
        ['H1', 'Hari Head', 'PGT', 'Science', hod],
        ['P1', 'Prem Principal', 'Principal', 'Science', principal],
        ['D1', 'Dev Deputy', 'PGT', 'Science', deputy],
        ['A1', 'Asha Admin', 'Office Assistant', 'Administration', admin],
      ] as const) {
        const e = await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, department, user_id)
           VALUES ($1, $2, $3, 'E2E', $4, $5, $6) RETURNING id::text`,
          [school.id, `${s}${code}`, name, designation, dept, u.id],
        );
        ids[code] = e.rows[0]!.id;
      }
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      await c.query(`SELECT app.purchase_seed_masters($1)`, [school.id]);
      ids.science = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM departments WHERE school_id = $1 AND name = 'Science'`,
          [school.id],
        )
      ).rows[0]!.id;
      ids.admin_dept = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM departments WHERE school_id = $1 AND name = 'Administration'`,
          [school.id],
        )
      ).rows[0]!.id;
      await c.query(`UPDATE departments SET hod_employee_id = $2 WHERE id = $1`, [
        ids.science,
        ids.H1,
      ]);
      const cat = await c.query<{ id: string }>(
        `INSERT INTO purchase_item_categories (school_id, code, name) VALUES ($1, 'STAT', 'Stationery') RETURNING id::text`,
        [school.id],
      );
      for (const [code, name] of [
        ['PEN', 'Ball pen'],
        ['PAPER', 'A4 paper ream'],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO purchase_items (school_id, code, name, item_type, category_id, uom_id)
             SELECT $1, $2, $3, 'consumable', $4, id FROM purchase_uoms WHERE school_id = $1 AND code = 'NOS' RETURNING id::text`,
            [school.id, code, name, cat.rows[0]!.id],
          )
        ).rows[0]!.id;
      ids.vendor = (
        await c.query<{ id: string }>(
          `INSERT INTO vendors (school_id, code, legal_name, gst_status, state_code, status) VALUES ($1, 'V1', 'Pen House', 'unregistered', '27', 'active') RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO purchase_rate_contracts (school_id, vendor_id, item_id, rate, valid_from, valid_to)
         VALUES ($1, $2, $3, 8.50, CURRENT_DATE - 30, CURRENT_DATE + 300)`,
        [school.id, ids.vendor, ids.PEN],
      );
      await c.query(`UPDATE purchase_items SET last_purchase_rate = 300 WHERE id = $1`, [
        ids.PAPER,
      ]);
    });
    app = await createApp();
    inject = injector(app);
    // Science: the HOD, then everyone with the Principal designation; skips the PR under ₹1,000 or on contract
    expect(
      (
        await call(admin, 'PUT', `/purchase/approvals/${ids.science!}/indent`, {
          levels: [
            { name: 'HOD', by: 'hod', slaHours: 48 },
            { name: 'Principal', by: 'designation', designation: 'Principal' },
          ],
        })
      ).statusCode,
    ).toBe(200);
    await call(admin, 'PUT', `/purchase/approvals/${ids.science!}/rules`, {
      bypassLimit: 1000,
      rateContractBypass: true,
    });
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('raises a draft for the raiser’s own department, priced from the contract; the raiser sees no rates', async () => {
    const form = (await call(teacher, 'GET', '/purchase/indent-form')).json();
    expect(form.departments).toEqual([{ id: ids.science, name: 'Science' }]);
    expect(form.showRates).toBe(false);
    expect(form.items.find((x: { code: string }) => x.code === 'PEN')).toMatchObject({
      contractRate: null,
      contractVendor: null,
      lastRate: null,
    });
    const office = (await call(admin, 'GET', '/purchase/indent-form')).json();
    expect(office.showRates).toBe(true);
    expect(office.items.find((x: { code: string }) => x.code === 'PEN')).toMatchObject({
      contractRate: 8.5,
      contractVendor: 'Pen House',
    });
    expect(
      (await call(outsider, 'POST', '/purchase/indents', { purpose: 'x', lines: [] })).statusCode,
    ).toBe(403);
    expect(
      (
        await call(teacher, 'POST', '/purchase/indents', {
          purpose: 'Other dept',
          departmentId: ids.admin_dept,
          lines: [{ itemId: ids.PEN, quantity: 1 }],
        })
      ).statusCode,
    ).toBe(403);
    const nos = form.uoms.find((u: { code: string }) => u.code === 'NOS').id as string;
    const id = await raise(teacher, [
      { itemId: ids.PEN, quantity: 10 },
      { freeText: 'Bunsen burner', quantity: 2, uomId: nos, estRate: 150 },
    ]);
    const pi = await get(teacher, id);
    expect(pi).toMatchObject({
      status: 'draft',
      number: null,
      estimate: null,
      showRates: false,
      departmentSpendThisYear: null,
      department: 'Science',
    });
    expect(pi.lineItems[0]).toMatchObject({ estRate: null, amount: null, rateSource: null });
    // the purchase office sees the estimate: the contract's rate; the raiser's typed rate is ignored
    const seen = await get(admin, id);
    expect(seen).toMatchObject({ estimate: 85, showRates: true });
    expect(seen.lineItems[0]).toMatchObject({
      rateSource: 'contract',
      estRate: 8.5,
      amount: 85,
      contractVendor: 'Pen House',
    });
    expect(seen.lineItems[1]).toMatchObject({
      inCatalogue: false,
      item: 'Bunsen burner',
      rateSource: 'typed',
      estRate: 0,
    });
    ids.draft = id;
  });

  it('goes up the levels: HOD, then the Principal; under the limit it skips the PR (a PR approved by the system)', async () => {
    const id = await raise(teacher, [{ itemId: ids.PAPER, quantity: 2 }]);
    const sub = (await call(teacher, 'POST', `/purchase/indents/${id}/submit`)).json();
    expect(sub.number).toMatch(/^PI\/\d{4}-\d{2}\/\d{4}$/);
    expect((await get(teacher, id)).waitingWith).toContain('Hari Head');
    // the raiser does not decide; someone else not on the level neither
    expect((await decide(teacher, id, 'approve')).statusCode).toBe(403);
    expect((await decide(deputy, id, 'approve')).statusCode).toBe(403);
    expect(
      (await call(hod, 'GET', '/purchase/indents?view=waiting'))
        .json()
        .data.map((x: { id: string }) => x.id),
    ).toContain(id);
    expect((await decide(hod, id, 'approve')).statusCode).toBe(201);
    expect((await get(teacher, id)).waitingWith).toContain('Prem Principal');
    const done = (await decide(principal, id, 'approve')).json();
    expect(done).toMatchObject({
      status: 'approved',
      route: 'to_order',
      bypassRule: 'under_limit',
    });
    expect(done.bypassNote).toContain('within Science');
    expect(done.requisitions).toEqual([
      expect.objectContaining({ autoRule: 'under_limit', status: 'approved' }),
    ]);
    ids.firstUnder = id;
  });

  it('the split-indent guard: a second small PI of the same category in the window goes to the PR', async () => {
    const id = await raise(teacher, [{ itemId: ids.PAPER, quantity: 2 }]);
    await call(teacher, 'POST', `/purchase/indents/${id}/submit`);
    await decide(hod, id, 'approve');
    const done = (await decide(principal, id, 'approve')).json();
    expect(done).toMatchObject({
      status: 'approved',
      route: 'to_requisition',
      bypassRule: null,
      requisitions: [],
    });
    expect(done.bypassNote).toContain('Not skipped');
    expect(done.bypassNote).toContain('₹1,200');
  });

  it('every line on a rate contract: the PR carries the contract vendor and rate', async () => {
    const id = await raise(teacher, [{ itemId: ids.PEN, quantity: 200 }]);
    await call(teacher, 'POST', `/purchase/indents/${id}/submit`);
    await decide(hod, id, 'approve');
    const done = (await decide(principal, id, 'approve')).json();
    expect(done).toMatchObject({ route: 'to_order', bypassRule: 'rate_contract', estimate: 1700 });
    const line = await withMigrator(
      async (c) =>
        (
          await c.query<{ vendor_id: string; rate: string }>(
            `SELECT rl.vendor_id::text, rl.rate::text FROM purchase_requisition_lines rl JOIN purchase_requisitions r ON r.id = rl.requisition_id
            WHERE r.id = $1`,
            [done.requisitions[0].id],
          )
        ).rows[0],
    );
    expect(line).toEqual({ vendor_id: ids.vendor, rate: '8.50' });
  });

  it('nobody approves their own: the HOD’s level passes on; the Principal’s last level goes to the school admin', async () => {
    const byHod = await raise(hod, [{ itemId: ids.PAPER, quantity: 10 }]);
    await call(hod, 'POST', `/purchase/indents/${byHod}/submit`);
    let pi = await get(hod, byHod);
    expect(pi.steps[0]).toMatchObject({
      status: 'skipped',
      note: expect.stringContaining('nobody approves their own'),
    });
    expect(pi.waitingWith).toContain('Prem Principal');
    expect((await decide(principal, byHod, 'approve')).json()).toMatchObject({
      status: 'approved',
      route: 'to_requisition',
    });
    const byPrincipal = await raise(principal, [{ itemId: ids.PAPER, quantity: 10 }]);
    await call(principal, 'POST', `/purchase/indents/${byPrincipal}/submit`);
    await decide(hod, byPrincipal, 'approve');
    pi = await get(principal, byPrincipal);
    expect(pi.waitingWith).toContain('Asha Admin');
    expect((await decide(principal, byPrincipal, 'approve')).statusCode).toBe(403);
    expect((await decide(admin, byPrincipal, 'approve')).json()).toMatchObject({
      status: 'approved',
    });
  });

  it('sends back for changes and resubmits; rejects only with a reason', async () => {
    const id = await raise(teacher, [{ itemId: ids.PAPER, quantity: 50 }]);
    await call(teacher, 'POST', `/purchase/indents/${id}/submit`);
    expect((await decide(hod, id, 'send_back')).statusCode).toBe(400);
    expect((await decide(hod, id, 'send_back', 'Order 30 only')).json()).toMatchObject({
      status: 'sent_back',
      decisionNote: 'Order 30 only',
    });
    const edit = await call(teacher, 'PUT', `/purchase/indents/${id}`, {
      purpose: 'For the lab',
      lines: [{ itemId: ids.PAPER, quantity: 30 }],
    });
    expect(edit.statusCode).toBe(200);
    await call(teacher, 'POST', `/purchase/indents/${id}/submit`);
    const again = await get(hod, id);
    expect(again).toMatchObject({ status: 'submitted', estimate: 9000 });
    expect(again.history.map((h: { kind: string }) => h.kind)).toEqual(
      expect.arrayContaining(['cancelled', 'started']),
    );
    expect((await decide(hod, id, 'reject')).statusCode).toBe(400);
    expect((await decide(hod, id, 'reject', 'Not in the budget')).json()).toMatchObject({
      status: 'rejected',
      decisionNote: 'Not in the budget',
    });
  });

  it('a purchase-only delegation: the deputy approves on the HOD’s behalf for those days', async () => {
    const id = await raise(teacher, [{ itemId: ids.PAPER, quantity: 40 }]);
    await call(teacher, 'POST', `/purchase/indents/${id}/submit`);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const d = await call(hod, 'POST', '/purchase/delegations', {
      toEmployeeId: ids.D1,
      startsOn: today,
      endsOn: today,
      reason: 'On leave',
    });
    expect(d.json()).toMatchObject({ to: 'Dev Deputy E2E' });
    // only the school admin hands over someone else's approvals
    expect(
      (
        await call(teacher, 'POST', '/purchase/delegations', {
          fromUserId: hod.id,
          toEmployeeId: ids.T1,
          startsOn: today,
          endsOn: today,
          reason: 'x y z',
        })
      ).statusCode,
    ).toBe(403);
    expect((await decide(deputy, id, 'approve')).statusCode).toBe(201);
    const pi = await get(teacher, id);
    expect(pi.history.some((h: { kind: string }) => h.kind === 'delegated')).toBe(true);
    expect((await call(hod, 'GET', '/purchase/delegations')).json().data[0]).toMatchObject({
      active: true,
      mine: true,
    });
    expect(
      (await call(hod, 'DELETE', `/purchase/delegations/${d.json().id as string}`)).statusCode,
    ).toBe(200);
  });

  it('withdraws before anyone approves; a department without levels cannot submit', async () => {
    const id = await raise(teacher, [{ itemId: ids.PAPER, quantity: 3 }]);
    await call(teacher, 'POST', `/purchase/indents/${id}/submit`);
    expect(
      (await call(teacher, 'POST', `/purchase/indents/${id}/cancel`, { reason: 'Not needed now' }))
        .statusCode,
    ).toBe(201);
    expect((await get(teacher, id)).status).toBe('cancelled');
    const other = await call(admin, 'POST', '/purchase/indents', {
      purpose: 'Office paper',
      departmentId: ids.admin_dept,
      lines: [{ itemId: ids.PAPER, quantity: 1 }],
    });
    const r = await call(admin, 'POST', `/purchase/indents/${other.json().id as string}/submit`);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ type: 'purchase.no_approvers' });
    // the purchase office (view right) sees every department's; the outsider none
    expect((await call(admin, 'GET', '/purchase/indents')).json().total).toBeGreaterThanOrEqual(8);
    expect((await call(outsider, 'GET', '/purchase/indents')).json().total).toBe(0);
  });
  it('a level of several people may need all of them; the admin passes a stuck level', async () => {
    // Science: Hari and Dev must both approve, then the Principal
    expect(
      (
        await call(admin, 'PUT', `/purchase/approvals/${ids.science!}/indent`, {
          levels: [
            {
              name: 'Senior teachers',
              by: 'employees',
              employeeIds: [ids.H1, ids.D1],
              need: 'all',
            },
            { name: 'Principal', by: 'designation', designation: 'Principal' },
          ],
        })
      ).statusCode,
    ).toBe(200);
    const waiting = async (u: SeededUser) =>
      (await call(u, 'GET', '/purchase/indents?view=waiting'))
        .json()
        .data.map((x: { id: string }) => x.id) as string[];
    const id = await raise(teacher, [{ itemId: ids.PAPER, quantity: 4 }]);
    await call(teacher, 'POST', `/purchase/indents/${id}/submit`);
    expect(await waiting(hod)).toContain(id);
    expect(await waiting(deputy)).toContain(id);
    // one of them approves: the level waits for the other, and the first is not asked again
    expect((await decide(hod, id, 'approve')).statusCode).toBe(201);
    let pi = await get(teacher, id);
    expect(pi.status).toBe('submitted');
    expect(pi.steps[0]).toMatchObject({
      status: 'pending',
      need: 'all',
      approvedBy: [expect.objectContaining({ name: expect.stringContaining('') })],
    });
    expect(await waiting(hod)).not.toContain(id);
    expect(await waiting(deputy)).toContain(id);
    const twice = await decide(hod, id, 'approve');
    expect(twice.statusCode).toBe(403);
    // the second: the level passes; the Principal's turn
    expect((await decide(deputy, id, 'approve')).statusCode).toBe(201);
    pi = await get(teacher, id);
    expect(pi.steps[0].status).toBe('approved');
    expect(pi.waitingWith).toContain('Prem Principal');
    // the Principal is away: the admin passes the level, with the reason; others may not
    const step = pi.steps.find((x: { status: string }) => x.status === 'pending');
    expect(
      (await call(teacher, 'POST', `/purchase/steps/${step.id as string}/pass`, { reason: 'Away' }))
        .statusCode,
    ).toBe(403);
    const passed = await call(admin, 'POST', `/purchase/steps/${step.id as string}/pass`, {
      reason: 'The Principal is on leave',
    });
    expect(passed.statusCode).toBe(201);
    pi = await get(teacher, id);
    expect(pi.status).toBe('approved');
    expect(pi.steps[1].note).toBe('Passed for Prem Principal E2E: The Principal is on leave');
    // one rejection at a level that needs all rejects
    const second = await raise(teacher, [{ itemId: ids.PAPER, quantity: 5 }]);
    await call(teacher, 'POST', `/purchase/indents/${second}/submit`);
    expect((await decide(hod, second, 'approve')).statusCode).toBe(201);
    expect((await decide(deputy, second, 'reject', 'Too many reams this term')).statusCode).toBe(
      201,
    );
    expect((await get(teacher, second)).status).toBe('rejected');
    // nobody passes what they raised
    const own = await call(admin, 'POST', '/purchase/indents', {
      purpose: 'Science room paper',
      departmentId: ids.science,
      lines: [{ itemId: ids.PAPER, quantity: 1 }],
    });
    const ownId = own.json().id as string;
    await call(admin, 'POST', `/purchase/indents/${ownId}/submit`);
    const ownStep = (await get(admin, ownId)).steps.find(
      (x: { status: string }) => x.status === 'pending',
    );
    const self = await call(admin, 'POST', `/purchase/steps/${ownStep.id as string}/pass`, {
      reason: 'In a hurry',
    });
    expect(self.statusCode).toBe(403);
    expect(self.json().type).toBe('workflow.self_approval');
  });
  it('any employee who signs in raises a PI for their own department, even with no role', async () => {
    const plain = await withMigrator(async (c) => {
      const u = await seedUser(c, school, `${s}-plain`);
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, department, user_id)
         VALUES ($1, $2, 'Nina', 'E2E', 'Counsellor', 'Science', $3)`,
        [school.id, `${s}N1`, u.id],
      );
      return u;
    });
    const me = (await call(plain, 'GET', '/me')).json();
    expect(me.permissions).toEqual(['purchase.indent.raise']);
    const r = await call(plain, 'POST', '/purchase/indents', {
      purpose: 'Counselling room charts',
      lines: [{ itemId: ids.PAPER, quantity: 1 }],
    });
    expect(r.statusCode).toBe(201);
    expect(await get(plain, r.json().id as string)).toMatchObject({
      department: 'Science',
      status: 'draft',
    });
    // someone who is not an employee still has nothing
    expect((await call(outsider, 'GET', '/me')).json().permissions).toEqual([]);
  });

  it('the stores’ free stock when raised; a reason to buy new instead (optional); the printed PI; a line without a rate', async () => {
    await call(admin, 'PUT', `/purchase/approvals/${ids.science!}/indent`, {
      levels: [
        { name: 'HOD', by: 'hod' },
        { name: 'Principal', by: 'designation', designation: 'Principal' },
      ],
    });
    // pens: 45 free in the main store (5 held), 10 in Science's store, 99 in the office's (not Science's)
    const mainName = await withMigrator(async (c) => {
      await c.query(
        `INSERT INTO stores (school_id, code, name, kind) VALUES ($1, 'MAIN', 'Main store', 'main') ON CONFLICT DO NOTHING`,
        [school.id],
      );
      const main = (
        await c.query<{ id: string; name: string }>(
          `SELECT id::text, name FROM stores WHERE school_id = $1 AND kind = 'main'`,
          [school.id],
        )
      ).rows[0]!;
      const sub = async (code: string, name: string, dept: string) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO stores (school_id, code, name, kind, parent_id, department_id) VALUES ($1, $2, $3, 'sub', $4, $5) RETURNING id::text`,
            [school.id, code, name, main.id, dept],
          )
        ).rows[0]!.id;
      const lab = await sub('SCI', 'Science lab store', ids.science!);
      const office = await sub('ADM', 'Office store', ids.admin_dept!);
      for (const [store, qty, held] of [
        [main.id, 50, 5],
        [lab, 10, 0],
        [office, 99, 0],
      ] as const)
        await c.query(
          `INSERT INTO stock_balances (school_id, store_id, item_id, qty, reserved) VALUES ($1, $2, $3, $4, $5)`,
          [school.id, store, ids.PEN, qty, held],
        );
      return main.name;
    });
    const form = (await call(teacher, 'GET', '/purchase/indent-form')).json();
    const pen = form.items.find((x: { code: string }) => x.code === 'PEN');
    expect(pen).toMatchObject({ stockTracked: true, stockUom: 'NOS', perUnit: 1 });
    expect(pen.stock.map((x: { store: string; free: number }) => [x.store, x.free])).toEqual([
      [mainName, 45],
      ['Science lab store', 10],
    ]);
    const id = await raise(teacher, [{ itemId: ids.PEN, quantity: 40, estRate: 1 }]);
    const draft = await get(teacher, id);
    expect(draft.lineItems[0]).toMatchObject({ stockFree: 55, stockUom: 'NOS', estRate: null });
    expect(draft.lineItems[0].stockStores).toEqual([
      { store: mainName, free: 45 },
      { store: 'Science lab store', free: 10 },
    ]);
    expect(draft.can.print).toBe(false);
    expect((await call(teacher, 'GET', `/purchase/indents/${id}/pdf`)).statusCode).toBe(409);
    // 55 free covers 40: the store issues it once approved (docs/design/83, "served from stock"); a
    // reason, optional, has it bought new instead — this raiser gives one
    expect(
      (
        await call(teacher, 'PUT', `/purchase/indents/${id}`, {
          purpose: 'For the lab',
          lines: [{ itemId: ids.PEN, quantity: 40, stockReason: 'Blue ink; the store has black' }],
        })
      ).statusCode,
    ).toBe(200);
    expect((await call(teacher, 'POST', `/purchase/indents/${id}/submit`)).statusCode).toBe(201);
    const sent = await get(teacher, id);
    // the approval's title carries no amount (the raiser opens it too)
    const subject = await withMigrator(
      async (c) =>
        (
          await c.query<{ subject: string }>(
            `SELECT subject FROM workflow_instances WHERE id = $1`,
            [sent.workflowInstanceId],
          )
        ).rows[0]!.subject,
    );
    expect(subject).not.toContain('₹');
    // the HOD (an approver) sees the rates and the reason
    const forHod = await get(hod, id);
    expect(forHod).toMatchObject({ showRates: true, estimate: 340 });
    expect(forHod.lineItems[0]).toMatchObject({
      estRate: 8.5,
      stockFree: 55,
      stockReason: 'Blue ink; the store has black',
    });
    // printed once sent: the raiser, the approver; nobody else
    expect(sent.can.print).toBe(true);
    const pdf = await call(teacher, 'GET', `/purchase/indents/${id}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const saved = await call(hod, 'GET', `/purchase/indents/${id}/pdf?save=1`);
    expect(saved.headers['content-disposition']).toContain('attachment');
    expect((await call(outsider, 'GET', `/purchase/indents/${id}/pdf`)).statusCode).toBe(404);
    // the raiser reads an auto-approval without its amounts; the approver with them
    expect((await get(teacher, ids.firstUnder!)).bypassNote).toBe(
      "Auto-approved: within Science's limit",
    );
    expect((await get(principal, ids.firstUnder!)).bypassNote).toContain('₹600');
    // a line in words has no rate: under the limit it still goes to the PR
    const nos = form.uoms.find((u: { code: string }) => u.code === 'NOS').id as string;
    const words = await raise(teacher, [
      { freeText: 'Magnifying glass', quantity: 1, uomId: nos, estRate: 50 },
    ]);
    await call(teacher, 'POST', `/purchase/indents/${words}/submit`);
    await decide(hod, words, 'approve');
    const done = (await decide(principal, words, 'approve')).json();
    expect(done).toMatchObject({ route: 'to_requisition', bypassRule: null, estimate: 0 });
    expect(done.bypassNote).toContain('no rate yet');
  });
  it('the list filters by department and dates; its file keeps the filters; estimates only for those who see rates', async () => {
    const book = async (b64: string) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(b64, 'base64') as unknown as ExcelJS.Buffer);
      return wb;
    };
    // the letterhead's four lines, a blank row, then the column heads
    const heads = (ws: ExcelJS.Worksheet) =>
      (ws.getRow(6).values as unknown[]).filter((v) => typeof v === 'string') as string[];
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    expect((await call(admin, 'GET', '/purchase/indents?from=2099-01-01')).json().total).toBe(0);
    const sci = (
      await call(
        admin,
        'GET',
        `/purchase/indents?departmentId=${ids.science!}&from=${today}&to=${today}`,
      )
    ).json();
    expect(sci.total).toBeGreaterThan(0);
    expect(new Set(sci.data.map((x: { department: string }) => x.department))).toEqual(
      new Set(['Science']),
    );
    // the purchase office's file: the letterhead with the filters, the estimate, a sheet of lines
    const office = await call(
      admin,
      'GET',
      `/purchase/indents/export?format=xlsx&departmentId=${ids.science!}`,
    );
    expect(office.statusCode).toBe(200);
    expect(office.json().filename).toMatch(/^Purchase-Indents-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const wb = await book(office.json().base64 as string);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Purchase Indents', 'Lines']);
    expect(String(wb.worksheets[0]!.getRow(4).getCell(1).value)).toContain('Department: Science');
    expect(heads(wb.worksheets[0]!)).toContain('Estimate (₹)');
    expect(heads(wb.worksheets[1]!)).toEqual(
      expect.arrayContaining(['Item', 'Rate (₹)', 'In store when raised']),
    );
    // the raiser's file: no estimate, no rates
    const mine = await book(
      (await call(teacher, 'GET', '/purchase/indents/export?format=xlsx&view=mine')).json()
        .base64 as string,
    );
    expect(heads(mine.worksheets[0]!)).not.toContain('Estimate (₹)');
    expect(heads(mine.worksheets[1]!)).not.toContain('Rate (₹)');
    const pdf = (await call(teacher, 'GET', '/purchase/indents/export?format=pdf')).json();
    expect(
      Buffer.from(pdf.base64 as string, 'base64')
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
    // what the filters offer: the raiser their department, no vendors; the office every department and the vendors
    expect((await call(teacher, 'GET', '/purchase/list-filters')).json()).toEqual({
      departments: [{ id: ids.science, name: 'Science' }],
      vendors: [],
    });
    const wide = (await call(admin, 'GET', '/purchase/list-filters')).json();
    expect(wide.departments.length).toBeGreaterThan(1);
    expect(wide.vendors.map((v: { code: string }) => v.code)).toContain('V1');
  });
  it('the item sheet fills the form (nothing is saved); a line carries a document those on the indent may open', async () => {
    const t = (await call(teacher, 'GET', '/purchase/indent-sheet')).json();
    expect(t.filename).toBe('indent-items.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(t.base64 as string, 'base64') as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0]!;
    const put = (row: number, cells: Array<string | number | null>) =>
      cells.forEach((v, i) => {
        ws.getRow(row).getCell(i + 1).value = v;
      });
    put(2, ['Ball pen (PEN)', 12, 'Blue']);
    put(3, ['PAPER', 0]);
    put(4, ['Nonsense (ZZZ)', 1]);
    put(5, [null, 3, null, 'Bunsen burner', 'NOS']);
    put(6, [null, 1, null, 'x', 'NOS']);
    put(7, ['A4 paper ream', 4]);
    const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const before = (await call(teacher, 'GET', '/purchase/indents?view=mine')).json().total;
    const read = (await call(teacher, 'POST', '/purchase/indent-sheet', { file })).json();
    const nos = (await call(teacher, 'GET', '/purchase/indent-form'))
      .json()
      .uoms.find((u: { code: string }) => u.code === 'NOS').id as string;
    expect(read.lines).toEqual([
      { itemId: ids.PEN, quantity: 12, note: 'Blue' },
      { freeText: 'Bunsen burner', uomId: nos, quantity: 3 },
      { itemId: ids.PAPER, quantity: 4 },
    ]);
    expect(read.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 6]);
    // reading saves nothing
    expect((await call(teacher, 'GET', '/purchase/indents?view=mine')).json().total).toBe(before);
    // a line's document: a PDF or a photo as the body, by a raiser without file rights
    const upload = (u: SeededUser, body: Buffer, type = 'application/pdf') =>
      inject({
        method: 'POST',
        url: '/purchase/indent-files?name=spec.pdf',
        headers: headersFor(u.sub, school.id),
        raw: { contentType: type, body },
      });
    const pdf = Buffer.from('%PDF-1.4\n% a spec sheet\n');
    const up = await upload(teacher, pdf);
    expect(up.statusCode).toBe(201);
    const fileId = up.json().id as string;
    expect((await upload(teacher, Buffer.from('not a pdf'))).statusCode).toBe(400);
    expect((await upload(teacher, pdf, 'text/plain')).statusCode).toBe(400);
    const id = await raise(teacher, [{ itemId: ids.PAPER, quantity: 1, fileId }]);
    const pi = await get(teacher, id);
    expect(pi.lineItems[0]).toMatchObject({ fileId, fileName: 'spec.pdf' });
    const view = await call(
      teacher,
      'GET',
      `/purchase/indents/${id}/lines/${pi.lineItems[0].id as string}/file`,
    );
    expect(view.statusCode).toBe(200);
    expect(view.headers['content-type']).toBe('application/pdf');
    expect(view.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(
      (
        await call(
          outsider,
          'GET',
          `/purchase/indents/${id}/lines/${pi.lineItems[0].id as string}/file`,
        )
      ).statusCode,
    ).toBe(404);
    // saving again keeps the document; someone else's file is refused
    const again = await call(teacher, 'PUT', `/purchase/indents/${id}`, {
      purpose: 'For the lab',
      lines: [{ itemId: ids.PAPER, quantity: 2, fileId }],
    });
    expect(again.statusCode).toBe(200);
    const theirs = (await upload(hod, pdf)).json().id as string;
    expect(
      (
        await call(teacher, 'PUT', `/purchase/indents/${id}`, {
          purpose: 'For the lab',
          lines: [{ itemId: ids.PAPER, quantity: 2, fileId: theirs }],
        })
      ).statusCode,
    ).toBe(400);
  });
});
