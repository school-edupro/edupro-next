import { PageHeader } from '@edupro/ui';
import { ReminderCompose, type ReminderTemplate } from '@/components/fees/ReminderCompose';
import { apiFetch } from '@/lib/api';
import {
  reminderPreview,
  reminderSaveCc,
  reminderSend,
  reminderTest,
} from '@/lib/fee-reminder-actions';

/**
 * A fee reminder to the parents of defaulters: the pupils come from the defaulters report (the ticked
 * ones, or everyone its filters list); the message is a template for each channel, previewed and
 * tested before it is sent.
 */
export default async function FeeReminderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const id = (v?: string) => (v && /^\d{1,18}$/.test(v) ? v : undefined);
  const ids = (sp.ids ?? '').split(',').filter((x) => /^\d{1,18}$/.test(x));
  const filter = {
    studentIds: ids.length ? ids : undefined,
    asOf: day(sp.asOf),
    classId: id(sp.classId),
    discountId: sp.discountId === 'none' ? 'none' : id(sp.discountId),
    minBalance: /^\d{1,9}$/.test(sp.minBalance ?? '') ? Number(sp.minBalance) : undefined,
    ledger: sp.ledger === 'school' || sp.ledger === 'hostel' ? sp.ledger : undefined,
  };
  const options = await apiFetch<{
    templates: ReminderTemplate[];
    staff: Array<{ id: string; name: string; designation: string | null }>;
    cc: string[];
  }>('/fees/reminders/options');
  // back to the same list of defaulters
  const back = new URLSearchParams({ report: 'defaulters' });
  for (const k of ['asOf', 'classId', 'discountId', 'minBalance', 'ledger'])
    if (sp[k]) back.set(k, sp[k]!);
  return (
    <>
      <PageHeader
        kicker="Fees · Defaulters"
        title="Fee reminder"
        description={
          ids.length
            ? `To the parents of the ${String(ids.length)} pupil${ids.length === 1 ? '' : 's'} ticked on the defaulters list.`
            : 'To the parents of every pupil on the defaulters list as filtered.'
        }
      />
      <ReminderCompose
        filter={filter}
        templates={options.templates}
        staff={options.staff}
        ccDefault={options.cc}
        back={`/fees/reports?${back.toString()}`}
        preview={reminderPreview}
        test={reminderTest}
        send={reminderSend}
        saveCc={reminderSaveCc}
      />
    </>
  );
}
