import { Badge, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { Icon } from '@/components/nav-icons';
import { STATUS_LABEL, STATUS_TONE, WHO, dt, type ConsentForm } from '@/components/consents/types';
import { apiFetch } from '@/lib/api';

const TABS = [
  ['all', 'All'],
  ['published', 'Published'],
  ['draft', 'Drafts'],
  ['closed', 'Closed'],
  ['archived', 'Archived'],
] as const;

/** Consent forms (docs/design/28-consent-forms.md): every form with its status and response rate. */
export default async function ConsentFormsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const status = TABS.some((t) => t[0] === sp.status) ? sp.status! : 'all';
  const qs = new URLSearchParams({ status });
  if (sp.q) qs.set('q', sp.q.slice(0, 80));
  const { data, canCreate = true } = await apiFetch<{ data: ConsentForm[]; canCreate?: boolean }>(
    `/engagement/consent-forms?${qs}`,
  );
  return (
    <>
      <PageHeader
        kicker="Engagement"
        title="Consent forms"
        description={
          canCreate
            ? 'Ask families and staff for consent and details: trips, events, photo use, medical, declarations. Build a form, send it, read the answers.'
            : 'The consent forms shared with you.'
        }
        actions={
          canCreate ? (
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/engagement/consent-forms/new">
              <Icon name="plus" size={16} /> New form
            </a>
          ) : undefined
        }
      />
      <Notice
        params={{ ...sp, detail: sp.ok === 'deleted' ? 'The draft was deleted.' : sp.detail }}
      />
      <nav
        className="ep-tabs-links"
        aria-label="Forms by status"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {TABS.map(([v, l]) => (
          <a
            key={v}
            href={`/engagement/consent-forms?status=${v}`}
            aria-current={status === v ? 'page' : undefined}
          >
            {l}
          </a>
        ))}
      </nav>
      <form method="get" className="ep-filter-band" style={{ marginBottom: 'var(--sp-4)' }}>
        <input type="hidden" name="status" value={status} />
        <label className="ep-field" htmlFor="cf-q">
          <span className="ep-field__label">Search by title</span>
          <input id="cf-q" name="q" className="ep-input" defaultValue={sp.q ?? ''} maxLength={80} />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Search
        </button>
      </form>
      {data.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>
            No forms here yet.{' '}
            <a href="/engagement/consent-forms/new" style={{ textDecoration: 'underline' }}>
              Build the first one
            </a>
            .
          </p>
        </Card>
      ) : (
        <div className="ep-cf-list">
          {data.map((f) => {
            const rate = f.asked ? Math.round((f.answered / f.asked) * 100) : null;
            return (
              <article key={f.id} className="ep-cf-item">
                <div className="ep-cf-item__top">
                  <h2 className="ep-cf-item__title">
                    <a href={`/engagement/consent-forms/${f.id}`}>{f.title}</a>
                  </h2>
                  <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                    <Badge tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Badge>
                    {f.status === 'published' && !f.open ? (
                      <Badge tone="warning">{f.closedWhy ?? 'Not open'}</Badge>
                    ) : null}
                  </span>
                </div>
                <p className="ep-field__help" style={{ margin: 0 }}>
                  {WHO[f.respondents]} ·{' '}
                  {f.fields.filter((x) => !['heading', 'pagebreak'].includes(x.type)).length}{' '}
                  questions
                  {f.settings.closesAt ? ` · closes ${dt(f.settings.closesAt)}` : ''}
                  {f.createdBy ? ` · by ${f.createdBy}` : ''}
                </p>
                {f.asked !== null ? (
                  <p style={{ margin: 0 }}>
                    <strong>{f.answered}</strong> of {f.asked} answered
                    {rate !== null ? ` (${rate}%)` : ''}
                    {f.responses > f.answered ? ` · ${f.responses} responses` : ''}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
