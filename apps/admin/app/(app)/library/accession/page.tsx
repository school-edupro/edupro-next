import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { applyAccessionChange } from '@/lib/library-books-actions';
import { COPY_STATUS, COPY_TONE, type CopyStatus } from '@/lib/library-books';

type PlanRow = {
  copyId: string;
  titleId: string;
  title: string;
  status: string;
  old: string;
  new: string;
  problem: string | null;
};
type Change = {
  old: string;
  new: string;
  now: string;
  titleId: string;
  title: string;
  reason: string;
  by: string | null;
  at: string;
};
const ACC = /^[A-Za-z0-9/ -]{1,30}$/;
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Correcting accession numbers (docs/design/36-library.md, part 2 of the register work): one copy, or a
 * range typed wrong moved in one go; a preview first, then applied with a reason. The old numbers are
 * retired: never given to another copy, still finding their copies at the desk, in a stock check and in
 * a search.
 */
export default async function AccessionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const manage = me.permissions.includes('library.catalogue.manage');
  const v = (k: string) => {
    const x = (sp[k] ?? '').trim();
    return ACC.test(x) ? x.toUpperCase().replace(/\s+/g, '') : '';
  };
  const from = v('from');
  const to = v('to');
  const start = v('start');
  const reason = (sp.reason ?? '').trim().slice(0, 300);
  let plan: { rows: PlanRow[]; copies: number; problems: number } | null = null;
  let planError: string | null = null;
  if (manage && sp.preview && from && start) {
    try {
      plan = await apiFetch<{ rows: PlanRow[]; copies: number; problems: number }>(
        '/library/accession/preview',
        { method: 'POST', body: JSON.stringify({ from, to: to || undefined, start }) },
      );
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      planError = String(e.problem.detail ?? e.problem.type);
    }
  }
  const changes = await apiFetch<Change[]>('/library/accession/changes');
  const lfrom = v('lfrom');
  const lto = v('lto');
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Library', href: '/library' }, { label: 'Accession numbers' }]}
      />
      <PageHeader
        kicker="Library"
        title="Correct accession numbers"
        description="A number typed wrong, for one copy or a whole range. See what changes first, then apply it with the reason. An old number is never given to another copy, and it still finds its copy at the desk, in a stock check and in a search."
      />
      <Notice params={sp} />
      {sp.ok && lfrom ? (
        <p className="ep-alert ep-alert--info" role="status">
          The labels on the books still show the old numbers.{' '}
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/library/labels?from=${encodeURIComponent(lfrom)}&to=${encodeURIComponent(lto || lfrom)}`}
          >
            Print the new labels
          </a>
        </p>
      ) : null}

      {manage ? (
        <section
          className="ep-card"
          aria-labelledby="ac-form-h"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <h2 id="ac-form-h" className="ep-card__title">
            The numbers to correct
          </h2>
          <form method="get" action="/library/accession">
            <input type="hidden" name="preview" value="1" />
            <div className="ep-acr-filter">
              <label className="ep-field" htmlFor="ac-from" style={{ margin: 0 }}>
                <span className="ep-field__label">Accession no. now *</span>
                <input
                  id="ac-from"
                  name="from"
                  className="ep-input"
                  required
                  maxLength={30}
                  defaultValue={from}
                  placeholder="B00101"
                />
                <span className="ep-field__help">One copy, or the first of a range</span>
              </label>
              <label className="ep-field" htmlFor="ac-to" style={{ margin: 0 }}>
                <span className="ep-field__label">Up to (for a range)</span>
                <input
                  id="ac-to"
                  name="to"
                  className="ep-input"
                  maxLength={30}
                  defaultValue={to}
                  placeholder="B00150"
                />
                <span className="ep-field__help">Leave empty for one copy</span>
              </label>
              <label className="ep-field" htmlFor="ac-start" style={{ margin: 0 }}>
                <span className="ep-field__label">Correct number *</span>
                <input
                  id="ac-start"
                  name="start"
                  className="ep-input"
                  required
                  maxLength={30}
                  defaultValue={start}
                  placeholder="B00201"
                />
                <span className="ep-field__help">
                  For a range, the first; the rest follow in order
                </span>
              </label>
              <label className="ep-field" htmlFor="ac-reason" style={{ margin: 0 }}>
                <span className="ep-field__label">Reason</span>
                <input
                  id="ac-reason"
                  name="reason"
                  className="ep-input"
                  maxLength={300}
                  defaultValue={reason}
                  placeholder="Typed wrong at accessioning"
                />
                <span className="ep-field__help">
                  Needed to apply; kept in each copy&apos;s history
                </span>
              </label>
            </div>
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <button type="submit" className="ep-btn ep-btn--secondary">
                Preview
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {planError ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {planError}
        </p>
      ) : null}

      {plan ? (
        <section
          className="ep-card"
          aria-labelledby="ac-plan-h"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <h2 id="ac-plan-h" className="ep-card__title">
            What changes: {plan.copies} cop{plan.copies === 1 ? 'y' : 'ies'}
            {plan.problems ? ` · ${String(plan.problems)} cannot be changed` : ''}
          </h2>
          {plan.problems ? (
            <p className="ep-alert ep-alert--warning" role="status">
              Nothing is changed while a number stands in the way: correct the range or the new
              number and preview again.
            </p>
          ) : null}
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Old and new numbers (scrolls sideways)"
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Now</th>
                  <th scope="col">Becomes</th>
                  <th scope="col">Book</th>
                  <th scope="col">Status</th>
                  <th scope="col">Stands in the way</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.copyId}>
                    <td>{r.old}</td>
                    <td>
                      <strong>{r.new}</strong>
                    </td>
                    <td>
                      <a href={`/library/books/${r.titleId}#copy-${r.copyId}`}>{r.title}</a>
                    </td>
                    <td>
                      <span
                        className={`ep-badge ep-badge--${COPY_TONE[r.status as CopyStatus] ?? 'neutral'}`}
                      >
                        {COPY_STATUS[r.status as CopyStatus] ?? r.status}
                      </span>
                    </td>
                    <td>{r.problem ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!plan.problems ? (
            <form action={applyAccessionChange} style={{ marginTop: 'var(--sp-3)' }}>
              <input type="hidden" name="from" value={from} />
              <input type="hidden" name="to" value={to} />
              <input type="hidden" name="start" value={start} />
              <div className="ep-acr-filter">
                <label className="ep-field" htmlFor="ac-why" style={{ margin: 0 }}>
                  <span className="ep-field__label">Reason *</span>
                  <input
                    id="ac-why"
                    name="reason"
                    className="ep-input"
                    required
                    minLength={3}
                    maxLength={300}
                    defaultValue={reason}
                  />
                </label>
              </div>
              <div style={{ marginTop: 'var(--sp-3)' }}>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Apply: change {plan.copies} number{plan.copies === 1 ? '' : 's'}
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}

      <section className="ep-card" aria-labelledby="ac-list-h">
        <h2 id="ac-list-h" className="ep-card__title">
          Latest corrections
        </h2>
        {changes.length ? (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Latest corrections (scrolls sideways)"
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Was</th>
                  <th scope="col">Became</th>
                  <th scope="col">Book</th>
                  <th scope="col">Reason</th>
                  <th scope="col">By</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c, i) => (
                  <tr key={`${c.old}-${String(i)}`}>
                    <td>{when(c.at)}</td>
                    <td>{c.old}</td>
                    <td>
                      {c.new}
                      {c.now !== c.new ? <div className="ep-field__help">now {c.now}</div> : null}
                    </td>
                    <td>
                      <a href={`/library/books/${c.titleId}`}>{c.title}</a>
                    </td>
                    <td>{c.reason}</td>
                    <td>{c.by ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help">No accession number has been corrected yet.</p>
        )}
      </section>
    </>
  );
}
