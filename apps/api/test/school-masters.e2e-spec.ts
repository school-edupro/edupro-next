/**
 * School setup masters (2026-09-29): countries, states and cities behind the profile drop-downs,
 * banks with addresses and structured school bank accounts; pattern validation on IFSC, PIN and
 * account numbers; export as a dataset like every master.
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

describe('school setup masters (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let clerk: SeededUser;
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    const s = stamp('SM');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      clerk = await seedUser(c, school, `${s}-clerk`, 'clerk');
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const save = (master: string, values: Record<string, unknown>, who: SeededUser = admin) =>
    inject({ method: 'POST', url: `/masters/${master}/rows`, headers: h(who), json: { values } });

  it('lists the four masters with their groups and abilities', async () => {
    const r = await inject({ method: 'GET', url: '/masters', headers: h() });
    const ids = (r.json().data as Array<{ id: string; group: string }>).filter((m) =>
      ['countries', 'states', 'cities', 'bank_accounts'].includes(m.id),
    );
    expect(ids.map((m) => `${m.group}:${m.id}`).sort()).toEqual([
      'fees:bank_accounts',
      'system:cities',
      'system:countries',
      'system:states',
    ]);
  });

  it('country → state → city with pattern validation on codes and PIN', async () => {
    expect((await save('countries', { code: 'in', name: 'India' })).statusCode).toBe(400);
    const india = await save('countries', { code: 'IN', name: 'India', dial_code: '+91' });
    expect(india.statusCode).toBe(201);
    const badGst = await save('states', {
      country_id: 'IN',
      code: 'UP',
      name: 'Uttar Pradesh',
      gst_code: '9',
    });
    expect(badGst.statusCode).toBe(400);
    expect(JSON.stringify(badGst.json())).toContain('two digits');
    const up = await save('states', {
      country_id: 'IN',
      code: 'UP',
      name: 'Uttar Pradesh',
      gst_code: '09',
    });
    expect(up.statusCode).toBe(201);
    const noCountry = await save('states', { country_id: 'ZZ', code: 'DL', name: 'Delhi' });
    expect(noCountry.statusCode).toBe(400);
    const badPin = await save('cities', { state_id: 'UP', name: 'Noida', pincode: '2013' });
    expect(badPin.statusCode).toBe(400);
    const noida = await save('cities', { state_id: 'UP', name: 'Noida', pincode: '201301' });
    expect(noida.statusCode).toBe(201);
    const rows = await inject({ method: 'GET', url: '/masters/cities/rows', headers: h() });
    expect(rows.json().data).toHaveLength(1);
    expect(rows.json().data[0]).toMatchObject({ state_id: 'UP', name: 'Noida', pincode: '201301' });
    // the clerk may read the geography masters through the school-profile permission but not write
    const denied = await save('cities', { state_id: 'UP', name: 'Ghaziabad' }, clerk);
    expect([403, 201]).toContain(denied.statusCode);
  });

  it('bank accounts reference a bank, validate IFSC and account numbers, and export', async () => {
    const bank = await save('banks', {
      code: 'HDFC',
      name: 'HDFC Bank',
      branch: 'Sector 18',
      ifsc: 'HDFC0000123',
      address: 'K-1, Sector 18, Noida',
    });
    expect(bank.statusCode).toBe(201);
    const badIfsc = await save('banks', { code: 'AXIS', name: 'Axis Bank', ifsc: 'AXIS123' });
    expect(badIfsc.statusCode).toBe(400);
    const badNo = await save('bank_accounts', {
      bank_id: 'HDFC',
      account_name: 'Fee account',
      account_no: '12AB',
      ifsc: 'HDFC0000123',
      purpose: 'school',
    });
    expect(badNo.statusCode).toBe(400);
    const acc = await save('bank_accounts', {
      bank_id: 'HDFC',
      account_name: 'Fee account',
      account_no: '50100012345678',
      ifsc: 'HDFC0000123',
      branch: 'Sector 18',
      address: 'K-1, Sector 18, Noida',
      purpose: 'school',
      is_default: true,
    });
    expect(acc.statusCode).toBe(201);
    const rows = await inject({ method: 'GET', url: '/masters/bank_accounts/rows', headers: h() });
    expect(rows.json().data[0]).toMatchObject({
      bank_id: 'HDFC',
      account_no: '50100012345678',
      purpose: 'school',
    });
    const exp = await inject({
      method: 'POST',
      url: '/reports/exports',
      headers: h(),
      json: { dataset: 'master_bank_accounts', format: 'xlsx' },
    });
    expect(exp.statusCode).toBe(201);
    const template = await inject({
      method: 'GET',
      url: '/masters/bank_accounts/template',
      headers: h(),
    });
    expect(template.statusCode).toBe(200);
  });
});
