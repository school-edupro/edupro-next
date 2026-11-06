import { Alert, Badge, Card } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AutoSubmit } from '@/components/AutoSubmit';
import { Notice } from '@/components/Notice';
import {
  EntryStatusActions,
  EntryStatusBadge,
  type EntryStatus,
} from '@/components/exams/EntryStatusActions';
import { ExamFrame } from '@/components/exams/ExamFrame';
import { ExcelUpload } from '@/components/exams/ExcelUpload';
import { MarksSheet } from '@/components/exams/MarksSheet';
import { SubNav } from '@/components/exams/SubNav';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { uploadExamMarks } from '@/lib/exam-entry-actions';
import type { Exam, ExamProgress } from '@/lib/types';

interface Part {
  id: string;
  name: string;
  maxMarks: string;
  mine: boolean;
}
interface EntrySection {
  classSectionId: string;
  code: string;
  subjects: Array<{
    subjectId: string;
    code: string;
    name: string;
    maxMarks: string;
    entryLocked: boolean;
    entered: number;
    parts?: Part[];
  }>;
}
interface Sheet {
  exam: { id: string; code: string; name: string; marksLocked: boolean };
  examSubject: {
    id: string;
    code: string;
    name: string;
    maxMarks: string;
    passMarks: string | null;
    entryLocked: boolean;
    gradeOnly: boolean;
    parts: Part[];
  };
  section: { id: string; code: string };
  codes: Array<{ code: string; name: string }>;
  grades: string[];
  status: EntryStatus;
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    parts: Record<string, { marks: string | null; absent: boolean }>;
    marks: string | null;
    code: string | null;
    grade: string | null;
    taken: string | null;
  }>;
}

const n = (v: string) => String(Number(v));

/**
 * Marks entry (docs/design/66, phase 2): choosing the section and the subject opens its sheet at once,
 * previous and next go through every section's subjects, and the sheet saves (or saves and submits)
 * from the bar at its foot. Excel download and upload beside it.
 */
