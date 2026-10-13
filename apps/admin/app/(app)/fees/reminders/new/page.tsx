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
  const misc = sp.misc === '1';
  const pay = (['all', 'due', 'unpaid', 'part'] as const).find((x) => x === sp.pay) ?? 'due';
  const filter = misc
    ? {
        classId: id(sp.classId),
        misc: { miscFeeId: id(sp.miscFeeId), pay, lineIds: ids.length ? ids : undefined },
      }
    : {
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
    whatsappNotApproved?: number;
  }>('/fees/reminders/options');
  // back to the same list of defaulters (or of misc fee dues)
  const back = new URLSearchParams({ report: misc ? 'misc_dues' : 'defaulters' });
  for (const k of misc
    ? ['miscFeeId', 'classId']
    : ['asOf', 'classId', 'discountId', 'minBalance', 'ledger'])
    if (sp[k]) back.set(k, sp[k]!);
  const backHref =
    misc && id(sp.miscFeeId) && !ids.length
      ? `/fees/misc-fees/${id(sp.miscFeeId)!}`
      : `/fees/reports?${back.toString()}`;
  return (
    <>
      <PageHeader
        kicker={misc ? 'Fees · Misc fees' : 'Fees · Defaulters'}
        title={
          misc ? (pay === 'all' ? 'Misc fee announcement' : 'Misc fee reminder') : 'Fee reminder'
        }
        description={
          misc
            ? pay === 'all'
              ? 'To the parents of every pupil the misc fee is announced for. Template blanks: {{fee_name}}, {{fee_amount}}, {{fee_due}}, {{last_date}}, {{student_name}}, {{class}}.'
              : `To the parents of ${ids.length ? `the ${String(ids.length)} ticked` : 'everyone'} who still has to pay. A paid, closed or full fee is not asked for. Template blanks: {{fee_name}}, {{fee_due}}, {{last_date}}, {{student_name}}.`
            : ids.length
              ? `To the parents of the ${String(ids.length)} pupil${ids.length === 1 ? '' : 's'} ticked on the defaulters list.`
              : 'To the parents of every pupil on the defaulters list as filtered.'
        }
      />
      <ReminderCompose
        filter={filter}
        templates={options.templates}
        staff={options.staff}
        ccDefault={options.cc}
        whatsappNotApproved={options.whatsappNotApproved ?? 0}
        back={backHref}
        backLabel={misc ? 'Back to misc fees' : undefined}
        amountWord={misc ? 'to pay' : undefined}
        preview={reminderPreview}
        test={reminderTest}
        send={reminderSend}
        saveCc={reminderSaveCc}
      />
    </>
  );
}
