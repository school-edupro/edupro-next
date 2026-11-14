import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { REV_STATUS, dmy, monthLabel } from '@/components/payroll/people/PeopleTabs';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { money } from '@/lib/payroll';
import { revisionStep } from '@/lib/payroll-people-actions';

interface Sim {
  revision: {
    id: string;
    kind: string;
    detail: Record<string, unknown>;
    effectiveFrom: string;
    reason: string;
    status: string;
    mine?: boolean;
    createdBy?: string;
  };
  firstOpenMonth: string;
  records: number;
  employees: number;
  total: string;
  items: Array<{
    code: string;
    name: string;
    head: string;
    month: string;
    paid: string;
    due: string;
    arrear: string;
  }>;
  skipped: unknown[];
}

/**
 * A revision (docs/design/86, phase E): what applying it pays — the arrears by employee, head and month, worked out
 * again through the engine — and from which month the new figure holds; applied by a checker who did not draft it.
 * An increment's letters print from here.
 */
export default async function RevisionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  let s: Sim;
  let letters: Array<{
    id: string;
    letterNo: string;
    code: string;
    name: string;
    effectiveFrom: string;
  }> = [];
  try {
    s = await apiFetch<Sim>(`/payroll/revisions/${id}/simulate`);
    letters = (await apiFetch<{ rows: typeof letters }>(`/payroll/revisions/${id}/letters`)).rows;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const r = s.revision;
  const title =
    r.kind === 'RATE'
      ? `${String(r.detail.rateCode)} to ${String(r.detail.newValue)}`
      : r.kind === 'FORMULA'
        ? `${String(r.detail.headCode)}: new formula`
        : `Increments of ${monthLabel(r.effectiveFrom.slice(0, 7))}`;
  const byPerson = new Map<string, { name: string; total: number; lines: Sim['items'] }>();
  for (const x of s.items) {
    const p = byPerson.get(x.code) ?? { name: x.name, total: 0, lines: [] };
    p.total += Number(x.arrear);
    p.lines.push(x);
    byPerson.set(x.code, p);
  }
  const draft = r.status === 'DRAFT';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Payroll' },
          { label: 'Pay changes and leavers', href: '/payroll/people?tab=revisions' },
          { label: title },
        ]}
      />
      <PageHeader
        kicker="Revision"
        title={title}
        description={`${r.reason} · from ${dmy(r.effectiveFrom)}`}
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis">
        <KpiTile label="Status" value={REV_STATUS[r.status]?.[0] ?? r.status} />
        <KpiTile label="Arrears" value={`₹${money(s.total)}`} />
        <KpiTile label="Staff" value={String(s.employees)} />
        <KpiTile label="Months looked at" value={String(s.records)} />
        <KpiTile label="New figure from" value={monthLabel(s.firstOpenMonth)} />
        <KpiTile label="Letters" value={String(letters.length)} />
      </div>
      {draft ? (
        <section className="ep-card" aria-labelledby="rv-do">
          <h2 id="rv-do" className="ep-card__title">
            Apply or cancel
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Applying writes the arrears above for the next run and the new figure from{' '}
            {monthLabel(s.firstOpenMonth)}. A checker who did not draft it applies it.
          </p>
          <div className="ep-grid__toolbar">
            {me.permissions.includes('payroll.run.approve') ? (
              <form action={revisionStep.bind(null, id, 'apply')}>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Apply
                </button>
              </form>
            ) : null}
            {me.permissions.includes('payroll.run.manage') ? (
              <form action={revisionStep.bind(null, id, 'cancel')}>
                <button type="submit" className="ep-btn ep-btn--ghost">
                  Cancel the draft
                </button>
              </form>
            ) : null}
          </div>
        </section>
      ) : (
        <p className="ep-card">
          <Badge tone={REV_STATUS[r.status]?.[1] ?? 'neutral'}>
            {REV_STATUS[r.status]?.[0] ?? r.status}
          </Badge>{' '}
          {r.status === 'APPLIED'
            ? 'The arrears wait for the next run; the figures above are worked out again now.'
            : null}
        </p>
      )}
      {letters.length ? (
        <section className="ep-card" aria-labelledby="rv-lt">
          <h2 id="rv-lt" className="ep-card__title">
            Letters
          </h2>
          <div className="ep-grid__toolbar">
            <span className="ep-field__help">All the letters, a page each</span>
            <FileLinks
              href={`/api/payroll/pay-file?kind=letters&id=${id}`}
              label="all the letters"
            />
          </div>
          <ul className="ep-list">
            {letters.map((l) => (
              <li key={l.id}>
                {l.letterNo} · {l.name} <span className="ep-field__help">{l.code}</span>{' '}
                <FileLinks
                  href={`/api/payroll/pay-file?kind=letter&id=${l.id}`}
                  label={`letter ${l.letterNo}`}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <FoldCard
        id="rv-items"
        title={`Arrears by employee (${String(byPerson.size)})`}
        hint="Each locked month worked out again, head by head, against what was paid"
        open={byPerson.size > 0 && byPerson.size <= 10}
      >
        {byPerson.size ? (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Arrears by employee"
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Month</th>
                  <th scope="col">Head</th>
                  <th scope="col">Paid (₹)</th>
                  <th scope="col">Due (₹)</th>
                  <th scope="col">Arrear (₹)</th>
                </tr>
              </thead>
              <tbody>
                {[...byPerson.entries()].flatMap(([code, p]) =>
                  p.lines.map((x, i) => (
                    <tr key={`${code}-${x.month}-${x.head}`}>
                      <td>
                        {i === 0 ? (
                          <>
                            {p.name} <span className="ep-field__help">{code}</span>
                          </>
                        ) : null}
                      </td>
                      <td>{monthLabel(x.month)}</td>
                      <td>{x.head}</td>
                      <td>{money(x.paid)}</td>
                      <td>{money(x.due)}</td>
                      <td>{money(x.arrear)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            No locked month changes: the new figure simply holds from {monthLabel(s.firstOpenMonth)}
            .
          </p>
        )}
      </FoldCard>
    </>
  );
}
