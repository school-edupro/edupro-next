import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { MarkScheme } from '@/lib/mark-schemes';
import { sendPromotions } from '@/lib/remark-actions';

interface Row {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  section: string;
  pct: number | null;
  division: string | null;
  result: string;
  proposal: 'promote' | 'retain' | 'graduate' | 'review';
  reason: string;
  proposedSectionId: string | null;
  proposedCard: string | null;
  decision: {
    decision: string;
    toClassSectionId: string | null;
    toSection: string | null;
    applied: boolean;
  } | null;
  promotedTo: string | null;
}
interface Proposals {
  scheme: { id: string; name: string; termCode: string };
  toYear: { id: string; code: string } | null;
  years: Array<{ id: string; code: string }>;
  sections: Array<{ id: string; label: string; classId: string }>;
  totals: Record<'promote' | 'review' | 'retain' | 'graduate', number>;
  rows: Row[];
}

const DECISIONS: Record<Row['proposal'], string> = {
  promote: 'Promote',
  review: 'Hold for review',
  retain: 'Retain',
  graduate: 'Passed out',
};
const RESULT: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  pass: { label: 'Pass', tone: 'success' },
  compartment: { label: 'Compartment', tone: 'warning' },
  fail: { label: 'Fail', tone: 'danger' },
  absent: { label: 'Absent', tone: 'warning' },
  incomplete: { label: 'Incomplete', tone: 'neutral' },
};

/**
 * Promotion proposals of a locked result scheme (docs/design/65, part 7): each student's term result
 * and what it proposes, next year's section and the card's "Promoted to"; the ticked rows go to People
 * → Promotions (applied there) and to the cards. A decision already applied is not changed.
 */
