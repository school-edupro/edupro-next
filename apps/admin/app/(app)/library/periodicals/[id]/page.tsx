import { Badge, Breadcrumbs } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { IssueActions, SubscriptionTools } from '@/components/library/Periodicals';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import {
  SUBSCRIPTION_STATE,
  SUBSCRIPTION_TONE,
  dmy,
  type SubscriptionView,
} from '@/lib/library-books';
import { renewSubscription } from '@/lib/library-books-actions';

/**
 * A subscription (docs/design/36-library.md, part 6): the periodical, the period, the copies and the
 * cost; its issues expected, received, late or missing, each received or marked here; renew, cancel, a
 * special issue.
 */
export default async function SubscriptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const s = await apiFetch<SubscriptionView>(`/library/subscriptions/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const count = (st: string) => s.issues.filter((i) => i.status === st).length;
  const late = s.issues.filter((i) => i.late).length;
  const facts: Array<[string, string | null]> = [
    ['Library', s.library],
    ['Vendor', s.vendor],
    ['Frequency', s.frequency],
    ['Period', `${dmy(s.startsOn)} to ${dmy(s.endsOn)}`],
    ['First issue', dmy(s.firstIssueOn)],
    ['Copies of each', String(s.copies)],
    ['Cost', s.cost ? `₹${s.cost}` : null],
    ['Order no.', s.orderNo],
    ['Bill', s.billNo ? `${s.billNo}${s.billDate ? ` of ${dmy(s.billDate)}` : ''}` : null],
    ['Late after', `${String(s.graceDays)} days`],
    ['ISSN', s.issn],
  ];
  const open = s.status !== 'cancelled' && s.can.manage;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Library', href: '/library' },
          { label: 'Periodicals', href: '/library/periodicals?tab=subscriptions' },
          { label: s.periodical },
        ]}
      />
      <Notice params={sp} />
      <section className="ep-hero ep-book__hero" aria-label="The subscription">
        <div className="ep-hero__main">
          <div className="ep-hero__title">
            <h1>{s.periodical}</h1>
            {s.kind ? <Badge tone="info">{s.kind}</Badge> : null}
            <Badge tone={SUBSCRIPTION_TONE[s.state]}>{SUBSCRIPTION_STATE[s.state]}</Badge>
          </div>
          {s.status === 'cancelled' ? (
            <p className="ep-hero__line">
              Cancelled from {dmy(s.cancelledOn)}: {s.cancelReason}
            </p>
          ) : null}
          <dl className="ep-hero__facts">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          {s.notes ? <p className="ep-field__help">{s.notes}</p> : null}
          {s.renewedFrom || s.renewedBy ? (
            <p className="ep-field__help">
              {s.renewedFrom ? (
                <>
                  Renewed from{' '}
                  <a href={`/library/periodicals/${s.renewedFrom}`}>the period before</a>.{' '}
                </>
              ) : null}
              {s.renewedBy ? (
                <>
                  Renewed for <a href={`/library/periodicals/${s.renewedBy}`}>the next period</a>.
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="ep-hero__side">
          <dl className="ep-hero__facts ep-book__counts" aria-label="Issues">
            <div>
              <dt>Issues</dt>
              <dd>{s.issues.length}</dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd>{count('received')}</dd>
            </div>
            <div>
              <dt>Late</dt>
              <dd>{late}</dd>
            </div>
            <div>
              <dt>Missing</dt>
              <dd>{count('missing')}</dd>
            </div>
          </dl>
          {open ? (
            <div className="ep-hero__actions">
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/library/periodicals/${s.id}/edit`}
              >
                Edit
              </a>
              {!s.renewedBy ? (
                <ConfirmAction
                  action={renewSubscription}
                  fields={{ id: s.id }}
                  label="Renew"
                  variant="secondary"
                  title={`Renew ${s.periodical}?`}
                  confirmLabel="Renew"
                >
                  A new subscription from {dmy(s.endsOn)} on, as long as this one, with the same
                  copies, vendor and cost; its issues are expected at once. The bill and order come
                  when you edit it.
                </ConfirmAction>
              ) : null}
              <SubscriptionTools s={s} />
            </div>
          ) : null}
        </div>
      </section>
      <section className="ep-card ep-acr-card" aria-labelledby="sb-issues-h">
        <h2 id="sb-issues-h" className="ep-card__title">
          Issues
        </h2>
        <div
          className="ep-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Issues (scrolls sideways)"
        >
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Issues of {s.periodical}</caption>
            <thead>
              <tr>
                <th scope="col">Issue</th>
                <th scope="col">Expected</th>
                <th scope="col">Status</th>
                <th scope="col">Received</th>
                <th scope="col">Remarks</th>
                {open ? (
                  <th scope="col">
                    <span className="ep-sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {s.issues.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.label}
                    {i.special ? (
                      <>
                        {' '}
                        <Badge tone="info">Special</Badge>
                      </>
                    ) : null}
                    {i.volume || i.issueNo ? (
                      <div className="ep-field__help">
                        {[
                          i.volume ? `Vol. ${i.volume}` : null,
                          i.issueNo ? `No. ${i.issueNo}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    ) : null}
                  </td>
                  <td>{dmy(i.expectedOn)}</td>
                  <td>
                    {i.status === 'received' ? (
                      <Badge tone="success">Received</Badge>
                    ) : i.status === 'missing' ? (
                      <Badge tone="danger">Missing</Badge>
                    ) : i.late ? (
                      <Badge tone="warning">Late</Badge>
                    ) : (
                      <Badge tone="neutral">Expected</Badge>
                    )}
                  </td>
                  <td>
                    {i.receivedOn ? `${dmy(i.receivedOn)} · ${String(i.copiesReceived ?? 0)}` : '—'}
                    {i.by ? <div className="ep-field__help">{i.by}</div> : null}
                  </td>
                  <td>{i.remarks ?? ''}</td>
                  {open ? (
                    <td>
                      <IssueActions issue={i} copies={s.copies} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
