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
import { MasterExport } from '@/components/MasterExport';
import { ExamSetupNav } from '@/components/exams/ExamSetupNav';
import { Notice } from '@/components/Notice';
import { createExamType, saveGradeScale, updateExamType } from '@/lib/actions';
import { installGradeScalePresets, saveMarkCode } from '@/lib/exam-entry-actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ExamType, GradeScale } from '@/lib/types';

/** Sprint 14: exam types and grade scales; `?type=CODE` opens a type to change, `?scale=CODE` a scale. */
export default async function ExamMastersPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    scale?: string;
    type?: string;
  }>;
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
  // the marks codes and what each does to a result (docs/design/65)
  const codes = await apiFetch<{
    data: Array<{
      id: string;
      code: string;
      name: string;
      treatment: string;
      value: string | null;
      blocksResult: boolean;
      sortOrder: number;
      status: string;
    }>;
  }>('/exams/mark-codes')
    .then((r) => r.data)
    .catch(() => []);
  const canManage = me.permissions.includes('exams.master.manage');
  const editingType = types.find((r) => r.code === sp.type) ?? null;
  const editing = scales.find((s) => s.code === sp.scale) ?? null;
  const bandRows = editing ? editing.bands : [];
  const blanks = Math.max(0, 8 - bandRows.length);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <ExamSetupNav current="/exams/masters" />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        <Card title={x('types')} actions={<MasterExport master="exam_types" label={x('types')} />}>
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
              {
                key: 'edit',
                header: '',
                render: (r) =>
                  canManage ? (
                    <a
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      href={`/exams/masters?type=${encodeURIComponent(r.code)}`}
                      aria-label={x('editType', { code: r.code })}
                      aria-current={editingType?.id === r.id ? 'true' : undefined}
                    >
                      {x('edit')}
                    </a>
                  ) : null,
              },
            ]}
            rows={types}
            rowKey={(r) => r.id}
            emptyTitle={x('noTypes')}
          />
          {canManage && editingType ? (
            <form action={updateExamType} style={{ marginTop: 'var(--sp-3)' }}>
              <input type="hidden" name="id" value={editingType.id} />
              <input type="hidden" name="code" value={editingType.code} />
              <h4 className="ep-card__title" style={{ marginTop: 0 }}>
                {x('editType', { code: editingType.code })}
              </h4>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                {x('typeCodeFixed')}
              </p>
              <FormRow columns={4}>
                <InputField
                  id="typeName"
                  name="name"
                  label={x('name')}
                  required
                  minLength={2}
                  maxLength={80}
                  defaultValue={editingType.name}
                />
                <InputField
                  id="typeWeightage"
                  name="weightage"
                  label={x('weightage')}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  defaultValue={editingType.weightage ?? ''}
                />
                <InputField
                  id="typeOrder"
                  name="sortOrder"
                  label={x('order')}
                  type="number"
                  min={0}
                  max={1000}
                  defaultValue={String(editingType.sortOrder)}
                />
                <label className="ep-field" htmlFor="typeStatus">
                  <span className="ep-field__label">{c('status')}</span>
                  <select
                    id="typeStatus"
                    name="status"
                    className="ep-select"
                    defaultValue={editingType.status}
                  >
                    <option value="active">{c('active')}</option>
                    <option value="inactive">{c('inactive')}</option>
                  </select>
                </label>
              </FormRow>
              <FormActions>
                <Button type="submit">{x('saveType')}</Button>
                <a className="ep-btn ep-btn--ghost" href="/exams/masters">
                  {c('cancel')}
                </a>
              </FormActions>
            </form>
          ) : null}
          {canManage && !editingType ? (
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
        <Card
          title={x('scales')}
          actions={<MasterExport master="grade_bands" label={x('bands')} />}
        >
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
          {canManage ? (
            <form action={installGradeScalePresets} style={{ marginTop: 'var(--sp-3)' }}>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                Ready-made scales: CBSE 8-point A1 to E (VI-XII), primary A* to D (I-V) and the
                co-scholastic A to C (for grade-only subjects). A scale you already have is left
                alone.
              </p>
              <Button type="submit" variant="secondary">
                Add the ready-made scales
              </Button>
            </form>
          ) : null}
        </Card>
        <Card title="Marks codes">
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Written in place of marks. Each says what it does to a result: counted as 0, left out of
            the maximum, fixed marks or a % of the maximum (pro-rata comes from the other exams of a
            term); a code that fails the subject holds the result (AB).
          </p>
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Marks codes</caption>
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Name</th>
                  <th scope="col">In a result</th>
                  <th scope="col">Fails the subject</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <strong>{k.code}</strong>
                    </td>
                    <td>{k.name}</td>
                    <td>
                      {TREATMENT[k.treatment] ?? k.treatment}
                      {k.value
                        ? ` (${String(Number(k.value))}${k.treatment === 'percent' ? ' %' : ''})`
                        : ''}
                    </td>
                    <td>{k.blocksResult ? 'Yes' : 'No'}</td>
                    <td>
                      <Badge tone={toneForStatus(k.status)}>{k.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canManage ? (
            <form action={saveMarkCode} style={{ marginTop: 'var(--sp-3)' }}>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                Add a code, or change one by writing its code again.
              </p>
              <FormRow>
                <InputField id="mc-code" name="code" label="Code" required maxLength={12} />
                <InputField id="mc-name" name="name" label="Name" required maxLength={60} />
              </FormRow>
              <FormRow>
                <label className="ep-field" htmlFor="mc-treatment">
                  <span className="ep-field__label">In a result</span>
                  <select
                    id="mc-treatment"
                    name="treatment"
                    className="ep-select"
                    defaultValue="exclude"
                  >
                    {Object.entries(TREATMENT).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <InputField
                  id="mc-value"
                  name="value"
                  label="Marks or % (fixed / % only)"
                  type="number"
                  min={0}
                  step="0.5"
                />
              </FormRow>
              <FormRow>
                <label className="ep-field" htmlFor="mc-status">
                  <span className="ep-field__label">Status</span>
                  <select id="mc-status" name="status" className="ep-select" defaultValue="active">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
                <label className="ep-check" htmlFor="mc-blocks" style={{ alignSelf: 'end' }}>
                  <input id="mc-blocks" type="checkbox" name="blocksResult" /> Fails the subject
                </label>
              </FormRow>
              <FormActions>
                <Button type="submit">Save the code</Button>
              </FormActions>
            </form>
          ) : null}
        </Card>
      </div>
    </>
  );
}

const TREATMENT: Record<string, string> = {
  zero: 'Counted as 0',
  exclude: 'Out of the maximum',
  fixed: 'Fixed marks',
  percent: '% of the maximum',
  pro_rata: 'Pro-rata (term)',
};
