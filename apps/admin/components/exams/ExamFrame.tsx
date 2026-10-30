import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { ConfirmAction } from '@/components/ConfirmAction';
import { toggleExamLock } from '@/lib/exam-hub-actions';
import type { Exam, ExamStage } from '@/lib/types';
import { ExamTabs, type ExamTab } from './ExamTabs';
import { STAGE_TONE } from './StageSteps';

/**
 * The top of every page of an exam (docs/design/66): its name, type and dates, its stage, the date
 * sheet, a copy for the next term, the whole-exam lock (asked first), and the exam's tabs.
 */
export async function ExamFrame({
  exam,
  stage,
  current,
  canManage,
  canUnlock,
}: {
  exam: Exam;
  stage: ExamStage | null;
  current: ExamTab;
  canManage: boolean;
  canUnlock: boolean;
}) {
  const [t, s, l] = await Promise.all([
    getTranslations('examHub.overview'),
    getTranslations('examHub.stage'),
    getTranslations('examHub.list'),
  ]);
  const dates =
    exam.startsOn && exam.endsOn
      ? l('dates', { from: exam.startsOn, to: exam.endsOn })
      : exam.startsOn
        ? l('from', { from: exam.startsOn })
        : l('noDates');
  return (
    <>
      <Breadcrumbs items={[{ label: l('title'), href: '/exams' }, { label: exam.name }]} />
      <PageHeader
        kicker={`${exam.examTypeName} · ${exam.code}`}
        title={exam.name}
        description={dates}
        actions={
          <span
            style={{
              display: 'inline-flex',
              gap: 'var(--sp-2)',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {stage ? <Badge tone={STAGE_TONE[stage]}>{s(stage)}</Badge> : null}
            {exam.marksLocked ? <Badge tone="warning">{l('locked')}</Badge> : null}
            {exam.status === 'inactive' ? <Badge tone="neutral">{l('inactive')}</Badge> : null}
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/exams/${exam.id}/date-sheet`}>
              {t('dateSheet')}
            </a>
            {canManage ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/exams/new?from=${exam.id}`}>
                {t('copy')}
              </a>
            ) : null}
            {canManage && (!exam.marksLocked || canUnlock) ? (
              <ConfirmAction
                action={toggleExamLock}
                fields={{ examId: exam.id, to: exam.marksLocked ? 'open' : 'lock' }}
                label={exam.marksLocked ? t('unlockWhole') : t('lockWhole')}
                title={exam.marksLocked ? t('unlockWholeTitle') : t('lockWholeTitle')}
                confirmLabel={exam.marksLocked ? t('unlockWhole') : t('lockWhole')}
              >
                {exam.marksLocked
                  ? t('unlockWholeBody', { name: exam.name })
                  : t('lockWholeBody', { name: exam.name })}
              </ConfirmAction>
            ) : null}
          </span>
        }
      />
      <ExamTabs examId={exam.id} current={current} />
    </>
  );
}
