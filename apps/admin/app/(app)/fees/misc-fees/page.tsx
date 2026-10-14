import { Badge, Card, PageHeader } from '@edupro/ui';
import { MiscAnnounce } from '@/components/fees/MiscAnnounce';
import { MiscRequests, type MiscRequest } from '@/components/fees/MiscRequests';
import { Notice } from '@/components/Notice';
import { FilterInput, FilterRow, Pager, rupees } from '@/components/RegisterTools';
import { apiFetch, getMe } from '@/lib/api';
import { miscAnnounce, miscFindPupils, miscReadSheet } from '@/lib/misc-fee-actions';
import { sectionOptions } from '@/lib/sections';
import type { ClassRow, Page } from '@/lib/types';

export interface MiscFee {
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
  openRequests: number;
  waitingWith: string | null;
}
const STATUS: Record<MiscFee['status'], [string, 'success' | 'warning' | 'danger' | 'neutral']> = {
  pending: ['Waiting for approval', 'warning'],
  announced: ['Announced', 'success'],
  rejected: ['Rejected', 'danger'],
  closed: ['Closed', 'neutral'],
};
const dmy = (v: string) => v.slice(0, 10).split('-').reverse().join('-');
const TABS = [
  ['fees', 'Misc fees'],
  ['announce', 'Announce a fee'],
  ['requests', 'Requests'],
] as const;

/**
 * Misc fees announced to pupils (a trip, an activity, an exam form): the list, a new announcement and
 * the requests waiting. Collection is at the counter; dues are a report of the Reports centre.
 */
