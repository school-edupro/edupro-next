/**
 * Sprint 12 QA: the fee procedure harness. 200 generated cases (structures, discounts, transport slabs,
 * opening balances, instalment variants, payment patterns, overrides, both late fee modes) are run through
 * the API and compared with an independent TypeScript model of the legacy rules (GenerateFee and
 * fnlLateFee). The cases are synthetic until the production dump arrives; the model is the one the
 * rehearsal will replay real history against.
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

type Discount = 'none' | 'SIB' | 'STAFF' | 'EWS' | 'FIX';
type Slab = 'none' | 'S1' | 'S2';
type Pattern = 0 | 1 | 2 | 3 | 4;

interface Case {
  id: string;
  classIdx: number;
  discount: Discount;
  slab: Slab;
  ob: number;
  inst: null | 2 | 4 | 12;
  pattern: Pattern;
  override: number | null;
  mode: 'daywise' | 'slab';
}

interface Head {
  code: string;
  amount: number;
  frequency: 'monthly' | 'quarterly' | 'half_yearly' | 'annual';
}

const CLASSES: Array<{ code: string; heads: Head[] }> = [0, 1, 2, 3].map((k) => ({
  code: ['VI', 'VII', 'VIII', 'IX'][k]!,
  heads: [
    { code: 'TUI', amount: 2000 + 250 * k, frequency: 'monthly' },
    { code: 'DEV', amount: 1200, frequency: 'quarterly' },
    { code: 'COMP', amount: 300, frequency: 'monthly' },
    { code: 'ANN', amount: 3500, frequency: 'annual' },
    { code: 'EXAM', amount: 400 + 25 * k, frequency: 'half_yearly' },
  ],
}));
const SLABS: Record<Exclude<Slab, 'none'>, number> = { S1: 1200, S2: 1500 };
const DISCOUNTS: Record<
  Exclude<Discount, 'none'>,
  { head: string | null; pct100?: number; amount?: number }
> = {
  SIB: { head: 'TUI', pct100: 5000 },
  STAFF: { head: null, pct100: 10000 },
  EWS: { head: null, pct100: 3333 },
  FIX: { head: 'TUI', amount: 500 },
};
const PER_DAY = 10;
const AS_OF = '2026-10-15';
const SLAB_AFTER_DUE = 100;
const SLAB_1 = { days: 15, amount: 250 };
const SLAB_2 = { days: 45, amount: 500 };

const cases: Case[] = Array.from({ length: 200 }, (_, i) => ({
  id: `C${String(i).padStart(3, '0')}`,
  classIdx: i % 4,
  discount: (['none', 'SIB', 'STAFF', 'EWS', 'FIX'] as Discount[])[i % 5]!,
  slab: (['none', 'S1', 'S2'] as Slab[])[Math.floor(i / 2) % 3]!,
  ob: [0, 2500, -500][Math.floor(i / 4) % 3]!,
  inst: ([null, 2, 4, 12] as Case['inst'][])[Math.floor(i / 8) % 4]!,
  pattern: (Math.floor(i / 3) % 5) as Pattern,
  override: i % 7 === 3 ? 42 : null,
  mode: i < 100 ? 'daywise' : 'slab',
}));

// ---- the reference model (legacy GenerateFee + fnlLateFee, blueprint section 5.3) --------------------
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const periodsOf = (f: Head['frequency']) =>
  f === 'monthly'
    ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    : f === 'quarterly'
      ? [1, 4, 7, 10]
      : f === 'half_yearly'
        ? [1, 7]
        : [1];

interface Group {
  dueOn: string;
  net: number; // paise
  paid: number;
  allocations: Array<{ on: string; amount: number }>;
}

function model(kase: Case, periods: Array<{ sequence: number; dueOn: string }>) {
  const disc = kase.discount === 'none' ? null : DISCOUNTS[kase.discount];
  const discountFor = (head: string, grossPaise: number) => {
    if (!disc || (disc.head && disc.head !== head)) return 0;
    if (disc.pct100 !== undefined) return Math.floor((grossPaise * disc.pct100 + 5000) / 10000);
    return Math.min(grossPaise, (disc.amount ?? 0) * 100);
  };
  // rows per period sequence (net in paise)
  const perPeriod = new Map<number, number[]>();
  const push = (seq: number, net: number) =>
    perPeriod.set(seq, [...(perPeriod.get(seq) ?? []), net]);
  for (const head of CLASSES[kase.classIdx]!.heads)
    for (const seq of periodsOf(head.frequency)) {
      const gross = head.amount * 100;
      push(seq, Math.max(gross - discountFor(head.code, gross), 0));
    }
  if (kase.slab !== 'none')
    for (let seq = 1; seq <= 12; seq += 1) push(seq, SLABS[kase.slab] * 100); // transport allowed for discounted students (setting)
  if (kase.ob !== 0) push(1, kase.ob * 100);
  // whole-rupee rounding per period, then instalment override moves periods to their anchor's due date
  const dueOf = new Map(periods.map((p) => [p.sequence, p.dueOn]));
  const groups = new Map<string, Group>();
  for (const [seq, nets] of [...perPeriod.entries()].sort((a, b) => a[0] - b[0])) {
    const sum = nets.reduce((a, b) => a + b, 0);
    const rounded =
      sum >= 0 ? Math.floor((sum + 50) / 100) * 100 : -Math.floor((-sum + 50) / 100) * 100;
    const anchorSeq = kase.inst
      ? Math.floor((seq - 1) / (12 / kase.inst)) * (12 / kase.inst) + 1
      : seq;
    const dueOn = dueOf.get(anchorSeq)!;
    const g = groups.get(dueOn) ?? { dueOn, net: 0, paid: 0, allocations: [] };
    g.net += rounded;
    groups.set(dueOn, g);
  }
  const ordered = [...groups.values()].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  // payment patterns (amounts in rupees, computed from the model so the API and the model agree on inputs)
  const g1 = ordered[0]!;
  const g2 = ordered[1]!;
  const payments: Array<{ on: string; amount: number }> = [];
  if (kase.pattern === 1) payments.push({ on: '2026-04-05', amount: g1.net / 100 });
  if (kase.pattern === 2) payments.push({ on: '2026-05-10', amount: g1.net / 100 });
  if (kase.pattern === 3) payments.push({ on: '2026-04-01', amount: 1000 });
  if (kase.pattern === 4) payments.push({ on: '2026-09-01', amount: (g1.net + g2.net) / 100 });
  const usable = payments.filter((p) => p.amount >= 1);
  for (const p of usable) {
    let left = Math.round(p.amount * 100);
    for (const g of ordered) {
      if (left <= 0) break;
      const open = Math.max(g.net - g.paid, 0);
      const take = Math.min(left, open);
      if (take > 0) {
        g.paid += take;
        g.allocations.push({ on: p.on, amount: take });
        left -= take;
      }
    }
  }
  const lateFee = (g: Group, overridden: number | null) => {
    if (g.net <= 0 || AS_OF <= g.dueOn) return 0;
    const paidByDue = g.allocations
      .filter((a) => a.on <= g.dueOn)
      .reduce((s, a) => s + a.amount, 0);
    if (g.net - paidByDue <= 0) return 0;
    let end = AS_OF;
    if (g.net - g.paid <= 0) {
      const settled = g.allocations
        .map((a) => a.on)
        .sort()
        .at(-1);
      if (settled && settled < end) end = settled;
    }
    if (end <= g.dueOn) return 0;
    if (overridden !== null) return overridden * 100;
    const days = daysBetween(g.dueOn, end);
    if (kase.mode === 'daywise') return days * PER_DAY * 100;
    return (
      (end > addDays(g.dueOn, SLAB_2.days)
        ? SLAB_2.amount
        : end > addDays(g.dueOn, SLAB_1.days)
          ? SLAB_1.amount
          : SLAB_AFTER_DUE) * 100
    );
  };
  const overrideDue = '2026-07-10';
  return {
    payments: usable,
    groups: ordered.map((g) => ({
      dueOn: g.dueOn,
      net: (g.net / 100).toFixed(2),
      paid: (g.paid / 100).toFixed(2),
      lateFee: (lateFee(g, g.dueOn === overrideDue ? kase.override : null) / 100).toFixed(2),
    })),
    total: (ordered.reduce((s, g) => s + g.net, 0) / 100).toFixed(2),
    overrideDue,
  };
}

describe('fee procedure harness (e2e, 200 generated legacy-rule cases)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  const classIds: string[] = [];
  const sectionIds: string[] = [];
  const heads: Record<string, string> = {};
  const slabIds: Record<string, string> = {};
  const discountIds: Record<string, string> = {};
  let periods: Array<{ id: string; sequence: number; dueOn: string }> = [];
  const h = () => headersFor(admin.sub, school.id);

  beforeAll(async () => {
    const s = stamp('FH');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      await c.query(
        `INSERT INTO school_settings (school_id, key, value) VALUES ($1, 'fees.transport_for_discounted', 'true'::jsonb), ($1, 'fees.late_fee_mode', '"daywise"'::jsonb), ($1, 'fees.late_fee_per_day', '"10.00"'::jsonb)`,
        [school.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    for (const [i, code] of ['TUI', 'DEV', 'COMP', 'ANN', 'EXAM'].entries()) {
      const r = await inject({
        method: 'POST',
        url: '/fees/heads',
        headers: h(),
        json: { code, name: code, sortOrder: i },
      });
      heads[code] = r.json().id;
    }
    heads.TRN = (
      await inject({
        method: 'POST',
        url: '/fees/heads',
        headers: h(),
        json: { code: 'TRN', name: 'Transport', kind: 'transport', sortOrder: 9 },
      })
    ).json().id;
    heads.OPB = (
      await inject({
        method: 'POST',
        url: '/fees/heads',
        headers: h(),
        json: { code: 'OPB', name: 'Opening balance', kind: 'opening_balance', sortOrder: 10 },
      })
    ).json().id;
    periods = (
      await inject({
        method: 'POST',
        url: '/fees/periods/generate',
        headers: h(),
        json: { dueDay: 10, monthsPerInstalment: 3 },
      })
    ).json().data;
    for (const [k, cls] of CLASSES.entries()) {
      const c = await inject({
        method: 'POST',
        url: '/academics/classes',
        headers: h(),
        json: { code: cls.code, name: `Class ${cls.code}`, displayOrder: 6 + k },
      });
      classIds.push(c.json().id);
      const sec = await inject({
        method: 'POST',
        url: `/academics/classes/${c.json().id}/sections`,
        headers: h(),
        json: { name: 'A' },
      });
      sectionIds.push(sec.json().id);
      const st = await inject({
        method: 'PUT',
        url: `/fees/structures/${c.json().id}`,
        headers: h(),
        json: {
          feeGroup: 'general',
          entries: cls.heads.map((x) => ({
            headId: heads[x.code],
            amount: x.amount,
            frequency: x.frequency,
          })),
        },
      });
      expect(st.statusCode).toBe(200);
    }
    for (const [code, amount] of Object.entries(SLABS)) {
      const r = await inject({
        method: 'POST',
        url: '/fees/slabs',
        headers: h(),
        json: { code, name: code, monthlyAmount: amount },
      });
      slabIds[code] = r.json().id;
    }
    for (const [code, d] of Object.entries(DISCOUNTS)) {
      const r = await inject({
        method: 'POST',
        url: '/fees/discounts',
        headers: h(),
        json: {
          code,
          name: code,
          headId: d.head ? heads[d.head] : undefined,
          percent: d.pct100 !== undefined ? d.pct100 / 100 : undefined,
          amount: d.amount,
        },
      });
      expect(r.statusCode).toBe(201);
      discountIds[code] = r.json().id;
    }
    // slab-mode configuration on the anchor periods (after due, +15 days, +45 days)
    for (const p of periods.filter((x) => [1, 4, 7, 10].includes(x.sequence))) {
      const r = await inject({
        method: 'PUT',
        url: `/fees/periods/${p.id}/late-fee`,
        headers: h(),
        json: {
          lateFeeAmount: SLAB_AFTER_DUE,
          slabs: [
            { on: addDays(p.dueOn, SLAB_1.days), amount: SLAB_1.amount },
            { on: addDays(p.dueOn, SLAB_2.days), amount: SLAB_2.amount },
          ],
        },
      });
      expect(r.statusCode).toBe(200);
    }
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('demand, allocation and late fee of every case equal the reference model', async () => {
    const failures: string[] = [];
    let currentMode: Case['mode'] = 'daywise';
    for (const [i, kase] of cases.entries()) {
      if (kase.mode !== currentMode) {
        const r = await inject({
          method: 'PUT',
          url: '/platform/settings/fees.late_fee_mode',
          headers: h(),
          json: { value: kase.mode },
        });
        expect([200, 201]).toContain(r.statusCode);
        currentMode = kase.mode;
      }
      const expected = model(kase, periods);
      const st = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `FH-${kase.id}`,
          firstName: kase.id,
          lastName: 'Harness',
          dob: '2015-01-01',
          admittedOn: '2026-04-05',
          enrolment: { classSectionId: sectionIds[kase.classIdx], rollNo: i + 1 },
        },
      });
      expect(st.statusCode).toBe(201);
      const studentId = st.json().id as string;
      const prof = await inject({
        method: 'PUT',
        url: `/fees/students/${studentId}/profile`,
        headers: h(),
        json: {
          feeGroup: 'general',
          studentType: 'new',
          transportSlabId: kase.slab === 'none' ? null : slabIds[kase.slab],
          discountId: kase.discount === 'none' ? null : discountIds[kase.discount],
          openingBalance: kase.ob,
          instalmentsOverride: kase.inst,
        },
      });
      expect(prof.statusCode).toBe(200);
      const gen = await inject({
        method: 'POST',
        url: `/fees/students/${studentId}/demands/generate`,
        headers: h(),
      });
      expect(gen.statusCode).toBe(201);
      for (const p of expected.payments) {
        const r = await inject({
          method: 'POST',
          url: '/payments/offline',
          headers: h(),
          json: { studentId, amount: p.amount, mode: 'cash', receivedOn: p.on },
        });
        if (r.statusCode !== 201)
          failures.push(
            `${kase.id}: payment ${JSON.stringify(p)} → ${r.statusCode} ${JSON.stringify(r.json())}`,
          );
      }
      if (kase.override !== null) {
        const anchor = periods.find((p) => p.dueOn === expected.overrideDue)!;
        const r = await inject({
          method: 'PUT',
          url: `/fees/students/${studentId}/late-fee`,
          headers: h(),
          json: { periodId: anchor.id, amount: kase.override, reason: 'harness override' },
        });
        if (r.statusCode !== 200) failures.push(`${kase.id}: override → ${r.statusCode}`);
      }
      const ledger = (
        await inject({
          method: 'GET',
          url: `/fees/students/${studentId}/ledger?asOf=${AS_OF}`,
          headers: h(),
        })
      ).json() as {
        instalments: Array<{
          dueOn: string;
          net: string;
          paid: string;
          lateFee: { amount: string };
        }>;
        totals: { net: string };
      };
      const got = ledger.instalments.map((x) => ({
        dueOn: x.dueOn,
        net: x.net,
        paid: x.paid,
        lateFee: x.lateFee.amount,
      }));
      if (
        JSON.stringify(got) !== JSON.stringify(expected.groups) ||
        ledger.totals.net !== expected.total
      )
        failures.push(
          `${kase.id} ${JSON.stringify(kase)}\n  expected ${JSON.stringify(expected.groups)} total ${expected.total}\n  got      ${JSON.stringify(got)} total ${ledger.totals.net}`,
        );
    }
    if (failures.length)
      console.error(`${failures.length} case(s) differ:\n${failures.slice(0, 10).join('\n')}`);
    expect(failures).toEqual([]);
  }, 500_000);
});
