/** Every fee report, in one bar: what was collected, what is due and expected, and the accounts side. */
export const REPORT_GROUPS = [
  {
    title: 'Collection',
    items: [
      ['day_book', 'Day book'],
      ['daybook_grouped', 'Day book (grouped)'],
      ['mode_daywise', 'Mode-wise collection'],
      ['head_receipts', 'Head-wise tally'],
      ['cheque_bounce', 'Cheque bounce'],
    ],
  },
  {
    title: 'Dues and forecast',
    items: [
      ['defaulters', 'Defaulters'],
      ['period_headwise', 'Period fee, head-wise'],
      ['yearly_projection', 'Yearly projection'],
      ['forecast', 'Forecast'],
    ],
  },
  {
    title: 'Accounts',
    items: [
      ['tally', 'Tally vouchers'],
      ['check', 'Report check'],
    ],
  },
] as const;

export type ReportKey = (typeof REPORT_GROUPS)[number]['items'][number][0];
export const REPORT_LABEL = Object.fromEntries(
  REPORT_GROUPS.flatMap((g) => g.items.map(([k, label]) => [k, label])),
) as Record<ReportKey, string>;
/** Addresses saved before the reports were brought together still open the right one. */
export const REPORT_ALIAS: Record<string, ReportKey> = {
  head_tally: 'head_receipts',
  mode_summary: 'mode_daywise',
};
export const isReportKey = (v: string | undefined): v is ReportKey =>
  !!v && Object.prototype.hasOwnProperty.call(REPORT_LABEL, v);

export function ReportTabs({ current }: { current: ReportKey }) {
  return (
    <nav
      aria-label="Fee reports"
      style={{ display: 'grid', gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)' }}
    >
      {REPORT_GROUPS.map((g) => (
        <div
          key={g.title}
          style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}
        >
          <span className="ep-kicker" style={{ minWidth: '9.5rem' }}>
            {g.title}
          </span>
          {g.items.map(([key, label]) => (
            <a
              key={key}
              className={`ep-btn ep-btn--sm ${key === current ? 'ep-btn--primary' : 'ep-btn--ghost'}`}
              href={`/fees/reports?report=${key}`}
              aria-current={key === current ? 'page' : undefined}
            >
              {label}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}
