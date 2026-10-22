import { Badge, Breadcrumbs, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Pager } from '@/components/RegisterTools';
import { apiFetch, getMe } from '@/lib/api';
import { dmy } from '@/lib/library-books';
import { askFineWaiver, sendFinesToCounter, waiveOldFine } from '@/lib/library-fines-actions';

type Tab = 'outstanding' | 'collected' | 'waived';
type Row = {
  day: string | null;
  loanId: string;
  chargeId: string | null;
  borrowerKind: string;
  borrower: string;
  ref: string;
  place: string | null;
  title: string;
  accessionNo: string;
  dueOn: string | null;
  returnedOn: string | null;
  daysLate: number;
  fine: number;
  amount: number;
  due: number;
  state: string;
  receiptNo: string | null;
  mode: string | null;
  by: string | null;
  reason: string | null;
  how: 'counter' | 'library';
};
type Report = {
  rows: Row[];
  total: number;
  page: number;
  pages: number;
  totals: { rows: number; amount: number };
  unsent: { count: number; amount: number };
};
type Sections = {
  classes: Array<{ id: string; name: string; sections: Array<{ id: string; name: string }> }>;
};

const TABS: Array<[Tab, string, string]> = [
  ['outstanding', 'Outstanding', 'Returned on'],
  ['collected', 'Collected', 'Paid on'],
  ['waived', 'Waived', 'Waived on'],
];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Late fines (docs/design/36-library.md, "Library reports", part 1): a book back late puts its fine at
 * the fees counter at once, as a misc fee; the library takes no fine money. Outstanding (at the counter,
 * or old fines never sent), collected (the counter's receipts) and waived (who, when, why) between two
 * days, by pupils or staff, a class or a search; the tab as Excel or PDF.
 */
export default async function FinesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('library.loan.circulate')) notFound();
  const t = await getTranslations('pages.library_fines');
  const tab: Tab = TABS.some(([v]) => v === sp.tab) ? (sp.tab as Tab) : 'outstanding';
  // the filters, checked; they carry over between the tabs
  const f: Record<string, string> = {};
  for (const k of ['from', 'to'] as const) if (DAY.test(sp[k] ?? '')) f[k] = sp[k]!;
  if (sp.borrower === 'student' || sp.borrower === 'employee') f.borrower = sp.borrower;
  const where = /^[cs]:\d{1,18}$/.test(sp.where ?? '') ? sp.where! : '';
  if (where.startsWith('c:')) f.classId = where.slice(2);
  if (where.startsWith('s:')) f.sectionId = where.slice(2);
  const search = (sp.q ?? '').trim().slice(0, 80);
  if (search) f.q = search;
  const page = Math.max(1, Math.min(10_000, Number(sp.page) || 1));
  const qs = (x: Record<string, string>) => new URLSearchParams(x).toString();
  const [report, others, sections] = await Promise.all([
    apiFetch<Report>(`/library/fines/report?${qs({ ...f, tab, page: String(page), size: '50' })}`),
    Promise.all(
      TABS.filter(([v]) => v !== tab).map(([v]) =>
        apiFetch<Report>(`/library/fines/report?${qs({ ...f, tab: v, size: '1' })}`).then(
          (r) => [v, r.totals] as const,
        ),
      ),
    ),
    apiFetch<Sections>('/library/desk/sections').catch(() => ({ classes: [] }) as Sections),
  ]);
  const totals = Object.fromEntries([...others, [tab, report.totals] as const]) as Record<
    Tab,
    Report['totals']
  >;
  // the filters as the page has them, for links and the files
  const keep: Record<string, string> = {
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.borrower ? { borrower: f.borrower } : {}),
    ...(where ? { where } : {}),
    ...(search ? { q: search } : {}),
  };
  const here = `/library/fines?${qs({ ...keep, tab, ...(page > 1 ? { page: String(page) } : {}) })}`;
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/library-report?${qs({ report: 'fines', ...f, tab, format })}`;
  const [, tabLabel, dayWord] = TABS.find(([v]) => v === tab)!;
  const filtered = Object.keys(keep).length > 0;
  const who = (x: Row) => (
    <>
      {x.borrower}
      <div className="ep-field__help">
        {x.borrowerKind === 'student' ? 'Pupil' : 'Staff'} · {x.ref}
        {x.place ? ` · ${x.place}` : ''}
      </div>
    </>
  );
  const book = (x: Row) => (
    <>
      {x.title}
      <div className="ep-field__help">{x.accessionNo}</div>
    </>
  );
  const backField = <input type="hidden" name="back" value={here} />;
  // a waiver being written: an old fine at the library (l<loan>) or a fine at the counter (c<charge>)
  const act = /^[lc]\d{1,18}$/.test(sp.act ?? '') && tab === 'outstanding' ? sp.act! : '';
  const withAct = (a: string) => `${here}${here.includes('?') ? '&' : '?'}act=${a}`;
  const acting = act
    ? report.rows.find((x) =>
        act.startsWith('l')
          ? x.how === 'library' && x.loanId === act.slice(1)
          : x.chargeId === act.slice(1),
      )
    : undefined;
  /** amount (empty: all of it) and the reason, for a waiver */
  const waiveFields = (key: string, due: number) => (
    <>
      <InputField
        id={`lf-a-${key}`}
        name="amount"
        type="number"
        min={1}
        max={due}
        step="0.01"
        label="Amount (₹)"
        help={`All ${rupees(due)} if left empty`}
      />
      <div className="ep-dlog__search">
        <InputField
          id={`lf-r-${key}`}
          name="reason"
          label="Reason"
          required
          minLength={3}
          maxLength={300}
        />
      </div>
    </>
  );

  return (
    <>
      <Breadcrumbs items={[{ label: 'Library', href: '/library' }, { label: t('title') }]} />
      <PageHeader
        kicker={t('kicker')}
        title="Late fines"
        description={t('description')}
        actions={
          <>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/library/charges">
              Lost and damaged books
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')}>
              Excel
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')}>
              PDF
            </a>
          </>
        }
      />
      <Notice params={sp} />

      {report.unsent.count ? (
        <div
          className="ep-alert ep-alert--warning"
          role="status"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <p style={{ margin: 0 }}>
            {report.unsent.count} old fine{report.unsent.count === 1 ? ' is' : 's are'} still at the
            library ({rupees(report.unsent.amount)}), from before fines went to the fees counter.
            Send them there so the borrowers pay at the counter, or waive one with its reason.
          </p>
          <form action={sendFinesToCounter} style={{ marginTop: 'var(--sp-2)' }}>
            {backField}
            <Button type="submit" size="sm">
              Send all {report.unsent.count} to the fees counter
            </Button>
          </form>
        </div>
      ) : null}

      <div className="ep-cdash__kpis" style={{ marginBottom: 'var(--sp-4)' }}>
        {TABS.map(([v, label]) => (
          <a
            key={v}
            href={`/library/fines?${qs({ ...keep, tab: v })}#list`}
            className="ep-tile-link"
            aria-current={tab === v ? 'true' : undefined}
            aria-label={`${label}: ${rupees(totals[v].amount)}, ${String(totals[v].rows)} fines. Show the list`}
          >
            <Card title={label}>
              <div className="ep-cdash__big">{rupees(totals[v].amount)}</div>
              <p className="ep-field__help" style={{ margin: 0 }}>
                {totals[v].rows} fine{totals[v].rows === 1 ? '' : 's'}
                {filtered ? ' for these filters' : v === 'outstanding' ? ' due' : ''}
              </p>
            </Card>
          </a>
        ))}
      </div>

      <div className="ep-filter-band">
        <form method="get" action="/library/fines" className="ep-dlog__filters">
          <input type="hidden" name="tab" value={tab} />
          <InputField
            id="lf-from"
            name="from"
            type="date"
            label={`${dayWord} from`}
            defaultValue={f.from ?? ''}
          />
          <InputField id="lf-to" name="to" type="date" label="To" defaultValue={f.to ?? ''} />
          <SelectField
            id="lf-borrower"
            name="borrower"
            label="Borrowers"
            defaultValue={f.borrower ?? ''}
            options={[
              { value: '', label: 'Pupils and staff' },
              { value: 'student', label: 'Pupils' },
              { value: 'employee', label: 'Staff' },
            ]}
          />
          <SelectField
            id="lf-where"
            name="where"
            label="Class or section"
            defaultValue={where}
            options={[
              { value: '', label: 'Every class' },
              ...sections.classes.flatMap((k) => [
                { value: `c:${k.id}`, label: `${k.name} (all sections)` },
                ...k.sections.map((s) => ({ value: `s:${s.id}`, label: `${k.name}-${s.name}` })),
              ]),
            ]}
          />
          <div className="ep-dlog__search">
            <InputField
              id="lf-q"
              name="q"
              type="search"
              label="Search"
              placeholder="Name, admission or employee no., book or book no."
              maxLength={80}
              defaultValue={search}
            />
          </div>
          <Button type="submit">Show</Button>
          {filtered ? (
            <a className="ep-btn ep-btn--secondary" href={`/library/fines?tab=${tab}`}>
              Clear
            </a>
          ) : null}
        </form>
      </div>

      <section className="ep-card" id="list" aria-labelledby="lf-list-h">
        <h2 id="lf-list-h" className="ep-card__title">
          {tabLabel} · {report.total} · {rupees(report.totals.amount)}
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {tab === 'outstanding'
            ? 'A late fine is a misc fee on the pupil (the parent sees it) or the staff member, paid at the fees counter. To waive one there, ask the fees office: it decides under Fee setup → Approval levels.'
            : tab === 'collected'
              ? 'Paid at the fees counter on misc receipts; old fines collected at the library before are listed too.'
              : 'Waived at the desk when the book came back (with the reason and who waived it), or by the fees office.'}
        </p>
        {acting ? (
          <div className="ep-fine-act" id="lf-act" role="region" aria-labelledby="lf-act-h">
            <h3 id="lf-act-h" className="ep-fine-act__title">
              {acting.how === 'library'
                ? 'Waive an old fine'
                : 'Ask the fees office to waive a late fine'}
            </h3>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {acting.borrower} ({acting.ref}) · {acting.title} ({acting.accessionNo}) ·{' '}
              {acting.daysLate} days late · {rupees(acting.due)} due.{' '}
              {acting.how === 'library'
                ? 'The waiver is kept with the reason and your name.'
                : 'The fine stays due until the fees office approves; then the misc fee comes down.'}
            </p>
            <form
              action={acting.how === 'library' ? waiveOldFine : askFineWaiver}
              className="ep-dlog__filters"
            >
              {backField}
              {acting.how === 'library' ? (
                <input type="hidden" name="loanId" value={acting.loanId} />
              ) : (
                <input type="hidden" name="chargeId" value={acting.chargeId ?? ''} />
              )}
              {waiveFields(act, acting.due)}
              <Button type="submit" variant="secondary">
                {acting.how === 'library' ? 'Waive the fine' : 'Ask the fees office'}
              </Button>
              <a className="ep-btn ep-btn--secondary" href={`${here}#list`}>
                Cancel
              </a>
            </form>
          </div>
        ) : null}
        {report.rows.length === 0 ? (
          <p className="ep-field__help">
            {tab === 'outstanding' && !filtered
              ? 'No fine is due.'
              : 'Nothing here for these filters.'}
          </p>
        ) : (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label={`${tabLabel} fines (scrolls sideways)`}
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">{dayWord}</th>
                  <th scope="col">Borrower</th>
                  <th scope="col">Book</th>
                  {tab === 'outstanding' ? (
                    <>
                      <th scope="col">Due on</th>
                      <th scope="col" className="is-numeric">
                        Fine
                      </th>
                      <th scope="col" className="is-numeric">
                        Due
                      </th>
                      <th scope="col">State</th>
                      <th scope="col">
                        <span className="ep-sr-only">Actions</span>
                      </th>
                    </>
                  ) : tab === 'collected' ? (
                    <>
                      <th scope="col" className="is-numeric">
                        Amount
                      </th>
                      <th scope="col">Receipt</th>
                      <th scope="col">Received by</th>
                      <th scope="col">Where</th>
                    </>
                  ) : (
                    <>
                      <th scope="col" className="is-numeric">
                        Fine
                      </th>
                      <th scope="col" className="is-numeric">
                        Waived
                      </th>
                      <th scope="col">Reason</th>
                      <th scope="col">By</th>
                      <th scope="col">Where</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((x, i) => (
                  <tr key={`${x.how}-${x.loanId}-${x.chargeId ?? ''}-${String(i)}`}>
                    <td>{dmy(x.day)}</td>
                    <td>{who(x)}</td>
                    <td>{book(x)}</td>
                    {tab === 'outstanding' ? (
                      <>
                        <td>
                          {dmy(x.dueOn)}
                          <div className="ep-field__help">{x.daysLate} days late</div>
                        </td>
                        <td className="is-numeric">{rupees(x.fine)}</td>
                        <td className="is-numeric">
                          <strong>{rupees(x.due)}</strong>
                          {x.amount ? (
                            <div className="ep-field__help">{rupees(x.amount)} paid</div>
                          ) : null}
                        </td>
                        <td>
                          <Badge
                            tone={
                              x.how === 'library'
                                ? 'danger'
                                : x.state.startsWith('The fees office')
                                  ? 'info'
                                  : 'warning'
                            }
                          >
                            {x.state}
                          </Badge>
                        </td>
                        <td>
                          <div className="ep-fine-acts">
                            {x.how === 'library' ? (
                              <form action={sendFinesToCounter}>
                                {backField}
                                <input type="hidden" name="loanId" value={x.loanId} />
                                <Button type="submit" size="sm">
                                  Send to the fees counter
                                </Button>
                              </form>
                            ) : null}
                            {x.how === 'library' ||
                            (x.chargeId && !x.state.startsWith('The fees office')) ? (
                              <a
                                className="ep-btn ep-btn--ghost ep-btn--sm"
                                href={`${withAct(x.how === 'library' ? `l${x.loanId}` : `c${x.chargeId ?? ''}`)}#lf-act`}
                              >
                                {x.how === 'library' ? 'Waive' : 'Ask to waive'}
                              </a>
                            ) : null}
                          </div>
                        </td>
                      </>
                    ) : tab === 'collected' ? (
                      <>
                        <td className="is-numeric">{rupees(x.amount)}</td>
                        <td>
                          {x.receiptNo ?? '—'}
                          {x.mode ? (
                            <div className="ep-field__help">{x.mode.toUpperCase()}</div>
                          ) : null}
                        </td>
                        <td>{x.by ?? '—'}</td>
                        <td>{x.how === 'counter' ? 'Fees counter' : 'Library (old fine)'}</td>
                      </>
                    ) : (
                      <>
                        <td className="is-numeric">{rupees(x.fine)}</td>
                        <td className="is-numeric">{rupees(x.amount)}</td>
                        <td>{x.reason ?? '—'}</td>
                        <td>{x.by ?? '—'}</td>
                        <td>{x.how === 'counter' ? 'Fees office' : 'Library'}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3}>
                    Total · {report.total} fine{report.total === 1 ? '' : 's'}
                  </th>
                  {tab === 'outstanding' ? (
                    <>
                      <td colSpan={2} />
                      <td className="is-numeric">
                        <strong>{rupees(report.totals.amount)}</strong>
                      </td>
                      <td colSpan={2} />
                    </>
                  ) : tab === 'collected' ? (
                    <>
                      <td className="is-numeric">
                        <strong>{rupees(report.totals.amount)}</strong>
                      </td>
                      <td colSpan={3} />
                    </>
                  ) : (
                    <>
                      <td />
                      <td className="is-numeric">
                        <strong>{rupees(report.totals.amount)}</strong>
                      </td>
                      <td colSpan={3} />
                    </>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <Pager
          page={report.page}
          pages={report.pages}
          hrefFor={(n) => `/library/fines?${qs({ ...keep, tab, page: String(n) })}#list`}
        />
      </section>
    </>
  );
}
