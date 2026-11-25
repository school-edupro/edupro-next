import { Badge, Card, Stars } from '@edupro/ui';
import { t, type Lang } from '@/lib/i18n';

export interface Query {
  id: string;
  number: string;
  kind: 'query' | 'complaint' | 'leave';
  categoryName: string;
  studentName: string;
  subject: string;
  status: 'open' | 'in_progress' | 'answered' | 'closed';
  decision: string | null;
  rating: number | null;
  openedAt: string;
}
export const TONE: Record<Query['status'], 'warning' | 'info' | 'success' | 'neutral'> = {
  open: 'warning',
  in_progress: 'info',
  answered: 'success',
  closed: 'neutral',
};
export const LABEL: Record<Query['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  answered: 'Answered',
  closed: 'Closed',
};
export const KIND: Record<Query['kind'], string> = {
  query: 'Query',
  complaint: 'Complaint',
  leave: 'Leave request',
};

/** A page of the family's queries, complaints and leave requests: a card for each, opening it in full. */
export function QueryItems({ items, lang }: { items: Query[]; lang: Lang }) {
  const queries = items;
  return (
    <>
      {queries.map((q) => (
        <a key={q.id} href={`/queries/${q.id}`} style={{ textDecoration: 'none' }}>
          <Card elevated style={{ marginBottom: 'var(--sp-3)' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 'var(--sp-2)',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 600,
                    color: 'var(--text-heading)',
                  }}
                >
                  {q.subject}
                </div>
                <div className="ep-kicker">
                  {q.number} · {t(lang, KIND[q.kind])} · {q.categoryName} · {q.studentName} ·{' '}
                  {new Date(q.openedAt).toLocaleDateString('en-IN')}
                </div>
              </div>
              <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                <Badge tone={TONE[q.status]}>{t(lang, LABEL[q.status])}</Badge>
                {q.decision ? (
                  <Badge tone={q.decision === 'approved' ? 'success' : 'danger'}>
                    {t(lang, q.decision)}
                  </Badge>
                ) : null}
                {q.rating ? <Stars value={q.rating} /> : null}
              </span>
            </div>
          </Card>
        </a>
      ))}
    </>
  );
}
