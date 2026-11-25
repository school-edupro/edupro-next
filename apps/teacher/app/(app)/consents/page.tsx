import { Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { ConsentFeed, type ConsentForm } from './ConsentFeed';

/** The first page: the latest 10 forms asked of me; the rest load as I scroll. */
const PAGE = 10;

interface Mine {
  forms: ConsentForm[];
  page: { total: number } | null;
}

/** Consent forms and declarations the school asks of the staff member (docs/design/28-consent-forms.md). */
export default async function StaffConsentsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; msg?: string }>;
}) {
  const sp = await searchParams;
  let mine: Mine;
  try {
    mine = await bff.api.fetch<Mine>(
      `/engagement/mine/consent-forms?part=staff&page=1&size=${String(PAGE)}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const lang = await currentLang();
  const foot = {
    more: t(lang, 'Show more'),
    loading: t(lang, 'Loading…'),
    failed: t(lang, 'Could not load more.'),
    end: t(lang, 'That is everything.'),
  };
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/" style={{ textDecoration: 'underline' }}>
          ← Home
        </a>
      </p>
      <PageHeader
        kicker="EduPro staff"
        title="Forms and declarations"
        description="Consent forms, surveys and declarations the school asks you to answer."
      />
      {sp.done ? (
        <p className="ep-alert ep-alert--success" role="status">
          Thank you. Your answer is saved as {sp.done}.{sp.msg ? ` ${sp.msg}` : ''}
        </p>
      ) : null}
      {mine.forms.length === 0 ? (
        <Card>Nothing to answer now.</Card>
      ) : (
        <ConsentFeed first={mine.forms} more={PAGE < (mine.page?.total ?? 0)} foot={foot} />
      )}
    </main>
  );
}
