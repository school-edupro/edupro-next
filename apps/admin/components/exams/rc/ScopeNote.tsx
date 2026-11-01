import { Alert } from '@edupro/ui';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import type { CardScope } from '@/lib/report-card-release';

/**
 * Says whose classes Report cards shows (docs/design/65, 1 Nov 2026): a coordinator's or a class
 * teacher's own, or none with where the office assigns them. Nothing for the principal (every class).
 */
export async function ScopeNote({ scope }: { scope: CardScope }) {
  if (scope.all) return null;
  const t = await getTranslations('rcRelease');
  const assign = (chunks: ReactNode) => <a href="/academics/teacher-assignments">{chunks}</a>;
  if (!scope.sections.length)
    return (
      <Alert tone="warning" title={t('noClassesTitle')}>
        {t.rich('noClasses', { a: assign })}
      </Alert>
    );
  return (
    <p className="ep-rcw-scope" role="note">
      {t('yourClasses', { list: scope.sections.map((x) => x.code).join(', ') })}
    </p>
  );
}
