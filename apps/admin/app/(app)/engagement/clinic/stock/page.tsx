import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { ClinicNav } from '@/components/clinic/ClinicNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { today, when } from '@/lib/appointments';
import { receiveClinicStock, writeOffClinicStock } from '@/lib/clinic-actions';
import { medName, type StockView } from '@/lib/clinic';

const MOVE: Record<string, string> = {
  received: 'Received',
  given: 'Given at a visit',
  written_off: 'Written off',
};

/**
 * The medicine shelf: what is in stock per medicine, each batch with its expiry, receiving a new batch,
 * writing off what expired or broke, and the last movements. A medicine given at a visit comes out of
 * the batch that expires first.
 */
export default async function ClinicStockPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [me, s] = await Promise.all([getMe(), apiFetch<StockView>('/clinic/stock')]);
  const manage = me.permissions.includes('engagement.clinic.manage');
  const active = s.medicines.filter((m) => m.active);
  return (
    <>
      <PageHeader
        kicker="Clinic"
        title="Medicine stock"
        description={`${String(active.filter((m) => m.low).length)} low · ${String(s.batches.filter((b) => b.expiring).length)} batches expire within ${String(s.expiryAlertDays)} days · ${String(s.batches.filter((b) => b.expired).length)} expired.`}
      />
      <ClinicNav current="/engagement/clinic/stock" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {manage ? (
        <Card title="Receive stock" style={{ marginBottom: 'var(--sp-4)' }}>
          {active.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Add medicines first under Clinic → Set-up.
            </p>
          ) : (
            <form action={receiveClinicStock} className="ep-hd__row">
              <label className="ep-field" htmlFor="cs-med">
                <span className="ep-field__label">Medicine</span>
                <select id="cs-med" name="medicineId" className="ep-select" required>
                  <option value="">Choose</option>
                  {active.map((m) => (
                    <option key={m.id} value={m.id}>
                      {medName(m)} · {m.form}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="cs-qty">
                <span className="ep-field__label">Quantity</span>
                <input
                  id="cs-qty"
                  name="qty"
                  type="number"
                  className="ep-input"
                  min={1}
                  max={1000000}
                  required
                />
              </label>
              <label className="ep-field" htmlFor="cs-batch">
                <span className="ep-field__label">Batch no.</span>
                <input id="cs-batch" name="batchNo" className="ep-input" maxLength={60} />
              </label>
              <label className="ep-field" htmlFor="cs-exp">
                <span className="ep-field__label">Expiry date</span>
                <input id="cs-exp" name="expiryOn" type="date" className="ep-input" />
              </label>
              <label className="ep-field" htmlFor="cs-rec">
                <span className="ep-field__label">Received on</span>
                <input
                  id="cs-rec"
                  name="receivedOn"
                  type="date"
                  className="ep-input"
                  defaultValue={today()}
                  max={today()}
                />
              </label>
              <label className="ep-field" htmlFor="cs-sup">
                <span className="ep-field__label">Supplier</span>
                <input id="cs-sup" name="supplier" className="ep-input" maxLength={120} />
              </label>
              <div>
                <Button type="submit">Receive</Button>
              </div>
            </form>
          )}
        </Card>
      ) : null}
      <Card title="In stock" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Medicines in stock">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Medicines and what is in stock</caption>
            <thead>
              <tr>
                <th scope="col">Medicine</th>
                <th scope="col">Form</th>
                <th scope="col" className="ep-num">
                  In stock
                </th>
                <th scope="col" className="ep-num">
                  Low-stock mark
                </th>
                <th scope="col">Next expiry</th>
                <th scope="col">Alert</th>
              </tr>
            </thead>
            <tbody>
              {active.length === 0 ? (
                <tr>
                  <td colSpan={6}>No medicines yet.</td>
                </tr>
              ) : null}
              {active.map((m) => (
                <tr key={m.id}>
                  <th scope="row">{medName(m)}</th>
                  <td>{m.form}</td>
                  <td className="ep-num">
                    {m.stock} {m.unit}
                  </td>
                  <td className="ep-num">{m.lowStockAt}</td>
                  <td>{m.nextExpiry ?? '—'}</td>
                  <td>
                    {m.low ? <Badge tone="warning">Low</Badge> : null}{' '}
                    {m.expired ? <Badge tone="danger">{m.expired} expired</Badge> : null}
                    {!m.low && !m.expired ? '—' : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Batches" style={{ marginBottom: 'var(--sp-4)' }}>
        {s.batches.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No stock on the shelf.
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Batches">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Batches on the shelf, earliest expiry first</caption>
              <thead>
                <tr>
                  <th scope="col">Medicine</th>
                  <th scope="col">Batch</th>
                  <th scope="col">Expiry</th>
                  <th scope="col" className="ep-num">
                    Left of received
                  </th>
                  <th scope="col">Received</th>
                  {manage ? <th scope="col">Write off</th> : null}
                </tr>
              </thead>
              <tbody>
                {s.batches.map((b) => {
                  const m = s.medicines.find((x) => x.id === b.medicineId);
                  return (
                    <tr key={b.id}>
                      <th scope="row">{m ? medName(m) : '—'}</th>
                      <td>{b.batchNo ?? '—'}</td>
                      <td>
                        {b.expiryOn ?? '—'}{' '}
                        {b.expired ? (
                          <Badge tone="danger">Expired</Badge>
                        ) : b.expiring ? (
                          <Badge tone="warning">Soon</Badge>
                        ) : null}
                      </td>
                      <td className="ep-num">
                        {b.qtyLeft} of {b.qtyIn}
                      </td>
                      <td>
                        {b.receivedOn}
                        {b.supplier ? <div className="ep-field__help">{b.supplier}</div> : null}
                      </td>
                      {manage ? (
                        <td>
                          <form action={writeOffClinicStock} className="ep-gate__act">
                            <input type="hidden" name="stockId" value={b.id} />
                            <input
                              name="qty"
                              type="number"
                              className="ep-input"
                              min={1}
                              max={b.qtyLeft}
                              defaultValue={b.expired ? b.qtyLeft : 1}
                              aria-label={`Quantity to write off from batch ${b.batchNo ?? b.id}`}
                            />
                            <input
                              name="note"
                              className="ep-input"
                              required
                              minLength={3}
                              maxLength={300}
                              defaultValue={b.expired ? 'Expired' : ''}
                              placeholder="Reason"
                              aria-label={`Reason to write off batch ${b.batchNo ?? b.id}`}
                            />
                            <Button type="submit" size="sm" variant="secondary">
                              Write off
                            </Button>
                          </form>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Last movements">
        {s.moves.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Nothing has moved yet.
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Stock movements">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">The last stock movements</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Medicine</th>
                  <th scope="col">What</th>
                  <th scope="col" className="ep-num">
                    Quantity
                  </th>
                  <th scope="col">Note</th>
                  <th scope="col">By</th>
                </tr>
              </thead>
              <tbody>
                {s.moves.map((mv) => (
                  <tr key={mv.id}>
                    <td>{when(mv.at)}</td>
                    <td>{mv.medicine}</td>
                    <td>
                      {mv.visitId ? (
                        <a href={`/engagement/clinic/visits/${mv.visitId}`}>{MOVE[mv.kind]}</a>
                      ) : (
                        MOVE[mv.kind]
                      )}
                    </td>
                    <td className="ep-num">
                      {mv.kind === 'received' ? '+' : '−'}
                      {mv.qty} {mv.unit}
                    </td>
                    <td>{mv.note ?? '—'}</td>
                    <td>{mv.by ?? '—'}</td>
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
