import {
  Badge,
  Button,
  Card,
  DataTable,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import {
  libraryCloseStockCheck,
  libraryScanStockCheck,
  librarySell,
  libraryStartStockCheck,
} from '@/lib/actions';
import { apiFetch } from '@/lib/api';

interface StockCheck {
  id: string;
  name: string;
  startedOn: string;
  finishedOn: string | null;
  status: string;
  expected: number;
  found: number;
  missing: number;
  openItems: Array<{ accessionNo: string; title: string; outcome: string }>;
}
interface Sale {
  id: string;
  accessionNo: string;
  title: string;
  buyerKind: string;
  buyer: string | null;
  price: string;
  receiptRef: string | null;
  soldOn: string;
  soldBy: string | null;
}

/** Sprint 18: stock verification and sales of withdrawn copies. */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, s, checks, sales] = await Promise.all([
    getTranslations('pages.library_stock'),
    getTranslations('stock'),
    apiFetch<{ data: StockCheck[] }>('/library/stock-checks').then((x) => x.data),
    apiFetch<{ data: Sale[] }>('/library/sales').then((x) => x.data),
  ]);
  const open = checks.find((c) => c.status === 'open') ?? null;
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        }}
      >
        <Card title={open ? `${open.name} · ${open.startedOn}` : s('start')}>
          {open ? (
            <>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
                <Badge tone="neutral">
                  {s('expected')} {open.expected}
                </Badge>
                <Badge tone="success">
                  {s('found')} {open.found}
                </Badge>
                <Badge tone="warning">
                  {s('openItems')} {open.openItems.length}
                </Badge>
              </div>
              <form action={libraryScanStockCheck}>
                <input type="hidden" name="checkId" value={open.id} />
                <label className="ep-field">
                  <span className="ep-field__label">{s('scan')}</span>
                  <textarea className="ep-input" name="accessionNos" rows={5} required />
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="submit">{s('record')}</Button>
                </div>
              </form>
              <form
                action={libraryCloseStockCheck}
                style={{
                  marginTop: 'var(--sp-3)',
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <input type="hidden" name="checkId" value={open.id} />
                <label style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                  <input type="checkbox" name="markMissingLost" /> {s('markLost')}
                </label>
                <Button type="submit" variant="secondary">
                  {s('close')}
                </Button>
              </form>
              <details style={{ marginTop: 'var(--sp-3)' }}>
                <summary className="ep-kicker">
                  {s('openItems')} · {open.openItems.length}
                </summary>
                <table className="ep-table ep-table--dense">
                  <tbody>
                    {open.openItems.map((i) => (
                      <tr key={i.accessionNo}>
                        <td>{i.accessionNo}</td>
                        <td>{i.title}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <form action={libraryStartStockCheck}>
              <FormRow columns={2}>
                <InputField
                  id="name"
                  name="name"
                  label={s('name')}
                  required
                  minLength={2}
                  maxLength={120}
                />
                <div style={{ alignSelf: 'end' }}>
                  <Button type="submit">{s('open')}</Button>
                </div>
              </FormRow>
            </form>
          )}
          <DataTable<StockCheck>
            caption={s('checks')}
            density="dense"
            columns={[
              {
                key: 'n',
                header: s('name'),
                render: (c) => (
                  <>
                    {c.name}
                    <div className="ep-kicker">
                      {c.startedOn}
                      {c.finishedOn ? ` → ${c.finishedOn}` : ''}
                    </div>
                  </>
                ),
              },
              {
                key: 's',
                header: s('status'),
                render: (c) => (
                  <Badge tone={c.status === 'open' ? 'warning' : 'neutral'}>{c.status}</Badge>
                ),
              },
              { key: 'e', header: s('expected'), numeric: true, render: (c) => c.expected },
              { key: 'f', header: s('found'), numeric: true, render: (c) => c.found },
              {
                key: 'm',
                header: s('missing'),
                numeric: true,
                render: (c) => (c.missing ? <Badge tone="danger">{c.missing}</Badge> : 0),
              },
            ]}
            rows={checks}
            rowKey={(c) => c.id}
            emptyTitle={s('noChecks')}
          />
        </Card>
        <Card title={s('sale')}>
          <form action={librarySell}>
            <FormRow columns={3}>
              <InputField
                id="accessionNo"
                name="accessionNo"
                label={s('accessionNo')}
                required
                maxLength={30}
              />
              <SelectField
                id="buyerKind"
                name="buyerKind"
                label={s('buyerKind')}
                options={[
                  { value: 'other', label: 'other' },
                  { value: 'student', label: 'student' },
                  { value: 'employee', label: 'employee' },
                ]}
              />
              <InputField id="buyerName" name="buyerName" label={s('buyerName')} maxLength={120} />
              <InputField id="buyerId" name="buyerId" label={s('buyerId')} pattern="\\d*" />
              <InputField
                id="price"
                name="price"
                label={s('price')}
                type="number"
                min={0}
                step="1"
                required
              />
              <InputField
                id="receiptRef"
                name="receiptRef"
                label={s('receiptRef')}
                maxLength={60}
              />
            </FormRow>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit" variant="secondary">
                {s('sell')}
              </Button>
            </div>
          </form>
          <DataTable<Sale>
            caption={s('sales')}
            density="dense"
            columns={[
              { key: 'd', header: s('soldOn'), render: (x) => x.soldOn },
              {
                key: 'a',
                header: s('accessionNo'),
                render: (x) => <strong>{x.accessionNo}</strong>,
              },
              { key: 't', header: s('title'), render: (x) => x.title },
              { key: 'b', header: s('buyer'), render: (x) => `${x.buyer ?? ''} (${x.buyerKind})` },
              { key: 'p', header: s('price'), numeric: true, render: (x) => `₹${x.price}` },
              { key: 'r', header: s('receiptRef'), render: (x) => x.receiptRef ?? '' },
            ]}
            rows={sales}
            rowKey={(x) => x.id}
            emptyTitle={s('noSales')}
          />
        </Card>
      </div>
    </>
  );
}
