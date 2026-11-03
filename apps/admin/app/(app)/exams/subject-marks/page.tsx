import { Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { ExamSetupNav } from '@/components/exams/ExamSetupNav';
import { SubjectMarksEditor } from '@/components/exams/SubjectMarksEditor';
import { apiFetch, getMe } from '@/lib/api';
import {
  copySubjectMarks,
  fillSubjectMarks,
  lastYearSubjectMarks,
  type SubjectMarksRow,
} from '@/lib/subject-marks-actions';
import type { Exam, GradeScale } from '@/lib/types';

interface Overview {
  types: Array<{ id: string; code: string; name: string }>;
  classes: Array<{ id: string; code: string; name: string }>;
  cells: Array<{ typeId: string; classId: string; subjects: number }>;
}

/**
 * Subject marks (docs/design/70, part 1), the legacy's Subject Master: for each exam type and class of
 * the year, the subjects its exams hold with the maximum and pass marks, a graded subject's scale and
 * Optional. The overview shows what is set; a type and a class open the list; copy it to other classes
 * or exam types, fill it from an exam already set up, or start from last year's.
 */
export default async function SubjectMarksPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    class?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const [me, ov, scales, exams] = await Promise.all([
    getMe(),
    apiFetch<Overview>('/exams/subject-marks/overview'),
    apiFetch<{ data: GradeScale[] }>('/exams/grade-scales').then((r) => r.data),
    apiFetch<{ data: Exam[] }>('/exams').then((r) => r.data),
  ]);
  const canManage = me.permissions.includes('exams.master.manage');
  const type = ov.types.find((x) => x.id === sp.type) ?? null;
  const klass = ov.classes.find((x) => x.id === sp.class) ?? null;
  const list =
    type && klass
      ? await apiFetch<{
          rows: SubjectMarksRow[];
          studied: Array<{ id: string; code: string; name: string; elective: boolean }>;
          updatedAt: string | null;
          updatedBy: string | null;
        }>(`/exams/subject-marks?typeId=${type.id}&classId=${klass.id}`)
      : null;
  const count = (t: string, k: string) =>
    ov.cells.find((x) => x.typeId === t && x.classId === k)?.subjects ?? 0;
  const href = (t: string, k: string) => `/exams/subject-marks?type=${t}&class=${k}`;
  const title = type && klass ? `${type.code} · ${klass.name}` : '';
  const ofType = type ? exams.filter((e) => e.examTypeId === type.id) : [];
  return (
    <>
      <Breadcrumbs items={[{ label: 'Exams', href: '/exams' }, { label: 'Subject marks' }]} />
      <PageHeader
        kicker="Exam set-up"
        title="Subject marks"
        description="Each exam type's subjects for a class with their maximum and pass marks, a graded subject's scale and Optional. Every exam of the type takes its papers and marks from here."
      />
      <ExamSetupNav current="/exams/subject-marks" />
      <Notice params={sp} />
      <Card title="What is set" style={{ marginBottom: 'var(--sp-4)' }}>
        {!ov.types.length ? (
          <p style={{ margin: 0 }}>
            No exam type yet: add them in{' '}
            <a href="/exams/masters">Types, grade scales, marks codes</a>.
          </p>
        ) : (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Subject marks by exam type and class"
          >
            <table className="ep-table ep-table--dense ep-sm-grid">
              <caption className="ep-sr-only">Subjects set for each exam type and class</caption>
              <thead>
                <tr>
                  <th scope="col">Exam type</th>
                  {ov.classes.map((k) => (
                    <th key={k.id} scope="col">
                      {k.code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ov.types.map((t) => (
                  <tr key={t.id}>
                    <th scope="row">
                      {t.code}
                      <span className="ep-mr-col__desc">{t.name}</span>
                    </th>
                    {ov.classes.map((k) => {
                      const n = count(t.id, k.id);
                      const here = type?.id === t.id && klass?.id === k.id;
                      return (
                        <td key={k.id} data-set={n ? 'true' : undefined}>
                          <a
                            href={href(t.id, k.id)}
                            aria-current={here ? 'true' : undefined}
                            aria-label={`${t.code} · ${k.name}: ${n ? `${String(n)} subjects` : 'not set'}`}
                          >
                            {n ? String(n) : '—'}
                          </a>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="ep-field__help" style={{ marginBottom: 0 }}>
          A number is the subjects set; — is not set. Open a cell to see or change its list.
        </p>
      </Card>
      {type && klass && list ? (
        <>
          <Card
            title={`${type.code} · ${type.name} · ${klass.name}`}
            actions={
              <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/api/subject-marks/${type.id}/xlsx`}
                >
                  Excel ({type.code})
                </a>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/api/subject-marks/${type.id}/pdf`}
                  target="_blank"
                  rel="noopener"
                >
                  PDF ({type.code})
                </a>
              </span>
            }
            style={{ marginBottom: 'var(--sp-4)' }}
          >
            {list.updatedAt ? (
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                Last changed{' '}
                {new Intl.DateTimeFormat('en-IN', {
                  timeZone: 'Asia/Kolkata',
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                }).format(new Date(list.updatedAt))}
                {list.updatedBy ? ` by ${list.updatedBy}` : ''}
              </p>
            ) : null}
            <SubjectMarksEditor
              key={`${type.id}-${klass.id}`}
              typeId={type.id}
              classId={klass.id}
              title={title}
              initial={list.rows}
              studied={list.studied}
              scales={scales.map((g) => ({ id: g.id, code: g.code, name: g.name }))}
              canManage={canManage}
            />
          </Card>
          {canManage ? (
            <Card title="Copy and fill" style={{ marginBottom: 'var(--sp-4)' }}>
              <div className="ep-sm-tools">
                <form action={copySubjectMarks} className="ep-streg-form">
                  <input type="hidden" name="typeId" value={type.id} />
                  <input type="hidden" name="classId" value={klass.id} />
                  <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="ep-field__label">
                      Copy this list to other classes ({type.code}; only the subjects each studies)
                    </legend>
                    <div className="ep-mr-tiles">
                      {ov.classes
                        .filter((k) => k.id !== klass.id)
                        .map((k) => (
                          <label key={k.id} className="ep-mr-tile">
                            <input type="checkbox" name="toClassId" value={k.id} />
                            <span>{k.code}</span>
                          </label>
                        ))}
                    </div>
                  </fieldset>
                  <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="ep-field__label">
                      …and to other exam types ({klass.name})
                    </legend>
                    <div className="ep-mr-tiles">
                      {ov.types
                        .filter((t) => t.id !== type.id)
                        .map((t) => (
                          <label key={t.id} className="ep-mr-tile">
                            <input type="checkbox" name="toTypeId" value={t.id} />
                            <span>
                              {t.code}
                              <small>{t.name}</small>
                            </span>
                          </label>
                        ))}
                    </div>
                  </fieldset>
                  <p className="ep-field__help" style={{ margin: 0 }}>
                    A subject already there takes these marks; the others there stay.
                  </p>
                  <div>
                    <button
                      type="submit"
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      disabled={!list.rows.length}
                    >
                      Copy
                    </button>
                  </div>
                </form>
                <form action={fillSubjectMarks} className="ep-streg-form">
                  <input type="hidden" name="typeId" value={type.id} />
                  <input type="hidden" name="classId" value={klass.id} />
                  <label className="ep-field" style={{ margin: 0 }}>
                    <span className="ep-field__label">Fill from an exam already set up</span>
                    <select
                      className="ep-select"
                      name="examId"
                      required
                      defaultValue={ofType[0]?.id ?? ''}
                    >
                      <option value="">Choose the exam</option>
                      {exams.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.code} · {e.name} ({e.examTypeCode})
                        </option>
                      ))}
                    </select>
                    <span className="ep-field__help">
                      Every class of the exam: its subjects and marks become the list of the
                      exam&apos;s type.
                    </span>
                  </label>
                  <div>
                    <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                      Fill
                    </button>
                  </div>
                </form>
                <form action={lastYearSubjectMarks} className="ep-streg-form">
                  <input type="hidden" name="typeId" value={type.id} />
                  <input type="hidden" name="classId" value={klass.id} />
                  <p className="ep-field__label" style={{ margin: 0 }}>
                    Last year&apos;s lists
                  </p>
                  <p className="ep-field__help" style={{ margin: 0 }}>
                    Copies {type.code}&apos;s lists of last year into this year, every class; what
                    is set already stays.
                  </p>
                  <div>
                    <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                      Copy from last year
                    </button>
                  </div>
                </form>
              </div>
            </Card>
          ) : null}
        </>
      ) : ov.types.length ? (
        <p className="ep-field__help">
          Open a cell above to see or set an exam type&apos;s list for a class.
        </p>
      ) : null}
    </>
  );
}
