import { Alert, Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { CountSheet } from '@/components/purchase/CountSheet';
import { ApiError, apiFetch } from '@/lib/api';
import { COUNT_STATUS, type CountDetail, type StoreFormLists } from '@/lib/purchase';
import { approveCount, cancelCount, sendBackCount, submitCount } from '@/lib/purchase-actions';

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso))
    : '—';
const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/**
 * One physical count (docs/design/84, part 8): the keeper counts (on screen or from the Excel sheet)
 * and sends it; the school admin sees book, counted and the differences with their value and reasons,
 * and approves (the adjustments post) or sends it back to count again.
 */
export default async function CountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const k = await apiFetch<CountDetail>(`/purchase/counts/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const st = COUNT_STATUS[k.status];
  const lists = k.can.count ? await apiFetch<StoreFormLists>('/purchase/store-form') : null;
  const diffs = k.lineItems.filter((l) => l.difference);
  const net = diffs.reduce((a, l) => a + (l.value ?? 0), 0);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Physical counts', href: '/purchase/counts' },
          { label: k.number },
        ]}
      />
      <PageHeader
        kicker={`Purchase · Physical count · ${k.category ?? 'everything it holds'}`}
        title={`${k.number} · ${k.store}`}
        description={`Started ${when(k.countedOn)}${k.startedBy ? ` by ${k.startedBy}` : ''} · ${String(k.counted)} of ${String(k.lines)} lines counted`}
        actions={
          <FileLinks
            href={`/api/purchase/stock-doc/counts/${k.id}`}
            label={`${k.number} ${k.status === 'counting' ? 'count sheet' : 'statement'} as a PDF`}
          />
        }
      />
      <Notice params={sp} />
      <section className="ep-card" aria-labelledby="ck-st">
        <h2 id="ck-st" className="ep-card__title">
          Status <Badge tone={st.tone}>{st.label}</Badge>
        </h2>
        {k.decisionNote ? (
          <Alert tone={k.status === 'counting' ? 'warning' : 'info'} title="Note">
            {k.decisionNote}
          </Alert>
        ) : null}
        {k.status !== 'counting' ? (
          <p style={{ marginTop: 0 }}>
            {diffs.length
              ? `${String(diffs.length)} difference${diffs.length === 1 ? '' : 's'}, net ${money(net)}.`
              : 'No difference: the shelves match the book.'}
            {k.status === 'approved'
              ? ` Approved by ${k.decidedBy ?? ''} on ${when(k.decidedAt)}.`
              : ''}
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          {k.can.submit ? (
            <ConfirmAction
              action={submitCount}
              fields={{ id: k.id }}
              label="Send for approval"
              title={`Send ${k.number} for approval?`}
              confirmLabel="Send"
              variant="primary"
            >
              Every line must be counted (0 when none is found) and every difference must have its
              reason.
            </ConfirmAction>
          ) : null}
          {k.can.decide ? (
            <>
              <ConfirmAction
                action={approveCount}
                fields={{ id: k.id }}
                label="Approve: post the differences"
                title={`Approve ${k.number}?`}
                confirmLabel="Approve"
                variant="primary"
              >
                {diffs.length
                  ? `${String(diffs.length)} adjustments post to ${k.store} at the average rate (net ${money(net)}).`
                  : 'Nothing to adjust: the count is recorded.'}
              </ConfirmAction>
              <ConfirmAction
                action={sendBackCount}
                fields={{ id: k.id }}
                label="Send back to count again"
                title={`Send ${k.number} back?`}
                confirmLabel="Send back"
                variant="secondary"
                reason={{ label: 'What to count again' }}
              >
                The keeper counts again and sends it back.
              </ConfirmAction>
            </>
          ) : null}
          {k.can.cancel ? (
            <ConfirmAction
              action={cancelCount}
              fields={{ id: k.id }}
              label="Cancel the count"
              title={`Cancel ${k.number}?`}
              confirmLabel="Cancel it"
              variant="ghost"
              confirmVariant="danger"
              reason={{ label: 'Why it is cancelled' }}
            >
              Nothing is adjusted; a new count can be started.
            </ConfirmAction>
          ) : null}
        </div>
      </section>

      {k.can.count && lists ? (
        <section className="ep-card" aria-labelledby="ck-sheet">
          <h2 id="ck-sheet" className="ep-card__title">
            Count
          </h2>
          <p style={{ marginTop: 0 }}>
            Enter what is on the shelf, in the store unit (0 when none is found). The book quantity
            shows once a line is counted; give the reason for each difference.
          </p>
          <CountSheet
            count={k}
            items={lists.items.map((i) => ({
              id: i.id,
              code: i.code,
              name: i.name,
              tracksBatch: i.tracksBatch,
            }))}
          />
        </section>
      ) : (
        <section className="ep-card" aria-labelledby="ck-lines">
          <h2 id="ck-lines" className="ep-card__title">
            Book and count
          </h2>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="ck-lines">
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Book
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Counted
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Difference
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {k.lineItems.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.item} ({l.itemCode})
                      <span className="ep-mr-col__desc">
                        {[
                          l.batch ? `Batch ${l.batch}` : null,
                          l.difference ? l.reason : null,
                          l.added ? 'found, not listed' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {l.book === null ? '—' : `${fmt(l.book)} ${l.unit}`}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {l.counted === null ? '—' : fmt(l.counted)}
                    </td>
                    <td style={{ textAlign: 'right' }}>{l.difference ? fmt(l.difference) : ''}</td>
                    <td style={{ textAlign: 'right' }}>
                      {l.difference && l.value !== null ? money(l.value) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
