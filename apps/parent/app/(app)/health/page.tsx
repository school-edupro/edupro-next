import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Visit {
  id: string;
  number: string;
  inAt: string;
  complaint: string;
  treatment: string | null;
  medicines: string[];
  remark: string | null;
  outcome: 'back_to_class' | 'rest' | 'sent_home' | 'referred';
  referredTo: string | null;
}
interface HealthCard {
  id: string;
  camp: string;
  examDate: string;
  heightCm: number | null;
  weightKg: number | null;
  bmi: number | null;
  bloodGroup: string | null;
  remarks: string | null;
  needsAttention: boolean;
  doctor: string | null;
}
interface Health {
  data: Array<{ id: string; name: string; visits: Visit[]; cards: HealthCard[] }>;
}
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
const OUTCOME: Record<Visit['outcome'], [string, 'success' | 'info' | 'warning' | 'danger']> = {
  back_to_class: ['Back to class', 'success'],
  rest: ['Rested in the clinic', 'info'],
  sent_home: ['Sent home', 'warning'],
  referred: ['Referred', 'danger'],
};

/**
 * Health (0075): each child's health check-up cards (once the school doctor has published them, with the
 * PDF to download) and visits to the school clinic (what was wrong, what was done and given).
 */
export default async function HealthPage() {
  const lang = await currentLang();
  let h: Health;
  try {
    h = await bff.api.fetch<Health>('/clinic/mine');
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
        description={t(lang, 'Health check-up cards and visits to the school clinic.')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {h.data.map((ch) => (
        <Card key={ch.id} title={ch.name} style={{ marginBottom: 'var(--sp-3)' }}>
          <h3 className="ep-cdash__h3" style={{ marginTop: 0 }}>
            {t(lang, 'Health check-up cards')}
          </h3>
          {ch.cards.length === 0 ? (
            <p className="ep-field__help">
              {t(lang, 'No health card yet. It shows here when the school doctor publishes it.')}
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: '0 0 var(--sp-3)', padding: 0 }}>
              {ch.cards.map((c) => (
                <li
                  key={c.id}
                  style={{ padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border-subtle)' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 'var(--sp-2)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <strong>{c.camp}</strong>
                    <span className="ep-kicker">{c.examDate}</span>
                  </div>
                  <div>
                    {[
                      c.heightCm ? `${t(lang, 'Height')} ${String(c.heightCm)} cm` : null,
                      c.weightKg ? `${t(lang, 'Weight')} ${String(c.weightKg)} kg` : null,
                      c.bmi ? `BMI ${String(c.bmi)}` : null,
                      c.bloodGroup ? `${t(lang, 'Blood group')} ${c.bloodGroup}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {c.remarks ? <p style={{ margin: 'var(--sp-1) 0' }}>{c.remarks}</p> : null}
                  <div
                    style={{
                      display: 'flex',
                      gap: 'var(--sp-2)',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    {c.needsAttention ? (
                      <Badge tone="warning">{t(lang, 'Please see a doctor')}</Badge>
                    ) : null}
                    <a
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      href={`/api/health-card/${c.id}`}
                      aria-label={`${t(lang, 'Download the health card (PDF)')}: ${c.camp}, ${ch.name}`}
                    >
                      {t(lang, 'Download the health card (PDF)')}
                    </a>
                    {c.doctor ? <span className="ep-field__help">{c.doctor}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h3 className="ep-cdash__h3">{t(lang, 'Clinic visits')}</h3>
          {ch.visits.length === 0 ? (
            <p className="ep-field__help">{t(lang, 'No clinic visits.')}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {ch.visits.map((v) => (
                <li
                  key={v.id}
                  style={{ padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border-subtle)' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 'var(--sp-2)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <strong>{v.complaint}</strong>
                    <span className="ep-kicker">{when(v.inAt)}</span>
                  </div>
                  <div className="ep-kicker">
                    {[
                      v.treatment,
                      v.medicines.length
                        ? `${t(lang, 'Medicine given')}: ${v.medicines.join(', ')}`
                        : null,
                      v.remark,
                      v.referredTo ? `${t(lang, 'Referred to')} ${v.referredTo}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  <Badge tone={OUTCOME[v.outcome][1]}>{t(lang, OUTCOME[v.outcome][0])}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </main>
  );
}
