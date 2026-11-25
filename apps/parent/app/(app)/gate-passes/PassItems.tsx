import { Badge, Button, Card } from '@edupro/ui';
import { t, type Lang } from '@/lib/i18n';
import { studentLabel, timeOf } from '../appointments/shared';
import { cancelGatePass } from './actions';
import { KIND, dateParts, stateOf, type Pass } from './shared';

/** A page of the family's gate passes: a card for each with its day, kind, state and the gate times. */
export function PassItems({ items, lang }: { items: Pass[]; lang: Lang }) {
  const passes = items;
  return (
    <>
      {passes.map((p) => {
        const d = dateParts(p.onDate);
        const [label, tone] = stateOf(p);
        return (
          <Card key={p.id} elevated style={{ marginBottom: 'var(--sp-3)' }}>
            <div className="ep-apt">
              <div className="ep-apt__date">
                <span className="ep-apt__day">{d.day}</span>
                <span className="ep-apt__month">{d.month}</span>
                {p.atTime ? <span className="ep-apt__time">{p.atTime}</span> : null}
              </div>
              <div className="ep-apt__body">
                <div className="ep-apt__top">
                  <a className="ep-apt__title" href={`/gate-passes/${p.id}`}>
                    {t(lang, KIND[p.kind])}
                  </a>
                  <Badge tone={tone}>{t(lang, label)}</Badge>
                </div>
                <div>{p.reason}</div>
                <div className="ep-kicker">
                  {[
                    p.number,
                    studentLabel(p, t(lang, 'Adm. no.')),
                    p.escortName
                      ? `${t(lang, 'With')} ${p.escortName}${p.escortRelation ? ` (${p.escortRelation})` : ''}`
                      : null,
                    p.state === 'pending' && p.waitingOn
                      ? `${t(lang, 'Waiting on')} ${p.waitingOn}`
                      : null,
                    p.outAt ? `${t(lang, 'Gate out')} ${timeOf(p.outAt)}` : null,
                    p.inAt ? `${t(lang, 'Gate in')} ${timeOf(p.inAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="ep-apt__actions">
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/gate-passes/${p.id}`}
                    aria-label={`${t(lang, p.passNo ? 'Details and gate pass' : 'Details')} ${p.number}`}
                  >
                    {t(lang, p.passNo ? 'Details and gate pass' : 'Details')}
                  </a>
                  {['pending', 'approved'].includes(p.state) ? (
                    <form action={cancelGatePass}>
                      <input type="hidden" name="id" value={p.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={`${t(lang, 'Cancel')} ${p.number}`}
                      >
                        {t(lang, 'Cancel')}
                      </Button>
                    </form>
                  ) : null}
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </>
  );
}
