import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';

interface Mine {
  forms: Array<{
    id: string;
    title: string;
    description: string | null;
    open: boolean;
    closesAt: string | null;
    people: Array<{
      kind: 'student' | 'staff';
      id: string;
      canAnswer: boolean;
      responses: Array<{ id: string; number: string }>;
    }>;
  }>;
}
const dt = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)} ${s.slice(11, 16)}`;

/** Consent forms and declarations the school asks of the staff member (docs/design/28-consent-forms.md). */
export default async function StaffConsentsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; msg?: string }>;
}) {
  const sp = await searchParams;
  let mine: Mine;
  try {
    mine = await bff.api.fetch<Mine>('/engagement/mine/consent-forms');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const forms = mine.forms
    .map((f) => ({ ...f, me: f.people.find((p) => p.kind === 'staff') }))
    .filter((f) => f.me);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/" style={{ textDecoration: 'underline' }}>
          ← Home
        </a>
      </p>
      <PageHeader
        kicker="EduPro staff"
        title="Forms and declarations"
        description="Consent forms, surveys and declarations the school asks you to answer."
      />
      {sp.done ? (
        <p className="ep-alert ep-alert--success" role="status">
          Thank you. Your answer is saved as {sp.done}.{sp.msg ? ` ${sp.msg}` : ''}
        </p>
      ) : null}
      {forms.length === 0 ? (
        <Card>Nothing to answer now.</Card>
      ) : (
        <div className="ep-cf-list">
          {forms.map((f) => (
            <article key={f.id} className="ep-cf-item">
              <div className="ep-cf-item__top">
                <h2 className="ep-cf-item__title">{f.title}</h2>
                {f.me!.canAnswer ? (
                  <Badge tone="warning">
                    {f.closesAt ? `To answer by ${dt(f.closesAt)}` : 'To answer'}
                  </Badge>
                ) : f.me!.responses.length ? (
                  <Badge tone="success">Answered</Badge>
                ) : (
                  <Badge tone="neutral">Closed</Badge>
                )}
              </div>
              {f.description ? (
                <p className="ep-field__help" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                  {f.description.length > 220 ? `${f.description.slice(0, 220)}…` : f.description}
                </p>
              ) : null}
              <div className="ep-cf-item__who">
                <span>
                  {f.me!.responses.map((r) => (
                    <span
                      key={r.id}
                      style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                    >
                      {r.number}
                      <FileLinks
                        url={`/consents/pdf/${r.id}`}
                        saveUrl={`/consents/pdf/${r.id}?save=1`}
                        label={`${f.title} ${r.number}`}
                      />
                    </span>
                  ))}
                </span>
                {f.me!.canAnswer ? (
                  <a className="ep-btn ep-btn--primary ep-btn--sm" href={`/consents/${f.id}`}>
                    {f.me!.responses.length ? 'Answer again' : 'Answer'}
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
