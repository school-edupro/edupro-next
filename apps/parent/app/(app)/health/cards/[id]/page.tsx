import { Badge, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { RecordSheet } from '@/components/RecordSheet';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import type { HealthCard } from '../../shared';

interface Detail extends HealthCard {
  school: string;
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
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 860, margin: '0 auto' }}>
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
      <RecordSheet
        school={c.school}
        doc={`${t(lang, 'Health check-up card')} · ${c.camp}`}
        name={c.student}
        badge={
          c.needsAttention ? <Badge tone="warning">{t(lang, 'Please see a doctor')}</Badge> : null
        }
        facts={[
          [t(lang, 'Class'), c.section],
          [t(lang, 'Admission no.'), c.admissionNo],
          [t(lang, 'Date of birth'), c.dob],
          [t(lang, 'Examined on'), c.examDate],
          [t(lang, 'Place'), c.place],
          [t(lang, 'Doctor'), c.doctor],
        ]}
        sections={c.groups.map((g) => ({
          title: t(lang, g.title),
          rows: g.rows.map(([k, x]): [string, string] => [t(lang, k), x]),
        }))}
        remarksTitle={t(lang, 'Remarks for the parents')}
        remarks={c.remarks}
        attention={c.needsAttention}
        attentionText={t(lang, 'Please see a doctor or specialist about the points above.')}
        signedBy={c.doctor ?? t(lang, 'School doctor')}
        signLabel={t(lang, 'Signature')}
        note={
          c.note ??
          t(lang, 'This card records a school health check-up. It is not a medical certificate.')
        }
      />
    </main>
  );
}
