import {
  Badge,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  toneForStatus,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createExamType, saveGradeScale } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ExamType, GradeScale } from '@/lib/types';

/** Sprint 14: exam types and grade scales. */
export default async function ExamMastersPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; scale?: string }>;
}) {
  const sp = await searchParams;
  const [t, x, c, me, types, scales] = await Promise.all([
    getTranslations('pages.exams_masters'),
    getTranslations('exams'),
    getTranslations('common'),
    getMe(),
    apiFetch<{ data: ExamType[] }>('/exams/types').then((r) => r.data),
    apiFetch<{ data: GradeScale[] }>('/exams/grade-scales').then((r) => r.data),
  ]);
  const canManage = me.permissions.includes('exams.master.manage');
  const editing = scales.find((s) => s.code === sp.scale) ?? null;
  const bandRows = editing ? editing.bands : [];
  const blanks = Math.max(0, 8 - bandRows.length);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        }}
      >
        <Card title={x('types')}>
          <DataTable<ExamType>
            caption={x('types')}
            density="dense"
            columns={[
              { key: 'code', header: x('code'), render: (r) => <strong>{r.code}</strong> },
              { key: 'name', header: x('name'), render: (r) => r.name },
              {
                key: 'w',
                header: x('weightage'),
                numeric: true,
                render: (r) => r.weightage ?? '—',
              },
              { key: 'n', header: x('examsCount'), numeric: true, render: (r) => r.exams },
              {
                key: 'status',
                header: c('status'),
                render: (r) => <Badge tone={toneForStatus(r.status)}>{c(r.status)}</Badge>,
              },
            ]}
            rows={types}
            rowKey={(r) => r.id}
            emptyTitle={x('noTypes')}
          />
          {canManage ? (
            <form action={createExamType} style={{ marginTop: 'var(--sp-3)' }}>
              <FormRow columns={4}>
                <InputField
                  id="code"
                  name="code"
                  label={x('code')}
                  required
                  pattern="[A-Za-z0-9_-]{2,20}"
                />
                <InputField id="name" name="name" label={x('name')} required maxLength={80} />
                <InputField
                  id="weightage"
                  name="weightage"
                  label={x('weightage')}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                />
                <InputField
                  id="sortOrder"
                  name="sortOrder"
                  label={x('order')}
                  type="number"
                  min={0}
                />
              </FormRow>
              <FormActions>
                <Button type="submit">{x('addType')}</Button>
              </FormActions>
            </form>
          ) : null}
        </Card>
        <Card title={x('scales')}>
          <DataTable<GradeScale>
            caption={x('scales')}
            density="dense"
            columns={[
              { key: 'code', header: x('code'), render: (r) => <strong>{r.code}</strong> },
              { key: 'name', header: x('name'), render: (r) => r.name },
              {
                key: 'bands',
                header: x('bands'),
                render: (r) =>
                  r.bands
                    .map(
                      (b) =>
                        `${b.grade} ${b.minPct}–${b.maxPct}${b.points ? ` (${b.points})` : ''}`,
                    )
                    .join(' · '),
              },
              {
                key: 'edit',
                header: '',
                render: (r) =>
                  canManage ? (
                    <a
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      href={`/exams/masters?scale=${r.code}`}
                    >
                      {x('open')}
                    </a>
                  ) : null,
              },
            ]}
            rows={scales}
            rowKey={(r) => r.id}
            emptyTitle={x('noScales')}
          />
          {canManage ? (
            <form action={saveGradeScale} style={{ marginTop: 'var(--sp-3)' }}>
              <p className="ep-field__help">{x('scaleHelp')}</p>
              <FormRow columns={3}>
                <InputField
                  id="scaleCode"
                  name="code"
                  label={x('code')}
                  required
                  pattern="[A-Za-z0-9_-]{2,20}"
                  defaultValue={editing?.code ?? ''}
                />
                <InputField
                  id="scaleName"
                  name="name"
                  label={x('name')}
                  required
                  maxLength={80}
                  defaultValue={editing?.name ?? ''}
                />
                <InputField
                  id="scaleDesc"
                  name="description"
                  label={c('name')}
                  maxLength={300}
                  defaultValue={editing?.description ?? ''}
                />
              </FormRow>
              <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>{x('grade')}</th>
                    <th>{x('minPct')}</th>
                    <th>{x('maxPct')}</th>
                    <th>{x('points')}</th>
                    <th>{x('remark')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...bandRows, ...Array.from({ length: blanks }, () => null)].map((b, i) => (
                    <tr key={b ? b.id : `new-${i}`}>
                      <td>
                        <input
                          className="ep-input"
                          name="grade"
                          aria-label={x('grade')}
                          defaultValue={b?.grade ?? ''}
                          maxLength={10}
                        />
                      </td>
                      <td>
                        <input
                          className="ep-input"
                          name="minPct"
                          aria-label={x('minPct')}
                          type="number"
                          min={0}
                          max={100}
                          step="0.01"
                          defaultValue={b?.minPct ?? ''}
                        />
                      </td>
                      <td>
                        <input
                          className="ep-input"
                          name="maxPct"
                          aria-label={x('maxPct')}
                          type="number"
                          min={0}
                          max={100}
                          step="0.01"
                          defaultValue={b?.maxPct ?? ''}
                        />
                      </td>
                      <td>
                        <input
                          className="ep-input"
                          name="points"
                          aria-label={x('points')}
                          type="number"
                          min={0}
                          max={10}
                          step="0.01"
                          defaultValue={b?.points ?? ''}
                        />
                      </td>
                      <td>
                        <input
                          className="ep-input"
                          name="remark"
                          aria-label={x('remark')}
                          defaultValue={b?.remark ?? ''}
                          maxLength={80}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <FormActions>
                <Button type="submit">{x('saveScale')}</Button>
              </FormActions>
            </form>
          ) : null}
        </Card>
      </div>
    </>
  );
}