export default async function ExamMarksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    pick?: string;
    section?: string;
    subject?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('exams.marks.view')) notFound();
  const [t, m, exam, progress, sections] = await Promise.all([
    getTranslations('examHub.entry'),
    getTranslations('examHub.misc'),
    apiFetch<Exam>(`/exams/${id}`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    apiFetch<ExamProgress>(`/exams/${id}/progress`).catch(() => null),
    apiFetch<{ data: EntrySection[] }>(`/exams/${id}/entry/sections`)
      .then((r) => r.data)
      .catch(() => [] as EntrySection[]),
  ]);
  // every sheet: a section's subject, or each part of a subject entered in parts
  const options = sections.flatMap((s) =>
    s.subjects.flatMap((sub) =>
      (sub.parts ?? []).length
        ? (sub.parts ?? []).map((p) => ({
            value: `${s.classSectionId}|${sub.subjectId}|${p.id}`,
            subject: `${sub.subjectId}|${p.id}`,
            label: `${sub.name} · ${p.name} (${n(p.maxMarks)})`,
            section: s.code,
            classSectionId: s.classSectionId,
            subjectId: sub.subjectId,
            partId: p.id as string | null,
          }))
        : [
            {
              value: `${s.classSectionId}|${sub.subjectId}`,
              subject: sub.subjectId,
              label: `${sub.name}${Number(sub.maxMarks) === 0 ? ` (${t('grade')})` : ''} · ${t('enteredCount', { n: sub.entered })}${sub.entryLocked ? ` · ${t('locked')}` : ''}`,
              section: s.code,
              classSectionId: s.classSectionId,
              subjectId: sub.subjectId,
              partId: null as string | null,
            },
          ],
    ),
  );
  const inSection = (sid: string) => options.filter((o) => o.classSectionId === sid);
  const asked = sp.section ? inSection(sp.section) : [];
  const chosen =
    options.find((o) => o.value === sp.pick) ??
    asked.find((o) => o.subject === sp.subject) ??
    asked.find((o) => o.subjectId === sp.subject?.split('|')[0]) ??
    asked[0] ??
    options[0];
  const at = chosen ? options.indexOf(chosen) : -1;
  const prev = at > 0 ? options[at - 1] : undefined;
  const next = at >= 0 ? options[at + 1] : undefined;
  const sheet = chosen
    ? await apiFetch<Sheet>(
        `/exams/${id}/marks?classSectionId=${chosen.classSectionId}&subjectId=${chosen.subjectId}`,
      )
    : null;
  const canEnter = me.permissions.includes('exams.marks.enter');
  // submitted or verified marks are closed too (docs/design/65, part 2)
  const locked =
    !!sheet &&
    (sheet.exam.marksLocked || sheet.examSubject.entryLocked || sheet.status.status !== 'open');
  const verifier = chosen
    ? await apiFetch<{
        data: Array<{ classSectionId: string; subjectId: string; canVerify: boolean }>;
      }>(`/exams/${id}/entry-status`)
        .then(
          (x) =>
            x.data.find(
              (y) => y.classSectionId === chosen.classSectionId && y.subjectId === chosen.subjectId,
            )?.canVerify ?? false,
        )
        .catch(() => false)
    : false;
  const part = chosen?.partId
    ? (sheet?.examSubject.parts.find((p) => p.id === chosen.partId) ?? null)
    : null;
  const es = sheet?.examSubject;
  const max = part ? part.maxMarks : (es?.maxMarks ?? '0');
  const taken = sheet?.rows.filter((r) => r.taken) ?? [];
  const missing = taken.filter((r) => r.marks === null && !r.code && !r.grade).length;
  const backTo = `/exams/${id}/marks?pick=${encodeURIComponent(chosen?.value ?? '')}`;
  const link = (o: (typeof options)[number]) =>
    `/exams/${id}/marks?pick=${encodeURIComponent(o.value)}`;
  const seen = new Set<string>();
  const sectionList = options.filter((o) =>
    seen.has(o.classSectionId) ? false : (seen.add(o.classSectionId), true),
  );
  return (
    <>
      <ExamFrame
        exam={exam}
        stage={progress?.stage ?? null}
        current="marks"
        canManage={me.permissions.includes('exams.master.manage')}
        canLock={me.permissions.includes('exams.lock.manage')}
      />
      <SubNav
        label={t('nav')}
        current={`/exams/${id}/marks`}
        items={[
          { href: `/exams/${id}/marks`, label: t('navEnter') },
          { href: `/exams/${id}/status`, label: t('navStatus') },
        ]}
      />
      <Notice params={sp} />
      {!options.length ? (
        <Card>
          <p style={{ margin: 0 }}>{t('noSheets')}</p>
        </Card>
      ) : (
        <Card style={{ marginBottom: 'var(--sp-4)' }}>
          <form method="get" className="ep-rp__row" aria-label={t('sheet')}>
            <AutoSubmit />
            <label className="ep-field" htmlFor="mk-section">
              <span className="ep-field__label">{t('section')}</span>
              <select
                id="mk-section"
                name="section"
                className="ep-select"
                defaultValue={chosen?.classSectionId}
              >
                {sectionList.map((o) => (
                  <option key={o.classSectionId} value={o.classSectionId}>
                    {o.section}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="mk-subject" style={{ flex: '2 1 18rem' }}>
              <span className="ep-field__label">{t('subject')}</span>
              <select
                id="mk-subject"
                name="subject"
                className="ep-select"
                defaultValue={chosen?.subject}
              >
                {(chosen ? inSection(chosen.classSectionId) : []).map((o) => (
                  <option key={o.value} value={o.subject}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <noscript>
              <button type="submit" className="ep-btn ep-btn--secondary">
                {t('sheet')}
              </button>
            </noscript>
          </form>
          <div className="ep-xcard__actions" style={{ marginTop: 'var(--sp-2)' }}>
            {prev ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href={link(prev)}>
                ‹ {t('prev', { name: `${prev.section} · ${prev.label.split(' · ')[0]}` })}
              </a>
            ) : null}
            {next ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href={link(next)}>
                {t('next', { name: `${next.section} · ${next.label.split(' · ')[0]}` })} ›
              </a>
            ) : null}
          </div>
        </Card>
      )}
      {sheet && es && chosen ? (
        <div className="ep-rp">
          <Card
            elevated
            title={`${sheet.section.code} · ${es.name}${part ? ` · ${part.name}` : ''}`}
            actions={
              sheet.exam.marksLocked || es.entryLocked ? (
                <Badge tone="warning">{t('locked')}</Badge>
              ) : (
                <Badge tone="neutral">{t('students', { n: taken.length })}</Badge>
              )
            }
          >
            <div
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'center',
                flexWrap: 'wrap',
                marginBottom: 'var(--sp-3)',
              }}
            >
              <EntryStatusBadge s={sheet.status} />
              <EntryStatusActions
                examId={exam.id}
                classSectionId={chosen.classSectionId}
                subjectId={chosen.subjectId}
                status={sheet.status.status}
                back={backTo}
                missing={missing}
                // a whole subject is submitted from the Save bar; a subject in parts here
                canSubmit={Boolean(part) && canEnter && !sheet.exam.marksLocked && !es.entryLocked}
                canVerify={verifier}
                canReopen={me.permissions.includes('exams.marks.unlock')}
              />
            </div>
            {canEnter && !locked ? (
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                {t('marksHelp', { codes: sheet.codes.map((c) => c.code).join(', ') })}
              </p>
            ) : (
              <Alert tone="info">
                {sheet.status.status !== 'open'
                  ? t('closed')
                  : locked
                    ? t('lockedNote')
                    : t('viewOnly')}
              </Alert>
            )}
            <MarksSheet
              key={chosen.value}
              examId={exam.id}
              classSectionId={chosen.classSectionId}
              subjectId={chosen.subjectId}
              partId={part?.id ?? null}
              subjectName={es.name}
              rows={sheet.rows.map((r) => {
                const pm = part ? r.parts[part.id] : undefined;
                return {
                  studentId: r.studentId,
                  name: r.name,
                  admissionNo: r.admissionNo,
                  rollNo: r.rollNo,
                  taken: r.taken,
                  takenLabel:
                    r.taken === 'optional'
                      ? m('optional')
                      : r.taken === 'additional'
                        ? m('additional')
                        : '',
                  marks: part
                    ? pm?.marks != null
                      ? n(pm.marks)
                      : ''
                    : r.marks != null
                      ? n(r.marks)
                      : '',
                  code: part ? (pm?.absent ? 'AB' : '') : (r.code ?? ''),
                  grade: part ? '' : (r.grade ?? ''),
                };
              })}
              codes={sheet.codes}
              grades={sheet.grades}
              gradeOnly={es.gradeOnly}
              max={Number(max)}
              canEdit={canEnter && !locked}
              canSubmit={!part && canEnter && !locked}
            />
          </Card>
          <Card elevated title={t('excel')}>
            <p style={{ marginTop: 0 }}>{t('excelHelp', { subject: es.name })}</p>
            <p>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/exam-marks/excel?examId=${exam.id}&classSectionId=${chosen.classSectionId}&subjectId=${chosen.subjectId}`}
              >
                {t('download')}
              </a>
            </p>
            {canEnter && !locked ? (
              <ExcelUpload
                label={t('upload')}
                upload={uploadExamMarks.bind(
                  null,
                  exam.id,
                  chosen.classSectionId,
                  chosen.subjectId,
                )}
              />
            ) : null}
          </Card>
        </div>
      ) : null}
    </>
  );
}
