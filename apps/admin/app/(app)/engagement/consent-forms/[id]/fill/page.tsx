import { Breadcrumbs, Card, ConsentFill, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import type { ConsentForm, ConsentPending } from '@/components/consents/types';
import { fillConsentForOffice } from '@/lib/consent-actions';
import { apiFetch } from '@/lib/api';

/**
 * The office fills a form on behalf of a family or a staff member (a paper form typed in): choose who
 * among those not answered yet, then the same form the family sees.
 */
export default async function FillConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ who?: string; q?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const who = /^(student|employee):\d+$/.test(sp.who ?? '') ? sp.who! : null;
  const qs = new URLSearchParams({ tab: 'pending', size: '100' });
  if (sp.q) qs.set('q', sp.q.slice(0, 80));
  const [f, pending] = await Promise.all([
    apiFetch<ConsentForm>(`/engagement/consent-forms/${id}`),
    apiFetch<{ total: number; data: ConsentPending[] }>(
      `/engagement/consent-forms/${id}/register?${qs}`,
    ),
  ]);
  const chosen = who ? pending.data.find((p) => `${p.kind}:${p.id}` === who) : undefined;
  // a form taking several answers lets the office add one for someone who already answered
  const name = chosen
    ? `${chosen.name}${chosen.code ? ` (${chosen.code})` : ''}`
    : who
      ? 'the chosen person'
      : null;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Consent forms', href: '/engagement/consent-forms' },
          { label: f.title, href: `/engagement/consent-forms/${id}` },
          { label: 'Fill on behalf' },
        ]}
      />
      <PageHeader
        kicker="Fill on behalf"
        title={f.title}
        description="Type in a paper form. The response says it was entered by the school office."
      />
      <Notice params={sp} />
      {!f.open ? (
        <Card>
          <p style={{ margin: 0 }}>The form is not taking answers ({f.closedWhy ?? 'closed'}).</p>
        </Card>
      ) : !who ? (
        <Card title="Who is it for?">
          <form method="get" className="ep-filter-band" style={{ marginBottom: 'var(--sp-3)' }}>
            <label className="ep-field" htmlFor="fill-q">
              <span className="ep-field__label">Name or admission no.</span>
              <input
                id="fill-q"
                name="q"
                className="ep-input"
                defaultValue={sp.q ?? ''}
                maxLength={80}
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              Find
            </button>
          </form>
          {pending.data.length === 0 ? (
            <p className="ep-field__help">Everyone asked has answered.</p>
          ) : (
            <ul className="ep-cf-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {pending.data.map((p) => (
                <li key={`${p.kind}${p.id}`}>
                  <a
                    href={`/engagement/consent-forms/${id}/fill?who=${p.kind}:${p.id}`}
                    style={{ textDecoration: 'underline' }}
                  >
                    {p.name}
                  </a>{' '}
                  <span className="ep-field__help">
                    {p.code ?? ''} · {p.section ?? ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {pending.total > pending.data.length ? (
            <p className="ep-field__help">
              {pending.total - pending.data.length} more: search by name or admission number.
            </p>
          ) : null}
        </Card>
      ) : (
        <Card title={`For ${name}`}>
          <ConsentFill
            fields={f.fields}
            lists={f.lists ?? {}}
            action={fillConsentForOffice}
            hidden={{ formId: id, who }}
            askName={{ label: 'Name of the person who signed the paper form' }}
            submitLabel="Save the response"
            intro={
              f.description ? (
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{f.description}</p>
              ) : undefined
            }
          />
          <p style={{ marginTop: 'var(--sp-3)' }}>
            <a
              href={`/engagement/consent-forms/${id}/fill`}
              style={{ textDecoration: 'underline' }}
            >
              Choose someone else
            </a>
          </p>
        </Card>
      )}
    </>
  );
}
