import { Badge } from '@edupro/ui';
import { FileLinks } from '@/components/FileLinks';
import { FoldCard } from '@/components/FoldCard';
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

/** The lines that had quotes, and how many of them went to the lowest (L1). */
export function l1Count(s: OrderSourcing) {
  const quoted = s.lines.filter((l) => l.cells.some((c) => c !== null));
  return { quoted: quoted.length, l1: quoted.filter((l) => !l.notL1).length };
}

/** One line on the folded card: how the vendor was found, the quotes, L1, the certificate. */
export function sourcingHint(s: OrderSourcing) {
  const { quoted, l1 } = l1Count(s);
  const signed = s.committee.filter((m) => m.signedAt).length;
  return [
    s.autoRule
      ? s.autoRule === 'rate_contract'
        ? 'Rate contract'
        : 'Under the limit'
      : s.tier
        ? TIER[s.tier].label
        : null,
    s.quotes.length
      ? `${String(s.quotes.length)} quote${s.quotes.length === 1 ? '' : 's'}`
      : 'No quotes',
    quoted
      ? l1 === quoted
        ? `L1 on ${quoted === 1 ? 'the line' : `all ${String(quoted)} lines`}`
        : `L1 on ${String(l1)} of ${String(quoted)} lines (reasons given)`
      : null,
    s.certificate ? 'price certificate signed' : null,
    s.committee.length
      ? `committee ${String(signed)} of ${String(s.committee.length)} signed`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

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
    <FoldCard id="po-why" title="Why this vendor" hint={sourcingHint(s)}>
      <p style={{ marginTop: 0 }}>
        From{' '}
        <a
          style={{ textDecoration: 'underline' }}
          href={`/purchase/requisitions/${s.requisitionId}`}
        >
          {s.requisition}
        </a>
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
                        href={`/api/purchase/orders/${poId}/quotes/${q.id}`}
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
    </FoldCard>
  );
}

/** One line on the folded card: how many things changed, the first few, the reason. */
export function amendmentHint(a: OrderAmendment) {
  const n = a.changes.length;
  const names = a.changes.slice(0, 3).map((c) => c.what);
  return [
    n
      ? `${String(n)} change${n === 1 ? '' : 's'}: ${names.join(', ')}${n > 3 ? '…' : ''}`
      : 'Nothing printed on the PO changed',
    a.reason ? `why: ${a.reason}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** An amendment: the reason, the PO it replaces (to open and print) and what changed. */
export function OrderAmendmentCard({ a, label }: { a: OrderAmendment; label: string }) {
  return (
    <FoldCard id="po-amend" title={`What changed from ${a.previousLabel}`} hint={amendmentHint(a)}>
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
          href={`/api/purchase/orders/${a.previousId}/pdf`}
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
    </FoldCard>
  );
}