export default async function SchemePromotionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ toYearId?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('exams.marks.view')) notFound();
  const s = await apiFetch<MarkScheme>(`/exams/schemes/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const canSend = me.permissions.includes('people.promotion.manage');
  let p: Proposals | null = null;
  let error: string | null = null;
  try {
    p = await apiFetch<Proposals>(
      `/exams/schemes/${id}/promotion${sp.toYearId && /^\d{1,18}$/.test(sp.toYearId) ? `?toYearId=${sp.toYearId}` : ''}`,
    );
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error = typeof e.problem.detail === 'string' ? e.problem.detail : e.problem.type;
  }
  const back = `/exams/schemes/${id}/promotion${sp.toYearId ? `?toYearId=${sp.toYearId}` : ''}`;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: 'Mark schemes and registers', href: '/exams/schemes' },
          { label: s.name, href: `/exams/schemes/${s.id}` },
          { label: 'Promotion proposals' },
        ]}
      />
      <PageHeader
        kicker={`Mark scheme · ${s.termCode ?? ''}`}
        title={`Promotion proposals · ${s.name}`}
        description="Passed: promote to the next class. Compartment: hold for review until the supplementary result (the card says 'subject to compartment'). Failed: retain. Absent or incomplete: review. Change what is needed, tick the rows and send them."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/people/promotions">
            People → Promotions
          </a>
        }
      />
      <Notice params={sp} />
      {error ? (
        <Card>
          <div className="ep-alert ep-alert--danger" role="alert">
            {error}
          </div>
        </Card>
      ) : null}
      {p ? (
        <>
          <div
            style={{
              display: 'grid',
              gap: 'var(--sp-4)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              marginBottom: 'var(--sp-4)',
            }}
          >
            {(['promote', 'review', 'retain', 'graduate'] as const).map((k) => (
              <Card key={k} elevated>
                <div className="ep-kicker">{DECISIONS[k]}</div>
                <div
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontSize: 'var(--fs-h2)',
                    fontWeight: 600,
                  }}
                >
                  {p.totals[k]}
                </div>
              </Card>
            ))}
          </div>
          <Card style={{ marginBottom: 'var(--sp-4)' }}>
            <form
              method="get"
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'flex-end',
                flexWrap: 'wrap',
              }}
            >
              <label className="ep-field" style={{ minWidth: 200 }}>
                <span className="ep-field__label">Promote into the year</span>
                <select className="ep-select" name="toYearId" defaultValue={p.toYear?.id ?? ''}>
                  {p.years.length ? null : <option value="">No later year yet</option>}
                  {p.years.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.code}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="secondary">
                Show
              </Button>
            </form>
            {!p.toYear ? (
              <p className="ep-field__help" style={{ marginBottom: 0 }}>
                Next year is not set up yet: only the cards&rsquo; &ldquo;Promoted to&rdquo; is
                filled now. Send again once its sections exist.
              </p>
            ) : null}
          </Card>
          <Card elevated title={`${String(p.rows.length)} students`}>
            <form action={sendPromotions}>
              <input type="hidden" name="schemeId" value={s.id} />
              <input type="hidden" name="toYearId" value={p.toYear?.id ?? ''} />
              <input type="hidden" name="back" value={back} />
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Proposals">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Promotion proposals</caption>
                  <thead>
                    <tr>
                      <th scope="col">Send</th>
                      <th scope="col">Student</th>
                      <th scope="col">Result</th>
                      <th scope="col">Decision</th>
                      <th scope="col">Next year&rsquo;s section</th>
                      <th scope="col">The card says</th>
                      <th scope="col">Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.rows.map((r) => {
                      const applied = Boolean(r.decision?.applied);
                      const res = RESULT[r.result] ?? { label: r.result, tone: 'neutral' as const };
                      return (
                        <tr key={r.studentId}>
                          <td>
                            <input type="hidden" name="studentId" value={r.studentId} />
                            <label className="ep-check" htmlFor={`x-${r.studentId}`}>
                              <input
                                id={`x-${r.studentId}`}
                                type="checkbox"
                                className="ep-check__input"
                                name={`x-${r.studentId}`}
                                aria-label={`Send ${r.name}`}
                                defaultChecked={!applied}
                                disabled={applied || !canSend}
                              />
                              <span className="ep-check__box" aria-hidden="true" />
                            </label>
                          </td>
                          <td>
                            {r.rollNo ? `${String(r.rollNo)} · ` : ''}
                            {r.name}
                            <span className="ep-kicker" style={{ display: 'block' }}>
                              {r.section} · {r.admissionNo}
                            </span>
                          </td>
                          <td>
                            <Badge tone={res.tone}>{res.label}</Badge>
                            {r.pct !== null ? ` ${String(r.pct)}%` : ''}
                            <span className="ep-field__help" style={{ display: 'block' }}>
                              {r.reason}
                            </span>
                          </td>
                          <td>
                            <select
                              className="ep-select"
                              name={`d-${r.studentId}`}
                              aria-label={`Decision · ${r.name}`}
                              defaultValue={r.proposal}
                              disabled={applied || !canSend}
                            >
                              {Object.entries(DECISIONS).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              className="ep-select"
                              name={`s-${r.studentId}`}
                              aria-label={`Next year’s section · ${r.name}`}
                              defaultValue={
                                r.decision?.toClassSectionId ?? r.proposedSectionId ?? ''
                              }
                              disabled={applied || !canSend || !p.toYear}
                            >
                              <option value="">-</option>
                              {p.sections.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="ep-input"
                              name={`t-${r.studentId}`}
                              aria-label={`The card says · ${r.name}`}
                              maxLength={40}
                              defaultValue={r.promotedTo ?? r.proposedCard ?? ''}
                              disabled={!canSend}
                              style={{ minWidth: 220 }}
                            />
                          </td>
                          <td>
                            {r.decision ? (
                              <Badge tone={applied ? 'success' : 'info'}>
                                {applied ? 'Applied' : 'Sent'}: {r.decision.decision}
                                {r.decision.toSection ? ` → ${r.decision.toSection}` : ''}
                              </Badge>
                            ) : (
                              <span className="ep-field__help">not sent</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {canSend ? (
                <div className="ep-form-actions" style={{ marginTop: 'var(--sp-3)' }}>
                  <Button type="submit">Send the ticked rows</Button>
                </div>
              ) : (
                <p className="ep-field__help">
                  Sending needs the promotions right (coordinators and the school admin).
                </p>
              )}
            </form>
          </Card>
        </>
      ) : null}
    </>
  );
}
