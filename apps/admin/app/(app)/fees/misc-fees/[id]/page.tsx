import { Badge, Card, PageHeader } from '@edupro/ui';
import { MiscAddPupils } from '@/components/fees/MiscAddPupils';
import { MiscRequests, type MiscRequest } from '@/components/fees/MiscRequests';
import { Notice } from '@/components/Notice';
import { FilterInput, FilterRow, Pager, rupees } from '@/components/RegisterTools';
import { apiFetch, getMe } from '@/lib/api';
import { miscAddPupils, miscChange, miscFindPupils, miscReadSheet } from '@/lib/misc-fee-actions';
import { sectionOptions } from '@/lib/sections';
import type { ClassRow, Page } from '@/lib/types';

interface Fee {
  id: string;
  title: string;
  head: string;
  amount: string;
  lastDate: string;
  remark: string | null;
  mandatory: boolean;
  seats: number | null;
  status: 'pending' | 'announced' | 'rejected' | 'closed';
  requestedBy: string | null;
  pupils: number;
  billed: string;
  collected: string;
  paidPupils: number;
  waitingWith: string | null;
}
interface Line {
  id: string;
  studentId: string;
  student: string;
  admissionNo: string;
  class: string | null;
  amount: string;
  paid: string;
  balance: string;
  lastDate: string;
  ownDate: boolean;
  ownAmount: boolean;
  status: 'open' | 'paid' | 'cancelled';
}
const STATUS: Record<Fee['status'], [string, 'success' | 'warning' | 'danger' | 'neutral']> = {
  pending: ['Waiting for approval', 'warning'],
  announced: ['Announced', 'success'],
  rejected: ['Rejected', 'danger'],
  closed: ['Closed', 'neutral'],
};
const dmy = (v: string) => v.slice(0, 10).split('-').reverse().join('-');

