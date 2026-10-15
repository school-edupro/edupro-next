import { Card, PageHeader } from '@edupro/ui';
import { FeeSetupNav } from '@/components/fees/FeeSetupNav';
import {
  HostelCalendarEditor,
  type HostelCalendarView,
} from '@/components/fees/HostelCalendarEditor';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { saveHostelCalendar } from '@/lib/fee-setup-actions';

/**
 * Fee setup -> Hostel calendar: hostel instalments follow each class's calendar, or the hostel has its
 * own pay plan (for example quarterly), last dates, late fee and what parents see, kept like the class
 * calendar. Unpaid hostel bills take a change at once.
 */
export default async function HostelCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [cal, me] = await Promise.all([
    apiFetch<HostelCalendarView>('/fees/hostel-calendar'),
    getMe(),
  ]);
  const can = me.permissions.includes('fees.master.manage');
  return (
    <>
      <PageHeader
        kicker="Fees · Setup"
        title="Hostel calendar"
        description="Hostel fee is billed and receipted on its own ledger. Here it follows each class's calendar, or gets its own: how often it is paid, its last dates, its late fee and what parents see."
      />
      <FeeSetupNav current="/fees/hostel-calendar" />
      <Notice params={sp} />
      <Card title="How hostel fee falls due">
        <form action={saveHostelCalendar}>
          <HostelCalendarEditor cal={cal} can={can} />
          {can ? (
            <p style={{ marginTop: 'var(--sp-3)' }}>
              <button type="submit" className="ep-btn ep-btn--primary">
                Save the hostel calendar
              </button>
            </p>
          ) : null}
        </form>
      </Card>
    </>
  );
}
