import { Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';
import { WithdrawalDepartmentsEditor } from '@/components/WithdrawalDepartmentsEditor';
import { apiFetch, getMe } from '@/lib/api';
import { saveHostelNotice } from '@/lib/hostel-withdrawal-actions';
import type { WithdrawalDepartment } from '@/lib/types';

/** Hostel withdrawal settings: the notice period and the steps (same engine as the school withdrawal). */
export default async function HostelWithdrawalSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [me, s] = await Promise.all([
    getMe(),
    apiFetch<{
      departments: WithdrawalDepartment[];
      roles: Array<{ id: string; name: string }>;
      staff: Array<{ userId: string; name: string; designation: string | null }>;
      noticeDays: number;
      noticeCharge: boolean;
    }>('/hostel/withdrawal-settings'),
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
        description="Who clears a pupil leaving the hostel, in which order, and the notice the school asks for. Departments at the same step work in parallel; the last step settles the hostel fee."
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
      <Card title="Steps">
        <p className="ep-field__help">
          “Warden of the pupil’s hostel” is the warden of the hostel the pupil stays in. A step that
          raises a charge (damages, mess dues) puts it on the pupil as a misc fee. A step marked
          “also when leaving the school” clears a hosteller inside the school withdrawal.
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
