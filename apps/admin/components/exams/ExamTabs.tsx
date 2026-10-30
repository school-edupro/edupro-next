import { getTranslations } from 'next-intl/server';

export type ExamTab =
  'overview' | 'setup' | 'marks' | 'indicators' | 'remarks' | 'attendance' | 'results' | 'reports';

/** The pages of one exam (docs/design/66): the same tabs on each, so nothing is two clicks away. */
export async function ExamTabs({ examId, current }: { examId: string; current: ExamTab }) {
  const t = await getTranslations('examHub.tabs');
  const tabs: Array<[ExamTab, string]> = [
    ['overview', ''],
    ['setup', '/setup'],
    ['marks', '/status'],
    ['indicators', '/indicators'],
    ['remarks', '/remarks'],
    ['attendance', '/attendance'],
    ['results', '/analysis'],
    ['reports', '/reports'],
  ];
  return (
    <nav
      className="ep-tabs-links ep-tabs__list--wrap"
      aria-label={t('label')}
      style={{ marginBottom: 'var(--sp-4)', flexWrap: 'wrap' }}
    >
      {tabs.map(([key, path]) => (
        <a
          key={key}
          href={`/exams/${examId}${path}`}
          aria-current={key === current ? 'page' : undefined}
        >
          {t(key)}
        </a>
      ))}
    </nav>
  );
}