export default async function MiscFeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canPost = me.permissions.includes('fees.misc.post');
  const canDecide = me.permissions.includes('fees.adjustment.approve');
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as (typeof TABS)[number][0]) : 'fees';
  const status = ['pending', 'announced', 'rejected', 'closed'].includes(sp.status ?? '')
    ? sp.status!
    : '';
  const headId = /^\d{1,18}$/.test(sp.headId ?? '') ? sp.headId! : '';
  const q = (sp.q ?? '').trim().slice(0, 80);
  const page = Math.max(1, Number(sp.page) || 1);
  const size = 50;
  const heads =
    await apiFetch<Array<{ id: string; code: string; name: string }>>('/fees/misc-fees/heads');
  const qs = new URLSearchParams({ page: String(page), size: String(size) });
  if (status) qs.set('status', status);
  if (headId) qs.set('headId', headId);
  if (q) qs.set('q', q);
  const [list, requests, classes, sections] = await Promise.all([
    tab === 'fees'
      ? apiFetch<{ rows: MiscFee[]; total: number }>(`/fees/misc-fees?${qs.toString()}`)
      : Promise.resolve({ rows: [] as MiscFee[], total: 0 }),
    tab === 'requests'
      ? apiFetch<MiscRequest[]>(
          `/fees/misc-fees/requests${['pending', 'approved', 'rejected'].includes(sp.rs ?? '') ? `?status=${sp.rs!}` : ''}`,
        )
      : Promise.resolve([] as MiscRequest[]),
    tab === 'announce'
      ? apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data)
      : Promise.resolve([] as ClassRow[]),
    tab === 'announce' ? sectionOptions() : Promise.resolve([]),
  ]);
  const here = (over: Record<string, string>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, status, headId, q, ...over })) if (v) u.set(k, v);
    return `/fees/misc-fees?${u.toString()}`;
  };
  return (
    <>
      <PageHeader
        kicker="Fees"
        title="Misc fees"
        description="Announce a misc fee to classes, sections or pupils, with a last date, optional or mandatory, with limited seats where needed. Every announcement and change goes through Fee setup → Approval levels."
      />
      <Notice params={sp} />
      <nav
        aria-label="Misc fees"
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
          marginBottom: 'var(--sp-4)',
        }}
      >
        {TABS.filter(([k]) => k !== 'announce' || canPost).map(([k, label]) => (
          <a
            key={k}
            className={`ep-btn ep-btn--sm ${k === tab ? 'ep-btn--primary' : 'ep-btn--ghost'}`}
            aria-current={k === tab ? 'page' : undefined}
            href={`/fees/misc-fees?tab=${k}`}
          >
            {label}
          </a>
        ))}
        <a className="ep-btn ep-btn--sm ep-btn--ghost" href="/fees/misc-fees/collect">
          Counter collection
        </a>
        <a className="ep-btn ep-btn--sm ep-btn--ghost" href="/fees/reports?report=misc_dues">
          Dues report
        </a>
      </nav>
      {tab === 'announce' && canPost ? (
        heads.length === 0 ? (
          <Card title="Announce a fee">
            <p>
              No misc fee head yet. Add one under{' '}
              <a href="/fees/masters" style={{ textDecoration: 'underline' }}>
                Fee setup → Fee heads
              </a>{' '}
              with the kind “misc”, then come back.
            </p>
          </Card>
        ) : (
          <MiscAnnounce
            heads={heads.map((h) => ({ value: h.id, label: `${h.code} · ${h.name}` }))}
            classes={classes.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
            sections={sections}
            announce={miscAnnounce}
            findPupils={miscFindPupils}
            readSheet={miscReadSheet}
          />
        )
      ) : null}
      {tab === 'requests' ? (
        <Card title="Requests">
          <nav
            aria-label="Request status"
            style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}
          >
            {[
              ['', 'All'],
              ['pending', 'Waiting'],
              ['approved', 'Approved'],
              ['rejected', 'Rejected'],
            ].map(([k, label]) => (
              <a
                key={k}
                className={`ep-btn ep-btn--sm ${(sp.rs ?? '') === k ? 'ep-btn--secondary' : 'ep-btn--ghost'}`}
                href={`/fees/misc-fees?tab=requests${k ? `&rs=${k!}` : ''}`}
              >
                {label}
              </a>
            ))}
          </nav>
          <MiscRequests
            rows={requests}
            canDecide={canDecide}
            back={`/fees/misc-fees?tab=requests${sp.rs ? `&rs=${sp.rs}` : ''}`}
          />
        </Card>
      ) : null}
      {tab === 'fees' ? (
        <Card title="Misc fees of the year">
          <FilterRow clearHref="/fees/misc-fees">
            <label className="ep-field" htmlFor="status" style={{ margin: 0 }}>
              <span className="ep-field__label">Status</span>
              <select id="status" name="status" className="ep-select" defaultValue={status}>
                <option value="">All</option>
                {Object.entries(STATUS).map(([k, [label]]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="headId" style={{ margin: 0 }}>
              <span className="ep-field__label">Head</span>
              <select id="headId" name="headId" className="ep-select" defaultValue={headId}>
                <option value="">All</option>
                {heads.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <FilterInput id="q" label="Name of the fee" value={q} />
          </FilterRow>
          <p className="ep-field__help" aria-live="polite">
            {list.total
              ? `Showing ${String((page - 1) * size + 1)}–${String(Math.min(page * size, list.total))} of ${String(list.total)}`
              : 'No misc fee for these filters'}
          </p>
          {list.rows.length ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Misc fees">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Misc fees of the year</caption>
                <thead>
                  <tr>
                    <th scope="col">Fee</th>
                    <th scope="col">Head</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Amount
                    </th>
                    <th scope="col">Last date</th>
                    <th scope="col">For parents</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Seats
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Pupils
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Paid
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Billed
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Collected
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <a href={`/fees/misc-fees/${f.id}`}>{f.title}</a>
                      </td>
                      <td>{f.head}</td>
                      <td style={{ textAlign: 'right' }}>{rupees(f.amount)}</td>
                      <td>{dmy(f.lastDate)}</td>
                      <td>{f.mandatory ? 'Mandatory' : 'Optional'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {f.seats === null ? '—' : `${String(f.paidPupils)} of ${String(f.seats)}`}
                      </td>
                      <td style={{ textAlign: 'right' }}>{f.pupils}</td>
                      <td style={{ textAlign: 'right' }}>{f.paidPupils}</td>
                      <td style={{ textAlign: 'right' }}>{rupees(f.billed)}</td>
                      <td style={{ textAlign: 'right' }}>{rupees(f.collected)}</td>
                      <td>
                        <Badge tone={STATUS[f.status][1]}>{STATUS[f.status][0]}</Badge>
                        {f.status === 'pending' && f.waitingWith ? ` ${f.waitingWith}` : ''}
                        {f.status !== 'pending' && f.openRequests
                          ? ` · ${String(f.openRequests)} request(s) waiting`
                          : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <Pager
            page={page}
            pages={Math.ceil(list.total / size)}
            hrefFor={(p) => here({ page: String(p) })}
          />
        </Card>
      ) : null}
    </>
  );
}
