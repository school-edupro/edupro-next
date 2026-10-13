import { Badge, Button, Card, FormRow, InputField, PageHeader, SelectField } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { createDepositSlip, saveDepositSlipLimit } from '@/lib/fee-setup-actions';

interface Instrument {
  key: string;
  receiptNo: string | null;
  receivedOn: string;
  payer: string;
  admissionNo: string | null;
  section: string | null;
  ledger: string;
  mode: string;
  instrumentNo: string | null;
  instrumentDate: string | null;
  bankName: string | null;
  amount: string;
  /** Drawn on the same bank as the account chosen. */
  sameBank?: boolean | null;
}
interface Account {
  id: string;
  bank: string;
  accountName: string;
  accountNo: string;
  purpose: string;
}
interface Slip {
  id: string;
  slipNo: number;
  depositOn: string;
  account: Account;
  instruments: number;
  total: string;
  status: 'open' | 'cancelled';
  createdBy: string | null;
  kind: 'transfer' | 'clearing' | null;
}
const KIND = { transfer: 'Transfer (same bank)', clearing: 'Clearing (other banks)' };

const money = (v: string | number) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** The filters of "Slips made this year", as the API takes them. */
function slipQuery(sp: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  if (day(sp.sFrom)) q.set('from', day(sp.sFrom));
  if (day(sp.sTo)) q.set('to', day(sp.sTo));
  if (/^\d{1,18}$/.test(sp.sAccount ?? '')) q.set('bankAccountId', sp.sAccount!);
  if (['transfer', 'clearing', 'none'].includes(sp.sKind ?? '')) q.set('kind', sp.sKind!);
  if (['open', 'cancelled'].includes(sp.sStatus ?? '')) q.set('status', sp.sStatus!);
  if (/^\d{1,8}$/.test(sp.sNo ?? '')) q.set('slipNo', sp.sNo!);
  return q;
}

