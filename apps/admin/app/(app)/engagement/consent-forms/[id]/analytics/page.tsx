import { Breadcrumbs, Card, KpiTile, PageHeader } from '@edupro/ui';
import type { ConsentForm } from '@/components/consents/types';
import { apiFetch } from '@/lib/api';

interface Analytics {
  asked: number;
  answeredPupils: number;
  answeredStaff: number;
  responses: number;
  daily: Array<{ day: string; n: number }>;
  bySection: Array<{ section: string; asked: number; answered: number }>;
  byRespondent: {
    family: number;
    familyLink: number;
    staff: number;
    office: number;
    public: number;
  };
  approval: { waiting: number; approved: number; rejected: number } | null;
  fee: { raised: number; paid: number; pupils: number } | null;
  questions: Array<{
    key: string;
    label: string;
    type: string;
    answered: number;
    counts?: Array<{ option: string; n: number }>;
    stats?: { total: number; avg: number; min: number; max: number } | null;
  }>;
}
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** A labelled bar: the share of a whole, with the number beside it. */
function Bar({ label, n, of, navy }: { label: string; n: number; of: number; navy?: boolean }) {
  const p = pct(n, of);
  return (
    <div className="ep-cfa__row">
      <span>{label}</span>
      <span className="ep-cfa__track" role="img" aria-label={`${label}: ${n} of ${of} (${p}%)`}>
        <span
          className={`ep-cfa__fill${navy ? ' ep-cfa__fill--navy' : ''}`}
          style={{ display: 'block', width: `${p}%` }}
        />
      </span>
      <span>
        {n} <span className="ep-field__help">({p}%)</span>
      </span>
    </div>
  );
}

/**
 * A consent form at a glance (docs/design/28-consent-forms.md, part 3): the response rate overall and by
 * section, answers per day, who answered and how, approval, the fee raised and paid, and each question.
 */
export default async function ConsentAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [f, a] = await Promise.all([
    apiFetch<ConsentForm>(`/engagement/consent-forms/${id}`),
    apiFetch<Analytics>(`/engagement/consent-forms/${id}/analytics`),
  ]);
  const answered = a.answeredPupils + a.answeredStaff;
  const maxDay = Math.max(1, ...a.daily.map((d) => d.n));
  const ways: Array<[string, number]> = [
    ['Parent app', a.byRespondent.family],
    ['Public link (families)', a.byRespondent.familyLink],
    ['Staff app', a.byRespondent.staff],
    ['Office (paper form)', a.byRespondent.office],
    ['Public link (outsiders)', a.byRespondent.public],
  ];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Consent forms', href: '/engagement/consent-forms' },
          { label: f.title, href: `/engagement/consent-forms/${id}` },
          { label: 'Analytics' },
        ]}
      />
      <PageHeader kicker="Analytics" title={f.title} />
      <div className="ep-cf-stats">
        <KpiTile label="Asked" value={a.asked} />
        <KpiTile label="Answered" value={answered} hint={`${pct(answered, a.asked)}%`} />
        <KpiTile label="Not yet answered" value={Math.max(0, a.asked - answered)} />
        <KpiTile
          label="Responses"
          value={a.responses}
          hint={a.byRespondent.public ? `${a.byRespondent.public} outsiders` : undefined}
        />
        {a.fee ? (
          <KpiTile
            label="Fee raised"
            value={inr(a.fee.raised)}
            hint={`paid ${inr(a.fee.paid)} · ${a.fee.pupils} pupils`}
          />
        ) : null}
      </div>

      <div
        className="ep-grid-cards"
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))',
        }}
      >
        <Card title="Answers per day">
          {a.daily.length ? (
            <>
              <div
                className="ep-cfa__days"
                role="img"
                aria-label={`Answers per day: ${a.daily.map((d) => `${d.day} ${d.n}`).join(', ')}`}
              >
                {a.daily.map((d) => (
                  <span
                    key={d.day}
                    className="ep-cfa__day"
                    title={`${d.day}: ${d.n}`}
                    style={{ height: `${Math.max(4, Math.round((d.n / maxDay) * 100))}%` }}
                  />
                ))}
              </div>
              <p className="ep-field__help">
                From {a.daily[0]!.day} to {a.daily[a.daily.length - 1]!.day} · busiest day {maxDay}
              </p>
            </>
          ) : (
            <p className="ep-field__help">No answers yet.</p>
          )}
        </Card>
        <Card title="How they answered">
          <div className="ep-cfa">
            {ways
              .filter(([, n]) => n > 0)
              .map(([l, n]) => (
                <Bar key={l} label={l} n={n} of={a.responses} navy />
              ))}
            {a.responses === 0 ? <p className="ep-field__help">No answers yet.</p> : null}
          </div>
          {a.approval ? (
            <div className="ep-cfa" style={{ marginTop: 'var(--sp-4)' }}>
              <strong>Approval</strong>
              <Bar label="Waiting" n={a.approval.waiting} of={a.responses} />
              <Bar label="Approved" n={a.approval.approved} of={a.responses} />
              <Bar label="Not approved" n={a.approval.rejected} of={a.responses} />
            </div>
          ) : null}
        </Card>
      </div>

      {a.bySection.length ? (
        <Card title="Response rate by section" style={{ marginTop: 'var(--sp-4)' }}>
          <div className="ep-cfa">
            {a.bySection.map((s) => (
              <Bar
                key={s.section}
                label={`${s.section} (${s.asked})`}
                n={s.answered}
                of={s.asked}
              />
            ))}
          </div>
        </Card>
      ) : null}

      <Card title="The answers, question by question" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="ep-cfb">
          {a.questions.map((q) => (
            <section key={q.key} aria-label={q.label} className="ep-cfa">
              <strong>
                {q.label} <span className="ep-field__help">· {q.answered} answered</span>
              </strong>
              {q.counts ? (
                q.counts.map((c) => <Bar key={c.option} label={c.option} n={c.n} of={q.answered} />)
              ) : q.stats ? (
                <p style={{ margin: 0 }}>
                  Total {q.stats.total} · average {q.stats.avg} · least {q.stats.min} · most{' '}
                  {q.stats.max}
                </p>
              ) : (
                <p className="ep-field__help" style={{ margin: 0 }}>
                  Written answers: read them in the register or the Excel.
                </p>
              )}
            </section>
          ))}
        </div>
      </Card>
    </>
  );
}
