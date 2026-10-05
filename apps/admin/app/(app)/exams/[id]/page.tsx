import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  DataTable,
  FormActions,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { lockExamSubjects, setExamParts, setExamSubjects, updateExam } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Exam, ExamClass, ExamSubject, SubjectRow } from '@/lib/types';

/** Sprint 14: one exam: classes, subjects per class with max and pass marks, entry locks. */
export default async function ExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; classId?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, x, me, exam, subjects] = await Promise.all([
    getTranslations('pages.exams_detail'),
    getTranslations('exams'),
    getMe(),
    apiFetch<Exam>(`/exams/${id}`),
    apiFetch<{ data: SubjectRow[] }>('/academics/subjects?size=200')
      .then((r) => r.data)
      .catch(() => [] as SubjectRow[]),
  ]);
  const canManage = me.permissions.includes('exams.master.manage');
  const classId = sp.classId ?? exam.classes[0]?.classId ?? '';
  const rows = (exam.subjects ?? []).filter((s) => s.classId === classId);
  const byId = new Map(rows.map((s) => [s.subjectId, s]));
  const anyLocked = rows.some((s) => s.entryLocked);
  return (
    <>
      <Breadcrumbs items={[{ label: t('kicker'), href: '/exams' }, { label: exam.name }]} />
      <PageHeader
        kicker={t('kicker')}
        title={`${exam.name} · ${exam.code}`}
        description={`${exam.examTypeName}${exam.startsOn ? ` · ${exam.startsOn}` : ''}${exam.endsOn ? ` – ${exam.endsOn}` : ''}`}
        actions={
          canManage ? (
            <form action={updateExam} style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <input type="hidden" name="id" value={exam.id} />
              <input type="hidden" name="marksLocked" value={exam.marksLocked ? 'no' : 'yes'} />
              <Button type="submit" variant={exam.marksLocked ? 'secondary' : 'primary'}>
                {exam.marksLocked ? x('unlockExam') : x('lockExam')}
              </Button>
            </form>
          ) : null
        }
      />
      <Notice params={sp} />
      <Card title={x('classes')}>
        <DataTable<ExamClass>
          caption={x('classes')}
          density="dense"
          columns={[
            {
              key: 'class',
              header: x('chooseClass'),
              render: (k) => <strong>{k.classCode}</strong>,
            },
            { key: 'scale', header: x('gradeScale'), render: (k) => k.gradeScaleCode ?? '—' },
            { key: 'n', header: x('subjects'), numeric: true, render: (k) => k.subjects },
            { key: 'locked', header: x('locked'), numeric: true, render: (k) => k.locked },
            {
              key: 'open',
              header: '',
              render: (k) => (
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/exams/${exam.id}?classId=${k.classId}`}
                >
                  {x('open')}
                </a>
              ),
            },
          ]}
          rows={exam.classes}
          rowKey={(k) => k.classId}
          emptyTitle={x('noExams')}
        />
      </Card>
      {classId ? (
        <Card
          title={`${x('subjects')} · ${exam.classes.find((k) => k.classId === classId)?.classCode ?? ''}`}
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <DataTable<ExamSubject>
            caption={x('subjects')}
            density="dense"
            columns={[
              {
                key: 'subject',
                header: x('subject'),
                render: (s) => `${s.subjectCode} · ${s.subjectName}`,
              },
              { key: 'max', header: x('maxMarks'), numeric: true, render: (s) => s.maxMarks },
              {
                key: 'pass',
                header: x('passMarks'),
                numeric: true,
                render: (s) => s.passMarks ?? '—',
              },
              { key: 'on', header: x('examOn'), render: (s) => s.examOn ?? '—' },
              { key: 'el', header: x('elective'), render: (s) => (s.isElective ? '✓' : '') },
              {
                key: 'lock',
                header: x('entryLocked'),
                render: (s) =>
                  s.entryLocked ? (
                    <Badge tone="warning">
                      {x('locked')}
                      {s.lockedBy ? ` · ${s.lockedBy}` : ''}
                    </Badge>
                  ) : (
                    '—'
                  ),
              },
            ]}
            rows={rows}
            rowKey={(s) => s.id}
            emptyTitle={x('noSubjects')}
          />
          {canManage && !exam.marksLocked ? (
            <>
              <form action={setExamSubjects} style={{ marginTop: 'var(--sp-3)' }}>
                <input type="hidden" name="id" value={exam.id} />
                <input type="hidden" name="classId" value={classId} />
                <p className="ep-field__help">{x('subjectsHelp')}</p>
                <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>{x('subject')}</th>
                      <th>{x('maxMarks')}</th>
                      <th>{x('passMarks')}</th>
                      <th>{x('examOn')}</th>
                      <th>{x('elective')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjects.map((s) => {
                      const cur = byId.get(s.id);
                      return (
                        <tr key={s.id}>
                          <td>
                            <input type="hidden" name="subjectId" value={s.id} />
                            {s.code} · {s.name}
                          </td>
                          <td>
                            <input
                              className="ep-input"
                              name="maxMarks"
                              aria-label={x('maxMarks')}
                              type="number"
                              min={0}
                              max={1000}
                              step="0.5"
                              defaultValue={cur?.maxMarks ?? ''}
                            />
                          </td>
                          <td>
                            <input
                              className="ep-input"
                              name="passMarks"
                              aria-label={x('passMarks')}
                              type="number"
                              min={0}
                              max={1000}
                              step="0.5"
                              defaultValue={cur?.passMarks ?? ''}
                            />
                          </td>
                          <td>
                            <input
                              className="ep-input"
                              name="examOn"
                              aria-label={x('examOn')}
                              type="date"
                              defaultValue={cur?.examOn ?? ''}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              name="elective"
                              value={s.id}
                              aria-label={x('elective')}
                              defaultChecked={cur?.isElective ?? false}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <FormActions>
                  <Button type="submit">{x('saveSubjects')}</Button>
                </FormActions>
              </form>
              <form action={lockExamSubjects} style={{ marginTop: 'var(--sp-2)' }}>
                <input type="hidden" name="id" value={exam.id} />
                <input type="hidden" name="classId" value={classId} />
                <SelectField
                  id="locked"
                  name="locked"
                  label={x('entryLocked')}
                  defaultValue={anyLocked ? 'no' : 'yes'}
                  options={[
                    { value: 'yes', label: x('lockAll') },
                    { value: 'no', label: x('unlockAll') },
                  ]}
                />
                <FormActions>
                  <Button type="submit" variant="secondary">
                    {x('entryLocked')}
                  </Button>
                </FormActions>
              </form>
            </>
          ) : null}
        </Card>
      ) : null}
      {canManage && rows.length ? (
        <Card title="Subjects entered in parts" style={{ marginTop: 'var(--sp-5)' }}>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Leave a subject as one figure, or split it: <strong>Theory</strong> and{' '}
            <strong>Practical</strong>, or one part per teaching subject under it (Science entered
            as Physics, Chemistry and Biology, each by its own teacher). The subject’s maximum
            becomes the sum of its parts, and the report card shows the total. Clear every row to go
            back to one figure.
          </p>
          {rows.map((r) => {
            const parts = r.parts ?? [];
            const kids = r.children ?? [];
            // what is there; else the teaching subjects under it as a suggestion; then blank rows up to four
            const lines: Array<{ id: string; name: string; subjectId: string; max: string }> =
              parts.length
                ? parts.map((p) => ({
                    id: p.id,
                    name: p.name,
                    subjectId: p.subjectId ?? '',
                    max: String(Number(p.maxMarks)),
                  }))
                : kids.map((k) => ({ id: '', name: k.name, subjectId: k.id, max: '' }));
            while (lines.length < Math.max(4, parts.length + 1))
              lines.push({ id: '', name: '', subjectId: '', max: '' });
            return (
              <form
                key={r.id}
                action={setExamParts}
                className="ep-hd__form"
                style={{ marginBottom: 'var(--sp-4)' }}
              >
                <input type="hidden" name="examId" value={exam.id} />
                <input type="hidden" name="classId" value={classId} />
                <input type="hidden" name="examSubjectId" value={r.id} />
                <h3 className="ep-cdash__h3">
                  {r.subjectCode} · {r.subjectName} · maximum {Number(r.maxMarks)}{' '}
                  {parts.length ? (
                    <Badge tone="info">{parts.length} parts</Badge>
                  ) : (
                    <Badge tone="neutral">One figure</Badge>
                  )}
                </h3>
                {lines.map((l, n) => (
                  <div key={String(n)} className="ep-hd__row">
                    <input type="hidden" name="partId" value={l.id} />
                    <label className="ep-field" htmlFor={`pt-name-${r.id}-${String(n)}`}>
                      <span className="ep-field__label">Part {n + 1}</span>
                      <input
                        id={`pt-name-${r.id}-${String(n)}`}
                        name="partName"
                        className="ep-input"
                        maxLength={60}
                        defaultValue={l.name}
                        placeholder={n === 0 ? 'Theory' : n === 1 ? 'Practical' : ''}
                      />
                    </label>
                    <label className="ep-field" htmlFor={`pt-sub-${r.id}-${String(n)}`}>
                      <span className="ep-field__label">Entered by the teacher of</span>
                      <select
                        id={`pt-sub-${r.id}-${String(n)}`}
                        name="partSubject"
                        className="ep-select"
                        defaultValue={l.subjectId}
                      >
                        <option value="">{r.subjectName} (the subject itself)</option>
                        {kids.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.code} · {k.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="ep-field" htmlFor={`pt-max-${r.id}-${String(n)}`}>
                      <span className="ep-field__label">Maximum marks</span>
                      <input
                        id={`pt-max-${r.id}-${String(n)}`}
                        name="partMax"
                        type="number"
                        className="ep-input"
                        min={0}
                        max={1000}
                        step="0.5"
                        defaultValue={l.max}
                      />
                    </label>
                  </div>
                ))}
                <p className="ep-field__help" style={{ margin: 0 }}>
                  A row counts when it has a name and a maximum.
                  {parts.some((p) => p.entered)
                    ? ' Marks are already entered: a part with marks cannot be removed.'
                    : ''}
                </p>
                <div>
                  <Button type="submit" variant="secondary" disabled={r.entryLocked}>
                    Save the parts of {r.subjectCode}
                  </Button>
                </div>
              </form>
            );
          })}
        </Card>
      ) : null}
    </>
  );
}
