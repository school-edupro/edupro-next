import { getTranslations } from 'next-intl/server';
import { SubNav } from './SubNav';
import { WorkOutResults } from './WorkOutResults';

/**
 * The Results pages' top (docs/design/66): its pages (analysis, mark register, promotion), when the
 * results were worked out, and Work out results for whoever manages the exam. The pages are no longer
 * on the exam's tabs (6 Nov 2026) but still open at their addresses.
 */
export async function ResultsHead({
  examId,
  current,
  computedAt,
  canCompute,
  back,
}: {
  examId: string;
  current: 'analysis' | 'register' | 'promotion';
  computedAt: string | null;
  canCompute: boolean;
  back: string;
}) {
  const t = await getTranslations('examHub.results');
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--sp-2) var(--sp-4)',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--sp-3)',
      }}
    >
      <SubNav
        label={t('nav')}
        current={`/exams/${examId}/${current}`}
        items={(['analysis', 'register', 'promotion'] as const).map((k) => ({
          href: `/exams/${examId}/${k}`,
          label: t(k),
        }))}
      />
      <WorkOutResults examId={examId} computedAt={computedAt} canCompute={canCompute} back={back} />
    </div>
  );
}
