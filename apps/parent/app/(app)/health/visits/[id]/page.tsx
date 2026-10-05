import { Badge, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { RecordSheet } from '@/components/RecordSheet';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { OUTCOME, medName, when, type Visit } from '../../shared';

/** One clinic visit of my child with everything the clinic recorded, in sections. */
export default async function HealthVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = await currentLang();
  if (!/^\d{1,18}$/.test(id)) notFound();
  let v: Visit & { school: string };
  try {
    v = await bff.api.fetch<Visit & { school: string }>(`/clinic/mine/visits/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
  const away = v.outcome === 'sent_home' || v.outcome === 'referred';
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 860, margin: '0 auto' }}>
      <PageHeader
        kicker={`${t(lang, 'Clinic visit')} ${v.number}`}
        title={v.complaint}
        description={[v.student, when(v.inAt)].filter(Boolean).join(' · ')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/health">
            {t(lang, 'Back to Health')}
          </a>
        }
      />
      <RecordSheet
        school={v.school}
        doc={`${t(lang, 'Clinic visit')} · ${v.number}`}
        name={v.student ?? ''}
        badge={<Badge tone={OUTCOME[v.outcome][1]}>{t(lang, OUTCOME[v.outcome][0])}</Badge>}
        facts={[
          [t(lang, 'Class'), v.section],
          [t(lang, 'Admission no.'), v.admissionNo],
          [t(lang, 'Time in'), when(v.inAt)],
          [t(lang, 'Time out'), v.outAt ? when(v.outAt) : t(lang, 'Still in the clinic')],
          [t(lang, 'Clinic'), v.clinic],
          [t(lang, 'Nurse'), v.nurse],
        ]}
        sections={[
          {
            title: t(lang, 'Complaint and examination'),
            rows: [
              [t(lang, 'Complaint'), v.complaint],
              [t(lang, 'Disease'), v.diseases.join(', ') || null],
              [
                t(lang, 'Temperature'),
                v.temperatureC !== null ? `${String(v.temperatureC)} °C` : null,
              ],
              [t(lang, 'Pulse'), v.pulse !== null ? `${String(v.pulse)} / min` : null],
              [t(lang, 'Blood pressure'), v.bp],
              ['SpO2', v.spo2 !== null ? `${String(v.spo2)}%` : null],
              [t(lang, 'Weight'), v.weightKg !== null ? `${String(v.weightKg)} kg` : null],
              [t(lang, 'What the doctor found'), v.diagnosis],
            ],
          },
          {
            title: t(lang, 'Treatment'),
            rows: [
              [t(lang, 'Treatment given'), v.treatment],
              [t(lang, 'Prescription'), v.prescription],
              [t(lang, 'Referred to'), v.referredTo],
            ],
          },
        ]}
        remarksTitle={t(lang, away ? 'What the school asks of you' : 'Advice')}
        remarks={
          away
            ? `${
                v.outcome === 'referred'
                  ? `${t(lang, 'The school clinic referred your child to')} ${v.referredTo ?? ''}.`
                  : t(lang, 'The school clinic sent your child home.')
              }${v.remark ? `\n${v.remark}` : ''}`
            : v.remark
        }
        attention={away}
        signedBy={v.doctor}
        signLabel={t(lang, 'Doctor')}
        note={t(lang, 'Recorded by the school clinic.')}
      >
        {v.medicines.length ? (
          <section className="ep-sheet__sec" aria-label={t(lang, 'Medicines given')}>
            <h3>{t(lang, 'Medicines given')}</h3>
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label={t(lang, 'Medicines given')}
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">{t(lang, 'Medicines given')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t(lang, 'Medicine')}</th>
                    <th scope="col">{t(lang, 'Quantity')}</th>
                    <th scope="col">{t(lang, 'Dosage')}</th>
                  </tr>
                </thead>
                <tbody>
                  {v.medicines.map((m) => (
                    <tr key={m.id}>
                      <th scope="row">{medName(m)}</th>
                      <td>
                        {m.qty} {m.unit}
                      </td>
                      <td>{m.dosage ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </RecordSheet>
    </main>
  );
}
