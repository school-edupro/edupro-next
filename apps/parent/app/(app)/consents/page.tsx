import { Badge, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { ChildSwitch } from '@/components/ChildSwitch';
import { FileLinks } from '@/components/FileLinks';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Answer {
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
}
interface Form {
  id: string;
  title: string;
  description: string | null;
  open: boolean;
  closedWhy: string | null;
  closesAt: string | null;
  editUntil: string | null;
  repeat: 'once' | 'many';
  feeMode: 'none' | 'fixed' | 'calc';
  approval: boolean;
  people: Array<{
    kind: 'student' | 'staff';
    id: string;
    name: string;
    canAnswer: boolean;
    responses: Answer[];
  }>;
}
type Tab = 'todo' | 'answered' | 'closed';

const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
/** Whole days from now (IST) to a "YYYY-MM-DDTHH:MM" wall-clock time. */
const daysTo = (s: string) => {
  const now = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16);
  return Math.floor((Date.parse(`${s}:00Z`) - Date.parse(`${now}:00Z`)) / 86_400_000);
};
const due = (a: Answer) =>
  a.lineId ? Math.max(0, Number(a.lineAmount ?? 0) - Number(a.paid ?? 0)) : 0;

/**
 * Consent forms for the chosen child (docs/design/28-consent-forms.md): a summary (to answer, waiting
 * for the school, fee to pay), then tabs To answer / Answered / Closed with a card per form: when it
 * closes, whether it has a fee or needs approval, the school's text, the child's answers with their
 * status, Pay, Change and the PDF copy.
 */
