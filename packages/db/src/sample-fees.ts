/**
 * Sample fee data for a local school, to try the fee reports, deposit slips, refunds and adjustments.
 *
 *   pnpm --filter @edupro/db sample:fees add              two and a half months of receipts and what follows
 *   pnpm --filter @edupro/db sample:fees remove           takes every sample row out again
 *   pnpm --filter @edupro/db sample:fees remove --dry-run shows what would go, changes nothing
 *
 * Everything is entered through the running API (the same routes the counter uses), as the demo
 * accountant, so ledgers and reports agree. Only pupils who have a bill and no receipt this session are
 * used; what you entered by hand is not touched. Every receipt carries the remark SAMPLE-FEE, every
 * request ends with [sample], and every slip is marked SAMPLE-FEE: that is how "remove" finds them.
 * Messages the entries would send are stopped before they leave.
 *
 * Needs: the API running with the development sign-in (never production), DATABASE_MIGRATOR_URL.
 * Options: --school <code> (default ALPHA) --api <url> (default http://localhost:4000/api/v1)
 */
import { Client } from 'pg';

const TAG = 'SAMPLE-FEE';
const MARK = '[sample]';
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const API = arg('api', 'http://localhost:4000/api/v1');
const SCHOOL = arg('school', 'ALPHA');
const DRY = process.argv.includes('--dry-run');
const command = process.argv[2];

// the same sample every time: a small seeded generator instead of Math.random
let seed = 20261012;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join('');

