import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Mine {
  forms: Array<{
    id: string;
    title: string;
    description: string | null;
    open: boolean;
    closedWhy: string | null;
    closesAt: string | null;
    repeat: 'once' | 'many';
    people: Array<{
      kind: 'student' | 'staff';
      id: string;
      name: string;
      canAnswer: boolean;
      responses: Array<{
        id: string;
        number: string;
        signedAt: string;
        respondent: string;
        status: 'submitted' | 'approved' | 'rejected';
        fee: string;
        lineId: string | null;
        paid: string | null;
        lineAmount: string | null;
        waiting: boolean;
        canEdit: boolean;
        decidedNote: string | null;
      }>;
    }>;
  }>;
}
const dt = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)} ${s.slice(11, 16)}`;

/**
 * Consent forms the school asks of the family (docs/design/28-consent-forms.md): for each child, the
 * forms to answer first (with the closing date), then the ones answered, each with its PDF copy.
 */
export default async function ConsentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    done?: string;
    msg?: string;
    waiting?: string;
    fee?: string;
    changed?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let mine: Mine;
  try {
    mine = await bff.api.fetch<Mine>('/engagement/mine/consent-forms');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const families = mine.forms
    .map((f) => ({ ...f, people: f.people.filter((p) => p.kind === 'student') }))
    .filter((f) => f.people.length);
  const toDo = families.filter((f) => f.people.some((p) => p.canAnswer));
  const done = families.filter((f) => !f.people.some((p) => p.canAnswer));
  const item = (f: (typeof families)[number]) => (
    <article key={f.id} className="ep-cf-item">
      <div className="ep-cf-item__top">
        <h2 className="ep-cf-item__title">{f.title}</h2>
        {f.open ? (
          f.closesAt ? (
            <Badge tone="warning">
              {t(lang, 'Closes')} {dt(f.closesAt)}
            </Badge>
          ) : null
        ) : (
          <Badge tone="neutral">{t(lang, 'Closed')}</Badge>
        )}
      </div>
      {f.description ? (
        <p className="ep-field__help" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
          {f.description.length > 220 ? `${f.description.slice(0, 220)}…` : f.description}
        </p>
      ) : null}
      {f.people.map((p) => (
        <div key={p.id} className="ep-cf-item__who" style={{ display: 'grid', gap: 'var(--sp-2)' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              gap: 'var(--sp-2)',
            }}
          >
            <strong>{p.name}</strong>
            {p.canAnswer ? (
              <a
                className="ep-btn ep-btn--primary ep-btn--sm"
                href={`/consents/${f.id}?student=${p.id}`}
              >
                {p.responses.length ? t(lang, 'Answer again') : t(lang, 'Answer')}
              </a>
            ) : null}
          </div>
          {p.responses.map((r) => {
            const due = r.lineId ? Number(r.lineAmount ?? 0) - Number(r.paid ?? 0) : 0;
            return (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 'var(--sp-2)',
                  alignItems: 'center',
                }}
              >
                <span>{r.number}</span>
                {r.waiting ? (
                  <Badge tone="warning">{t(lang, 'Waiting for approval')}</Badge>
                ) : r.status === 'approved' ? (
                  <Badge tone="success">{t(lang, 'Approved')}</Badge>
                ) : r.status === 'rejected' ? (
                  <Badge tone="danger">{t(lang, 'Not approved')}</Badge>
                ) : (
                  <Badge tone="info">{t(lang, 'Answered')}</Badge>
                )}
                {r.decidedNote ? <span className="ep-field__help">{r.decidedNote}</span> : null}
                {Number(r.fee) > 0 ? (
                  <span className="ep-field__help">
                    {t(lang, 'Fee')} ₹{Number(r.fee).toLocaleString('en-IN')}
                    {r.lineId
                      ? due > 0
                        ? ''
                        : ` · ${t(lang, 'paid')}`
                      : r.status === 'rejected'
                        ? ''
                        : ` · ${t(lang, 'to pay after approval')}`}
                  </span>
                ) : null}
                <FileLinks
                  url={`/consents/pdf/${r.id}`}
                  saveUrl={`/consents/pdf/${r.id}?save=1`}
                  label={`${f.title} ${r.number}`}
                />
                {r.canEdit ? (
                  <a
                    href={`/consents/${f.id}?student=${p.id}&response=${r.id}`}
                    style={{ textDecoration: 'underline' }}
                  >
                    {t(lang, 'Change my answer')}
                  </a>
                ) : null}
                {r.lineId && due > 0 ? (
                  <form method="post" action="/fees/pay-misc">
                    <input type="hidden" name="lineId" value={r.lineId} />
                    <input type="hidden" name="studentId" value={p.id} />
                    <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                      {t(lang, 'Pay')} ₹{due.toLocaleString('en-IN')}
                    </button>
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </article>
  );
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '48rem', margin: '0 auto' }}>
      <PageHeader
        kicker="EduPro"
        title={t(lang, 'Consent forms')}
        description={t(
          lang,
          'Trips, events and permissions the school asks you to answer for each child.',
        )}
      />
      {sp.done ? (
        <p className="ep-alert ep-alert--success" role="status">
          {t(lang, 'Thank you. Your answer is saved as')} {sp.done}.{sp.msg ? ` ${sp.msg}` : ''}
          {sp.waiting ? ` ${t(lang, 'The school will approve it; you will be told.')}` : ''}
          {sp.fee && !sp.waiting
            ? ` ${t(lang, 'A fee of')} ₹${sp.fee} ${t(lang, 'is now due: pay it below or on the Fees page.')}`
            : ''}
        </p>
      ) : null}
      {sp.changed ? (
        <p className="ep-alert ep-alert--success" role="status">
          {t(lang, 'Your answer')} {sp.changed} {t(lang, 'is changed.')}
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || t(lang, 'That did not work. Please try again.')}
        </p>
      ) : null}
      <h2 className="ep-cf-h">{t(lang, 'To answer')}</h2>
      {toDo.length ? (
        <div className="ep-cf-list">{toDo.map(item)}</div>
      ) : (
        <Card>{t(lang, 'Nothing to answer now.')}</Card>
      )}
      {done.length ? (
        <>
          <h2 className="ep-cf-h" style={{ marginTop: 'var(--sp-5)' }}>
            {t(lang, 'Answered and closed')}
          </h2>
          <div className="ep-cf-list">{done.map(item)}</div>
        </>
      ) : null}
    </main>
  );
}
