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
      <Card title="Approval levels" style={{ marginBottom: 'var(--sp-4)' }}>
        <p style={{ margin: 0 }}>
          Who may start a hostel withdrawal and who approves it, level by level, are set on{' '}
          <a href="/fees/approval">Fee setup → Approval levels</a> (Hostel withdrawal).
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