let schoolId = '';
const call = async <T = Record<string, unknown>>(
  who: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: T & { type?: string; detail?: string } }> => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer dev:${who}`,
      'x-school-id': schoolId,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {} as T & { type?: string; detail?: string };
  try {
    json = text ? JSON.parse(text) : json;
  } catch {
    // not JSON: the status says enough
  }
  return { ok: res.ok, status: res.status, json };
};
const ACCOUNTS = 'dev-accounts';

interface Instalment {
  balance: string;
  status: string;
  lateFee: { outstanding: string };
}
interface Made {
  id: string;
  studentId: string;
  mode: string;
  amount: number;
  on: string;
}

const MODES: Array<[weight: number, mode: string, modeCode?: string]> = [
  [24, 'cash'],
  [20, 'upi'],
  [22, 'cheque'],
  [10, 'bank'],
  [6, 'bank', 'x_neft_rtgs'],
  [8, 'card'],
  [10, 'dd'],
];
const BANKS = [
  'State Bank of India',
  'HDFC Bank',
  'ICICI Bank',
  'Punjab National Bank',
  'Axis Bank',
  'Bank of Baroda',
  'Kotak Mahindra Bank',
  'Canara Bank',
];
const chooseMode = () => {
  let x = rnd() * MODES.reduce((a, m) => a + m[0], 0);
  for (const m of MODES) {
    x -= m[0];
    if (x <= 0) return m;
  }
  return MODES[0]!;
};

/** Working days (no Sundays) from 1 August to two days before today. */
function days(): string[] {
  const out: string[] = [];
  const end = new Date(Date.now() - 2 * 86_400_000);
  for (
    let d = new Date(Date.UTC(end.getUTCFullYear(), 7, 1));
    d <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    if (d.getUTCDay() !== 0) out.push(d.toISOString().slice(0, 10));
  return out;
}

/** The step of an approval that waits, approved by whoever of the demo users may act on it. */
async function approve(instanceId: string | null | undefined): Promise<boolean> {
  if (!instanceId) return true; // no level is set: decided on the page (the caller does that)
  for (const who of [ACCOUNTS, 'dev-principal', 'dev-admin']) {
    const inst = await call<{ steps?: Array<{ id: string; status: string }> }>(
      who,
      'GET',
      `/workflow/inbox/instances/${instanceId}`,
    );
    const step = inst.json.steps?.find((s) => s.status === 'pending');
    if (!inst.ok || !step) continue;
    const done = await call(who, 'POST', `/workflow/steps/${step.id}/approve`, {
      note: `Sample data ${MARK}`,
    });
    if (done.ok) return approve(instanceId).then(() => true); // the next level, if there is one
  }
  const left = await call<{ status?: string }>(
    ACCOUNTS,
    'GET',
    `/workflow/inbox/instances/${instanceId}`,
  );
  return left.json.status !== 'pending';
}

async function add(db: Client) {
  const before = await db.query<{ m: string; j: string }>(
    `SELECT COALESCE((SELECT max(id) FROM comms_messages), 0)::text AS m, COALESCE((SELECT max(id) FROM jobs_outbox), 0)::text AS j`,
  );
  const had = await db.query(
    `SELECT 1 FROM fee_payments WHERE school_id = $1 AND remarks = $2 LIMIT 1`,
    [schoolId, TAG],
  );
  if (had.rowCount) {
    console.log('Sample fee data is already there. Run "remove" first to put it in afresh.');
    return;
  }
  const year = await db.query<{ id: string }>(
    `SELECT id::text FROM academic_years WHERE school_id = $1 AND status = 'active' ORDER BY start_date DESC LIMIT 1`,
    [schoolId],
  );
  const yearId = year.rows[0]?.id;
  if (!yearId) throw new Error('The school has no active academic year');
  // pupils with a bill and nothing received this session: your own entries stay as they are
  const pupils = await db.query<{ id: string }>(
    `SELECT s.id::text FROM students s
      WHERE s.school_id = $1 AND s.status = 'active' AND s.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM fee_demands d WHERE d.student_id = s.id AND d.academic_year_id = $2 AND d.status IN ('pending', 'partial'))
        AND NOT EXISTS (SELECT 1 FROM fee_payments p WHERE p.student_id = s.id AND p.academic_year_id = $2)
        AND NOT EXISTS (SELECT 1 FROM student_withdrawals w WHERE w.student_id = s.id)
        -- an advance from last year is used up by the first receipt; such pupils are left alone
        AND NOT EXISTS (SELECT 1 FROM fee_demands d WHERE d.student_id = s.id AND d.academic_year_id = $2 AND d.net < 0)
      ORDER BY s.id`,
    [schoolId, yearId],
  );
  if (pupils.rows.length === 0) throw new Error('No pupil has a bill without receipts to use');
  console.log(
    `${String(pupils.rows.length)} pupils with a bill and no receipt this session are used.`,
  );
  const all = days();
  const made: Made[] = [];
  const failed = new Map<string, number>();
  for (const p of pupils.rows) {
    const n = 2 + Math.floor(rnd() * 3);
    const on = Array.from({ length: n }, () => pick(all)).sort();
    for (const date of [...new Set(on)]) {
      const ledger = await call<{ instalments: Instalment[] }>(
        ACCOUNTS,
        'GET',
        `/fees/students/${p.id}/ledger?asOf=${date}`,
      );
      const due = (ledger.json.instalments ?? []).filter((i) => Number(i.balance) > 0);
      if (due.length === 0) break;
      // one instalment at a time, now and then two together, with the late fee of that day
      const take = due.slice(0, rnd() < 0.2 ? 2 : 1);
      const amount = take.reduce(
        (a, i) => a + Number(i.balance) + Number(i.lateFee.outstanding),
        0,
      );
      const [, mode, modeCode] = chooseMode();
      const paper = mode === 'cheque' || mode === 'dd';
      const day = new Date(`${date}T00:00:00Z`);
      day.setUTCDate(day.getUTCDate() - Math.floor(rnd() * 3));
      const r = await call<{ paymentId: string }>(ACCOUNTS, 'POST', '/payments/receipts', {
        studentId: p.id,
        amount,
        mode,
        modeCode,
        receivedOn: date,
        remarks: TAG,
        reference:
          mode === 'upi'
            ? `UPI${digits(12)}`
            : mode === 'bank'
              ? `UTR${digits(12)}`
              : mode === 'card'
                ? `POS${digits(8)}`
                : undefined,
        instrumentNo: paper ? digits(6) : undefined,
        instrumentDate: paper ? day.toISOString().slice(0, 10) : undefined,
        bankName: paper || mode === 'bank' ? pick(BANKS) : undefined,
      });
      if (r.ok) made.push({ id: r.json.paymentId, studentId: p.id, mode, amount, on: date });
      else
        failed.set(
          r.json.type ?? String(r.status),
          (failed.get(r.json.type ?? String(r.status)) ?? 0) + 1,
        );
    }
  }
  console.log(`Receipts: ${String(made.length)} posted.`);
  for (const [why, n] of failed) console.log(`  not posted (${why}): ${String(n)}`);
  const paper = made.filter((m) => m.mode === 'cheque' || m.mode === 'dd');
  const used = new Set<string>();
  const next = (list: Made[], n: number) => {
    const out = list.filter((m) => !used.has(m.id)).slice(0, n);
    for (const m of out) used.add(m.id);
    return out;
  };

  // ---- two deposit slips: August's first cheques, then September's ----------------------------------
  const pending = await call<{ accounts: Array<{ id: string; purpose: string }> }>(
    ACCOUNTS,
    'GET',
    '/fees/deposit-slips/pending',
  );
  const account =
    pending.json.accounts?.find((a) => a.purpose === 'school') ?? pending.json.accounts?.[0];
  let slips = 0;
  if (account)
    for (const month of ['08', '09']) {
      const items = next(
        paper.filter((m) => m.on.slice(5, 7) === month),
        6,
      );
      if (items.length === 0) continue;
      const last = items
        .map((m) => m.on)
        .sort()
        .pop()!;
      const slip = await call(ACCOUNTS, 'POST', '/fees/deposit-slips', {
        bankAccountId: account.id,
        depositOn: last,
        items: items.map((m) => `p:${m.id}`),
        remarks: TAG,
      });
      if (slip.ok) slips += 1;
      else
        console.log(
          `  deposit slip not made: ${slip.json.detail ?? slip.json.type ?? String(slip.status)}`,
        );
    }
  console.log(`Deposit slips: ${String(slips)} made; the other cheques and drafts wait in hand.`);

  // ---- bounced cheques and cancelled receipts, through the approval levels ---------------------------
  const adjust = async (kind: 'bounce' | 'reversal', m: Made, reason: string, decide: boolean) => {
    const r = await call<{ id: string; status: string; workflowInstanceId: string | null }>(
      ACCOUNTS,
      'POST',
      '/fees/adjustments',
      { kind, paymentId: m.id, reason: `${reason} ${MARK}` },
    );
    if (!r.ok) {
      console.log(`  ${kind} not raised: ${r.json.detail ?? r.json.type ?? String(r.status)}`);
      return 'failed';
    }
    if (!decide || r.json.status !== 'pending') return r.json.status;
    if (r.json.workflowInstanceId)
      return (await approve(r.json.workflowInstanceId)) ? 'approved' : 'pending';
    const d = await call<{ status: string }>(
      'dev-principal',
      'POST',
      `/fees/adjustments/${r.json.id}/decide`,
      {
        outcome: 'approved',
        note: `Sample data ${MARK}`,
      },
    );
    return d.ok ? d.json.status : 'pending';
  };
  const count = new Map<string, number>();
  const note = (k: string, s: string) => count.set(`${k} ${s}`, (count.get(`${k} ${s}`) ?? 0) + 1);
  const cheques = paper.filter((m) => m.mode === 'cheque');
  for (const [m, reason] of [
    [next(cheques, 1)[0], 'Returned by the bank: funds insufficient'],
    [next(cheques, 1)[0], 'Returned by the bank: signature differs'],
    [next(cheques, 1)[0], 'Returned by the bank: payment stopped by the drawer'],
  ] as const)
    if (m) note('Cheque bounce', await adjust('bounce', m, reason, true));
  const counter = made.filter((m) => m.mode === 'cash' || m.mode === 'upi');
  for (const [m, reason, decide] of [
    [next(counter, 1)[0], 'Entered on the wrong pupil at the counter', true],
    [next(counter, 1)[0], 'Entered twice by mistake', true],
    [next(counter, 1)[0], 'Parent asked to change the mode of payment', false],
  ] as const)
    if (m) note('Receipt cancellation', await adjust('reversal', m, reason, decide));

  // ---- refunds: two paid, one waiting for approval, one kept as a draft -------------------------------
  const refund = async (m: Made, reason: string, how: 'pay' | 'wait' | 'draft') => {
    const can = await call<{ lines: Array<{ demandId: string; paid: string }> }>(
      ACCOUNTS,
      'GET',
      `/payments/receipts/${m.id}/refundable`,
    );
    const line = can.json.lines?.[0];
    if (!line) return 'failed';
    const r = await call<{ id: string; status: string; workflowInstanceId: string | null }>(
      ACCOUNTS,
      'POST',
      `/payments/receipts/${m.id}/refunds`,
      {
        draft: how === 'draft',
        lines: [{ part: 'fee', demandId: line.demandId, amount: Math.min(Number(line.paid), 500) }],
        feeAction: 'due',
        mode: 'bank',
        reference: how === 'pay' ? `UTR${digits(12)}` : undefined,
        reason: `${reason} ${MARK}`,
      },
    );
    if (!r.ok) {
      console.log(`  refund not raised: ${r.json.detail ?? r.json.type ?? String(r.status)}`);
      return 'failed';
    }
    if (how !== 'pay' || r.json.status !== 'requested') return r.json.status;
    if (r.json.workflowInstanceId)
      return (await approve(r.json.workflowInstanceId)) ? 'paid' : 'requested';
    const d = await call<{ status: string }>(
      'dev-principal',
      'POST',
      `/payments/refunds/${r.json.id}/decide`,
      {
        outcome: 'approved',
        note: `Sample data ${MARK}`,
      },
    );
    return d.ok ? d.json.status : 'requested';
  };
  const plain = made.filter((m) => ['cash', 'upi', 'bank', 'card'].includes(m.mode));
  for (const [m, reason, how] of [
    [next(plain, 1)[0], 'Paid in excess by the parent', 'pay'],
    [next(plain, 1)[0], 'Activity not held this term', 'pay'],
    [next(plain, 1)[0], 'Parent asked for the fee paid ahead', 'wait'],
    [next(plain, 1)[0], 'To be discussed with the parent', 'draft'],
  ] as const)
    if (m) note('Refund', await refund(m, reason, how));
  for (const [k, n] of count) console.log(`${k}: ${String(n)}`);

  // ---- nothing leaves the school: messages and notices these entries queued are stopped ---------------
  const msg = await db.query(
    `UPDATE comms_messages SET status = 'cancelled', last_error = 'sample fee data: not sent', updated_at = now()
      WHERE school_id = $1 AND id > $2 AND status = 'queued'`,
    [schoolId, before.rows[0]!.m],
  );
  const jobs = await db.query(
    `UPDATE jobs_outbox SET status = 'failed', last_error = 'sample fee data: not sent'
      WHERE school_id = $1 AND id > $2 AND status = 'pending' AND queue = 'notifications'`,
    [schoolId, before.rows[0]!.j],
  );
  console.log(
    `Messages stopped before sending: ${String(msg.rowCount)}; notices: ${String(jobs.rowCount)}.`,
  );
  const sum = await db.query<{ mode: string; n: string; total: string }>(
    `SELECT COALESCE(mode_label, mode::text) AS mode, count(*)::text AS n, sum(amount)::text AS total
       FROM fee_payments WHERE school_id = $1 AND remarks = $2 GROUP BY 1 ORDER BY 1`,
    [schoolId, TAG],
  );
  console.table(sum.rows);
}

async function remove(db: Client) {
  await db.query('BEGIN');
  try {
    // the school and the user the triggers and functions expect (the demo accountant)
    await db.query(
      `SELECT set_config('app.school_id', $1, true), set_config('app.user_id', (SELECT id::text FROM users WHERE oneauth_sub = $2), true)`,
      [schoolId, ACCOUNTS],
    );
    const pay = await db.query<{ id: string }>(
      `SELECT id::text FROM fee_payments WHERE school_id = $1 AND remarks = $2`,
      [schoolId, TAG],
    );
    const ids = pay.rows.map((r) => r.id);
    const out: Record<string, number> = { receipts: ids.length };
    const who = await db.query<{ student_id: string; year: string }>(
      `SELECT DISTINCT student_id::text, academic_year_id::text AS year FROM fee_payments WHERE id = ANY($1::bigint[])`,
      [ids],
    );
    const run = async (label: string, sql: string, params: unknown[]) => {
      const r = await db.query(sql, params);
      out[label] = (out[label] ?? 0) + (r.rowCount ?? 0);
    };
    // what a sample receipt still pays goes back to the bill
    await run(
      'fee lines set unpaid again',
      `UPDATE fee_demands d SET paid = d.paid - a.amount,
              status = CASE WHEN d.status = 'cancelled' THEN d.status WHEN d.paid - a.amount <= 0 THEN 'pending' WHEN d.paid - a.amount < d.net THEN 'partial' ELSE 'paid' END::fee_demand_status,
              updated_at = now()
         FROM (SELECT demand_id, sum(amount) AS amount FROM fee_payment_allocations WHERE payment_id = ANY($1::bigint[]) GROUP BY demand_id) a
        WHERE d.id = a.demand_id`,
      [ids],
    );
    await run(
      'allocations',
      `DELETE FROM fee_payment_allocations WHERE payment_id = ANY($1::bigint[])`,
      [ids],
    );
    // a credit line (an advance from last year) that a sample receipt used up is given back: for a pupil
    // left with no receipt, a fee line can only be paid by what its receipts hold
    for (const w of who.rows) {
      const left = await db.query(
        `SELECT 1 FROM fee_payments WHERE student_id = $1 AND academic_year_id = $2 AND NOT (id = ANY($3::bigint[])) LIMIT 1`,
        [w.student_id, w.year, ids],
      );
      if (left.rowCount) continue;
      await run(
        'credit given back to its line',
        `UPDATE fee_demands SET paid = 0, status = 'pending', updated_at = now()
          WHERE student_id = $1 AND academic_year_id = $2 AND paid <> 0 AND status IN ('paid', 'partial')
            AND NOT EXISTS (SELECT 1 FROM fee_payment_allocations a WHERE a.demand_id = fee_demands.id)`,
        [w.student_id, w.year],
      );
    }
    await run(
      'late fee postings',
      `DELETE FROM fee_late_fee_postings WHERE payment_id = ANY($1::bigint[])`,
      [ids],
    );
    // approvals of the sample requests
    const inst = await db.query<{ id: string }>(
      `SELECT workflow_instance_id::text AS id FROM fee_refunds WHERE payment_id = ANY($1::bigint[]) AND workflow_instance_id IS NOT NULL
       UNION SELECT workflow_instance_id::text FROM fee_adjustments WHERE payment_id = ANY($1::bigint[]) AND workflow_instance_id IS NOT NULL`,
      [ids],
    );
    const instances = inst.rows.map((r) => r.id);
    // a bounce adds a charge line to the bill: it goes with the bounce
    const charges = await db.query<{ id: string }>(
      `SELECT charge_demand_id::text AS id FROM fee_adjustments WHERE payment_id = ANY($1::bigint[]) AND charge_demand_id IS NOT NULL`,
      [ids],
    );
    await run('refunds', `DELETE FROM fee_refunds WHERE payment_id = ANY($1::bigint[])`, [ids]);
    await run('adjustments', `DELETE FROM fee_adjustments WHERE payment_id = ANY($1::bigint[])`, [
      ids,
    ]);
    await run(
      'bounce charge lines',
      `DELETE FROM fee_demands WHERE id = ANY($1::bigint[]) AND paid = 0`,
      [charges.rows.map((r) => r.id)],
    );
    await run(
      'approval steps',
      `DELETE FROM workflow_steps WHERE instance_id = ANY($1::bigint[])`,
      [instances],
    );
    await run('approvals', `DELETE FROM workflow_instances WHERE id = ANY($1::bigint[])`, [
      instances,
    ]);
    await run(
      'receipts taken off slips',
      `UPDATE fee_payments SET deposit_slip_id = NULL WHERE id = ANY($1::bigint[]) AND deposit_slip_id IS NOT NULL`,
      [ids],
    );
    await run(
      'deposit slips',
      `DELETE FROM fee_deposit_slips WHERE school_id = $1 AND remarks = $2`,
      [schoolId, TAG],
    );
    await run('receipts removed', `DELETE FROM fee_payments WHERE id = ANY($1::bigint[])`, [ids]);
    console.table(out);
    if (DRY) {
      await db.query('ROLLBACK');
      console.log('Dry run: nothing was changed.');
    } else {
      await db.query('COMMIT');
      console.log(
        'Sample fee data removed. Receipt and voucher numbers used by it are not given again.',
      );
    }
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  if (command !== 'add' && command !== 'remove') {
    console.log(
      'Usage: sample:fees add | remove [--dry-run] [--school ALPHA] [--api http://localhost:4000/api/v1]',
    );
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Never on a production system');
  if (!process.env.DATABASE_MIGRATOR_URL) throw new Error('DATABASE_MIGRATOR_URL is not set');
  const db = new Client({ connectionString: process.env.DATABASE_MIGRATOR_URL });
  await db.connect();
  try {
    const s = await db.query<{ id: string; name: string }>(
      `SELECT id::text, name FROM schools WHERE code = $1`,
      [SCHOOL],
    );
    if (!s.rows[0]) throw new Error(`No school with the code ${SCHOOL}`);
    schoolId = s.rows[0].id;
    console.log(
      `${command === 'add' ? 'Adding sample fee data to' : 'Removing sample fee data from'} ${s.rows[0].name}`,
    );
    if (command === 'add') {
      const up = await call(ACCOUNTS, 'GET', '/fees/deposit-slips/pending').catch(() => null);
      if (!up?.ok)
        throw new Error(
          `The API at ${API} did not answer for the demo accountant (is it running with the development sign-in?)`,
        );
      await add(db);
    } else await remove(db);
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
