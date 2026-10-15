import { Button, InputField, PageHeader } from '@edupro/ui';
import { PrintButton } from '@/components/PrintButton';
import { FeeBillSheet, type FeeBillView } from '@/components/fees/FeeBillSheet';
import { dmy } from '@/components/fees/sheets';
import { ApiError, apiFetch } from '@/lib/api';

type Bill = FeeBillView;
const LEDGERS = ['all', 'school', 'hostel'] as const;

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** Fee bills for print: one pupil, or every pupil of a class who owes something up to a date. */
export default async function FeeBillsPage({
  searchParams,
}: {
  searchParams: Promise<{
    classId?: string;
    studentId?: string;
    upTo?: string;
    scope?: string;
    view?: string;
    ledger?: string;
  }>;
}) {
  const sp = await searchParams;
  // the whole year's bill by default; the user may narrow it to what is due today or up to a date
  const scope = sp.scope === 'today' || sp.scope === 'date' ? sp.scope : 'year';
  const picked = sp.upTo && /^\d{4}-\d{2}-\d{2}$/.test(sp.upTo) ? sp.upTo : today();
  const upTo = scope === 'year' ? '9999-12-31' : scope === 'today' ? today() : picked;
  const parentView = sp.view === 'parent' && Boolean(sp.studentId);
  // all fee, regular (school) fee only, or hostel fee only
  const ledger = LEDGERS.find((l) => l === sp.ledger) ?? 'all';
  let bills: Bill[] = [];
  let problem: string | null = null;
  try {
    // the parent's view: only the instalments the school has opened to the family, as in the parent app
    if (sp.studentId)
      bills = [
        await apiFetch<Bill>(
          `/fees/students/${sp.studentId}/bill?ledger=${ledger}${parentView ? '' : `&upTo=${upTo}`}`,
        ),
      ];
    else if (sp.classId)
      bills = (
        await apiFetch<{ data: Bill[] }>(
          `/fees/bills?classId=${sp.classId}&upTo=${upTo}&ledger=${ledger}`,
        )
      ).data;
  } catch (error) {
    problem =
      error instanceof ApiError && typeof error.problem.detail === 'string'
        ? error.problem.detail
        : 'The bills could not be made.';
  }
  const asked = Boolean(sp.studentId || sp.classId);
  // one pupil's bill prints even when all is paid (it shows the receipts); a class's only those who owe
  const printable = bills.filter((b) => b.schedules.length > 0 || b.receipts.length > 0);
  return (
    <>
      <div className="ep-noprint">
        <PageHeader
          kicker="Fees"
          title="Fee bills for print"
          description="The annual fee bill: heads of the session, the instalment schedule with what is paid and left, the receipts and the balance. Choose all fee, regular (school) fee or hostel fee. For a class, pupils who owe nothing are left out. Bills are opened from Fees → Demands (a class) or from a pupil’s fee page."
        />
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <a
            className="ep-btn ep-btn--ghost"
            href={
              sp.studentId
                ? `/fees/ledger/${sp.studentId}`
                : `/fees/demands${sp.classId ? `?classId=${sp.classId}` : ''}`
            }
          >
            Back
          </a>
          {sp.classId ? <input type="hidden" name="classId" value={sp.classId} /> : null}
          {sp.studentId ? <input type="hidden" name="studentId" value={sp.studentId} /> : null}
          <label className="ep-field" htmlFor="ledger">
            <span className="ep-field__label">Fee type</span>
            <select className="ep-select" id="ledger" name="ledger" defaultValue={ledger}>
              <option value="all">All (school and hostel)</option>
              <option value="school">Regular (school fee)</option>
              <option value="hostel">Hosteller (hostel fee)</option>
            </select>
          </label>
          {parentView ? <input type="hidden" name="view" value="parent" /> : null}
          {!parentView ? (
            <>
              <label className="ep-field" htmlFor="scope">
                <span className="ep-field__label">Bill for</span>
                <select className="ep-select" id="scope" name="scope" defaultValue={scope}>
                  <option value="year">The full year</option>
                  <option value="today">What is due up to today</option>
                  <option value="date">What is due up to the date →</option>
                </select>
              </label>
              <InputField
                id="upTo"
                name="upTo"
                label="Date (for the last choice)"
                type="date"
                defaultValue={picked}
              />
            </>
          ) : null}
          <Button type="submit" variant="secondary">
            Show
          </Button>
          {printable.length > 0 ? (
            <PrintButton label={`Print ${printable.length} bill(s)`} />
          ) : null}
        </form>
        {problem ? (
          <p className="ep-alert ep-alert--danger" role="alert">
            {problem}
          </p>
        ) : null}
        {!asked ? (
          <p className="ep-field__help">
            Open Fees → Demands, choose a class and press “Print fee bills”.
          </p>
        ) : null}
        {parentView ? (
          <p className="ep-field__help">
            Parent’s view: the instalments the school has opened to the family, head by head, as the
            parent app shows them today. Receipts are on the pupil’s ledger.
          </p>
        ) : null}
        {asked && !problem && printable.length === 0 ? (
          <p className="ep-field__help">
            {parentView
              ? 'Nothing is payable for the parent today.'
              : scope === 'year'
                ? 'Nothing is payable for the year.'
                : `Nothing is payable up to ${dmy(upTo)}.`}
          </p>
        ) : null}
      </div>
      {printable.map((b) => (
        <FeeBillSheet key={b.student.id} b={b} />
      ))}
    </>
  );
}
