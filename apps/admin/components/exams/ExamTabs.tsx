import { getTranslations } from 'next-intl/server';

export type ExamTab =
  'overview' | 'setup' | 'marks' | 'indicators' | 'remarks' | 'attendance' | 'results' | 'reports';

/**
 * The pages of one exam (docs/design/66): the same tabs on each, so nothing is two clicks away; an area
 * the exam does not take has no tab (results and reports go with marks).
 */
export async function ExamTabs({
  examId,
  current,
  areas,
}: {
  examId: string;
  current: ExamTab;
  areas?: string[];
}) {
  const t = await getTranslations('examHub.tabs');
  const on = (a: string) => !areas || areas.includes(a);
  const tabs: Array<[ExamTab, string]> = [
    ['overview', ''],
    ['setup', '/setup'],
    ...(on('marks') ? ([['marks', '/status']] as Array<[ExamTab, string]>) : []),
    ...(on('indicators') ? ([['indicators', '/indicators']] as Array<[ExamTab, string]>) : []),
    ...(on('remarks') ? ([['remarks', '/remarks']] as Array<[ExamTab, string]>) : []),
    ...(on('attendance') || on('health')
      ? ([['attendance', on('attendance') ? '/attendance' : '/health']] as Array<[ExamTab, string]>)
      : []),
    ...(on('marks')
      ? ([
          ['results', '/analysis'],
          ['reports', '/reports'],
        ] as Array<[ExamTab, string]>)
      : []),
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
