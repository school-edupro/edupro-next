import { Badge, Button, Card, FormRow, InputField, PageHeader, SelectField } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { createDepositSlip } from '@/lib/fee-setup-actions';

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
}

const money = (v: string | number) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

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
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canManage = me.permissions.includes('fees.deposit_slip.manage');
  const q = new URLSearchParams();
  if (sp.from) q.set('from', sp.from);
  if (sp.to) q.set('to', sp.to);
  if (sp.ledger) q.set('ledger', sp.ledger);
  const [pending, slips] = await Promise.all([
    apiFetch<{ data: Instrument[]; accounts: Account[] }>(
      `/fees/deposit-slips/pending?${q.toString()}`,
    ),
    apiFetch<{ data: Slip[] }>('/fees/deposit-slips').then((r) => r.data),
  ]);
  const total = pending.data.reduce((a, x) => a + Number(x.amount), 0);
  return (
    <>
      <PageHeader
        kicker="Fees"
        title="Bank deposit slips"
        description="Tick the cheques and drafts going to the bank, choose the school account and the date, and print the slip. A cheque can sit on one slip only."
      />
      <Notice params={sp} />
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
                      <td>{x.bankName ?? '—'}</td>
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
                <div style={{ marginTop: 'var(--sp-4)' }}>
                  <FormRow columns={4}>
                    <SelectField
                      id="bankAccountId"
                      name="bankAccountId"
                      label="Deposit into"
                      required
                      options={pending.accounts.map((a) => ({
                        value: a.id,
                        label: `${a.bank} · ${a.accountName} · …${a.accountNo.slice(-4)}`,
                      }))}
                    />
                    <InputField
                      id="depositOn"
                      name="depositOn"
                      label="Deposit date"
                      type="date"
                      required
                      defaultValue={today()}
                    />
                    <InputField id="remarks" name="remarks" label="Remarks" maxLength={200} />
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <Button type="submit">Make deposit slip</Button>
                    </div>
                  </FormRow>
                </div>
              )
            ) : null}
          </form>
        )}
      </Card>
      <Card title="Slips made this year">
        {slips.length === 0 ? (
          <p className="ep-field__help">No slip yet.</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Deposit slips of the year</caption>
              <thead>
                <tr>
                  <th scope="col">Slip no.</th>
                  <th scope="col">Deposit date</th>
                  <th scope="col">Bank account</th>
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
