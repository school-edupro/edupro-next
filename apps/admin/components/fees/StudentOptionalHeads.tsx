import { Badge, Button, FormActions, InputField } from '@edupro/ui';
import { apiFetch } from '@/lib/api';
import { requestOptionalHeads } from '@/lib/fee-setup-actions';
import type { FeePeriod } from '@/lib/types';

interface OptionalHead {
  headId: string;
  code: string;
  name: string;
  opted: boolean;
  fromSeq: number | null;
  toSeq: number | null;
  fromName: string | null;
  toName: string | null;
}

/**
 * The school's optional fee heads (swimming, horse riding ...) for one pupil. A head is charged only when
 * the pupil is opted in, for the months chosen. The list is changed through the two-level approval.
 */
export async function StudentOptionalHeads({
  studentId,
  canRequest,
}: {
  studentId: string;
  canRequest: boolean;
}) {
  const [heads, periods] = await Promise.all([
    apiFetch<{ data: OptionalHead[] }>(`/fees/students/${studentId}/optional-heads`)
      .then((r) => r.data)
      .catch(() => [] as OptionalHead[]),
    apiFetch<{ data: FeePeriod[] }>('/fees/periods')
      .then((r) => r.data)
      .catch(() => [] as FeePeriod[]),
  ]);
  if (heads.length === 0) return null;
  return (
    <div style={{ marginTop: 'var(--sp-4)' }}>
      <h3 className="ep-h4">Optional fee heads</h3>
      <p className="ep-field__help">
        An optional head is charged only to pupils opted in for it. Tick the heads this pupil takes
        and the months; send it for approval (fee in-charge, then principal). The bill is rebuilt
        after approval.
      </p>
      <form action={requestOptionalHeads}>
        <input type="hidden" name="studentId" value={studentId} />
        <div className="ep-table-wrap">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Optional heads of this pupil</caption>
            <thead>
              <tr>
                <th scope="col">Takes it</th>
                <th scope="col">Optional head</th>
                <th scope="col">Now</th>
                <th scope="col">From month</th>
                <th scope="col">To month</th>
              </tr>
            </thead>
            <tbody>
              {heads.map((h) => (
                <tr key={h.headId}>
                  <td>
                    <input
                      type="checkbox"
                      name="headIds"
                      value={h.headId}
                      defaultChecked={h.opted}
                      disabled={!canRequest}
                      aria-label={`${h.name}: the pupil takes it`}
                    />
                  </td>
                  <th scope="row">{h.name}</th>
                  <td>
                    {h.opted ? (
                      <Badge tone="success">
                        {h.fromName} to {h.toName}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Not charged</Badge>
                    )}
                  </td>
                  {(['fromSeq', 'toSeq'] as const).map((k) => (
                    <td key={k}>
                      <select
                        className="ep-select"
                        name={`${k}:${h.headId}`}
                        defaultValue={String(h[k] ?? (k === 'fromSeq' ? 1 : 12))}
                        disabled={!canRequest}
                        aria-label={`${h.name}: ${k === 'fromSeq' ? 'from month' : 'to month'}`}
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
        {canRequest ? (
          <>
            <div style={{ maxWidth: '32rem', marginTop: 'var(--sp-3)' }}>
              <InputField
                id="optReason"
                name="reason"
                label="Reason"
                required
                minLength={3}
                maxLength={300}
              />
            </div>
            <FormActions>
              <Button type="submit" variant="secondary">
                Send optional heads for approval
              </Button>
            </FormActions>
          </>
        ) : null}
      </form>
    </div>
  );
}
