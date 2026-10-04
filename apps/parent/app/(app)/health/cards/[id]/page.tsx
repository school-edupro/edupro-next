import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import type { HealthCard } from '../../shared';

interface Detail extends HealthCard {
  dob: string | null;
  groups: Array<{ title: string; rows: Array<[string, string]> }>;
  note: string | null;
}

/** One health check-up card of my child: every finding section by section, as on the PDF. */
export default async function HealthCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = await currentLang();
  if (!/^\d{1,18}$/.test(id)) notFound();
  let c: Detail;
  try {
    c = await bff.api.fetch<Detail>(`/clinic/mine/cards/${id}/detail`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
  const who: Array<[string, string | null]> = [
    ['Child', c.student],
    ['Class', c.section],
    ['Admission no.', c.admissionNo],
    ['Date of birth', c.dob],
    ['Examined on', c.examDate],
    ['Place', c.place],
    ['Doctor', c.doctor],
  ];
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Health check-up card')}
        title={c.camp}
        description={[c.student, c.examDate].filter(Boolean).join(' · ')}
        actions={
          <span
            style={{
              display: 'inline-flex',
              gap: 'var(--sp-2)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <a className="ep-btn ep-btn--primary ep-btn--sm" href={`/api/health-card/${c.id}`}>
              {t(lang, 'Download the health card (PDF)')}
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/health">
              {t(lang, 'Back to Health')}
            </a>
          </span>
        }
      />
      {c.needsAttention ? (
        <div
          className="ep-alert ep-alert--warning"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'The doctor asks you to see a doctor or specialist about the remarks below.')}
        </div>
      ) : null}
      {c.remarks ? (
        <Card
          title={t(lang, 'Remarks for the parents')}
          actions={
            c.needsAttention ? <Badge tone="warning">{t(lang, 'Please see a doctor')}</Badge> : null
          }
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <p style={{ margin: 0 }}>{c.remarks}</p>
        </Card>
      ) : null}
      <Card title={t(lang, 'The check-up')} style={{ marginBottom: 'var(--sp-3)' }}>
        <dl className="ep-hd__facts">
          {who
            .filter(([, x]) => x)
            .map(([k, x]) => (
              <div key={k}>
                <dt>{t(lang, k)}</dt>
                <dd>{x}</dd>
              </div>
            ))}
        </dl>
      </Card>
      {c.groups.map((g) => (
        <Card key={g.title} title={t(lang, g.title)} style={{ marginBottom: 'var(--sp-3)' }}>
          <dl className="ep-hd__facts">
            {g.rows.map(([k, x]) => (
              <div key={k}>
                <dt>{t(lang, k)}</dt>
                <dd>{x}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ))}
      {c.note ? <p className="ep-field__help">{c.note}</p> : null}
    </main>
  );
}
