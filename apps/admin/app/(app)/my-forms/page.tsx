import { Badge, Card, PageHeader } from '@edupro/ui';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';

interface Mine {
  forms: Array<{
    id: string;
    title: string;
    description: string | null;
    open: boolean;
    closesAt: string | null;
    editUntil: string | null;
    feeMode: string;
    approval: boolean;
    people: Array<{
      kind: 'student' | 'staff';
      id: string;
      canAnswer: boolean;
      responses: Array<{
        id: string;
        number: string;
        status: string;
        waiting: boolean;
        canEdit: boolean;
        decidedNote: string | null;
      }>;
    }>;
  }>;
}
const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;

/**
 * My forms (docs/design/28-consent-forms.md): consent forms and declarations the school asks of the
 * signed-in staff member, for those who work in the admin app (the staff app shows the same).
 */
export default async function MyFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const mine = await apiFetch<Mine>('/engagement/mine/consent-forms').catch(() => ({ forms: [] }));
  const forms = mine.forms
    .map((f) => ({ f, me: f.people.find((p) => p.kind === 'staff') }))
    .filter((x) => x.me);
  const todo = forms.filter((x) => x.me!.canAnswer);
  const rest = forms.filter((x) => !x.me!.canAnswer);
  const item = ({ f, me }: (typeof forms)[number]) => (
    <article
      key={f.id}
      className="fp-cf-card"
      data-state={me!.canAnswer ? 'open' : f.open ? 'done' : 'closed'}
    >
      <div className="fp-cf-card__head">
        <h2 className="fp-cf-card__title">{f.title}</h2>
        <span className="fp-cf-card__chips">
          {!f.open ? (
            <Badge tone="neutral">Closed</Badge>
          ) : f.closesAt ? (
            <Badge tone="warning">Closes {dmy(f.closesAt)}</Badge>
          ) : null}
          {f.approval ? <Badge tone="neutral">Approved by the school</Badge> : null}
        </span>
      </div>
      {f.description ? (
        <details>
          <summary>Read what the school says</summary>
          <p>{f.description}</p>
        </details>
      ) : null}
      {me!.responses.map((r) => (
        <div key={r.id} className="fp-cf-answer">
          <span className="fp-cf-answer__no">{r.number}</span>
          {r.waiting ? (
            <Badge tone="warning">Waiting for approval</Badge>
          ) : r.status === 'approved' ? (
            <Badge tone="success">Approved</Badge>
          ) : r.status === 'rejected' ? (
            <Badge tone="danger">Not approved</Badge>
          ) : (
            <Badge tone="success">Answered</Badge>
          )}
          {r.decidedNote ? <span className="ep-field__help">{r.decidedNote}</span> : null}
          <span className="fp-cf-actions" style={{ marginLeft: 'auto' }}>
            {r.canEdit ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/my-forms/${f.id}?response=${r.id}`}
              >
                Change
              </a>
            ) : null}
            <FileLinks
              href={`/api/consent-forms/file?kind=mine&rid=${r.id}`}
              label={`${f.title} ${r.number}`}
            />
          </span>
        </div>
      ))}
      {me!.canAnswer ? (
        <div className="fp-cf-actions">
          <a className="ep-btn ep-btn--primary ep-btn--sm" href={`/my-forms/${f.id}`}>
            {me!.responses.length ? 'Answer again' : 'Answer now'}
          </a>
        </div>
      ) : null}
    </article>
  );
  return (
    <>
      <PageHeader
        kicker="My work"
        title="My forms"
        description="Consent forms, surveys and declarations the school asks you to answer."
      />
      <Notice params={sp} />
      <h2 className="ep-cf-h">To answer ({todo.length})</h2>
      {todo.length ? (
        <div className="ep-cf-list">{todo.map(item)}</div>
      ) : (
        <Card>Nothing to answer now.</Card>
      )}
      {rest.length ? (
        <>
          <h2 className="ep-cf-h" style={{ marginTop: 'var(--sp-5)' }}>
            Answered and closed
          </h2>
          <div className="ep-cf-list">{rest.map(item)}</div>
        </>
      ) : null}
    </>
  );
}
