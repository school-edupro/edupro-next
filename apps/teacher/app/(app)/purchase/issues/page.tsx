import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import type { IssueRow } from '@/lib/purchase';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${iso}T00:00:00+05:30`));

/** What a store issued to me or my department, waiting for my acknowledgement (docs/design/84, part 8). */
export default async function StaffIssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let data: { rows: IssueRow[] };
  try {
    data = await bff.api.fetch<{ rows: IssueRow[] }>('/purchase/issues?mine=1');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Home')}
        </a>
      </p>
      <PageHeader
        kicker="EduPro staff"
        title={t(lang, 'Issued to my department')}
        description={t(
          lang,
          'What the store issued to you or your department: confirm you received it.',
        )}
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.detail || 'Done.'}
        </p>
      ) : null}
      <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        {data.rows.length ? (
          data.rows.map((x) => (
            <Card key={x.id} title={`${x.number} · ${x.department}`}>
              <p style={{ marginTop: 0 }}>
                <Badge tone="warning">To acknowledge</Badge> From {x.store} on {when(x.issuedOn)}
                {x.indent ? ` · for ${x.indent}` : ''}
                {x.takenBy ? ` · taken by ${x.takenBy}` : ''} · {x.lines} line
                {x.lines === 1 ? '' : 's'}
              </p>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/purchase/issues/${x.id}`}>
                {t(lang, 'Open and acknowledge')}
              </a>
            </Card>
          ))
        ) : (
          <Card>{t(lang, 'Nothing is waiting for your acknowledgement.')}</Card>
        )}
      </div>
    </main>
  );
}
