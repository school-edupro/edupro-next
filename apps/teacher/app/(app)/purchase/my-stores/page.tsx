import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface StoreRow {
  id: string;
  code: string;
  name: string;
  mine: boolean;
  status: string;
}
interface StockRow {
  itemId: string;
  code: string;
  name: string;
  unit: string;
  qty: number;
  reserved: number;
  reorderLevel: number | null;
  below: boolean;
  earliestExpiry: string | null;
}
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** The stock of the stores I keep (docs/design/84, part 8): in hand, reserved, free, below reorder. */
export default async function MyStoresPage() {
  const lang = await currentLang();
  let stores: StoreRow[];
  try {
    stores = (await bff.api.fetch<{ data: StoreRow[] }>('/purchase/stores')).data.filter(
      (s) => s.mine && s.status === 'active',
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) notFound();
    throw error;
  }
  const stock = await Promise.all(
    stores.map((s) =>
      bff.api
        .fetch<{ data: StockRow[] }>(`/purchase/stock?storeId=${s.id}`)
        .then((r) => r.data)
        .catch(() => [] as StockRow[]),
    ),
  );
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '60rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Home')}
        </a>
      </p>
      <PageHeader
        kicker="EduPro staff"
        title={t(lang, 'Stock in my stores')}
        description="What the stores you keep hold. Issues, transfers and counts are made in the office app."
      />
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        {stores.length ? (
          stores.map((s, i) => (
            <Card key={s.id} title={`${s.name} (${s.code})`}>
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label={`Stock in ${s.name}`}
              >
                <table className="ep-table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        In hand
                      </th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Free
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock[i]!.length ? (
                      stock[i]!.map((r) => (
                        <tr key={r.itemId}>
                          <td>
                            {r.name} ({r.code})
                            {r.below ? (
                              <>
                                {' '}
                                <Badge tone="warning">Below reorder level</Badge>
                              </>
                            ) : null}
                            {r.earliestExpiry ? (
                              <span className="ep-field__help" style={{ display: 'block' }}>
                                Earliest expiry {r.earliestExpiry}
                              </span>
                            ) : null}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {fmt(r.qty)} {r.unit}
                          </td>
                          <td style={{ textAlign: 'right' }}>{fmt(r.qty - r.reserved)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3}>Nothing in stock.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          ))
        ) : (
          <Card>You keep no store.</Card>
        )}
      </div>
    </main>
  );
}