/** One misc fee: its figures, its pupils (each can carry their own amount and last date), its requests. */
export default async function MiscFeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [data, me] = await Promise.all([
    apiFetch<{ fee: Fee; lines: Line[]; requests: MiscRequest[] }>(`/fees/misc-fees/${id}`),
    getMe(),
  ]);
  const { fee } = data;
  const canPost = me.permissions.includes('fees.misc.post') && fee.status === 'announced';
  const canDecide = me.permissions.includes('fees.adjustment.approve');
  const canRemind = me.permissions.includes('fees.defaulter.notify') && fee.status === 'announced';
  const [classes, sections] = canPost
    ? await Promise.all([
        apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
        sectionOptions(),
      ])
    : [[] as ClassRow[], [] as Array<{ value: string; label: string }>];
  const q = (sp.q ?? '').trim().toLowerCase().slice(0, 80);
  const pay = ['paid', 'due', 'part'].includes(sp.pay ?? '') ? sp.pay! : '';
  const shown = data.lines.filter(
    (l) =>
      (!q || l.student.toLowerCase().includes(q) || l.admissionNo.toLowerCase().includes(q)) &&
      (!pay ||
        (pay === 'paid' && l.status === 'paid') ||
        (pay === 'due' && l.status === 'open') ||
        (pay === 'part' && l.status === 'open' && Number(l.paid) > 0)),
  );
  const size = 100;
  const page = Math.min(
    Math.max(1, Number(sp.page) || 1),
    Math.max(1, Math.ceil(shown.length / size)),
  );
  const rows = shown.slice((page - 1) * size, page * size);
  const here = (over: Record<string, string>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, pay, ...over })) if (v) u.set(k, v);
    return `/fees/misc-fees/${id}?${u.toString()}`;
  };
  const balance = Number(fee.billed) - Number(fee.collected);
  return (
    <>
      <PageHeader
        kicker="Fees · Misc fees"
        title={fee.title}
        description={`${fee.head} · ${fee.mandatory ? 'Mandatory' : 'Optional'} · last date ${dmy(fee.lastDate)}${fee.seats === null ? '' : ` · ${String(fee.seats)} seats`}${fee.remark ? ` · ${fee.remark}` : ''}`}
      />
      <Notice params={sp} />
      <Card title="At a glance">
        <p style={{ display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap', margin: 0 }}>
          <span>
            <Badge tone={STATUS[fee.status][1]}>{STATUS[fee.status][0]}</Badge>
            {fee.status === 'pending' && fee.waitingWith ? ` ${fee.waitingWith}` : ''}
          </span>
          <span>
            Amount <strong>{rupees(fee.amount)}</strong>
          </span>
          <span>
            Pupils <strong>{fee.pupils}</strong>
          </span>
          <span>
            Paid in full <strong>{fee.paidPupils}</strong>
            {fee.seats === null ? '' : ` of ${String(fee.seats)} seats`}
          </span>
          <span>
            Billed <strong>{rupees(fee.billed)}</strong>
          </span>
          <span>
            Collected <strong>{rupees(fee.collected)}</strong>
          </span>
          <span>
            Balance <strong>{rupees(balance)}</strong>
          </span>
        </p>
        <p
          style={{
            display: 'flex',
            gap: 'var(--sp-2)',
            flexWrap: 'wrap',
            marginBottom: 0,
          }}
        >
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/fees/misc-fees">
            ← All misc fees
          </a>
          {canRemind ? (
            <>
              <a
                className="ep-btn ep-btn--primary ep-btn--sm"
                href={`/fees/reminders/new?misc=1&miscFeeId=${fee.id}&pay=all`}
              >
                Send the announcement to parents
              </a>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/fees/reminders/new?misc=1&miscFeeId=${fee.id}&pay=due`}
              >
                Remind those who have not paid
              </a>
            </>
          ) : null}
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/fees/reports?report=misc_dues&miscFeeId=${fee.id}`}
          >
            Dues report (Excel, PDF)
          </a>
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/fees/misc-fees/collect">
            Counter collection
          </a>
        </p>
      </Card>
      {canPost ? (
        <Card title="Changes (each goes for approval)" style={{ marginTop: 'var(--sp-4)' }}>
          <details>
            <summary>Extend the last date for everyone</summary>
            <form
              action={miscChange}
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'flex-end',
                flexWrap: 'wrap',
                marginTop: 'var(--sp-3)',
              }}
            >
              <input type="hidden" name="feeId" value={fee.id} />
              <input type="hidden" name="kind" value="extend" />
              <label className="ep-field" htmlFor="ext-date" style={{ margin: 0 }}>
                <span className="ep-field__label">New last date</span>
                <input
                  id="ext-date"
                  name="lastDate"
                  type="date"
                  className="ep-input"
                  required
                  defaultValue={fee.lastDate}
                />
              </label>
              <label className="ep-field" htmlFor="ext-reason" style={{ margin: 0 }}>
                <span className="ep-field__label">Reason</span>
                <input
                  id="ext-reason"
                  name="reason"
                  className="ep-input"
                  required
                  minLength={3}
                  maxLength={300}
                />
              </label>
              <button type="submit" className="ep-btn ep-btn--primary">
                Send for approval
              </button>
            </form>
            <p className="ep-field__help">
              A pupil whose own last date is earlier moves to the new date too; a pupil given a
              later date keeps it.
            </p>
          </details>
          <details style={{ marginTop: 'var(--sp-3)' }}>
            <summary>Add more pupils</summary>
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <MiscAddPupils
                feeId={fee.id}
                classes={classes.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
                sections={sections}
                add={miscAddPupils}
                findPupils={miscFindPupils}
                readSheet={miscReadSheet}
              />
            </div>
          </details>
          <details style={{ marginTop: 'var(--sp-3)' }}>
            <summary>Close the fee (no more collection)</summary>
            <form
              action={miscChange}
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'flex-end',
                flexWrap: 'wrap',
                marginTop: 'var(--sp-3)',
              }}
            >
              <input type="hidden" name="feeId" value={fee.id} />
              <input type="hidden" name="kind" value="close" />
              <label className="ep-field" htmlFor="close-reason" style={{ margin: 0 }}>
                <span className="ep-field__label">Reason</span>
                <input
                  id="close-reason"
                  name="reason"
                  className="ep-input"
                  required
                  minLength={3}
                  maxLength={300}
                />
              </label>
              <button type="submit" className="ep-btn ep-btn--danger">
                Send for approval
              </button>
            </form>
          </details>
        </Card>
      ) : null}
      <Card title={`Pupils · ${String(shown.length)}`} style={{ marginTop: 'var(--sp-4)' }}>
        <FilterRow clearHref={`/fees/misc-fees/${id}`}>
          <FilterInput id="q" label="Pupil or admission no." value={sp.q ?? ''} />
          <label className="ep-field" htmlFor="pay" style={{ margin: 0 }}>
            <span className="ep-field__label">Payment</span>
            <select id="pay" name="pay" className="ep-select" defaultValue={pay}>
              <option value="">All</option>
              <option value="paid">Paid</option>
              <option value="due">Not paid in full</option>
              <option value="part">Part paid</option>
            </select>
          </label>
        </FilterRow>
        {rows.length === 0 ? (
          <p className="ep-field__help">No pupil for these filters.</p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Pupils of the fee">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Pupils of the fee</caption>
              <thead>
                <tr>
                  <th scope="col">Admission no.</th>
                  <th scope="col">Pupil</th>
                  <th scope="col">Class</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Amount
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Paid
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Balance
                  </th>
                  <th scope="col">Last date</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td>{l.admissionNo}</td>
                    <td>{l.student}</td>
                    <td>{l.class ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {rupees(l.amount)}
                      {l.ownAmount ? ' *' : ''}
                    </td>
                    <td style={{ textAlign: 'right' }}>{rupees(l.paid)}</td>
                    <td style={{ textAlign: 'right' }}>{rupees(l.balance)}</td>
                    <td>
                      {dmy(l.lastDate)}
                      {l.ownDate ? ' *' : ''}
                    </td>
                    <td>
                      <Badge
                        tone={
                          l.status === 'paid'
                            ? 'success'
                            : Number(l.paid) > 0
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {l.status === 'paid'
                          ? 'Paid'
                          : l.status === 'cancelled'
                            ? 'Removed'
                            : Number(l.paid) > 0
                              ? 'Part paid'
                              : 'Unpaid'}
                      </Badge>
                    </td>
                    <td>
                      <a href={`/fees/misc-fees/collect?studentId=${l.studentId}`}>Collect</a>
                      {canPost ? (
                        <details>
                          <summary>Change amount or date</summary>
                          <form
                            action={miscChange}
                            style={{ display: 'grid', gap: 'var(--sp-2)', minWidth: '14rem' }}
                          >
                            <input type="hidden" name="feeId" value={fee.id} />
                            <input type="hidden" name="kind" value="pupil_change" />
                            <input type="hidden" name="lineId" value={l.id} />
                            <input
                              name="amount"
                              type="number"
                              min={0}
                              step="0.01"
                              className="ep-input"
                              placeholder={`Amount (now ${l.amount})`}
                              aria-label={`New amount for ${l.student}`}
                            />
                            <input
                              name="lastDate"
                              type="date"
                              className="ep-input"
                              aria-label={`New last date for ${l.student}`}
                            />
                            <input
                              name="reason"
                              className="ep-input"
                              required
                              minLength={3}
                              maxLength={300}
                              placeholder="Reason"
                              aria-label={`Reason for ${l.student}`}
                            />
                            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                              Send for approval
                            </button>
                          </form>
                        </details>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="ep-field__help">
          * the pupil’s own amount or last date, different from the fee’s.
        </p>
        <Pager
          page={page}
          pages={Math.ceil(shown.length / size)}
          hrefFor={(p) => here({ page: String(p) })}
        />
      </Card>
      <Card title="Requests" style={{ marginTop: 'var(--sp-4)' }}>
        <MiscRequests
          rows={data.requests}
          canDecide={canDecide}
          back={`/fees/misc-fees/${id}`}
          showFee={false}
        />
      </Card>
    </>
  );
}
