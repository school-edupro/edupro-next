import { Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { voteHelp } from './actions';

interface HelpQuestion {
  id: string;
  question: string;
  questionHi: string | null;
  answer: string;
  answerHi: string | null;
  page: string | null;
  pageLabel: string | null;
  myVote: boolean | null;
}
interface HelpGroup {
  id: string | null;
  title: string;
  titleHi: string | null;
  questions: HelpQuestion[];
}

/**
 * Help for staff: the school's own questions and answers (kept on Helpdesk set-up, Help for staff, 0422), under
 * headings that fold; a search box, the screen an answer is about, and "Was this helpful?" — as the staff app shows.
 */
export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; open?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const hi = lang === 'hi';
  let groups: HelpGroup[] = [];
  try {
    groups = (await bff.api.fetch<{ groups: HelpGroup[] }>('/engagement/staff-help')).groups;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const q = (sp.q ?? '').trim().slice(0, 100);
  const words = q.toLocaleLowerCase();
  const matches = (x: HelpQuestion) =>
    !words ||
    [x.question, x.questionHi, x.answer, x.answerHi].some((s) =>
      s?.toLocaleLowerCase().includes(words),
    );
  const shown = groups
    .map((g) => ({ ...g, questions: g.questions.filter(matches) }))
    .filter((g) => g.questions.length > 0);
  const found = shown.reduce((n, g) => n + g.questions.length, 0);
  const count = (n: number) => (hi ? `${n} प्रश्न` : n === 1 ? '1 question' : `${n} questions`);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="EduPro"
        title={t(lang, 'Help')}
        description={t(
          lang,
          'Answers to the common questions. For anything else, raise a staff query under Queries.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {groups.length ? (
        <form
          method="get"
          role="search"
          style={{
            display: 'flex',
            gap: 'var(--sp-2)',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            marginBottom: 'var(--sp-3)',
          }}
        >
          <label className="ep-field" style={{ flex: '1 1 16rem' }}>
            <span className="ep-field__label">{t(lang, 'Search the questions')}</span>
            <input
              className="ep-input"
              type="search"
              name="q"
              defaultValue={q}
              maxLength={100}
              autoComplete="off"
            />
          </label>
          <Button type="submit">{t(lang, 'Search')}</Button>
          {q ? (
            <a className="ep-btn ep-btn--ghost" href="/help">
              {t(lang, 'Clear')}
            </a>
          ) : null}
        </form>
      ) : null}
      {q ? (
        <p role="status" className="ep-field__help" style={{ marginBottom: 'var(--sp-3)' }}>
          {found
            ? hi
              ? `“${q}” के लिए ${count(found)}`
              : `${count(found)} for “${q}”`
            : t(lang, 'Nothing matches your search. Raise a staff query for anything else.')}
        </p>
      ) : null}
      {!groups.length ? (
        <Card>
          {t(lang, 'No questions yet. For anything else, raise a staff query under Queries.')}
        </Card>
      ) : null}
      {shown.map((g) => (
        <details
          key={g.id ?? 'other'}
          className="ep-card"
          open={!!q || g.questions.some((x) => x.id === sp.open)}
          style={{ marginBottom: 'var(--sp-3)', padding: 0 }}
        >
          <summary
            style={{
              padding: 'var(--sp-3) var(--sp-4)',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--sp-2)',
              flexWrap: 'wrap',
            }}
          >
            <strong>{hi ? (g.titleHi ?? g.title) : g.title}</strong>
            <span className="ep-field__help">{count(g.questions.length)}</span>
          </summary>
          <div
            style={{ display: 'grid', gap: 'var(--sp-2)', padding: '0 var(--sp-4) var(--sp-4)' }}
          >
            {g.questions.map((x) => (
              <details
                key={x.id}
                id={`q-${x.id}`}
                open={x.id === sp.open}
                style={{
                  borderTop: '1px solid var(--border-default)',
                  paddingTop: 'var(--sp-2)',
                }}
              >
                <summary style={{ cursor: 'pointer', fontWeight: 'var(--fw-semibold)' }}>
                  {hi ? (x.questionHi ?? x.question) : x.question}
                </summary>
                <p style={{ margin: 'var(--sp-2) 0', whiteSpace: 'pre-wrap' }}>
                  {hi ? (x.answerHi ?? x.answer) : x.answer}
                </p>
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  {x.page && x.pageLabel ? (
                    <a className="ep-btn ep-btn--ghost ep-btn--sm" href={x.page}>
                      {hi ? `${t(lang, x.pageLabel)} खोलें` : `Open ${x.pageLabel}`}
                    </a>
                  ) : null}
                  <form
                    action={voteHelp}
                    style={{
                      display: 'flex',
                      gap: 'var(--sp-2)',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <input type="hidden" name="id" value={x.id} />
                    <input type="hidden" name="q" value={q} />
                    <span className="ep-field__help">{t(lang, 'Was this helpful?')}</span>
                    <button
                      type="submit"
                      name="helpful"
                      value="yes"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      aria-pressed={x.myVote === true}
                    >
                      {t(lang, 'Yes')}
                    </button>
                    <button
                      type="submit"
                      name="helpful"
                      value="no"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      aria-pressed={x.myVote === false}
                    >
                      {t(lang, 'No')}
                    </button>
                  </form>
                </div>
                {x.myVote !== null ? (
                  <p role="status" className="ep-field__help" style={{ margin: 'var(--sp-2) 0 0' }}>
                    {x.myVote
                      ? t(lang, 'Thank you. You said this helped.')
                      : t(
                          lang,
                          'Thank you. You said this did not help; raise a staff query for more help.',
                        )}
                  </p>
                ) : null}
              </details>
            ))}
          </div>
        </details>
      ))}
    </main>
  );
}
