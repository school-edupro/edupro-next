import { Badge, Breadcrumbs, Card, ConsentFill, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { Icon } from '@/components/nav-icons';
import type { ConsentForm } from '@/components/consents/types';
import { previewConsentCheck } from '@/lib/consent-actions';
import { apiFetch } from '@/lib/api';

/**
 * Preview a consent form as a family or a staff member sees it (docs/design/28-consent-forms.md): the
 * same questions, steps, rules and fee, live; submitting only checks the answers, nothing is saved.
 */
export default async function ConsentPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ as?: string; ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const f = await apiFetch<ConsentForm>(`/engagement/consent-forms/${id}`);
  const views: Array<'family' | 'staff'> =
    f.respondents === 'both' ? ['family', 'staff'] : [f.respondents];
  const as = views.includes(sp.as as 'family' | 'staff')
    ? (sp.as as 'family' | 'staff')
    : views[0]!;
  const approval = Boolean(f.settings.approval?.on);
  // the fee is for families (an answer about a pupil)
  const fee =
    as === 'family' && (f.settings.fee?.mode ?? 'none') !== 'none' ? f.settings.fee : undefined;
  const okText =
    sp.ok === 'checked'
      ? 'Preview: the answers pass the form’s checks. Nothing was saved and nobody was told.'
      : undefined;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Consent forms', href: '/engagement/consent-forms' },
          { label: f.title, href: `/engagement/consent-forms/${id}` },
          { label: 'Preview' },
        ]}
      />
      <PageHeader
        kicker="Preview"
        title={f.title}
        description="As it will look to those who answer. Try the answers: questions appear and hide by the rules, the fee is worked out. Nothing is saved."
        actions={
          <span
            style={{
              display: 'inline-flex',
              gap: 'var(--sp-2)',
              alignItems: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            <Badge tone="warning">Preview only</Badge>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/engagement/consent-forms/${id}`}
            >
              <Icon name="back" size={16} /> Back to the form
            </a>
          </span>
        }
      />
      <Notice params={{ ok: sp.ok, detail: okText }} />
      {views.length > 1 ? (
        <nav
          className="ep-tabs-links"
          aria-label="Preview as"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {views.map((v) => (
            <a
              key={v}
              href={`/engagement/consent-forms/${id}/preview?as=${v}`}
              aria-current={as === v ? 'page' : undefined}
            >
              {v === 'family' ? 'As a family (parent app)' : 'As a staff member'}
            </a>
          ))}
        </nav>
      ) : null}
      <div style={{ maxWidth: '46rem' }}>
        <Card>
          <ConsentFill
            // a new key per view, so switching starts from empty answers
            key={as}
            fields={f.fields}
            lists={f.lists ?? {}}
            action={previewConsentCheck}
            hidden={{ formId: id, as }}
            askName={as === 'family' ? { label: 'Your name (as the parent signing)' } : undefined}
            fee={fee}
            feeNote={approval ? 'to pay after the school approves' : 'due once you submit'}
            submitLabel="Check the answers (preview)"
            intro={
              f.description ? (
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{f.description}</p>
              ) : undefined
            }
          />
        </Card>
        {f.settings.success ? (
          <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
            After answering they see: “{f.settings.success}”
          </p>
        ) : null}
      </div>
    </>
  );
}
