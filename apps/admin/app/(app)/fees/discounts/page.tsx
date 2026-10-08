import { Button, Card, FormActions, PageHeader, SelectField } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { FeeSetupNav } from '@/components/fees/FeeSetupNav';
import { GridTools } from '@/components/fees/GridTools';
import { apiFetch, getMe } from '@/lib/api';
import { importDiscountLines, saveDiscountLines } from '@/lib/fee-grid-actions';
import type { FeeDiscount } from '@/lib/types';

interface Grid {
  discount: { id: string; code: string; name: string };
  rows: Array<{
    headId: string;
    code: string;
    name: string;
    percent: string | null;
    amount: string | null;
  }>;
}

/** A discount type head by head: a percentage or a fixed amount per month on each fee head. */
export default async function FeeDiscountsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    uploaded?: string;
    id?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canManage = me.permissions.includes('fees.master.manage');
  const discounts = await apiFetch<{ data: FeeDiscount[] }>('/fees/discounts').then((r) => r.data);
  const grid =
    sp.id && discounts.some((d) => d.id === sp.id)
      ? await apiFetch<Grid>(`/fees/grids/discount/${sp.id}`)
      : null;
  return (
    <>
      <PageHeader
        kicker="Fees"
        title="Discount by head"
        description="For each discount type, give a percentage or a fixed amount per month on every fee head it should reduce. Discount types themselves are added on the first tab."
      />
      <FeeSetupNav current="/fees/discounts" />
      <Notice params={sp} />
      {sp.uploaded ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.uploaded} head(s) saved from the Excel file.
        </p>
      ) : null}
      <Card>
        <form method="get" style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end' }}>
          <SelectField
            id="id"
            name="id"
            label="Discount type"
            defaultValue={sp.id ?? ''}
            options={[
              { value: '', label: '—' },
              ...discounts.map((d) => ({ value: d.id, label: `${d.name} (${d.code})` })),
            ]}
          />
          <Button type="submit" variant="secondary">
            Load fee heads
          </Button>
          <a className="ep-btn ep-btn--ghost" href="/masters/fees">
            Add a discount type
          </a>
        </form>
        {grid ? (
          <>
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
              {grid.discount.name}: fill a percentage <em>or</em> a fixed amount per head, not both.
              Empty means no discount on that head. A fixed amount is taken off every month the head
              is charged and never exceeds the head’s fee. Once a discount has head lines, only
              those lines apply. Pupils’ bills change when they are generated again.
            </p>
            <GridTools
              fileHref={`/api/fees/grid-file?kind=discount&id=${grid.discount.id}`}
              upload={importDiscountLines}
              hidden={[['discountId', grid.discount.id]]}
              canManage={canManage}
            />
            <form action={saveDiscountLines}>
              <input type="hidden" name="discountId" value={grid.discount.id} />
              <div className="ep-table-wrap">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Discount on each fee head</caption>
                  <thead>
                    <tr>
                      <th scope="col">Fees head name</th>
                      <th scope="col">Percentage (%)</th>
                      <th scope="col">Fix amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grid.rows.map((r) => (
                      <tr key={r.headId}>
                        <th scope="row">
                          <input type="hidden" name="headIds" value={r.headId} />
                          {r.name}
                        </th>
                        <td>
                          <input
                            className="ep-input"
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            name={`p:${r.headId}`}
                            defaultValue={r.percent ? Number(r.percent) : ''}
                            placeholder="0.00"
                            disabled={!canManage}
                            aria-label={`${r.name}: percentage`}
                          />
                        </td>
                        <td>
                          <input
                            className="ep-input"
                            type="number"
                            min={0}
                            step="0.01"
                            name={`f:${r.headId}`}
                            defaultValue={r.amount ? Number(r.amount) : ''}
                            placeholder="0.00"
                            disabled={!canManage}
                            aria-label={`${r.name}: fixed amount`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canManage ? (
                <FormActions>
                  <Button type="submit">Save the discount</Button>
                </FormActions>
              ) : null}
            </form>
          </>
        ) : null}
      </Card>
    </>
  );
}
