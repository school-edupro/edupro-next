import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { OUTCOME, medName, when, type Visit } from '../../shared';

/** One clinic visit of my child with everything the clinic recorded, in sections. */
export default async function HealthVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = await currentLang();
  if (!/^\d{1,18}$/.test(id)) notFound();
  let v: Visit;
  try {
    v = await bff.api.fetch<Visit>(`/clinic/mine/visits/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
  const blocks: Array<[string, Array<[string, string | null]>]> = [
    [
      'The visit',
      [
        ['Child', [v.student, v.section].filter(Boolean).join(' · ') || null],
        ['Admission no.', v.admissionNo],
        ['Time in', when(v.inAt)],
        ['Time out', v.outAt ? when(v.outAt) : null],
        ['Clinic', v.clinic],
        ['Doctor', v.doctor],
        ['Nurse', v.nurse],
      ],
    ],
    [
      'Complaint and examination',
      [
        ['Complaint', v.complaint],
        ['Disease', v.diseases.join(', ') || null],
        ['Temperature', v.temperatureC !== null ? `${String(v.temperatureC)} °C` : null],
        ['Pulse', v.pulse !== null ? `${String(v.pulse)} / min` : null],
        ['Blood pressure', v.bp],
        ['SpO2', v.spo2 !== null ? `${String(v.spo2)}%` : null],
        ['Weight', v.weightKg !== null ? `${String(v.weightKg)} kg` : null],
        ['What the doctor found', v.diagnosis],
      ],
    ],
    [
      'Treatment',
      [
        ['Treatment given', v.treatment],
        ['Prescription', v.prescription],
        ['Advice', v.remark],
        ['Referred to', v.referredTo],
      ],
    ],
  ];
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={`${t(lang, 'Clinic visit')} ${v.number}`}
        title={v.complaint}
        description={[v.student, when(v.inAt)].filter(Boolean).join(' · ')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={OUTCOME[v.outcome][1]}>{t(lang, OUTCOME[v.outcome][0])}</Badge>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/health">
              {t(lang, 'Back to Health')}
            </a>
          </span>
        }
      />
      {v.outcome === 'sent_home' || v.outcome === 'referred' ? (
        <div
          className="ep-alert ep-alert--warning"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {v.outcome === 'referred'
            ? `${t(lang, 'The school clinic referred your child to')} ${v.referredTo ?? ''}.`
            : t(lang, 'The school clinic sent your child home.')}
        </div>
      ) : null}
      {blocks.map(([title, rows]) =>
        rows.some(([, x]) => x) ? (
          <Card key={title} title={t(lang, title)} style={{ marginBottom: 'var(--sp-3)' }}>
            <dl className="ep-hd__facts">
              {rows
                .filter(([, x]) => x)
                .map(([k, x]) => (
                  <div key={k}>
                    <dt>{t(lang, k)}</dt>
                    <dd>{x}</dd>
                  </div>
                ))}
            </dl>
          </Card>
        ) : null,
      )}
      {v.medicines.length ? (
        <Card title={t(lang, 'Medicines given')}>
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
        </Card>
      ) : null}
    </main>
  );
}
