import { Alert, Badge, Button, Card, FormRow, InputField, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { AutoSubmit } from '@/components/AutoSubmit';
import { Notice } from '@/components/Notice';
import { ExamFrame } from '@/components/exams/ExamFrame';
import { ResultsHead } from '@/components/exams/ResultsHead';
import { apiFetch, getMe } from '@/lib/api';
import { recordExamPromotions } from '@/lib/exam-hub-actions';
import type { Exam, ExamProgress, PromotionProposals, Year } from '@/lib/types';

/**
 * Sprint 16: promotion proposals from the results, handed to the promotion register of the next year;
 * docs/design/66: in the Results tab, recording them keeps the page here.
 */
export default async function PromotionProposalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    classId?: string;
    minPct?: string;
    maxFailed?: string;
    toYearId?: string;
    recorded?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, x, r, me, exam, progress, years] = await Promise.all([
    getTranslations('pages.exams_promotion'),
    getTranslations('examHub.results'),
    getTranslations('results'),
    getMe(),
    apiFetch<Exam>(`/exams/${id}`),
    apiFetch<ExamProgress>(`/exams/${id}/progress`).catch(() => null),
    apiFetch<{ data: Year[] }>('/platform/years')
      .then((x) => x.data.filter((y) => y.kind === 'academic'))
      .catch(() => [] as Year[]),
  ]);
  const classId = sp.classId ?? exam.classes[0]?.classId;
  const minPct = sp.minPct && /^\d+(\.\d+)?$/.test(sp.minPct) ? sp.minPct : '33';
  const maxFailed = sp.maxFailed && /^\d+$/.test(sp.maxFailed) ? sp.maxFailed : '0';
  const proposals = classId
    ? await apiFetch<PromotionProposals>(
        `/exams/${id}/promotion-proposals?classId=${classId}&minPct=${minPct}&maxFailed=${maxFailed}`,
      )
    : null;
  const targets = years.filter(
    (y) => y.id !== me.academicYear?.id && (y.status === 'planned' || y.status === 'active'),
  );
  const toYearId = sp.toYearId ?? targets[0]?.id;
  const sections = toYearId
    ? await apiFetch<{
        data: Array<{ id: string; label: string; classId: string; order: number }>;
      }>(`/people/promotions/sections?yearId=${toYearId}`)
        .then((x) => x.data)
        .catch(() => [])
    : [];
  const canManage = me.permissions.includes('people.promotion.manage');
  return (
    <>
      <ExamFrame
        exam={exam}
        stage={progress?.stage ?? null}
        current="results"
        canManage={me.permissions.includes('exams.master.manage')}
        canLock={me.permissions.includes('exams.lock.manage')}
      />
      <ResultsHead
        examId={id}
        current="promotion"
        computedAt={proposals?.exam.computedAt ?? null}
        canCompute={me.permissions.includes('exams.master.manage')}
        back={`/exams/${id}/promotion?classId=${classId ?? ''}`}
      />
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {t('description')}
      </p>
      {sp.ok && sp.recorded ? (
        <Alert
          tone="success"
          action={
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/people/promotions?classId=${classId ?? ''}&toYearId=${toYearId ?? ''}`}
            >
              {x('openPromotions')}
            </a>
          }
        >
          {x('recorded', { n: Number(sp.recorded) || 0 })}
        </Alert>
      ) : null}
      {sp.recorded ? null : <Notice params={sp} />}
      <Card title={r('rule')} style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get">
          <AutoSubmit />
          <FormRow columns={4}>
            <SelectField
              id="classId"
              name="classId"
              label={r('class')}
              defaultValue={classId ?? ''}
              options={exam.classes.map((c) => ({ value: c.classId, label: c.classCode }))}
            />
            <InputField
              id="minPct"
              name="minPct"
              label={r('minPct')}
              type="number"
              min={0}
              max={100}
              step="0.5"
              defaultValue={minPct}
            />
            <InputField
              id="maxFailed"
              name="maxFailed"
              label={r('maxFailed')}
              type="number"
              min={0}
              max={10}
              defaultValue={maxFailed}
            />
            <SelectField
              id="toYearId"
              name="toYearId"
              label={r('targetYear')}
              defaultValue={toYearId ?? ''}
              options={targets.map((y) => ({ value: y.id, label: y.code }))}
            />
          </FormRow>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="submit" variant="secondary">
              {r('apply')}
            </Button>
          </div>
        </form>
      </Card>
      {proposals ? (
        <Card
          title={`${r('proposals')} · ${proposals.totals.promote} ${r('promote').toLowerCase()} · ${proposals.totals.retain} ${r('retain').toLowerCase()} · ${proposals.totals.review} ${r('review').toLowerCase()}`}
        >
          {!proposals.exam.computedAt ? <p className="ep-field__help">{r('notComputed')}</p> : null}
          {targets.length === 0 ? <p className="ep-field__help">{r('noTarget')}</p> : null}
          <form action={recordExamPromotions}>
            <input type="hidden" name="examId" value={id} />
            <input type="hidden" name="classId" value={classId ?? ''} />
            <input type="hidden" name="toYearId" value={toYearId ?? ''} />
            <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th />
                  <th>{r('pupil')}</th>
                  <th>{r('section')}</th>
                  <th style={{ textAlign: 'right' }}>{r('pct')}</th>
                  <th>{r('grade')}</th>
                  <th>{r('decision')}</th>
                  <th>{r('reason')}</th>
                  <th>{r('targetSection')}</th>
                </tr>
              </thead>
              <tbody>
                {proposals.proposals.map((p) => (
                  <tr key={p.studentId}>
                    <td>
                      <input
                        type="checkbox"
                        name="studentIds"
                        value={p.studentId}
                        aria-label={`${r('record')} · ${p.name}`}
                        defaultChecked={p.decision !== 'review' && canManage && targets.length > 0}
                        disabled={!canManage || p.decision === 'review' || targets.length === 0}
                      />
                      <input
                        type="hidden"
                        name={`decision:${p.studentId}`}
                        value={p.decision === 'review' ? '' : p.decision}
                      />
                    </td>
                    <td>
                      {p.name}
                      <div className="ep-kicker">{p.admissionNo}</div>
                    </td>
                    <td>{p.section}</td>
                    <td style={{ textAlign: 'right' }}>{p.pct ?? '—'}</td>
                    <td>{p.grade ?? ''}</td>
                    <td>
                      <Badge
                        tone={
                          p.decision === 'promote'
                            ? 'success'
                            : p.decision === 'retain'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {r(p.decision)}
                      </Badge>
                    </td>
                    <td className="ep-field__help">{p.reason}</td>
                    <td>
                      {p.decision === 'promote' && sections.length ? (
                        <select
                          className="ep-input"
                          name={`section:${p.studentId}`}
                          aria-label={`${r('targetSection')} · ${p.name}`}
                          defaultValue=""
                        >
                          <option value="">—</option>
                          {sections.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canManage && targets.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--sp-3)',
                  marginTop: 'var(--sp-3)',
                }}
              >
                <span className="ep-field__help">{r('recordHelp')}</span>
                <Button type="submit">{r('record')}</Button>
              </div>
            ) : null}
          </form>
        </Card>
      ) : null}
    </>
  );
}
