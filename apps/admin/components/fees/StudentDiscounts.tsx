import { Button, FormActions, InputField } from '@edupro/ui';
import { apiFetch } from '@/lib/api';
import { requestDiscountChange } from '@/lib/fee-setup-actions';
import type { FeeDiscount, FeePeriod } from '@/lib/types';

interface Held {
  id: string;
  discountId: string;
  name: string;
  head: string | null;
  percent: string | null;
  amount: string | null;
  fromSeq: number;
  toSeq: number;
  fromName: string | null;
  toName: string | null;
}

const ROWS = [0, 1, 2, 3, 4];

/**
 * A pupil's discounts month by month (0098). Several can run together; on one head they add up and
 * never exceed the head's fee. A change goes to the school admin and the bill is rebuilt on approval.
 */
export async function StudentDiscounts({
  studentId,
  canRequest,
}: {
  studentId: string;
  canRequest: boolean;
}) {
  const [held, master, periods] = await Promise.all([
    apiFetch<{ data: Held[] }>(`/fees/students/${studentId}/discounts`)
      .then((r) => r.data)
      .catch(() => [] as Held[]),
    apiFetch<{ data: FeeDiscount[] }>('/fees/discounts')
      .then((r) => r.data.filter((d) => d.status === 'active'))
      .catch(() => [] as FeeDiscount[]),
    apiFetch<{ data: FeePeriod[] }>('/fees/periods')
      .then((r) => r.data)
      .catch(() => [] as FeePeriod[]),
  ]);
  if (held.length === 0 && (!canRequest || master.length === 0)) return null;
  const value = (d: Held) => (d.percent ? `${Number(d.percent)}%` : `₹${d.amount}`);
  return (
    <div style={{ marginTop: 'var(--sp-4)' }}>
      <h3 className="ep-h4">Discounts by month</h3>
      {held.length > 0 ? (
        <div className="ep-table-wrap">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Discounts this pupil holds</caption>
            <thead>
              <tr>
                <th scope="col">Discount</th>
                <th scope="col">On head</th>
                <th scope="col">Value</th>
                <th scope="col">From</th>
                <th scope="col">To</th>
              </tr>
            </thead>
            <tbody>
              {held.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.head ?? 'Every head'}</td>
                  <td>{value(d)}</td>
                  <td>{d.fromName ?? d.fromSeq}</td>
                  <td>{d.toName ?? d.toSeq}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ep-field__help">No month-wise discount yet.</p>
      )}
      {canRequest && master.length > 0 ? (
        <form action={requestDiscountChange} style={{ marginTop: 'var(--sp-3)' }}>
          <input type="hidden" name="studentId" value={studentId} />
          <p className="ep-field__help">
            Set the full list as it should be after approval: up to five discounts, each with its
            first and last month. Leave a row empty to drop it. Months outside the range keep the
            full fee; a month already paid is not changed.
          </p>
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Discount list to request</caption>
              <thead>
                <tr>
                  <th scope="col">Discount</th>
                  <th scope="col">From month</th>
                  <th scope="col">To month</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((i) => (
                  <tr key={i}>
                    <td>
                      <select
                        className="ep-select"
                        name={`discountId${i}`}
                        defaultValue={held[i]?.discountId ?? ''}
                        aria-label={`Discount ${i + 1}`}
                      >
                        <option value="">—</option>
                        {master.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.percent ? `${Number(d.percent)}%` : `₹${d.amount}`}
                            {d.headCode ? ` on ${d.headCode}` : ''})
                          </option>
                        ))}
                      </select>
                    </td>
                    {(['fromSeq', 'toSeq'] as const).map((k) => (
                      <td key={k}>
                        <select
                          className="ep-select"
                          name={`${k}${i}`}
                          defaultValue={String(held[i]?.[k] ?? (k === 'fromSeq' ? 1 : 12))}
                          aria-label={`Discount ${i + 1}: ${k === 'fromSeq' ? 'from month' : 'to month'}`}
                        >
                          {periods.map((p) => (
                            <option key={p.id} value={p.sequence}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ maxWidth: '32rem', marginTop: 'var(--sp-3)' }}>
            <InputField
              id="discReason"
              name="reason"
              label="Reason"
              required
              minLength={3}
              maxLength={300}
            />
          </div>
          <FormActions>
            <Button type="submit" variant="secondary">
              Send discounts for approval
            </Button>
          </FormActions>
        </form>
      ) : null}
    </div>
  );
}
