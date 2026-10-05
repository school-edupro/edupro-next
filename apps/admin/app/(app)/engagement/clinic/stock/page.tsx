import { Alert, Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { ClinicNav } from '@/components/clinic/ClinicNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { today, when } from '@/lib/appointments';
import { importClinicStock, receiveClinicStock, writeOffClinicStock } from '@/lib/clinic-actions';

type View = 'medicines' | 'batches' | 'moves' | 'receive';
interface Row {
  id: string;
  medicine: string;
  unit: string;
  // medicines
  form?: string;
  lowStockAt?: number;
  stock?: number;
  expired?: number;
  expiring?: number;
  nextExpiry?: string | null;
  low?: boolean;
  // batches
  batchNo?: string | null;
  expiryOn?: string | null;
  qtyIn?: number;
  qtyLeft?: number;
  receivedOn?: string;
  supplier?: string | null;
  state?: string;
  // moves
  kind?: 'received' | 'given' | 'written_off';
  qty?: number;
  note?: string | null;
  at?: string;
  visitId?: string | null;
  visitNo?: string | null;
  by?: string | null;
}
interface StockList {
  view: View;
  data: Row[];
  page: { number: number; size: number; total: number };
  alerts: { low: number; expiring: number; expired: number; days: number };
  medicines: Array<{ id: string; name: string }>;
}
const VIEWS: Array<[View, string]> = [
  ['medicines', 'In stock'],
  ['batches', 'Batches'],
  ['moves', 'Movements'],
  ['receive', 'Receive stock'],
];
const STATES: Record<string, Array<[string, string]>> = {
  medicines: [
    ['', 'All medicines'],
    ['low', 'Low stock'],
    ['expiring', 'Expiring soon'],
    ['expired', 'With expired stock'],
    ['ok', 'No alert'],
  ],
  batches: [
    ['on_shelf', 'On the shelf'],
    ['in_stock', 'Good'],
    ['expiring', 'Expiring soon'],
    ['expired', 'Expired'],
    ['empty', 'Used up'],
  ],
  moves: [
    ['', 'Everything'],
    ['received', 'Received'],
    ['given', 'Given at a visit'],
    ['written_off', 'Written off'],
  ],
};
const BATCH: Record<string, [string, 'success' | 'warning' | 'danger' | 'neutral']> = {
  in_stock: ['Good', 'success'],
  expiring: ['Expiring soon', 'warning'],
  expired: ['Expired', 'danger'],
  empty: ['Used up', 'neutral'],
};
const MOVE: Record<string, string> = {
  received: 'Received',
  given: 'Given at a visit',
  written_off: 'Written off',
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The medicine shelf in four tabs: what is in stock per medicine (with alerts), the batches (expiry,
 * write-off), every movement (received, given at a visit, written off), and receiving stock (one batch,
 * or the opening stock from Excel). Each list has its filters, pages, Excel and PDF.
 */
export default async function ClinicStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const view: View = VIEWS.some(([v]) => v === sp.view) ? (sp.view as View) : 'medicines';
  const listView = view === 'receive' ? 'medicines' : view;
  const page = Math.max(1, Number(sp.page) || 1);
  const size = ['15', '30', '60'].includes(sp.size ?? '') ? sp.size! : '15';
  const filters = Object.fromEntries(
    Object.entries({
      q: sp.q?.trim().slice(0, 80) || undefined,
      medicineId: /^\d{1,18}$/.test(sp.medicineId ?? '') ? sp.medicineId : undefined,
      state: STATES[listView]!.some(([s]) => s && s === sp.state) ? sp.state : undefined,
      from: view !== 'medicines' && DATE.test(sp.from ?? '') ? sp.from : undefined,
      to: view !== 'medicines' && DATE.test(sp.to ?? '') ? sp.to : undefined,
    }).filter(([, v]) => v),
  ) as Record<string, string>;
  const [me, list] = await Promise.all([
    getMe(),
    apiFetch<StockList>(
      `/clinic/stock/list?${new URLSearchParams({ view: listView, ...filters, page: String(page), size }).toString()}`,
    ),
  ]);
  const manage = me.permissions.includes('engagement.clinic.manage');
  const pages = Math.max(1, Math.ceil(list.page.total / list.page.size));
  const qs = (extra: Record<string, string> = {}) =>
    new URLSearchParams({
      view,
      ...filters,
      ...(size === '15' ? {} : { size }),
      ...extra,
    }).toString();
  const here = `/engagement/clinic/stock?${qs({ page: String(page) })}`;
  const exportHref = (format: 'xlsx' | 'pdf') =>
    `/api/clinic/stock-export?${new URLSearchParams({ view: listView, format, ...filters }).toString()}`;
  const filtered = Object.keys(filters).length > 0;
  return (
    <>
      <PageHeader
        kicker="Clinic"
        title="Medicine stock"
        description={`${String(list.alerts.low)} low · ${String(list.alerts.expiring)} batches expire within ${String(list.alerts.days)} days · ${String(list.alerts.expired)} expired.`}
      />
      <ClinicNav current="/engagement/clinic/stock" permissions={me.permissions} ok={sp.ok} />
      {sp.ok === 'imported' ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone={Number(sp.failed) ? 'warning' : 'success'}>
            Excel read: {sp.added ?? '0'} batch(es) received
            {Number(sp.failed) ? `, ${sp.failed!} row(s) not taken` : ''}.
            {sp.bad ? ` ${sp.bad}` : ''}
          </Alert>
        </div>
      ) : null}
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <div className="ep-cdash__kpis" style={{ marginBottom: 'var(--sp-4)' }}>
        {(
          [
            [
              'Low stock',
              list.alerts.low,
              'medicines at or under their mark',
              '?view=medicines&state=low',
            ],
            [
              'Expiring soon',
              list.alerts.expiring,
              `batches within ${String(list.alerts.days)} days`,
              '?view=batches&state=expiring',
            ],
            ['Expired', list.alerts.expired, 'batches to write off', '?view=batches&state=expired'],
          ] as Array<[string, number, string, string]>
        ).map(([title, n, help, href]) => (
          <Card key={title} title={title}>
            <div className="ep-cdash__big">
              <a className="ep-cdash__num" href={href} aria-label={`${title}: ${String(n)}`}>
                {n}
              </a>
            </div>
            <div className="ep-field__help">{help}</div>
          </Card>
        ))}
      </div>
      <nav
        className="ep-tabs-links"
        aria-label="Stock sections"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {VIEWS.filter(([v]) => v !== 'receive' || manage).map(([v, label]) => (
          <a key={v} href={`?view=${v}`} aria-current={view === v ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
      {view === 'receive' ? (
        <>
          <Card title="Receive one batch" style={{ marginBottom: 'var(--sp-4)' }}>
            {list.medicines.length === 0 ? (
              <p className="ep-field__help" style={{ margin: 0 }}>
                Add medicines first under Clinic → Set-up → Medicines.
              </p>
            ) : (
              <form action={receiveClinicStock} className="ep-hd__form">
                <div className="ep-hd__row">
                  <SelectField
                    id="cs-med"
                    name="medicineId"
                    label="Medicine"
                    required
                    defaultValue=""
                    options={[
                      { value: '', label: 'Choose' },
                      ...list.medicines.map((m) => ({ value: m.id, label: m.name })),
                    ]}
                  />
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
                </div>
                <div className="ep-hd__row">
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
                </div>
                <div>
                  <Button type="submit">Receive</Button>
                </div>
              </form>
            )}
          </Card>
          <Card title="Opening stock from Excel">
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              1. Download the Excel: the Medicine column is a drop-down of your medicines (the list
              is also on its second sheet). 2. Fill one row per batch: medicine, batch no., expiry,
              quantity, received on, supplier. 3. Upload it here. Only medicines from the drop-down
              are accepted; add a new medicine under Set-up first.
            </p>
            <form action={importClinicStock} className="ep-gate__act">
              <label className="ep-field" htmlFor="cs-file">
                <span className="ep-field__label">Excel file (.xlsx)</span>
                <input
                  id="cs-file"
                  name="file"
                  type="file"
                  className="ep-input"
                  required
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                />
              </label>
              <Button type="submit">Upload</Button>
              <a className="ep-btn ep-btn--secondary" href="/api/clinic/stock-template">
                Download the Excel to fill
              </a>
            </form>
          </Card>
        </>
      ) : (
        <>
          <div className="ep-filter-band">
            <form method="get" className="ep-dlog__filters">
              <input type="hidden" name="view" value={view} />
              <InputField
                id="sf-q"
                name="q"
                type="search"
                label={view === 'medicines' ? 'Medicine' : 'Medicine, batch no., supplier or note'}
                defaultValue={filters.q ?? ''}
                maxLength={80}
              />
              {view !== 'medicines' ? (
                <SelectField
                  id="sf-med"
                  name="medicineId"
                  label="Medicine"
                  defaultValue={filters.medicineId ?? ''}
                  options={[
                    { value: '', label: 'All' },
                    ...list.medicines.map((m) => ({ value: m.id, label: m.name })),
                  ]}
                />
              ) : null}
              <SelectField
                id="sf-state"
                name="state"
                label={view === 'moves' ? 'What' : 'Show'}
                defaultValue={filters.state ?? (view === 'batches' ? 'on_shelf' : '')}
                options={STATES[view]!.map(([value, label]) => ({ value, label }))}
              />
              {view !== 'medicines' ? (
                <>
                  <label className="ep-field" htmlFor="sf-from">
                    <span className="ep-field__label">
                      {view === 'batches' ? 'Received from' : 'From'}
                    </span>
                    <input
                      id="sf-from"
                      name="from"
                      type="date"
                      className="ep-input"
                      defaultValue={filters.from ?? ''}
                    />
                  </label>
                  <label className="ep-field" htmlFor="sf-to">
                    <span className="ep-field__label">To</span>
                    <input
                      id="sf-to"
                      name="to"
                      type="date"
                      className="ep-input"
                      defaultValue={filters.to ?? ''}
                    />
                  </label>
                </>
              ) : null}
              <SelectField
                id="sf-size"
                name="size"
                label="Rows per page"
                defaultValue={size}
                options={['15', '30', '60'].map((v) => ({ value: v, label: v }))}
              />
              <Button type="submit">Show</Button>
              {filtered ? (
                <a className="ep-btn ep-btn--secondary" href={`?view=${view}`}>
                  Clear
                </a>
              ) : null}
            </form>
          </div>
          <Card
            title={`${VIEWS.find(([v]) => v === view)![1]} · ${String(list.page.total)}`}
            actions={
              <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                {manage ? (
                  <a className="ep-btn ep-btn--primary ep-btn--sm" href="?view=receive">
                    Receive stock
                  </a>
                ) : null}
                <a className="ep-btn ep-btn--secondary ep-btn--sm" href={exportHref('xlsx')}>
                  Excel
                </a>
                <a className="ep-btn ep-btn--secondary ep-btn--sm" href={exportHref('pdf')}>
                  PDF
                </a>
              </span>
            }
          >
            {list.data.length === 0 ? (
              <p className="ep-field__help" style={{ margin: 0 }}>
                {filtered ? 'Nothing matches these filters.' : 'Nothing here yet.'}
              </p>
            ) : (
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Stock">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">{VIEWS.find(([v]) => v === view)![1]}</caption>
                  {view === 'medicines' ? (
                    <>
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
                          <th scope="col">
                            <span className="ep-sr-only">Open</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.data.map((m) => (
                          <tr key={m.id}>
                            <th scope="row">{m.medicine}</th>
                            <td>{m.form}</td>
                            <td className="ep-num">
                              {m.stock} {m.unit}
                            </td>
                            <td className="ep-num">{m.lowStockAt}</td>
                            <td>{m.nextExpiry ?? '—'}</td>
                            <td>
                              {m.low ? <Badge tone="warning">Low</Badge> : null}{' '}
                              {m.expiring ? (
                                <Badge tone="warning">{m.expiring} expiring</Badge>
                              ) : null}{' '}
                              {m.expired ? <Badge tone="danger">{m.expired} expired</Badge> : null}
                              {!m.low && !m.expiring && !m.expired ? (
                                <Badge tone="success">Good</Badge>
                              ) : null}
                            </td>
                            <td>
                              <a
                                className="ep-btn ep-btn--secondary ep-btn--sm"
                                href={`?view=batches&medicineId=${m.id}`}
                                aria-label={`Batches of ${m.medicine}`}
                              >
                                Batches
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  ) : view === 'batches' ? (
                    <>
                      <thead>
                        <tr>
                          <th scope="col">Medicine</th>
                          <th scope="col">Batch</th>
                          <th scope="col">Expiry</th>
                          <th scope="col" className="ep-num">
                            Left of received
                          </th>
                          <th scope="col">Received</th>
                          <th scope="col">State</th>
                          {manage ? <th scope="col">Write off</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {list.data.map((b) => (
                          <tr key={b.id}>
                            <th scope="row">{b.medicine}</th>
                            <td>{b.batchNo ?? '—'}</td>
                            <td>{b.expiryOn ?? '—'}</td>
                            <td className="ep-num">
                              {b.qtyLeft} of {b.qtyIn} {b.unit}
                            </td>
                            <td>
                              {b.receivedOn}
                              {b.supplier ? (
                                <div className="ep-field__help">{b.supplier}</div>
                              ) : null}
                            </td>
                            <td>
                              <Badge tone={BATCH[b.state ?? 'in_stock']![1]}>
                                {BATCH[b.state ?? 'in_stock']![0]}
                              </Badge>
                            </td>
                            {manage ? (
                              <td>
                                {b.qtyLeft ? (
                                  <form action={writeOffClinicStock} className="ep-gate__act">
                                    <input type="hidden" name="stockId" value={b.id} />
                                    <input type="hidden" name="returnTo" value={here} />
                                    <input
                                      name="qty"
                                      type="number"
                                      className="ep-input"
                                      min={1}
                                      max={b.qtyLeft}
                                      defaultValue={b.state === 'expired' ? b.qtyLeft : 1}
                                      aria-label={`Quantity to write off from batch ${b.batchNo ?? b.id}`}
                                    />
                                    <input
                                      name="note"
                                      className="ep-input"
                                      required
                                      minLength={3}
                                      maxLength={300}
                                      defaultValue={b.state === 'expired' ? 'Expired' : ''}
                                      placeholder="Reason"
                                      aria-label={`Reason to write off batch ${b.batchNo ?? b.id}`}
                                    />
                                    <Button type="submit" size="sm" variant="secondary">
                                      Write off
                                    </Button>
                                  </form>
                                ) : (
                                  '—'
                                )}
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </>
                  ) : (
                    <>
                      <thead>
                        <tr>
                          <th scope="col">When</th>
                          <th scope="col">Medicine</th>
                          <th scope="col">Batch</th>
                          <th scope="col">What</th>
                          <th scope="col" className="ep-num">
                            Quantity
                          </th>
                          <th scope="col">Note</th>
                          <th scope="col">By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.data.map((mv) => (
                          <tr key={mv.id}>
                            <td>{when(mv.at ?? null)}</td>
                            <th scope="row">{mv.medicine}</th>
                            <td>{mv.batchNo ?? '—'}</td>
                            <td>
                              <Badge
                                tone={
                                  mv.kind === 'received'
                                    ? 'success'
                                    : mv.kind === 'given'
                                      ? 'info'
                                      : 'warning'
                                }
                              >
                                {MOVE[mv.kind ?? 'received']}
                              </Badge>
                              {mv.visitId ? (
                                <div>
                                  <a href={`/engagement/clinic/visits/${mv.visitId}`}>
                                    {mv.visitNo}
                                  </a>
                                </div>
                              ) : null}
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
                    </>
                  )}
                </table>
              </div>
            )}
            {pages > 1 ? (
              <nav
                aria-label="Pages"
                style={{
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  alignItems: 'center',
                  marginTop: 'var(--sp-3)',
                }}
              >
                {page > 1 ? (
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`?${qs({ page: String(page - 1) })}`}
                  >
                    ← Previous
                  </a>
                ) : null}
                <span className="ep-field__help">
                  Page {page} of {pages}
                </span>
                {page < pages ? (
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`?${qs({ page: String(page + 1) })}`}
                  >
                    Next →
                  </a>
                ) : null}
              </nav>
            ) : null}
          </Card>
        </>
      )}
    </>
  );
}
