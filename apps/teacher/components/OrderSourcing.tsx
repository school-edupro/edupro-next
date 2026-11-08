import { Badge, Card } from '@edupro/ui';
import { FileLinks } from '@/components/FileLinks';
import { inr, TIER, type OrderAmendment, type OrderSourcing } from '@/lib/purchase';

const day = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso))
    : '—';

/**
 * Why this vendor, for those who approve a PO (docs/design/83, "As built — the PO's sourcing and
 * amendments"): the requisition's sourcing and the quotes for this PO's lines, the comparative statement
 * (what the school pays per unit with GST, L1 marked, this PO's vendor highlighted), the rate contract or
 * the reason for a choice not L1, the price certificate or the committee's signatures.
 */
export function OrderSourcingCard({ poId, s }: { poId: string; s: OrderSourcing }) {
  const tier = s.autoRule
    ? `Made and approved by the system (${s.autoRule === 'rate_contract' ? 'rate contract' : 'under the limit'})`
    : s.tier
      ? TIER[s.tier].label
      : '';
  return (
    <Card title="Why this vendor">
      <p style={{ marginTop: 0 }}>
        From {s.requisition}
        {tier ? ` · ${tier}` : ''}
        {s.tenderRef ? ` · tender ${s.tenderRef}` : ''}
      </p>
      {s.quotes.length ? (
        <div
          className="ep-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Quotes for this PO's lines"
        >
          <table className="ep-table">
            <caption className="ep-sr-only">Quotes for this PO's lines</caption>
            <thead>
              <tr>
                <th scope="col">Vendor</th>
                <th scope="col">Quote</th>
                <th scope="col">Delivery</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  These lines with GST
                </th>
              </tr>
            </thead>
            <tbody>
              {s.quotes.map((q) => (
                <tr key={q.id}>
                  <td>
                    {q.vendor} ({q.vendorCode}){' '}
                    {q.thisPo ? <Badge tone="info">This PO</Badge> : null}
                    <span className="ep-mr-col__desc">
                      {q.gstStatus === 'regular' ? 'GST registered' : `${q.gstStatus}: no GST`}
                      {q.msme ? ` · MSME ${q.msme}` : ''}
                    </span>
                  </td>
                  <td>
                    {q.ref ?? 'No reference'}
                    {q.date ? ` · ${day(q.date)}` : ''}
                    <span className="ep-mr-col__desc">
                      {q.validUntil ? `Valid until ${day(q.validUntil)}` : 'No validity given'}
                    </span>
                    {q.hasFile ? (
                      <FileLinks
                        url={`/api/purchase-order-quote/${poId}/${q.id}`}
                        saveUrl={`/api/purchase-order-quote/${poId}/${q.id}?save=1`}
                        label={`the quote of ${q.vendor}`}
                      />
                    ) : null}
                  </td>
                  <td>{q.deliveryDays !== null ? `${String(q.deliveryDays)} days` : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{inr(q.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ep-field__help">
          No quotes on the requisition for these lines: the vendor and rate were agreed (direct
          purchase or tender) or come from a rate contract.
        </p>
      )}
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Comparative statement"
        style={{ marginTop: 'var(--sp-4)' }}
      >
        <table className="ep-table">
          <caption className="ep-card__title" style={{ textAlign: 'left' }}>
            Comparative statement: rate + GST = what the school pays per unit; the lowest is L1
          </caption>
          <thead>
            <tr>
              <th scope="col">Line</th>
              {s.quotes.map((q) => (
                <th key={q.id} scope="col" style={{ textAlign: 'right' }}>
                  {q.vendorCode}
                  {q.thisPo ? ' (this PO)' : ''}
                </th>
              ))}
              <th scope="col">Chosen</th>
            </tr>
          </thead>
          <tbody>
            {s.lines.map((l) => (
              <tr key={l.poLineId}>
                <th scope="row" style={{ fontWeight: 'normal', textAlign: 'left' }}>
                  {l.seq}. {l.description}
                  <span className="ep-mr-col__desc">
                    {l.quantity} {l.uom}
                  </span>
                </th>
                {l.cells.map((c, i) => (
                  <td
                    key={s.quotes[i]!.id}
                    style={{
                      textAlign: 'right',
                      ...(s.quotes[i]!.thisPo ? { fontWeight: 'bold' } : {}),
                    }}
                  >
                    {c ? (
                      <>
                        {inr(c.rate)}
                        {c.gstRate ? ` + ${String(c.gstRate)}%` : ''}
                        <span className="ep-mr-col__desc">
                          {c.gstRate ? `${inr(c.landed)} ` : ''}
                          {c.l1 ? <Badge tone="success">L1</Badge> : null}
                        </span>
                      </>
                    ) : (
                      <span className="ep-mr-col__desc">Not quoted</span>
                    )}
                  </td>
                ))}
                <td>
                  {l.chosen.vendor ?? '—'}: {inr(l.chosen.landed)}
                  {l.contract ? (
                    <span className="ep-mr-col__desc">
                      On rate contract: {l.contract.vendor} {inr(l.contract.rate)}
                    </span>
                  ) : null}
                  {l.notL1 ? (
                    <span className="ep-mr-col__desc">Not L1: {l.reason ?? 'no reason given'}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.certificate ? (
        <>
          <h3 className="ep-card__title" style={{ marginTop: 'var(--sp-4)' }}>
            Reasonable-price certificate
          </h3>
          <blockquote style={{ margin: 0 }}>{s.certificate.text}</blockquote>
          <p className="ep-field__help">
            {s.certificate.by ?? '—'} · {day(s.certificate.at)}
          </p>
        </>
      ) : null}
      {s.committee.length ? (
        <>
          <h3 className="ep-card__title" style={{ marginTop: 'var(--sp-4)' }}>
            The committee's signatures
          </h3>
          <ul className="ep-purch-checks">
            {s.committee.map((m) => (
              <li key={m.name}>
                {m.name}
                {m.role ? ` (${m.role})` : ''} ·{' '}
                {m.signedAt ? `signed ${day(m.signedAt)}` : 'not signed'}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

/** An amendment: the reason, the PO it replaces (to open and print) and what changed. */
export function OrderAmendmentCard({ a, label }: { a: OrderAmendment; label: string }) {
  return (
    <Card title={`What changed from ${a.previousLabel}`}>
      <p
        style={{
          marginTop: 0,
          display: 'flex',
          gap: 'var(--sp-2)',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span>
          {label} replaces{' '}
          <a style={{ textDecoration: 'underline' }} href={`/purchase/orders/${a.previousId}`}>
            {a.previousLabel}
          </a>
          {a.reason ? `: ${a.reason}` : ''}
        </span>
        <FileLinks
          url={`/api/purchase-order/${a.previousId}`}
          saveUrl={`/api/purchase-order/${a.previousId}?save=1`}
          label={`${a.previousLabel} as a PDF`}
        />
      </p>
      {a.changes.length ? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="What changed">
          <table className="ep-table">
            <caption className="ep-sr-only">What changed</caption>
            <thead>
              <tr>
                <th scope="col">What</th>
                <th scope="col">Was ({a.previousLabel})</th>
                <th scope="col">Now ({label})</th>
              </tr>
            </thead>
            <tbody>
              {a.changes.map((c) => (
                <tr key={c.what}>
                  <td>{c.what}</td>
                  <td>{c.from}</td>
                  <td>
                    <strong>{c.to}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ep-field__help">Nothing printed on the PO changed.</p>
      )}
    </Card>
  );
}
