import { Badge, Button, Card } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AutoSubmit } from '@/components/AutoSubmit';
import { ExamFrame } from '@/components/exams/ExamFrame';
import { FormSaveBar } from '@/components/exams/FormSaveBar';
import { LiveCalc } from '@/components/exams/LiveCalc';
import { SubNav } from '@/components/exams/SubNav';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { countExamAttendance, saveExamAttendance } from '@/lib/remark-actions';
import type { Exam, ExamProgress } from '@/lib/types';

interface Register {
  exam: { marksLocked: boolean };
  section: { id: string; code: string };
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    daysPresent: number | null;
    daysTotal: number | null;
  }>;
}

/**
 * Exam attendance of a section (docs/design/65): counted from daily attendance between two dates, and
 * corrected here by the office or the class teacher. It prints on the report card.
 */
export default async function ExamAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('exams.marks.view')) notFound();
  const [t, a, exam, progress, sections] = await Promise.all([
    getTranslations('examHub.entry'),
    getTranslations('examHub.att'),
    apiFetch<Exam>(`/exams/${id}`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    apiFetch<ExamProgress>(`/exams/${id}/progress`).catch(() => null),
    apiFetch<{ data: Array<{ classSectionId: string; classId: string; code: string }> }>(
      `/exams/${id}/entry/sections`,
    )
      .then((r) => r.data)
      .catch(() => [] as Array<{ classSectionId: string; classId: string; code: string }>),
  ]);
  const section = sections.find((x) => x.classSectionId === sp.section) ?? sections[0];
  const sectionId = section?.classSectionId;
  const reg = sectionId
    ? await apiFetch<Register>(`/exams/${id}/register?classSectionId=${sectionId}`)
    : null;
  const klass = exam.classes.find((k) => k.classId === section?.classId);
  const locked = !!reg && (reg.exam.marksLocked || Boolean(klass?.locks?.attendance));
  const canEnter = me.permissions.includes('exams.attendance.enter');
  const open = canEnter && !locked;
  const back = `/exams/${id}/attendance${sectionId ? `?section=${sectionId}` : ''}`;
  return (
    <>
      <ExamFrame
        exam={exam}
        stage={progress?.stage ?? null}
        current="attendance"
        canManage={me.permissions.includes('exams.master.manage')}
        canLock={me.permissions.includes('exams.lock.manage')}
      />
      <SubNav
        label={t('attNav')}
        current={`/exams/${id}/attendance`}
        items={[
          { href: `/exams/${id}/attendance`, label: t('attendance') },
          {
            href: `/exams/${id}/health${sectionId ? `?section=${sectionId}` : ''}`,
            label: t('health'),
          },
        ].filter((x) =>
          (exam.areas ?? ['attendance', 'health']).includes(
            x.href.includes('/health') ? 'health' : 'attendance',
          ),
        )}
      />
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {a('intro')}
      </p>
      <Notice params={sp} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-rp__row" aria-label={t('sheet')}>
          <AutoSubmit />
          <label className="ep-field" htmlFor="at-section">
            <span className="ep-field__label">{t('section')}</span>
            <select id="at-section" className="ep-select" name="section" defaultValue={sectionId}>
              {sections.map((x) => (
                <option key={x.classSectionId} value={x.classSectionId}>
                  {x.code}
                </option>
              ))}
            </select>
          </label>
          <noscript>
            <Button type="submit" variant="secondary">
              {t('sheet')}
            </Button>
          </noscript>
        </form>
      </Card>
      {reg ? (
        <>
          {open ? (
            <Card elevated title={a('count')} style={{ marginBottom: 'var(--sp-4)' }}>
              <form
                action={countExamAttendance}
                style={{
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  alignItems: 'flex-end',
                  flexWrap: 'wrap',
                }}
              >
                <input type="hidden" name="examId" value={exam.id} />
                <input type="hidden" name="classSectionId" value={reg.section.id} />
                <input type="hidden" name="back" value={back} />
                <label className="ep-field" htmlFor="at-from">
                  <span className="ep-field__label">{a('from')}</span>
                  <input id="at-from" className="ep-input" type="date" name="from" />
                </label>
                <label className="ep-field" htmlFor="at-to">
                  <span className="ep-field__label">{a('to')}</span>
                  <input id="at-to" className="ep-input" type="date" name="to" />
                </label>
                <label className="ep-check" htmlFor="att-overwrite">
                  <input
                    id="att-overwrite"
                    className="ep-check__input"
                    type="checkbox"
                    name="overwrite"
                  />
                  <span className="ep-check__box" aria-hidden="true" /> {a('replace')}
                </label>
                <Button type="submit" variant="secondary">
                  {a('countButton')}
                </Button>
              </form>
            </Card>
          ) : null}
          <Card
            elevated
            title={reg.section.code}
            actions={
              locked ? (
                <Badge tone="warning">{t('locked')}</Badge>
              ) : (
                <Badge tone="neutral">{t('students', { n: reg.rows.length })}</Badge>
              )
            }
          >
            <form action={saveExamAttendance}>
              <input type="hidden" name="examId" value={exam.id} />
              <input type="hidden" name="classSectionId" value={reg.section.id} />
              <input type="hidden" name="back" value={back} />
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label={t('attendance')}
              >
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">{t('attendance')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('roll')}</th>
                      <th scope="col">{t('student')}</th>
                      <th scope="col">{a('present')}</th>
                      <th scope="col">{a('working')}</th>
                      <th scope="col" className="is-numeric">
                        %
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {reg.rows.map((r) => (
                      <tr key={r.studentId}>
                        <td>{r.rollNo ?? ''}</td>
                        <th scope="row">
                          <input type="hidden" name="studentId" value={r.studentId} />
                          {r.name}
                          <span className="ep-kicker" style={{ display: 'block' }}>
                            {r.admissionNo}
                          </span>
                        </th>
                        <td>
                          <input
                            className="ep-input"
                            type="number"
                            min={0}
                            max={400}
                            name={`p-${r.studentId}`}
                            aria-label={`${a('present')} · ${r.name}`}
                            defaultValue={r.daysPresent ?? ''}
                            disabled={!open}
                            style={{ width: '7rem' }}
                          />
                        </td>
                        <td>
                          <input
                            className="ep-input"
                            type="number"
                            min={1}
                            max={400}
                            name={`t-${r.studentId}`}
                            aria-label={`${a('working')} · ${r.name}`}
                            defaultValue={r.daysTotal ?? ''}
                            disabled={!open}
                            style={{ width: '7rem' }}
                          />
                        </td>
                        <td className="is-numeric">
                          <LiveCalc
                            kind="pct"
                            a={`p-${r.studentId}`}
                            b={`t-${r.studentId}`}
                            initial={
                              r.daysPresent !== null && r.daysTotal
                                ? String(Math.round((r.daysPresent * 1000) / r.daysTotal) / 10)
                                : ''
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {open ? (
                <FormSaveBar>
                  <Button type="submit">{a('save')}</Button>
                </FormSaveBar>
              ) : (
                <p className="ep-field__help">{locked ? a('locked') : a('viewOnly')}</p>
              )}
            </form>
          </Card>
        </>
      ) : null}
    </>
  );
}
