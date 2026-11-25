import { Badge, Card } from '@edupro/ui';
import { t, type Lang } from '@/lib/i18n';
import { OUTCOME, dateParts, medName, timeOf, type HealthCard, type Visit } from './shared';

export type HealthItem = { kind: 'visit'; visit: Visit } | { kind: 'card'; card: HealthCard };

/** A page of the child's health list: a card for each clinic visit and health check-up card. */
export function HealthItems({ items, lang }: { items: HealthItem[]; lang: Lang }) {
  const list = { data: items };
  return (
    <>
      {list.data.map((it) => {
        if (it.kind === 'visit') {
          const v = it.visit;
          const d = dateParts(v.inAt);
          return (
            <Card key={`v${v.id}`} elevated style={{ marginBottom: 'var(--sp-3)' }}>
              <div className="ep-apt">
                <div className="ep-apt__date">
                  <span className="ep-apt__day">{d.day}</span>
                  <span className="ep-apt__month">{d.month}</span>
                  <span className="ep-apt__time">{timeOf(v.inAt)}</span>
                </div>
                <div className="ep-apt__body">
                  <div className="ep-apt__top">
                    <a className="ep-apt__title" href={`/health/visits/${v.id}`}>
                      {v.complaint}
                    </a>
                    <Badge tone={OUTCOME[v.outcome][1]}>{t(lang, OUTCOME[v.outcome][0])}</Badge>
                  </div>
                  <div>
                    {[
                      v.treatment,
                      v.medicines.length
                        ? `${t(lang, 'Medicine given')}: ${v.medicines.map((m) => medName(m)).join(', ')}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || t(lang, 'Clinic visit')}
                  </div>
                  <div className="ep-kicker">
                    {[t(lang, 'Clinic visit'), v.number, v.student, v.doctor]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  <div className="ep-apt__actions">
                    <a
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      href={`/health/visits/${v.id}`}
                      aria-label={`${t(lang, 'Details')} ${v.number}`}
                    >
                      {t(lang, 'Details')}
                    </a>
                  </div>
                </div>
              </div>
            </Card>
          );
        }
        const c = it.card;
        const d = dateParts(c.examDate);
        return (
          <Card key={`c${c.id}`} elevated style={{ marginBottom: 'var(--sp-3)' }}>
            <div className="ep-apt">
              <div className="ep-apt__date">
                <span className="ep-apt__day">{d.day}</span>
                <span className="ep-apt__month">{d.month}</span>
              </div>
              <div className="ep-apt__body">
                <div className="ep-apt__top">
                  <a className="ep-apt__title" href={`/health/cards/${c.id}`}>
                    {c.camp}
                  </a>
                  <Badge tone={c.needsAttention ? 'warning' : 'success'}>
                    {t(lang, c.needsAttention ? 'Please see a doctor' : 'Health card')}
                  </Badge>
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
                <div className="ep-kicker">
                  {[t(lang, 'Health check-up'), c.student, c.doctor].filter(Boolean).join(' · ')}
                </div>
                <div className="ep-apt__actions">
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/health/cards/${c.id}`}
                    aria-label={`${t(lang, 'Details')}: ${c.camp}, ${c.student}`}
                  >
                    {t(lang, 'Details')}
                  </a>
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/api/health-card/${c.id}`}
                    aria-label={`${t(lang, 'Download the health card (PDF)')}: ${c.camp}, ${c.student}`}
                  >
                    {t(lang, 'Download the health card (PDF)')}
                  </a>
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </>
  );
}
