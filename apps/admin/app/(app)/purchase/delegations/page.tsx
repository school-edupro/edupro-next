import { Badge, Breadcrumbs, FormActions, FormRow, FormSection, PageHeader } from '@edupro/ui';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import type { PurchaseDelegation } from '@/lib/purchase';
import { delegatePurchase, revokePurchaseDelegation } from '@/lib/purchase-actions';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));

/**
 * Purchase delegations (docs/design/83, part 2): an approver away for some days hands their PI, PR and
 * PO approvals to a colleague; the colleague decides "on behalf of" them and the history says so. It
 * covers purchase only — leave, fees and the rest stay with the approver. The school admin can hand
 * over anyone's.
 */
export default async function PurchaseDelegationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const data = await apiFetch<{
    data: PurchaseDelegation[];
    staff: Array<{
      id: string;
      userId: string;
      code: string;
      name: string;
      designation: string | null;
    }>;
    canForOthers: boolean;
  }>('/purchase/delegations');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase Indents', href: '/purchase/indents' },
          { label: 'Hand over my approvals' },
        ]}
      />
      <PageHeader
        kicker="Purchase"
        title="Hand over my approvals"
        description="Away for some days? A colleague approves your purchase indents, requisitions and orders in your place for those days. Other approvals (leave, fees and the rest) stay with you."
      />
      <Notice params={sp} />
      <form action={delegatePurchase}>
        <FormSection title="Hand over">
          <FormRow columns={data.canForOthers ? 3 : 2}>
            {data.canForOthers ? (
              <label className="ep-field" htmlFor="dl-from">
                <span className="ep-field__label">Whose approvals</span>
                <select id="dl-from" name="fromUserId" className="ep-select" defaultValue="">
                  <option value="">Mine</option>
                  {data.staff.map((s) => (
                    <option key={s.id} value={s.userId}>
                      {s.name} ({s.code}){s.designation ? ` · ${s.designation}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="ep-field" htmlFor="dl-to">
              <span className="ep-field__label" data-required="true">
                To
              </span>
              <select id="dl-to" name="toEmployeeId" className="ep-select" required defaultValue="">
                <option value="">Pick the colleague</option>
                {data.staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code}){s.designation ? ` · ${s.designation}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="dl-reason">
              <span className="ep-field__label" data-required="true">
                Reason
              </span>
              <input
                id="dl-reason"
                name="reason"
                className="ep-input"
                required
                minLength={3}
                maxLength={300}
                placeholder="On leave, on exam duty…"
              />
            </label>
          </FormRow>
          <FormRow columns={2}>
            <label className="ep-field" htmlFor="dl-from-day">
              <span className="ep-field__label" data-required="true">
                From
              </span>
              <input
                id="dl-from-day"
                name="startsOn"
                type="date"
                className="ep-input"
                required
                min={today}
                defaultValue={today}
              />
            </label>
            <label className="ep-field" htmlFor="dl-to-day">
              <span className="ep-field__label" data-required="true">
                To (the whole day)
              </span>
              <input
                id="dl-to-day"
                name="endsOn"
                type="date"
                className="ep-input"
                required
                min={today}
              />
            </label>
          </FormRow>
          <FormActions>
            <button type="submit" className="ep-btn ep-btn--primary">
              Hand over
            </button>
          </FormActions>
        </FormSection>
      </form>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Purchase delegations">
        <table className="ep-table">
          <caption className="ep-sr-only">Purchase delegations</caption>
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col">Days</th>
              <th scope="col">Reason</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="ep-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.data.length ? (
              data.data.map((d) => (
                <tr key={d.id}>
                  <td>{d.from}</td>
                  <td>{d.to}</td>
                  <td>
                    {when(d.startsAt)} – {when(d.endsAt)}
                  </td>
                  <td>{d.reason}</td>
                  <td>
                    <Badge tone={d.revoked ? 'neutral' : d.active ? 'success' : 'info'}>
                      {d.revoked
                        ? 'Ended early'
                        : d.active
                          ? 'In force'
                          : new Date(d.startsAt) > new Date()
                            ? 'Starts later'
                            : 'Over'}
                    </Badge>
                  </td>
                  <td>
                    {!d.revoked &&
                    new Date(d.endsAt) > new Date() &&
                    (d.mine || data.canForOthers) ? (
                      <ConfirmAction
                        action={revokePurchaseDelegation}
                        fields={{ id: d.id }}
                        label="End now"
                        title="End this hand-over now?"
                        confirmLabel="End now"
                        variant="ghost"
                        confirmVariant="danger"
                      >
                        {`${d.to} stops approving in ${d.from}’s place.`}
                      </ConfirmAction>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>No hand-overs in the last 30 days.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
