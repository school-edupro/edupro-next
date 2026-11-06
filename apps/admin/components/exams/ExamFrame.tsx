import { Alert, Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { ConfirmAction } from '@/components/ConfirmAction';
import { apiFetch } from '@/lib/api';
import { toggleExamLock } from '@/lib/exam-hub-actions';
import type { Exam, ExamStage } from '@/lib/types';
import { ExamTabs, type ExamTab } from './ExamTabs';
import { STAGE_TONE } from './StageSteps';

/**
 * The top of every page of an exam (docs/design/66): its name, type and dates, its stage, the date
 * sheet, a copy for the next term, the whole-exam lock (asked first), and the exam's tabs. 6 Nov 2026:
 * the lock is the school admin's (exams.lock.manage); unlocking reopens the submitted and verified
 * marks, so the dialog says how many and asks the reason.
 */
export async function ExamFrame({
  exam,
  stage,
  current,
  canManage,
  canLock,
}: {
  exam: Exam;
  stage: ExamStage | null;
  current: ExamTab;
  canManage: boolean;
  /** lock and unlock the whole exam (the school admin) */
  canLock: boolean;
}) {
  const [t, s, l, a] = await Promise.all([
    getTranslations('examHub.overview'),
    getTranslations('examHub.stage'),
    getTranslations('examHub.list'),
    getTranslations('examHub.areas'),
  ]);
  // a page of an area the exam does not take (an old link): said at the top
  const areaOf: Partial<Record<ExamTab, string[]>> = {
    marks: ['marks'],
    indicators: ['indicators'],
    remarks: ['remarks'],
    attendance: ['attendance', 'health'],
    results: ['marks'],
    reports: ['marks'],
  };
  // what unlocking reopens: the submitted and verified sheets
  const toReopen =
    exam.marksLocked && canLock
      ? await apiFetch<{ counts: { submitted: number; verified: number } }>(
          `/exams/${exam.id}/entry-status`,
        )
          .then((r) => r.counts.submitted + r.counts.verified)
          .catch(() => 0)
      : 0;
  const need = areaOf[current];
  const off = need && exam.areas ? !need.some((x) => exam.areas!.includes(x)) : false;
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
            {canLock ? (
              <ConfirmAction
                action={toggleExamLock}
                fields={{ examId: exam.id, to: exam.marksLocked ? 'open' : 'lock' }}
                label={exam.marksLocked ? t('unlockWhole') : t('lockWhole')}
                title={exam.marksLocked ? t('unlockWholeTitle') : t('lockWholeTitle')}
                confirmLabel={exam.marksLocked ? t('unlockWhole') : t('lockWhole')}
                {...(toReopen ? { reason: { label: t('unlockReason') } } : {})}
              >
                {exam.marksLocked
                  ? `${t('unlockWholeBody', { name: exam.name })}${toReopen ? ` ${t('unlockReopens', { n: toReopen })}` : ''}`
                  : t('lockWholeBody', { name: exam.name })}
              </ConfirmAction>
            ) : null}
          </span>
        }
      />
      <ExamTabs examId={exam.id} current={current} areas={exam.areas} />
      {off ? (
        <Alert tone="warning">
          {a('notTaken', { area: need!.map((x) => a(x as 'marks')).join(' / ') })}
        </Alert>
      ) : null}
    </>
  );
}
