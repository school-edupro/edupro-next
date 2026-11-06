import { Button } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { computeExamResults } from '@/lib/actions';

/**
 * When an exam's results were worked out, and Work out results for whoever manages the exam: on the
 * exam's Overview (6 Nov 2026: the Results and Reports tabs are gone) and on the Results pages.
 */
export async function WorkOutResults({
  examId,
  computedAt,
  canCompute,
  back,
}: {
  examId: string;
  computedAt: string | null;
  canCompute: boolean;
  back: string;
}) {
  const t = await getTranslations('examHub.results');
  return (
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
  );
}
