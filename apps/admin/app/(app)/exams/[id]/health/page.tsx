import { Badge, Button, Card } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AutoSubmit } from '@/components/AutoSubmit';
import { Notice } from '@/components/Notice';
import { ExamFrame } from '@/components/exams/ExamFrame';
import { FormSaveBar } from '@/components/exams/FormSaveBar';
import { LiveCalc } from '@/components/exams/LiveCalc';
import { SubNav } from '@/components/exams/SubNav';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { saveHealthSheet } from '@/lib/exam-sheet-actions';
import type { Exam, ExamProgress } from '@/lib/types';

interface Register {
  exam: { marksLocked: boolean };
  section: { id: string; code: string };
  healthVisible: boolean;
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    health: {
      heightCm: string | null;
      weightKg: string | null;
      bmi: string | null;
      bloodGroup: string | null;
      recordedOn: string | null;
    } | null;
  }>;
}

const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const n = (v: string | null | undefined) => (v == null ? '' : String(Number(v)));

/**
 * Health of a section in an exam (docs/design/66, phase 2): height and weight as measured for the exam
 * (BMI worked out as typed) and the blood group, shown from the last record; a changed row is saved as
 * measured on the date given. Sensitive: shown with the health view right, written with the entry
 * right; the health lock closes it. The report card prints it.
 */
export default async function ExamHealthPage({
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
  const [t, h, exam, progress, sections] = await Promise.all([
    getTranslations('examHub.entry'),
    getTranslations('examHub.health'),
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
  const reg = section
    ? await apiFetch<Register>(`/exams/${id}/register?classSectionId=${section.classSectionId}`)
    : null;
  const klass = exam.classes.find((k) => k.classId === section?.classId);
  const locked = !!reg && (reg.exam.marksLocked || Boolean(klass?.locks?.health));
  const open = !!reg?.healthVisible && me.permissions.includes('exams.health.enter') && !locked;
  const today = new Date().toISOString().slice(0, 10);
  const back = `/exams/${id}/health${section ? `?section=${section.classSectionId}` : ''}`;
  return (
    <>
      <ExamFrame
        exam={exam}
        stage={progress?.stage ?? null}
        current="attendance"
        canManage={me.permissions.includes('exams.master.manage')}
        canUnlock={me.permissions.includes('exams.marks.unlock')}
      />
      <SubNav
        label={t('attNav')}
        current={`/exams/${id}/health`}
        items={[
          {
            href: `/exams/${id}/attendance${section ? `?section=${section.classSectionId}` : ''}`,
            label: t('attendance'),
          },
          { href: `/exams/${id}/health`, label: t('health') },
        ].filter((x) =>
          (exam.areas ?? ['attendance', 'health']).includes(
            x.href.includes('/health') ? 'health' : 'attendance',
          ),
        )}
      />
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {h('description')}
      </p>
      <Notice params={sp} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-rp__row" aria-label={t('sheet')}>
          <AutoSubmit />
          <label className="ep-field" htmlFor="hl-section">
            <span className="ep-field__label">{t('section')}</span>
            <select
              id="hl-section"
              className="ep-select"
              name="section"
              defaultValue={section?.classSectionId}
            >
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
      {reg && !reg.healthVisible ? (
        <Card>
          <p style={{ margin: 0 }}>{h('noView')}</p>
        </Card>
      ) : null}
      {reg?.healthVisible ? (
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
          <form action={saveHealthSheet}>
            <input type="hidden" name="examId" value={exam.id} />
            <input type="hidden" name="classSectionId" value={reg.section.id} />
            <input type="hidden" name="back" value={back} />
            <label className="ep-field" htmlFor="hl-on" style={{ maxWidth: '14rem' }}>
              <span className="ep-field__label">{h('measuredOn')}</span>
              <input
                id="hl-on"
                className="ep-input"
                type="date"
                name="recordedOn"
                max={today}
                defaultValue={today}
                disabled={!open}
              />
            </label>
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={h('title')}>
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">
                  {h('title')} · {reg.section.code}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('roll')}</th>
                    <th scope="col">{t('student')}</th>
                    <th scope="col">{h('height')}</th>
                    <th scope="col">{h('weight')}</th>
                    <th scope="col" className="is-numeric">
                      {h('bmi')}
                    </th>
                    <th scope="col">{h('blood')}</th>
                  </tr>
                </thead>
                <tbody>
                  {reg.rows.map((r) => {
                    const x = r.health;
                    return (
                      <tr key={r.studentId}>
                        <td>{r.rollNo ?? ''}</td>
                        <th scope="row">
                          <input type="hidden" name="studentId" value={r.studentId} />
                          <input type="hidden" name={`h0-${r.studentId}`} value={n(x?.heightCm)} />
                          <input type="hidden" name={`w0-${r.studentId}`} value={n(x?.weightKg)} />
                          <input
                            type="hidden"
                            name={`b0-${r.studentId}`}
                            value={x?.bloodGroup ?? ''}
                          />
                          {r.name}
                          <span className="ep-kicker" style={{ display: 'block' }}>
                            {r.admissionNo}
                            {x?.recordedOn ? ` · ${h('last', { date: x.recordedOn })}` : ''}
                          </span>
                        </th>
                        <td>
                          <input
                            className="ep-input"
                            type="number"
                            inputMode="decimal"
                            name={`h-${r.studentId}`}
                            aria-label={`${h('height')} · ${r.name}`}
                            min={40}
                            max={250}
                            step="0.1"
                            defaultValue={n(x?.heightCm)}
                            disabled={!open}
                            style={{ width: '7rem' }}
                          />
                        </td>
                        <td>
                          <input
                            className="ep-input"
                            type="number"
                            inputMode="decimal"
                            name={`w-${r.studentId}`}
                            aria-label={`${h('weight')} · ${r.name}`}
                            min={3}
                            max={200}
                            step="0.01"
                            defaultValue={n(x?.weightKg)}
                            disabled={!open}
                            style={{ width: '7rem' }}
                          />
                        </td>
                        <td className="is-numeric">
                          <LiveCalc
                            kind="bmi"
                            a={`w-${r.studentId}`}
                            b={`h-${r.studentId}`}
                            initial={x?.bmi ? String(Math.round(Number(x.bmi) * 10) / 10) : ''}
                          />
                        </td>
                        <td>
                          <select
                            className="ep-select"
                            name={`b-${r.studentId}`}
                            aria-label={`${h('blood')} · ${r.name}`}
                            defaultValue={x?.bloodGroup ?? ''}
                            disabled={!open}
                          >
                            <option value="">-</option>
                            {GROUPS.map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {open ? (
              <FormSaveBar>
                <Button type="submit">{h('save')}</Button>
              </FormSaveBar>
            ) : (
              <p className="ep-field__help">{locked ? h('locked') : h('viewOnly')}</p>
            )}
          </form>
        </Card>
      ) : null}
    </>
  );
}
