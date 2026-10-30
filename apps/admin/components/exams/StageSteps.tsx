import { getTranslations } from 'next-intl/server';
import type { ExamStage } from '@/lib/types';

const STAGES: ExamStage[] = ['setup', 'entry', 'verification', 'results', 'released'];

/** Set-up → Marks entry → Verification → Results → Cards released, the exam's own step marked. */
export async function StageSteps({ stage, label }: { stage: ExamStage; label: string }) {
  const t = await getTranslations('examHub.stage');
  const at = STAGES.indexOf(stage);
  return (
    <ol className="ep-xstages" aria-label={label}>
      {STAGES.map((s, i) => (
        <li
          key={s}
          data-state={i < at || stage === 'released' ? 'done' : undefined}
          aria-current={i === at ? 'step' : undefined}
        >
          {t(s)}
        </li>
      ))}
    </ol>
  );
}

export const STAGE_TONE: Record<ExamStage, 'neutral' | 'info' | 'warning' | 'success'> = {
  setup: 'neutral',
  entry: 'info',
  verification: 'warning',
  results: 'success',
  released: 'success',
};
