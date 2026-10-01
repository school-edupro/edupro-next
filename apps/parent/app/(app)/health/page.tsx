import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Visit {
  id: string;
  inAt: string;
  outAt: string | null;
  complaint: string;
  treatment: string | null;
  temperatureC: string | null;
  referredTo: string | null;
  sentHome: boolean;
}
interface Record_ {
  recorded_on: string;
  height_cm: string | null;
  weight_kg: string | null;
  bmi: string | null;
  blood_group: string | null;
  vision_left: string | null;
  vision_right: string | null;
  dental: string | null;
}
interface Health {
  children: Array<{ student: { id: string; name: string }; visits: Visit[]; records: Record_[] }>;
}
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/** Sprint 19: clinic visits and health records of the family's children. */
export default async function HealthPage() {
  const lang = await currentLang();
  let h: Health;
  try {
    h = await bff.api.fetch<Health>('/engagement/mine/health');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Health')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="EduPro"
        title={t(lang, 'Health')}
        description={t(lang, 'Clinic visits and the annual health check of each child.')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {h.children.map((ch) => (
        <Card key={ch.student.id} title={ch.student.name} style={{ marginBottom: 'var(--sp-3)' }}>
          <h3 style={{ fontSize: 'var(--fs-body)', margin: '0 0 var(--sp-1)' }}>
            {t(lang, 'Clinic visits')}
          </h3>
          {ch.visits.length === 0 ? (
            <p className="ep-field__help">{t(lang, 'No clinic visits.')}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: '0 0 var(--sp-3)', padding: 0 }}>
              {ch.visits.map((v) => (
                <li
                  key={v.id}
                  style={{ padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border-subtle)' }}
                >
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}
                  >
                    <strong>{v.complaint}</strong>
                    <span className="ep-kicker">{when(v.inAt)}</span>
                  </div>
                  <div className="ep-kicker">
                    {v.treatment ?? ''}
                    {v.temperatureC ? ` · ${v.temperatureC} °C` : ''}
                    {v.referredTo ? ` · ${t(lang, 'Referred to')} ${v.referredTo}` : ''}
                  </div>
                  {v.sentHome ? <Badge tone="warning">{t(lang, 'Sent home')}</Badge> : null}
                </li>
              ))}
            </ul>
          )}
          <h3 style={{ fontSize: 'var(--fs-body)', margin: '0 0 var(--sp-1)' }}>
            {t(lang, 'Health records')}
          </h3>
          {ch.records.length === 0 ? (
            <p className="ep-field__help">{t(lang, 'No health check recorded.')}</p>
          ) : (
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th>{t(lang, 'Date')}</th>
                  <th>{t(lang, 'Height')}</th>
                  <th>{t(lang, 'Weight')}</th>
                  <th>BMI</th>
                  <th>{t(lang, 'Blood group')}</th>
                  <th>{t(lang, 'Vision')}</th>
                  <th>{t(lang, 'Dental')}</th>
                </tr>
              </thead>
              <tbody>
                {ch.records.map((r) => (
                  <tr key={r.recorded_on}>
                    <td>{r.recorded_on}</td>
                    <td>{r.height_cm ?? ''}</td>
                    <td>{r.weight_kg ?? ''}</td>
                    <td>{r.bmi ?? ''}</td>
                    <td>{r.blood_group ?? ''}</td>
                    <td>{[r.vision_left, r.vision_right].filter(Boolean).join(' / ')}</td>
                    <td>{r.dental ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ))}
    </main>
  );
}
