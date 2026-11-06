import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { inr, type RequisitionCandidate } from '@/lib/purchase';
import { closeIndent, makeRequisition } from '@/lib/purchase-actions';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));

/**
 * To requisition (docs/design/83, part 3): the approved indents waiting for the purchase office. Tick
 * several (of any departments) to make one requisition — the same item's lines are added up and every
 * indent line is kept with it — or close one that will not be bought.
 */
export default async function ToRequisitionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('purchase.requisition.manage')) notFound();
  const data = await apiFetch<{
    data: RequisitionCandidate[];
    purchaseDepartmentId: string | null;
  }>('/purchase/requisition-candidates');
  const departments = new Set(data.data.map((p) => p.departmentId)).size;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase Requisitions', href: '/purchase/requisitions' },
          { label: 'To requisition' },
        ]}
      />
      <PageHeader
        kicker="Purchase"
        title="To requisition"
        description="Approved indents waiting for a requisition. Tick the ones to buy together: their lines for the same item are added up, and each indent stays linked to its line."
      />
      <Notice params={sp} />
      {departments > 1 && !data.purchaseDepartmentId ? (
        <p className="ep-alert ep-alert--warning" role="status">
          To combine departments in one requisition, set the department whose levels approve such
          requisitions on <a href="/purchase/settings">Purchase settings</a>.
        </p>
      ) : null}
      {data.data.length ? (
        <>
          <form id="make-pr" action={makeRequisition} />
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Indents to requisition"
          >
            <table className="ep-table">
              <caption className="ep-sr-only">Approved indents waiting for a requisition</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="ep-sr-only">Pick</span>
                  </th>
                  <th scope="col">Indent</th>
                  <th scope="col">Department</th>
                  <th scope="col">Lines</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Estimate
                  </th>
                  <th scope="col">
                    <span className="ep-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <label className="ep-check" htmlFor={`tr-${p.id}`}>
                        <input
                          id={`tr-${p.id}`}
                          className="ep-check__input"
                          type="checkbox"
                          name="indentId"
                          value={p.id}
                          form="make-pr"
                        />
                        <span className="ep-check__box" />
                        <span className="ep-sr-only">Pick {p.number}</span>
                      </label>
                    </td>
                    <td>
                      <a href={`/purchase/indents/${p.id}`}>{p.number}</a>
                      {p.priority === 'urgent' ? (
                        <>
                          {' '}
                          <Badge tone="danger">Urgent</Badge>
                        </>
                      ) : null}
                      <span className="ep-mr-col__desc">
                        {p.purpose} · {p.raisedBy}
                        {p.requiredBy
                          ? ` · needed by ${when(`${p.requiredBy}T00:00:00+05:30`)}`
                          : ''}
                      </span>
                      {p.note ? <span className="ep-mr-col__desc">{p.note}</span> : null}
                    </td>
                    <td>{p.department}</td>
                    <td>
                      {p.lines
                        .map(
                          (l) =>
                            `${l.item} × ${String(l.quantity)} ${l.uom}${l.inCatalogue ? '' : ' (in words)'}`,
                        )
                        .join('; ')}
                    </td>
                    <td style={{ textAlign: 'right' }}>{inr(p.estimate)}</td>
                    <td>
                      <ConfirmAction
                        action={closeIndent}
                        fields={{ id: p.id }}
                        label="Close"
                        title={`Close ${p.number}?`}
                        confirmLabel="Close the indent"
                        variant="ghost"
                        confirmVariant="danger"
                        reason={{ label: 'Why it is not bought (the raiser sees it)' }}
                      >
                        It leaves this list without a requisition, e.g. issued from stock or no
                        longer needed.
                      </ConfirmAction>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <button type="submit" form="make-pr" className="ep-btn ep-btn--primary">
              Make a requisition from the ticked indents
            </button>
          </div>
        </>
      ) : (
        <p>No approved indent is waiting for a requisition.</p>
      )}
    </>
  );
}