export default async function ConsentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
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
  const kid = await chosenChild();
  let forms: Form[];
  try {
    forms = (await bff.api.fetch<{ forms: Form[] }>('/engagement/mine/consent-forms')).forms;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  // this child's part of each form
  const mine = forms
    .map((f) => ({ f, p: f.people.find((x) => x.kind === 'student' && (!kid || x.id === kid.id)) }))
    .filter((x): x is { f: Form; p: Form['people'][number] } => Boolean(x.p));
  const todo = mine.filter((x) => x.p.canAnswer);
  const answered = mine.filter((x) => !x.p.canAnswer && x.f.open && x.p.responses.length);
  const closed = mine.filter((x) => !x.f.open);
  const waiting = mine.reduce((n, x) => n + x.p.responses.filter((r) => r.waiting).length, 0);
  const feeDue = mine.reduce((n, x) => n + x.p.responses.reduce((m, r) => m + due(r), 0), 0);
  const tab: Tab = sp.tab === 'answered' || sp.tab === 'closed' ? sp.tab : 'todo';
  const list = tab === 'todo' ? todo : tab === 'answered' ? answered : closed;
  const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

  const card = ({ f, p }: { f: Form; p: Form['people'][number] }) => {
    const days = f.closesAt ? daysTo(f.closesAt) : null;
    const state = !f.open
      ? 'closed'
      : p.canAnswer
        ? days !== null && days <= 2
          ? 'urgent'
          : 'open'
        : 'done';
    return (
      <article key={f.id} className="fp-cf-card" data-state={state}>
        <div className="fp-cf-card__head">
          <h2 className="fp-cf-card__title">{f.title}</h2>
          <span className="fp-cf-card__chips">
            {!f.open ? (
              <Badge tone="neutral">{t(lang, 'Closed')}</Badge>
            ) : f.closesAt ? (
              <Badge tone={days !== null && days <= 2 ? 'danger' : 'warning'}>
                {days !== null && days <= 0
                  ? t(lang, 'Closes today')
                  : days === 1
                    ? t(lang, 'Closes tomorrow')
                    : `${t(lang, 'Closes')} ${dmy(f.closesAt)}`}
              </Badge>
            ) : null}
            {f.feeMode !== 'none' ? <Badge tone="info">{t(lang, 'Has a fee')}</Badge> : null}
            {f.approval ? <Badge tone="neutral">{t(lang, 'School approves')}</Badge> : null}
          </span>
        </div>
        {f.description ? (
          <details>
            <summary>{t(lang, 'Read what the school says')}</summary>
            <p>{f.description}</p>
          </details>
        ) : null}
        {p.responses.map((r) => {
          const d = due(r);
          return (
            <div key={r.id} className="fp-cf-answer">
              <span className="fp-cf-answer__no">{r.number}</span>
              {r.waiting ? (
                <Badge tone="warning">{t(lang, 'Waiting for the school')}</Badge>
              ) : r.status === 'approved' ? (
                <Badge tone="success">{t(lang, 'Approved')}</Badge>
              ) : r.status === 'rejected' ? (
                <Badge tone="danger">{t(lang, 'Not approved')}</Badge>
              ) : (
                <Badge tone="success">{t(lang, 'Answered')}</Badge>
              )}
              {r.decidedNote ? <span className="ep-field__help">{r.decidedNote}</span> : null}
              {Number(r.fee) > 0 ? (
                <span className="ep-field__help">
                  {t(lang, 'Fee')} {inr(Number(r.fee))}
                  {r.lineId
                    ? d > 0
                      ? ` · ${inr(d)} ${t(lang, 'to pay')}`
                      : ` · ${t(lang, 'paid')}`
                    : r.status === 'rejected'
                      ? ''
                      : ` · ${t(lang, 'after approval')}`}
                </span>
              ) : null}
              <span className="fp-cf-actions" style={{ marginLeft: 'auto' }}>
                {r.lineId && d > 0 ? (
                  <form method="post" action="/fees/pay-misc">
                    <input type="hidden" name="lineId" value={r.lineId} />
                    <input type="hidden" name="studentId" value={p.id} />
                    <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                      {t(lang, 'Pay')} {inr(d)}
                    </button>
                  </form>
                ) : null}
                {r.canEdit ? (
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/consents/${f.id}?student=${p.id}&response=${r.id}`}
                  >
                    {t(lang, 'Change')}
                  </a>
                ) : null}
                <FileLinks
                  url={`/consents/pdf/${r.id}`}
                  saveUrl={`/consents/pdf/${r.id}?save=1`}
                  label={`${f.title} ${r.number}`}
                />
              </span>
            </div>
          );
        })}
        {p.canAnswer ? (
          <div className="fp-cf-actions">
            <a className="ep-btn ep-btn--primary" href={`/consents/${f.id}?student=${p.id}`}>
              {p.responses.length ? t(lang, 'Answer again') : t(lang, 'Answer now')}
            </a>
            {f.editUntil ? (
              <span className="ep-field__help">
                {t(lang, 'You can change your answer until')} {dmy(f.editUntil)}
              </span>
            ) : null}
          </div>
        ) : null}
      </article>
    );
  };

  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <PageHeader
        kicker="EduPro"
        title={t(lang, 'Consent forms')}
        description={t(lang, 'Trips, events and permissions the school asks you to answer.')}
      />
      <ChildSwitch lang={lang} back="/consents" current={kid?.id} />
      {sp.done ? (
        <p className="ep-alert ep-alert--success" role="status">
          {t(lang, 'Thank you. Your answer is saved as')} {sp.done}.{sp.msg ? ` ${sp.msg}` : ''}
          {sp.waiting ? ` ${t(lang, 'The school will approve it; you will be told.')}` : ''}
          {sp.fee && !sp.waiting
            ? ` ${t(lang, 'A fee of')} ₹${sp.fee} ${t(lang, 'is now due: pay it below.')}`
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

      <div className="fp-cf-sum">
        <div className="fp-cf-sum__tile" data-tone={todo.length ? 'warn' : undefined}>
          <span className="fp-cf-sum__n">{todo.length}</span>
          <span className="fp-cf-sum__label">{t(lang, 'To answer')}</span>
        </div>
        <div className="fp-cf-sum__tile">
          <span className="fp-cf-sum__n">{waiting}</span>
          <span className="fp-cf-sum__label">{t(lang, 'Waiting for the school')}</span>
        </div>
        <div className="fp-cf-sum__tile" data-tone={feeDue ? 'warn' : undefined}>
          <span className="fp-cf-sum__n">{inr(feeDue)}</span>
          <span className="fp-cf-sum__label">{t(lang, 'Fee to pay')}</span>
        </div>
        <div className="fp-cf-sum__tile">
          <span className="fp-cf-sum__n">
            {answered.length + closed.filter((x) => x.p.responses.length).length}
          </span>
          <span className="fp-cf-sum__label">{t(lang, 'Answered')}</span>
        </div>
      </div>

      <nav
        className="ep-tabs-links"
        aria-label={t(lang, 'Consent forms')}
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        <a href="/consents" aria-current={tab === 'todo' ? 'page' : undefined}>
          {t(lang, 'To answer')} ({todo.length})
        </a>
        <a href="/consents?tab=answered" aria-current={tab === 'answered' ? 'page' : undefined}>
          {t(lang, 'Answered')} ({answered.length})
        </a>
        <a href="/consents?tab=closed" aria-current={tab === 'closed' ? 'page' : undefined}>
          {t(lang, 'Closed')} ({closed.length})
        </a>
      </nav>

      {list.length ? (
        <div className="ep-cf-list">{list.map(card)}</div>
      ) : (
        <div className="ep-card fp-cf-empty">
          <strong>
            {tab === 'todo'
              ? t(lang, 'Nothing to answer')
              : tab === 'answered'
                ? t(lang, 'No answers yet')
                : t(lang, 'No closed forms')}
          </strong>
          <span>
            {tab === 'todo'
              ? t(
                  lang,
                  'When the school asks for your consent, the form appears here and on your home screen.',
                )
              : t(lang, 'Forms you answer stay here with their PDF copy.')}
          </span>
        </div>
      )}
    </main>
  );
}
