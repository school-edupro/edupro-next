import { Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';
import { WithdrawalDepartmentsEditor } from '@/components/WithdrawalDepartmentsEditor';
import { apiFetch, getMe } from '@/lib/api';
import { saveCheckoutItems, saveHostelNotice } from '@/lib/hostel-withdrawal-actions';
import type { WithdrawalDepartment } from '@/lib/types';

/** Hostel withdrawal settings: the notice period and the steps (same engine as the school withdrawal). */
export default async function HostelWithdrawalSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [me, s, items] = await Promise.all([
    getMe(),
    apiFetch<{
      departments: WithdrawalDepartment[];
      roles: Array<{ id: string; name: string }>;
      staff: Array<{ userId: string; name: string; designation: string | null }>;
      noticeDays: number;
      noticeCharge: boolean;
    }>('/hostel/withdrawal-settings'),
    apiFetch<{
      data: Array<{ id: string; name: string; charge: number; active: boolean; used: number }>;
    }>('/hostel/checkout-items').then((r) => r.data),
  ]);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Hostel', href: '/hostel' },
          { label: 'Withdrawals', href: '/hostel/withdrawals' },
          { label: 'Steps and notice' },
        ]}
      />
      <PageHeader
        kicker="Hostel withdrawal settings"
        title="Steps and notice"
        description="The notice the school asks for, and the hostel's steps when a hosteller leaves the school. The approval levels of leaving the hostel are on Fee setup → Approval levels."
      />
      <HostelNav current="/hostel/withdrawals" permissions={me.permissions} />
      <Notice params={sp} />
      <Card title="Notice period" style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          action={saveHostelNotice}
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" htmlFor="hn-days">
            <span className="ep-field__label">Days of notice</span>
            <input
              id="hn-days"
              name="noticeDays"
              type="number"
              min={0}
              max={120}
              className="ep-input"
              defaultValue={s.noticeDays}
              required
            />
          </label>
          <label className="ep-roles__tick" htmlFor="hn-charge">
            <input
              id="hn-charge"
              name="noticeCharge"
              type="checkbox"
              defaultChecked={s.noticeCharge}
            />{' '}
            With shorter notice, charge the hostel fee of the month after leaving
          </label>
          <Button type="submit">Save</Button>
        </form>
      </Card>
      <Card title="Room check-out items" style={{ marginBottom: 'var(--sp-4)' }}>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          What the warden checks in the room when a pupil leaves the hostel, with the charge for one
          missing or damaged. At a withdrawal the charges of what is missing or damaged add up to
          the damage charge.
        </p>
        <form action={saveCheckoutItems}>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Check-out items">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Room check-out items</caption>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" className="ep-num">
                    Charge if missing or damaged (₹)
                  </th>
                  <th scope="col">In use</th>
                  <th scope="col">Remove</th>
                </tr>
              </thead>
              <tbody>
                {[...items.map((x, i) => ({ x, i: String(i) })), { x: null, i: 'new' }].map(
                  ({ x, i }) => (
                    <tr key={i}>
                      <td>
                        {x ? <input type="hidden" name={`i-${i}-id`} value={x.id} /> : null}
                        <label className="ep-sr-only" htmlFor={`ci-${i}-name`}>
                          {x ? `Item ${x.name}` : 'New item'}
                        </label>
                        <input
                          id={`ci-${i}-name`}
                          name={`i-${i}-name`}
                          className="ep-input"
                          maxLength={60}
                          defaultValue={x?.name ?? ''}
                          placeholder={x ? undefined : 'New item, e.g. Fan regulator'}
                        />
                      </td>
                      <td className="ep-num">
                        <label className="ep-sr-only" htmlFor={`ci-${i}-charge`}>
                          Charge {x?.name ?? 'of the new item'}
                        </label>
                        <input
                          id={`ci-${i}-charge`}
                          name={`i-${i}-charge`}
                          type="number"
                          min={0}
                          step="0.01"
                          className="ep-input"
                          style={{ maxWidth: '9rem' }}
                          defaultValue={x?.charge ?? 0}
                        />
                      </td>
                      <td>
                        {x ? (
                          <label className="ep-check" htmlFor={`ci-${i}-on`}>
                            <input
                              id={`ci-${i}-on`}
                              type="checkbox"
                              name={`i-${i}-active`}
                              defaultChecked={x.active}
                            />
                            <span className="ep-sr-only"> {x.name} in use</span>
                          </label>
                        ) : null}
                      </td>
                      <td>
                        {x ? (
                          <label className="ep-check" htmlFor={`ci-${i}-rm`}>
                            <input id={`ci-${i}-rm`} type="checkbox" name={`remove-${i}`} />
                            <span className="ep-sr-only"> Remove {x.name}</span>
                            {x.used ? (
                              <span className="ep-field__help"> (used: switched off)</span>
                            ) : null}
                          </label>
                        ) : null}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <Button type="submit" variant="secondary">
              Save the items
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Approval levels" style={{ marginBottom: 'var(--sp-4)' }}>
        <p style={{ margin: 0 }}>
          Who may start a hostel withdrawal and who approves it, level by level, are set on{' '}
          <a href="/fees/approval" style={{ textDecoration: 'underline' }}>
            Fee setup → Approval levels
          </a>{' '}
          (Hostel withdrawal).
        </p>
      </Card>
      <Card title="Steps when a hosteller leaves the school">
        <p className="ep-field__help">
          These clear a hosteller inside the school withdrawal (People → Withdrawals). “Warden of
          the pupil’s hostel” is the warden of the hostel the pupil stays in. A step that raises a
          charge (damages, mess dues) puts it on the pupil as a misc fee.
        </p>
        <WithdrawalDepartmentsEditor
          departments={s.departments}
          roles={s.roles}
          staff={s.staff}
          process="hostel"
        />
      </Card>
    </>
  );
}
