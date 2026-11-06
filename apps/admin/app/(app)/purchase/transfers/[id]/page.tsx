import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import { TRANSFER_STATUS, type TransferDetail } from '@/lib/purchase';
import { cancelTransfer, receiveTransfer } from '@/lib/purchase-actions';

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(`${iso}T00:00:00+05:30`))
    : '—';
const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One transfer (docs/design/84, part 8): what went, received by the receiving keeper or cancelled back. */
export default async function TransferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const t = await apiFetch<TransferDetail>(`/purchase/transfers/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const st = TRANSFER_STATUS[t.status];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Transfers', href: '/purchase/transfers' },
          { label: t.number },
        ]}
      />
      <PageHeader
        kicker="Purchase · Transfer"
        title={t.number}
        description={`${t.fromStore} → ${t.toStore} · sent ${when(t.sentOn)}${t.sentBy ? ` by ${t.sentBy}` : ''}`}
        actions={
          <FileLinks
            href={`/api/purchase/stock-doc/transfers/${t.id}`}
            label={`${t.number} as a PDF`}
          />
        }
      />
      <Notice params={sp} />
      <section className="ep-card" aria-labelledby="tr-st">
        <h2 id="tr-st" className="ep-card__title">
          Status <Badge tone={st.tone}>{st.label}</Badge>
        </h2>
        {t.status === 'received' ? (
          <p style={{ marginTop: 0 }}>
            Received on {when(t.receivedOn)}
            {t.receivedBy ? ` by ${t.receivedBy}` : ''}
            {t.receiveNote ? `: ${t.receiveNote}` : ''}.
          </p>
        ) : null}
        {t.status === 'cancelled' ? (
          <p style={{ marginTop: 0 }}>
            Cancelled: {t.receiveNote}. The items went back into {t.fromStore}.
          </p>
        ) : null}
        {t.note ? <p>{t.note}</p> : null}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          {t.can.receive ? (
            <ConfirmAction
              action={receiveTransfer}
              fields={{ id: t.id }}
              label={`Receive into ${t.toStore}`}
              title={`Receive ${t.number}?`}
              confirmLabel="Receive"
              variant="primary"
            >
              {`Everything listed (${String(t.lines)} lines, ${money(t.value)}) goes into ${t.toStore}. Count it first; a shortage is put right by a physical count.`}
            </ConfirmAction>
          ) : null}
          {t.can.cancel ? (
            <ConfirmAction
              action={cancelTransfer}
              fields={{ id: t.id }}
              label="Cancel the transfer"
              title={`Cancel ${t.number}?`}
              confirmLabel="Cancel it"
              variant="ghost"
              confirmVariant="danger"
              reason={{ label: 'Why it is cancelled' }}
            >
              {`The items go back into ${t.fromStore}.`}
            </ConfirmAction>
          ) : null}
        </div>
      </section>
      <section className="ep-card" aria-labelledby="tr-lines">
        <h2 id="tr-lines" className="ep-card__title">
          What went
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="tr-lines">
          <table className="ep-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Quantity
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Rate
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {t.lineItems.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.item} ({l.itemCode})
                    {l.batch ? (
                      <span className="ep-mr-col__desc">
                        Batch {l.batch}
                        {l.expiry ? `, expiry ${when(l.expiry)}` : ''}
                      </span>
                    ) : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {l.qty.toLocaleString('en-IN')} {l.unit}
                  </td>
                  <td style={{ textAlign: 'right' }}>{money(l.rate)}</td>
                  <td style={{ textAlign: 'right' }}>{money(l.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
