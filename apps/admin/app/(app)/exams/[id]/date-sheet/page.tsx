import { Breadcrumbs } from '@edupro/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import { PrintButton } from '@/components/PrintButton';
import { apiFetch, getMe } from '@/lib/api';
import type { Exam } from '@/lib/types';

/**
 * The exam's date sheet as it is printed or saved as PDF (docs/design/66): one class (date, day, time,
 * subject) or every class side by side (a row per date, a column per class), with the exam's note.
 */
export default async function DateSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ classId?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, l, me, exam, locale] = await Promise.all([
    getTranslations('examHub.sheet'),
    getTranslations('examHub.list'),
    getMe(),
    apiFetch<Exam>(`/exams/${id}`),
    getLocale(),
  ]);
  const school =
    me.memberships.find((m) => m.schoolId === me.school?.id)?.schoolName ??
    me.memberships[0]?.schoolName ??
    '';
  const klass = exam.classes.find((k) => k.classId === sp.classId) ?? null;
  const papers = (exam.subjects ?? []).filter(
    (s) => s.examOn && (!klass || s.classId === klass.classId),
  );
  const dates = [...new Set(papers.map((s) => s.examOn!))].sort();
  const day = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      weekday: 'long',
    });
  const shown = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  const time = (s: { startsAt?: string | null; endsAt?: string | null }) =>
    s.startsAt ? `${s.startsAt}${s.endsAt ? `–${s.endsAt}` : ''}` : '';
  const year = me.academicYear?.code ?? '';
  return (
    <>
      <div className="ep-datesheet__noprint">
        <Breadcrumbs
          items={[
            { label: l('title'), href: '/exams' },
            { label: exam.name, href: `/exams/${exam.id}` },
            { label: t('title') },
          ]}
        />
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--sp-2)',
            alignItems: 'center',
            margin: 'var(--sp-3) 0',
          }}
        >
          <ul className="ep-xchips" aria-label={t('title')}>
            <li style={{ padding: 0, border: 0, background: 'none' }}>
              <a href={`/exams/${exam.id}/date-sheet`} aria-current={klass ? undefined : 'page'}>
                {t('allClasses')}
              </a>
            </li>
            {exam.classes.map((k) => (
              <li key={k.classId} style={{ padding: 0, border: 0, background: 'none' }}>
                <a
                  href={`/exams/${exam.id}/date-sheet?classId=${k.classId}`}
                  aria-current={k.classId === klass?.classId ? 'page' : undefined}
                >
                  {k.classCode}
                </a>
              </li>
            ))}
          </ul>
          <PrintButton label={t('print')} />
          <a
            className="ep-btn ep-btn--ghost"
            href={`/exams/${exam.id}/setup?step=dates${klass ? `&classId=${klass.classId}` : ''}`}
          >
            {t('back')}
          </a>
        </div>
      </div>
      <section className="ep-datesheet" aria-label={t('title')}>
        <header className="ep-datesheet__head">
          <h2 className="ep-card__title">{school}</h2>
          <p>
            <strong>{exam.name}</strong>
            {year ? ` · ${year}` : ''}
          </p>
          <p>
            {t('title')} · {klass ? klass.classCode : t('allClasses')}
          </p>
        </header>
        {dates.length === 0 ? (
          <p>{t('empty')}</p>
        ) : klass ? (
          <table>
            <caption className="ep-sr-only">
              {t('title')} · {klass.classCode}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('date')}</th>
                <th scope="col">{t('day')}</th>
                <th scope="col">{t('time')}</th>
                <th scope="col">{t('subject')}</th>
              </tr>
            </thead>
            <tbody>
              {papers
                .sort((a, b) =>
                  `${a.examOn ?? ''}${a.startsAt ?? ''}`.localeCompare(
                    `${b.examOn ?? ''}${b.startsAt ?? ''}`,
                  ),
                )
                .map((s) => (
                  <tr key={s.id}>
                    <td>{shown(s.examOn!)}</td>
                    <td>{day(s.examOn!)}</td>
                    <td>{time(s)}</td>
                    <td>{s.subjectName}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={t('allClasses')}>
            <table>
              <caption className="ep-sr-only">
                {t('title')} · {t('allClasses')}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t('date')}</th>
                  <th scope="col">{t('day')}</th>
                  {exam.classes.map((k) => (
                    <th key={k.classId} scope="col">
                      {k.classCode}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dates.map((d) => (
                  <tr key={d}>
                    <td>{shown(d)}</td>
                    <td>{day(d)}</td>
                    {exam.classes.map((k) => {
                      const on = papers.filter((s) => s.classId === k.classId && s.examOn === d);
                      return (
                        <td key={k.classId}>
                          {on.map((s) => (
                            <div key={s.id}>
                              {s.subjectName}
                              {time(s) ? <div className="ep-meter__text">{time(s)}</div> : null}
                            </div>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {exam.dateSheetNote ? <p className="ep-datesheet__note">{exam.dateSheetNote}</p> : null}
      </section>
    </>
  );
}
