import { Badge, PageHeader } from '@edupro/ui';
import { ClinicNav } from '@/components/clinic/ClinicNav';
import { RecordSheet } from '@/components/RecordSheet';
import { apiFetch, getMe } from '@/lib/api';
import type { Checkup } from '@/lib/clinic';

interface Card extends Checkup {
  school: string;
  groups: Array<{ title: string; rows: Array<[string, string]> }>;
  note: string | null;
}

/** One pupil's health check-up card on screen, laid out like the PDF the parents download. */
export default async function HealthCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, c] = await Promise.all([getMe(), apiFetch<Card>(`/clinic/cards/${id}`)]);
  return (
    <>
      <PageHeader
        kicker="Health check-up card"
        title={c.student}
        description={[c.camp, c.examDate].filter(Boolean).join(' · ')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--primary ep-btn--sm" href={`/api/clinic/cards/${c.id}`}>
              Download the card (PDF)
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/engagement/clinic/checkups/${c.campId}/${c.sectionId ?? ''}?student=${c.studentId}`}
            >
              {c.status === 'published' ? 'Open the form' : 'Edit'}
            </a>
          </span>
        }
      />
      <ClinicNav current="/engagement/clinic/checkups" permissions={me.permissions} />
      <RecordSheet
        school={c.school}
        doc={`Health check-up card · ${c.camp}`}
        name={c.student}
        badge={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={c.status === 'published' ? 'success' : 'warning'}>
              {c.status === 'published' ? 'Published to the parents' : 'Draft'}
            </Badge>
            {c.needsAttention ? <Badge tone="warning">Needs attention</Badge> : null}
          </span>
        }
        facts={[
          ['Class', c.section],
          ['Admission no.', c.admissionNo],
          ['Date of birth', c.dob],
          ['Examined on', c.examDate],
          ['Place', c.place],
          ['Doctor', c.doctor],
        ]}
        sections={c.groups}
        remarksTitle="Remarks for the parents"
        remarks={c.remarks}
        attention={c.needsAttention}
        attentionText="Please see a doctor or specialist about the points above."
        signedBy={c.doctor ?? 'School doctor'}
        note={
          c.note ?? 'This card records a school health check-up. It is not a medical certificate.'
        }
      />
    </>
  );
}
