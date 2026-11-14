import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Notice } from '@/components/Notice';
import {
  IncrementsTab,
  RevisionsTab,
  SettlementsTab,
  TransfersTab,
} from '@/components/payroll/people/PeopleTabs';
import { ApiError, getMe } from '@/lib/api';

const TABS = [
  { id: 'settlements', label: 'Leavers’ settlements' },
  { id: 'revisions', label: 'Revisions' },
  { id: 'increments', label: 'Increments' },
  { id: 'transfers', label: 'From a sister school' },
] as const;

/**
 * Pay changes and leavers (docs/design/86, phase E): the leavers' settlements, pay revisions with their arrears, the
 * yearly increments with their letters, and staff come from a sister school. Each opens from its row.
 */
export default async function PayrollPeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  const tab = TABS.find((t) => t.id === sp.tab)?.id ?? 'settlements';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : today.slice(0, 7);
  const status = ['ALL', 'DRAFT', 'COMPUTED', 'APPROVED', 'STAGED', 'DUES', 'SETTLED'].includes(
    sp.status ?? '',
  )
    ? sp.status!
    : 'ALL';
  let body: ReactNode;
  try {
    body =
      tab === 'revisions'
        ? await RevisionsTab({ canDraft: me.permissions.includes('payroll.run.manage') })
        : tab === 'increments'
          ? await IncrementsTab({ month })
          : tab === 'transfers'
            ? await TransfersTab()
            : await SettlementsTab({ status });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  return (
    <>
      <Breadcrumbs items={[{ label: 'Payroll' }, { label: 'Pay changes and leavers' }]} />
      <PageHeader
        kicker="Payroll"
        title="Pay changes and leavers"
        description="Leavers’ settlements, pay revisions and their arrears, the yearly increments, and staff from a sister school."
      />
      <Notice params={sp} />
      <nav className="ep-tabs" aria-label="Pay changes and leavers">
        {TABS.map((t) => (
          <a
            key={t.id}
            className="ep-tabs__tab"
            href={`/payroll/people?tab=${t.id}`}
            aria-current={t.id === tab ? 'page' : undefined}
          >
            {t.label}
          </a>
        ))}
      </nav>
      {body}
    </>
  );
}
