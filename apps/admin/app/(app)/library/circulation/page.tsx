import { PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { BorrowerReturns } from '@/components/library/desk/BorrowerReturns';
import { ClassReturns } from '@/components/library/desk/ClassReturns';
import { IssueDesk } from '@/components/library/desk/IssueDesk';
import { ReturnDesk } from '@/components/library/desk/ReturnDesk';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import type { DeskClass } from '@/lib/library-desk';

const TABS = [
  ['issue', 'Issue'],
  ['return', 'Return'],
  ['borrower', 'Return by borrower'],
  ['class', 'Return by class'],
] as const;
type Tab = (typeof TABS)[number][0];

/**
 * The circulation desk (docs/design/36-library.md, "The circulation desk"): issue several books to a
 * borrower found by admission no., employee code or name; return by scanning a book, by borrower or by
 * class; renew; the late fine collected, waived or left for later. Lost and damaged books, the fines and
 * the stock checks and sales are linked from the tab row.
 */
export default async function CirculationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('library.loan.circulate')) notFound();
  const tab: Tab = TABS.some(([v]) => v === sp.tab) ? (sp.tab as Tab) : 'issue';
  const classes =
    tab === 'class'
      ? (await apiFetch<{ classes: DeskClass[] }>('/library/desk/sections')).classes
      : [];
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        kicker="Library"
        title="Circulation"
        description="Issue and return at the desk: find the borrower by admission no., employee code or name, scan the books; a book back late puts its fine at the fees counter."
      />
      <Notice params={sp} />
      <div className="ep-desk__tabs">
        <nav className="ep-tabs" aria-label="Circulation desk">
          <div className="ep-tabs__list">
            {TABS.map(([v, label]) => (
              <a
                key={v}
                className="ep-tabs__tab"
                href={v === 'issue' ? '/library/circulation' : `/library/circulation?tab=${v}`}
                aria-current={tab === v ? 'page' : undefined}
              >
                {label}
              </a>
            ))}
          </div>
        </nav>
        <nav className="ep-desk__links" aria-label="More at the library">
          <a href="/library/history">History</a>
          <a href="/library/charges">Lost and damaged</a>
          <a href="/library/fines">Late fines</a>
          {me.permissions.includes('library.stock.verify') ? (
            <a href="/library/stock">Stock verification and sales</a>
          ) : null}
        </nav>
      </div>
      {tab === 'issue' ? <IssueDesk today={today} /> : null}
      {tab === 'return' ? <ReturnDesk /> : null}
      {tab === 'borrower' ? <BorrowerReturns /> : null}
      {tab === 'class' ? <ClassReturns classes={classes} /> : null}
    </>
  );
}