/** Bank deposit slips: cheques and drafts in hand, the slip that takes them to the bank, and the slips made. */
export default async function DepositSlipsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    from?: string;
    to?: string;
    ledger?: string;
    account?: string;
    drawee?: string;
    made?: string;
    sFrom?: string;
    sTo?: string;
    sAccount?: string;
    sKind?: string;
    sStatus?: string;
    sNo?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canManage = me.permissions.includes('fees.deposit_slip.manage');
  const q = new URLSearchParams();
  if (sp.from) q.set('from', sp.from);
  if (sp.to) q.set('to', sp.to);
  if (sp.ledger) q.set('ledger', sp.ledger);
  const [first, slips, limit] = await Promise.all([
    apiFetch<{ data: Instrument[]; accounts: Account[] }>(
      `/fees/deposit-slips/pending?${q.toString()}`,
    ),
    apiFetch<{ data: Slip[] }>(`/fees/deposit-slips?${slipQuery(sp).toString()}`).then(
      (r) => r.data,
    ),
    apiFetch<{ limit: number }>('/fees/deposit-slips/limit')
      .then((r) => r.limit)
      .catch(() => 0),
  ]);
  // the account the slip is for decides which cheques are "same bank": the first one unless another is chosen
  const account = first.accounts.find((a) => a.id === sp.account) ?? first.accounts[0];
  const drawee = sp.drawee === 'same' || sp.drawee === 'other' ? sp.drawee : '';
  if (account) q.set('bankAccountId', account.id);
  if (drawee) q.set('drawee', drawee);
  const pending = account
    ? await apiFetch<{ data: Instrument[]; accounts: Account[] }>(
        `/fees/deposit-slips/pending?${q.toString()}`,
      )
    : first;
  const total = pending.data.reduce((a, x) => a + Number(x.amount), 0);
  const same = pending.data.filter((x) => x.sameBank).length;
  const other = pending.data.length - same;
  const slipsFor = (n: number) => (n === 0 ? 0 : limit > 0 ? Math.ceil(n / limit) : 1);
  const made = (sp.made ?? '').split(',').filter((x) => /^\d+$/.test(x));
  return (
    <>
      <PageHeader
        kicker="Fees"
        title="Bank deposit slips"
        description="Tick the cheques and drafts going to the bank, choose the school account and the date, and print the slip. A cheque can sit on one slip only."
      />
      <Notice params={sp} />
      {made.length > 0 ? (
        <p className="ep-alert ep-alert--success" role="status">
          {made.length} slips were made: {made.map((n) => `Slip ${n}`).join(', ')}. Open each from
          the list below to print it.
        </p>
      ) : null}
      <Card title="Cheques and drafts in hand">
        <form method="get" style={{ marginBottom: 'var(--sp-3)' }}>
          <FormRow columns={4}>
            <InputField
              id="from"
              name="from"
              label="Received from"
              type="date"
              defaultValue={sp.from ?? ''}
            />
            <InputField
              id="to"
              name="to"
              label="Received to"
              type="date"
              defaultValue={sp.to ?? ''}
            />
            <SelectField
              id="ledger"
              name="ledger"
              label="Fee type"
              defaultValue={sp.ledger ?? ''}
              options={[
                { value: '', label: 'All' },
                { value: 'school', label: 'Regular fee' },
                { value: 'hostel', label: 'Hostel fee' },
                { value: 'misc', label: 'Misc collection' },
                { value: 'admission', label: 'Admission' },
              ]}
            />
            {first.accounts.length > 0 ? (
              <SelectField
                id="account"
                name="account"
                label="Deposit into"
                defaultValue={account?.id ?? ''}
                options={first.accounts.map((a) => ({
                  value: a.id,
                  label: `${a.bank} · ${a.accountName} · …${a.accountNo.slice(-4)}`,
                }))}
              />
            ) : null}
            <SelectField
              id="drawee"
              name="drawee"
              label="Drawn on"
              defaultValue={drawee}
              options={[
                { value: '', label: 'All banks' },
                { value: 'same', label: 'Same bank (transfer)' },
                { value: 'other', label: 'Other banks (clearing)' },
              ]}
            />
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Button type="submit" variant="secondary">
                Show
              </Button>
            </div>
          </FormRow>
        </form>
        {pending.data.length === 0 ? (
          <p className="ep-field__help">No cheque or draft is waiting for deposit.</p>
        ) : (
          <form action={createDepositSlip}>
            <input type="hidden" name="bankAccountId" value={account?.id ?? ''} />
            <p
              style={{
                display: 'flex',
                gap: 'var(--sp-2)',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
              }}
            >
              <span className="ep-field__help">
                Check the list (or take it to the bank counter) before making the slips: the file
                has the cheques shown here, marked same bank or other bank.
              </span>
              <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/api/fees/deposit-file?format=xlsx&${q.toString()}`}
                >
                  Excel
                </a>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/api/fees/deposit-file?format=pdf&${q.toString()}`}
                >
                  PDF
                </a>
              </span>
            </p>
            <div className="ep-table-wrap">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Cheques and drafts not yet on a slip</caption>
                <thead>
                  <tr>
                    <th scope="col">Take</th>
                    <th scope="col">Received</th>
                    <th scope="col">Receipt no.</th>
                    <th scope="col">From</th>
                    <th scope="col">Class</th>
                    <th scope="col">Cheque / DD no.</th>
                    <th scope="col">Cheque date</th>
                    <th scope="col">Drawn on</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pending.data.map((x) => (
                    <tr key={x.key}>
                      <td>
                        <input
                          type="checkbox"
                          name="items"
                          value={x.key}
                          defaultChecked
                          disabled={!canManage}
                          aria-label={`Take cheque ${x.instrumentNo ?? ''} of ${x.payer}`}
                        />
                      </td>
                      <td>{dmy(x.receivedOn)}</td>
                      <td>{x.receiptNo ?? '—'}</td>
                      <td>
                        {x.payer}
                        {x.admissionNo ? ` (${x.admissionNo})` : ''}
                      </td>
                      <td>{x.section ?? '—'}</td>
                      <td>
                        {x.instrumentNo ?? '—'} <Badge tone="neutral">{x.mode.toUpperCase()}</Badge>
                      </td>
                      <td>{dmy(x.instrumentDate)}</td>
                      <td>
                        {x.bankName ?? '—'}{' '}
                        {account ? (
                          <Badge tone={x.sameBank ? 'info' : 'neutral'}>
                            {x.sameBank ? 'Same bank' : 'Other bank'}
                          </Badge>
                        ) : null}
                      </td>
                      <td style={{ textAlign: 'right' }}>{money(x.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={8}>
                      {pending.data.length} in hand
                    </th>
                    <th style={{ textAlign: 'right' }}>{money(total)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
            {canManage ? (
              pending.accounts.length === 0 ? (
                <p className="ep-field__help">
                  Add the school’s bank account first (Setup → School bank accounts).
                </p>
              ) : (
                <div style={{ marginTop: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-3)' }}>
                  <p className="ep-alert ep-alert--info" role="status" style={{ margin: 0 }}>
                    Going into <strong>{account!.bank}</strong> · …{account!.accountNo.slice(-4)}.{' '}
                    {limit > 0
                      ? `A slip holds up to ${String(limit)} cheques.`
                      : 'A slip has no limit of cheques.'}{' '}
                    If every cheque shown is taken: {slipsFor(same)} transfer slip
                    {slipsFor(same) === 1 ? '' : 's'} ({same} of the same bank) and{' '}
                    {slipsFor(other)} clearing slip{slipsFor(other) === 1 ? '' : 's'} ({other} of
                    other banks). Untick what stays in hand.
                  </p>
                  <FormRow columns={4}>
                    <InputField
                      id="depositOn"
                      name="depositOn"
                      label="Deposit date"
                      type="date"
                      required
                      defaultValue={today()}
                    />
                    <InputField id="remarks" name="remarks" label="Remarks" maxLength={200} />
                    <label
                      htmlFor="separate"
                      style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                    >
                      <input
                        id="separate"
                        type="checkbox"
                        name="separate"
                        value="yes"
                        defaultChecked
                      />
                      <span>Separate slips for same bank and other banks</span>
                    </label>
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <Button type="submit">Make deposit slips</Button>
                    </div>
                  </FormRow>
                </div>
              )
            ) : null}
          </form>
        )}
      </Card>
      {canManage ? (
        <Card title="Cheques on one slip">
          <form
            action={saveDepositSlipLimit}
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <label className="ep-field" htmlFor="limit" style={{ margin: 0 }}>
              <span className="ep-field__label">Most cheques and drafts on a slip</span>
              <input
                id="limit"
                name="limit"
                type="number"
                className="ep-input"
                min={0}
                max={500}
                list="limit-usual"
                defaultValue={limit}
                required
              />
              <datalist id="limit-usual">
                {[10, 20, 25, 30, 50].map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </label>
            <Button type="submit" variant="secondary">
              Save
            </Button>
            <span className="ep-field__help">
              As many lines as the bank’s slip has (10, 20, 25 …). More cheques than this are split
              over several slips by the system. 0 means no limit.
            </span>
          </form>
        </Card>
      ) : null}
      <Card title="Slips made this year">
        <form method="get" style={{ marginBottom: 'var(--sp-3)' }}>
          {/* the filters of the list above stay as they are */}
          {(['from', 'to', 'ledger', 'account', 'drawee'] as const).map((k) =>
            sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null,
          )}
          <FormRow columns={4}>
            <InputField
              id="sFrom"
              name="sFrom"
              label="Deposited from"
              type="date"
              defaultValue={sp.sFrom ?? ''}
            />
            <InputField
              id="sTo"
              name="sTo"
              label="Deposited to"
              type="date"
              defaultValue={sp.sTo ?? ''}
            />
            <SelectField
              id="sAccount"
              name="sAccount"
              label="Bank account"
              defaultValue={sp.sAccount ?? ''}
              options={[
                { value: '', label: 'All accounts' },
                ...first.accounts.map((a) => ({
                  value: a.id,
                  label: `${a.bank} · …${a.accountNo.slice(-4)}`,
                })),
              ]}
            />
            <SelectField
              id="sKind"
              name="sKind"
              label="Kind"
              defaultValue={sp.sKind ?? ''}
              options={[
                { value: '', label: 'All' },
                { value: 'transfer', label: 'Transfer (same bank)' },
                { value: 'clearing', label: 'Clearing (other banks)' },
                { value: 'none', label: 'Not separated' },
              ]}
            />
            <SelectField
              id="sStatus"
              name="sStatus"
              label="Status"
              defaultValue={sp.sStatus ?? ''}
              options={[
                { value: '', label: 'All' },
                { value: 'open', label: 'Made' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
            <InputField id="sNo" name="sNo" label="Slip no." defaultValue={sp.sNo ?? ''} />
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-2)' }}>
              <Button type="submit" variant="secondary">
                Apply
              </Button>
              <a className="ep-btn ep-btn--ghost" href="/fees/deposit-slips">
                Clear
              </a>
            </div>
          </FormRow>
        </form>
        <p className="ep-field__help">
          {slips.length} slip{slips.length === 1 ? '' : 's'} ·{' '}
          {money(slips.filter((x) => x.status === 'open').reduce((a, x) => a + Number(x.total), 0))}{' '}
          deposited
        </p>
        {slips.length === 0 ? (
          <p className="ep-field__help">No slip for these filters.</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Deposit slips of the year</caption>
              <thead>
                <tr>
                  <th scope="col">Slip no.</th>
                  <th scope="col">Deposit date</th>
                  <th scope="col">Bank account</th>
                  <th scope="col">Kind</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Cheques
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Amount
                  </th>
                  <th scope="col">Made by</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {slips.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <a href={`/fees/deposit-slips/${s.id}`}>Slip {s.slipNo}</a>
                    </td>
                    <td>{dmy(s.depositOn)}</td>
                    <td>
                      {s.account.bank} · …{s.account.accountNo.slice(-4)}
                    </td>
                    <td>{s.kind ? KIND[s.kind] : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{s.instruments}</td>
                    <td style={{ textAlign: 'right' }}>{money(s.total)}</td>
                    <td>{s.createdBy ?? '—'}</td>
                    <td>
                      <Badge tone={s.status === 'open' ? 'success' : 'neutral'}>
                        {s.status === 'open' ? 'Made' : 'Cancelled'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
