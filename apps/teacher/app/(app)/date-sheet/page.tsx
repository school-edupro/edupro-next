import { Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { AutoSubmit } from '@/components/AutoSubmit';
import { bff } from '@/lib/bff';
import { currentLang, t, type Lang } from '@/lib/i18n';

interface Paper {
  subject: string;
  examOn: string;
  startsAt: string | null;
  endsAt: string | null;
}
interface Sheet {
  id: string;
  name: string;
  note: string | null;
  classes: Array<{ classId: string; classCode: string; papers: Paper[] }>;
}

const day = (d: string, lang: Lang, o: Intl.DateTimeFormatOptions) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', o);
const time = (p: Paper) => (p.startsAt ? `${p.startsAt}${p.endsAt ? `–${p.endsAt}` : ''}` : '');

/**
 * The date sheets of the teacher's classes (docs/design/66): choose the exam (it opens at once; the
 * coming one first), then a row per date and a column per class with each paper and its time.
 */
export default async function DateSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ exam?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let sheets: Sheet[];
  try {
    sheets = await bff.api.fetch<{ data: Sheet[] }>('/exams/date-sheets').then((r) => r.data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) sheets = [];
    else throw error;
  }
  const today = new Date().toISOString().slice(0, 10);
  const chosen =
    sheets.find((s) => s.id === sp.exam) ??
    sheets.find((s) => s.classes.some((k) => k.papers.some((p) => p.examOn >= today))) ??
    sheets[0];
  const dates = chosen
    ? [...new Set(chosen.classes.flatMap((k) => k.papers.map((p) => p.examOn)))].sort()
    : [];
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 900, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Marks')}
        title={t(lang, 'Exam date sheet')}
        description={t(lang, 'The papers of each exam for your classes: date, day and time.')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {sheets.length === 0 || !chosen ? (
        <Card>
          <p style={{ margin: 0 }}>{t(lang, 'No date sheet yet.')}</p>
        </Card>
      ) : (
        <>
          <form method="get" style={{ marginBottom: 'var(--sp-3)' }}>
            <AutoSubmit />
            <label className="ep-field" htmlFor="ds-exam" style={{ maxWidth: '24rem' }}>
              <span className="ep-field__label">{t(lang, 'Exam')}</span>
              <select id="ds-exam" name="exam" className="ep-select" defaultValue={chosen.id}>
                {sheets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <noscript>
              <button type="submit" className="ep-btn ep-btn--secondary">
                {t(lang, 'Exam')}
              </button>
            </noscript>
          </form>
          <Card title={chosen.name}>
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={chosen.name}>
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">{chosen.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t(lang, 'Date')}</th>
                    {chosen.classes.map((k) => (
                      <th key={k.classId} scope="col">
                        {k.classCode}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dates.map((d) => (
                    <tr key={d}>
                      <th scope="row">
                        {day(d, lang, { day: 'numeric', month: 'short' })}
                        <span className="ep-kicker" style={{ display: 'block' }}>
                          {day(d, lang, { weekday: 'long' })}
                        </span>
                      </th>
                      {chosen.classes.map((k) => (
                        <td key={k.classId}>
                          {k.papers
                            .filter((p) => p.examOn === d)
                            .map((p) => (
                              <div key={p.subject}>
                                {p.subject}
                                {time(p) ? (
                                  <span className="ep-kicker" style={{ display: 'block' }}>
                                    {time(p)}
                                  </span>
                                ) : null}
                              </div>
                            ))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {chosen.note ? (
              <p className="ep-field__help" style={{ whiteSpace: 'pre-line' }}>
                {chosen.note}
              </p>
            ) : null}
          </Card>
        </>
      )}
    </main>
  );
}
