import { Button } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { computeExamResults } from '@/lib/actions';
import { SubNav } from './SubNav';

/**
 * The Results tab's top (docs/design/66): its pages (analysis, mark register, promotion), when the
 * results were worked out, and Work out results for whoever manages the exam.
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
      <span style={{ display: 'inline-flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
        <span className="ep-meter__text">
          {computedAt
            ? t('computedAt', { at: computedAt.slice(0, 16).replace('T', ' ') })
            : t('notComputed')}
        </span>
        {canCompute ? (
          <form action={computeExamResults}>
            <input type="hidden" name="examId" value={examId} />
            <input type="hidden" name="back" value={back} />
            <Button type="submit" size="sm">
              {t('compute')}
            </Button>
          </form>
        ) : null}
      </span>
    </div>
  );
}
