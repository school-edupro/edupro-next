import { Alert, Button, Card, FormActions } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Notice } from '@/components/Notice';
import { DateSheetEditor, type PaperRow } from '@/components/exams/DateSheetEditor';
import { AreaTicks } from '@/components/exams/AreaTicks';
import { ExamFrame } from '@/components/exams/ExamFrame';
import { ExamSubjectsEditor, type EditorRow } from '@/components/exams/ExamSubjectsEditor';
import { apiFetch, getMe } from '@/lib/api';
import { fillMasterFromExam, saveExamDetails } from '@/lib/exam-hub-actions';
import type {
  ClassRow,
  Exam,
  ExamProgress,
  ExamSubject,
  GradeScale,
  Page,
  SubjectRow,
} from '@/lib/types';

type Step = 'details' | 'subjects' | 'dates';
const num = (v: string | null | undefined) => (v == null ? '' : String(Number(v)));

/**
 * An exam's set-up in three steps (docs/design/66): its details and classes; each class's subjects
 * with their marks, parts and progress card set (filled in from what the class studies the first
 * time); and the date sheet. A new exam is led through them class by class.
 */
export default async function ExamSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    step?: string;
    classId?: string;
    new?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('exams.master.view')) notFound();
  const canManage = me.permissions.includes('exams.master.manage');
  const [t, n, exam, p, classes, subjects, scales, sets] = await Promise.all([
    getTranslations('examHub.setup'),
    getTranslations('examHub.new'),
    apiFetch<Exam>(`/exams/${id}`),
    apiFetch<ExamProgress>(`/exams/${id}/progress`),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
    apiFetch<{ data: Array<SubjectRow & { status?: string; parentId?: string | null }> }>(
      '/academics/subjects?size=200',
    )
      .then((r) => r.data.filter((x) => x.status !== 'inactive'))
      .catch(() => [] as Array<SubjectRow & { parentId?: string | null }>),
    apiFetch<{ data: GradeScale[] }>('/exams/grade-scales')
      .then((r) => r.data)
      .catch(() => [] as GradeScale[]),
    apiFetch<{ data: Array<{ id: string; code: string; name: string; kind: string }> }>(
      '/exams/indicator-sets',
    )
      .then((r) => r.data)
      .catch(() => []),
  ]);
  const step: Step = sp.step === 'subjects' || sp.step === 'dates' ? sp.step : 'details';
  const of = (classId: string) => (exam.subjects ?? []).filter((s) => s.classId === classId);
  // the class asked for; a new exam starts at its first class without subjects
  const klass =
    exam.classes.find((k) => k.classId === sp.classId) ??
    (sp.new && step === 'subjects' ? exam.classes.find((k) => k.subjects === 0) : undefined) ??
    (step === 'dates' ? exam.classes.find((k) => k.subjects > 0) : undefined) ??
    exam.classes[0];
  const at = klass ? exam.classes.indexOf(klass) : -1;
  const after = at >= 0 ? exam.classes[at + 1] : undefined;
  const base = `/exams/${exam.id}/setup`;
  const steps: Array<[Step, string]> = [
    ['details', n('stepDetails')],
    ['subjects', n('stepSubjects')],
    ['dates', n('stepDates')],
  ];
  const chips = (target: Step) => (
    <ul className="ep-xchips" aria-label={t('chooseClass')} style={{ marginBottom: 'var(--sp-3)' }}>
      {exam.classes.map((k) => (
        <li key={k.classId} style={{ padding: 0, border: 0, background: 'none' }}>
          <a
            href={`${base}?step=${target}&classId=${k.classId}`}
            aria-current={k.classId === klass?.classId ? 'page' : undefined}
          >
            {k.subjects ? '✓ ' : ''}
            {k.classCode}
            <span className="ep-meter__text">({k.subjects})</span>
          </a>
        </li>
      ))}
    </ul>
  );

  let body: ReactNode = null;
  if (step === 'details') {
    const sits = new Map(exam.classes.map((k) => [k.classId, k]));
    body = (
      <Card title={t('details')}>
        <form action={saveExamDetails}>
          <input type="hidden" name="id" value={exam.id} />
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {t('type')}: <strong>{exam.examTypeName}</strong> · {exam.code}. {t('typeFixed')}
          </p>
          <div className="ep-rp__row">
            <label className="ep-field" htmlFor="xd-name">
              <span className="ep-field__label">{t('name')}</span>
              <input
                id="xd-name"
                name="name"
                className="ep-input"
                required
                minLength={2}
                maxLength={120}
                defaultValue={exam.name}
                disabled={!canManage}
              />
            </label>
            <label className="ep-field" htmlFor="xd-from">
              <span className="ep-field__label">{t('from')}</span>
              <input
                id="xd-from"
                name="startsOn"
                type="date"
                className="ep-input"
                defaultValue={exam.startsOn ?? ''}
                disabled={!canManage}
              />
            </label>
            <label className="ep-field" htmlFor="xd-to">
              <span className="ep-field__label">{t('to')}</span>
              <input
                id="xd-to"
                name="endsOn"
                type="date"
                className="ep-input"
                defaultValue={exam.endsOn ?? ''}
                disabled={!canManage}
              />
            </label>
            <label className="ep-field" htmlFor="xd-status">
              <span className="ep-field__label">{t('status')}</span>
              <select
                id="xd-status"
                name="status"
                className="ep-select"
                defaultValue={exam.status}
                disabled={!canManage}
              >
                <option value="active">{t('active')}</option>
                <option value="inactive">{t('inactive')}</option>
              </select>
            </label>
          </div>
          <label className="ep-check" htmlFor="xd-portal">
            <input
              id="xd-portal"
              name="showOnPortal"
              type="checkbox"
              className="ep-check__input"
              defaultChecked={exam.showOnPortal}
              disabled={!canManage}
            />
            <span className="ep-check__box" aria-hidden="true" /> {t('portal')}
          </label>
          <AreaTicks idPrefix="xd-area" value={exam.areas ?? []} disabled={!canManage} />
          <h3 className="ep-cdash__h3">{t('classes')}</h3>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {t('classesHelp')}
          </p>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={t('classes')}>
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">{t('classes')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('sits')}</th>
                  <th scope="col">{t('class')}</th>
                  <th scope="col">{t('classScale')}</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <input type="hidden" name="rowClassId" value={k.id} />
                      <label className="ep-check" htmlFor={`xd-c-${k.id}`}>
                        <input
                          id={`xd-c-${k.id}`}
                          name="classId"
                          value={k.id}
                          type="checkbox"
                          className="ep-check__input"
                          defaultChecked={sits.has(k.id)}
                          disabled={!canManage}
                        />
                        <span className="ep-check__box" aria-hidden="true" />
                        <span className="ep-sr-only">
                          {t('sits')} {k.name}
                        </span>
                      </label>
                    </td>
                    <th scope="row">{k.name}</th>
                    <td>
                      <select
                        name={`scale-${k.id}`}
                        className="ep-select"
                        aria-label={`${t('classScale')} · ${k.name}`}
                        defaultValue={sits.get(k.id)?.gradeScaleId ?? ''}
                        disabled={!canManage}
                      >
                        <option value="">{t('noScale')}</option>
                        {scales.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name} ({g.code})
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canManage ? (
            <FormActions>
              <Button type="submit">{t('saveDetails')}</Button>
            </FormActions>
          ) : null}
        </form>
      </Card>
    );
  } else if (!klass) {
    body = (
      <Card>
        <p style={{ margin: 0 }}>{t('classesHelp')}</p>
      </Card>
    );
  } else if (step === 'subjects') {
    const current = of(klass.classId);
    const studied = await apiFetch<{
      data: Array<{ subjectId: string; code: string; name: string; isElective: boolean }>;
    }>(`/academics/classes/${klass.classId}/subjects`)
      .then((r) => r.data)
      .catch(() => []);
    // a subject's sub-subjects in the subject master (Social Science: Geography, History, …): the parts
    // it may be entered in, each by its own teacher
    const kidsOf = (subjectId: string) =>
      subjects
        .filter((x) => x.parentId === subjectId)
        .map((x) => ({ id: x.id, code: x.code, name: x.name }));
    const row = (s: ExamSubject): EditorRow => ({
      subjectId: s.subjectId,
      code: s.subjectCode,
      name: s.subjectName,
      on: true,
      max: num(s.maxMarks),
      pass: s.passMarks == null ? '' : num(s.passMarks),
      elective: s.isElective,
      scaleId: s.gradeScaleId ?? '',
      examOn: s.examOn,
      startsAt: s.startsAt ?? null,
      endsAt: s.endsAt ?? null,
      entryLocked: s.entryLocked,
      parts: (s.parts ?? []).map((x) => ({
        id: x.id,
        name: x.name,
        subjectId: x.subjectId ?? '',
        max: num(x.maxMarks),
        entered: x.entered,
      })),
      children: s.children?.length ? s.children : kidsOf(s.subjectId),
    });
    const blank = (
      x: { subjectId: string; code: string; name: string },
      on: boolean,
      elective = false,
    ): EditorRow => ({
      subjectId: x.subjectId,
      code: x.code,
      name: x.name,
      on,
      max: '',
      pass: '',
      elective,
      scaleId: '',
      examOn: null,
      startsAt: null,
      endsAt: null,
      entryLocked: false,
      parts: [],
      children: kidsOf(x.subjectId),
    });
    // the subject marks master of the exam's type for the class (docs/design/70)
    const masterRows = exam.subjectMarks?.find((x) => x.classId === klass.classId)?.rows ?? null;
    const masterHref = `/exams/subject-marks?type=${exam.examTypeId}&class=${klass.classId}`;
    const fmt = (n: number | null) => (n === null ? '' : String(n));
    const masterInitial: EditorRow[] | null = masterRows
      ? [
          ...masterRows.map((m): EditorRow => {
            const cur = current.find((s) => s.subjectId === m.subjectId);
            const own = cur ? row(cur) : null;
            const marked = !!cur?.marked;
            return {
              ...(own ?? blank({ subjectId: m.subjectId, code: m.code, name: m.name }, false)),
              // ticked when the exam holds it; all ticked when the class has none yet
              on: cur ? true : current.length === 0,
              ...(marked
                ? {}
                : {
                    max: fmt(m.maxMarks),
                    pass: fmt(m.passMarks),
                    elective: m.optional,
                    scaleId: m.gradeScaleId ?? '',
                  }),
              examSubjectId: cur?.id,
              marked,
              differs: !!cur?.differs,
              masterText: `${m.maxMarks === 0 ? 'grade only' : fmt(m.maxMarks)}${m.passMarks !== null ? ` / ${fmt(m.passMarks)}` : ''}`,
            };
          }),
          // a paper the exam holds that is not in the list
          ...current
            .filter((s) => !masterRows.some((m) => m.subjectId === s.subjectId))
            .map((s): EditorRow => ({ ...row(s), examSubjectId: s.id, notInMaster: true })),
        ]
      : null;
    const fromClassList = !masterInitial && current.length === 0 && studied.length > 0;
    const initial: EditorRow[] = [
      ...current.map(row),
      ...studied
        .filter((x) => !current.some((s) => s.subjectId === x.subjectId))
        .map((x) => blank(x, fromClassList, x.isElective)),
    ];
    const nextHref = after
      ? `${base}?step=subjects&classId=${after.classId}${sp.new ? '&new=1' : ''}`
      : `${base}?step=dates&classId=${exam.classes[0]?.classId ?? ''}${sp.new ? '&new=1' : ''}`;
    body = (
      <Card title={t('subjectsOf', { class: klass.classCode })}>
        {chips('subjects')}
        {!masterInitial ? (
          <Alert tone="warning" title={t('masterMissingTitle')}>
            <p style={{ margin: 0 }}>
              {t.rich('masterMissing', {
                a: (chunks: ReactNode) => <a href={masterHref}>{chunks}</a>,
                type: exam.examTypeCode,
                class: klass.classCode,
              })}
            </p>
            {canManage && exam.subjects?.length ? (
              <form action={fillMasterFromExam} style={{ marginTop: 'var(--sp-2)' }}>
                <input type="hidden" name="examId" value={exam.id} />
                <input
                  type="hidden"
                  name="back"
                  value={`${base}?step=subjects&classId=${klass.classId}`}
                />
                <Button type="submit" variant="secondary" size="sm">
                  {t('masterFill')}
                </Button>
                <span className="ep-field__help" style={{ marginLeft: 'var(--sp-2)' }}>
                  {t('masterFillHelp', { type: exam.examTypeCode })}
                </span>
              </form>
            ) : null}
          </Alert>
        ) : null}
        {canManage && masterInitial ? (
          <ExamSubjectsEditor
            key={klass.classId}
            examId={exam.id}
            classId={klass.classId}
            classCode={klass.classCode}
            initial={masterInitial ?? initial}
            fromClassList={fromClassList}
            fromMaster={
              masterInitial
                ? { href: masterHref, type: exam.examTypeCode, class: klass.classCode }
                : null
            }
            masterMax={Object.fromEntries((masterRows ?? []).map((m) => [m.subjectId, m.maxMarks]))}
            addable={
              masterInitial
                ? []
                : subjects
                    .filter((x) => !initial.some((r) => r.subjectId === x.id))
                    .map((x) => ({
                      id: x.id,
                      code: x.code,
                      name: x.name,
                      children: kidsOf(x.id),
                    }))
            }
            scales={scales.map((g) => ({ id: g.id, code: g.code, name: g.name }))}
            sets={sets}
            setId={klass.indicatorSetId ?? null}
            copySources={exam.classes
              .filter((k) => k.classId !== klass.classId && of(k.classId).length)
              .map((k) => ({
                classId: k.classId,
                classCode: k.classCode,
                rows: of(k.classId).map(row),
              }))}
            next={{
              href: nextHref,
              label: after ? t('saveNext', { class: after.classCode }) : t('saveDates'),
            }}
            locked={exam.marksLocked}
          />
        ) : (
          <ul>
            {current.map((s) => (
              <li key={s.id}>
                {s.subjectName} · {num(s.maxMarks)}
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  } else {
    const current = of(klass.classId);
    const papers: PaperRow[] = current.map((s) => ({
      subjectId: s.subjectId,
      code: s.subjectCode,
      name: s.subjectName,
      maxMarks: Number(s.maxMarks),
      passMarks: s.passMarks == null ? null : Number(s.passMarks),
      isElective: s.isElective,
      gradeScaleId: s.gradeScaleId ?? null,
      examOn: s.examOn,
      startsAt: s.startsAt ?? null,
      endsAt: s.endsAt ?? null,
    }));
    body = (
      <Card
        title={t('dateSheet', { class: klass.classCode })}
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/exams/${exam.id}/date-sheet`}>
            {t('printAll')}
          </a>
        }
      >
        {chips('dates')}
        {current.length === 0 ? (
          <>
            <p>{t('noSubjects', { class: klass.classCode })}</p>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`${base}?step=subjects&classId=${klass.classId}`}
            >
              {t('addSubjectsFirst')}
            </a>
          </>
        ) : canManage ? (
          <DateSheetEditor
            key={klass.classId}
            examId={exam.id}
            classId={klass.classId}
            classCode={klass.classCode}
            initial={papers}
            note={exam.dateSheetNote ?? ''}
            next={
              after
                ? {
                    href: `${base}?step=dates&classId=${after.classId}`,
                    label: t('saveNext', { class: after.classCode }),
                  }
                : null
            }
            locked={exam.marksLocked}
          />
        ) : (
          <ul>
            {papers.map((x) => (
              <li key={x.subjectId}>
                {x.name} · {x.examOn ?? '—'} {x.startsAt ?? ''}
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  return (
    <>
      <ExamFrame
        exam={exam}
        stage={p.stage}
        current="setup"
        canManage={canManage}
        canUnlock={me.permissions.includes('exams.marks.unlock')}
      />
      <nav aria-label={t('steps')} style={{ marginBottom: 'var(--sp-4)' }}>
        <ol className="ep-xstages">
          {steps.map(([key, label]) => (
            <li key={key} aria-current={key === step ? 'step' : undefined}>
              <a
                href={`${base}?step=${key}${klass && key !== 'details' ? `&classId=${klass.classId}` : ''}`}
                style={{ color: 'inherit' }}
              >
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {sp.new && !sp.ok ? <Alert tone="success">{t('newGuide')}</Alert> : null}
      <Notice params={sp} />
      {body}
    </>
  );
}
