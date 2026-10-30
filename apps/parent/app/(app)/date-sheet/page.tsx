import { Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { ChildSwitch } from '@/components/ChildSwitch';
import { bff } from '@/lib/bff';
import { chosenChild } from '@/lib/child';
import { currentLang, t, type Lang } from '@/lib/i18n';

interface Paper {
  subject: string;
  examOn: string;
  startsAt: string | null;
  endsAt: string | null;
}
interface Sheets {
  children: Array<{
    student: { id: string; name: string; section: string | null };
    exams: Array<{
      id: string;
      name: string;
      startsOn: string | null;
      endsOn: string | null;
      note: string | null;
      papers: Paper[];
    }>;
  }>;
}

const day = (d: string, lang: Lang, o: Intl.DateTimeFormatOptions) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', o);
const time = (p: Paper) => (p.startsAt ? `${p.startsAt}${p.endsAt ? `–${p.endsAt}` : ''}` : '');

/**
 * The child's exam date sheet (docs/design/66): each exam the school shows on the portal with the
 * child's papers (date, day, time, subject) and the school's note; the coming exams first, earlier
 * ones folded away.
 */
export default async function DateSheetPage() {
  const lang = await currentLang();
  let res: Sheets;
  try {
    res = await bff.api.fetch<Sheets>('/exams/mine/date-sheets');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Exam date sheet')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  const kid = await chosenChild();
  const today = new Date().toISOString().slice(0, 10);
  const table = (papers: Paper[], caption: string) => (
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="ep-table ep-table--dense">
        <caption className="ep-sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t(lang, 'Date')}</th>
            <th scope="col">{t(lang, 'Time')}</th>
            <th scope="col">{t(lang, 'Subject')}</th>
          </tr>
        </thead>
        <tbody>
          {papers.map((p) => (
            <tr key={`${p.examOn}-${p.subject}`}>
              <td>
                {day(p.examOn, lang, { day: 'numeric', month: 'short' })}
                <span className="ep-kicker" style={{ display: 'block' }}>
                  {day(p.examOn, lang, { weekday: 'long' })}
                </span>
              </td>
              <td>{time(p)}</td>
              <th scope="row">{p.subject}</th>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Exams')}
        title={t(lang, 'Exam date sheet')}
        description={t(lang, 'The papers of each exam: date, day and time.')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      <ChildSwitch lang={lang} back="/date-sheet" />
      {res.children
        .filter((c) => !kid || c.student.id === kid.id)
        .map((c) => {
          const coming = c.exams.filter((e) => e.papers.some((p) => p.examOn >= today));
          const earlier = c.exams.filter((e) => !coming.includes(e));
          const next = coming[0]?.papers.find((p) => p.examOn >= today);
          return (
            <section
              key={c.student.id}
              aria-label={c.student.name}
              style={{ display: 'grid', gap: 'var(--sp-4)' }}
            >
              {res.children.length > 1 && !kid ? (
                <h2 className="ep-card__title">
                  {c.student.name}
                  {c.student.section ? ` · ${c.student.section}` : ''}
                </h2>
              ) : null}
              {next ? (
                <div className="ep-alert ep-alert--info" role="status">
                  {t(lang, 'Next paper')}: <strong>{next.subject}</strong> ·{' '}
                  {day(next.examOn, lang, { weekday: 'long', day: 'numeric', month: 'long' })}
                  {time(next) ? ` · ${time(next)}` : ''}
                </div>
              ) : null}
              {c.exams.length === 0 || coming.length === 0 ? (
                <Card>
                  <p style={{ margin: 0 }}>
                    {c.exams.length ? t(lang, 'No exam coming up.') : t(lang, 'No date sheet yet.')}
                  </p>
                </Card>
              ) : null}
              {coming.map((e) => (
                <Card key={e.id} title={e.name}>
                  {table(e.papers, e.name)}
                  {e.note ? (
                    <p className="ep-field__help" style={{ whiteSpace: 'pre-line' }}>
                      {e.note}
                    </p>
                  ) : null}
                </Card>
              ))}
              {earlier.length ? (
                <details>
                  <summary>
                    {t(lang, 'Earlier exams')} ({earlier.length})
                  </summary>
                  <div style={{ display: 'grid', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
                    {earlier.map((e) => (
                      <Card key={e.id} title={e.name}>
                        {table(e.papers, e.name)}
                      </Card>
                    ))}
                  </div>
                </details>
              ) : null}
            </section>
          );
        })}
    </main>
  );
}
