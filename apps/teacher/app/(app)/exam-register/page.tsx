import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { saveAttendance, saveHealth, saveRemarks } from './actions';

interface Exam {
  id: string;
  code: string;
  name: string;
  marksLocked: boolean;
}
interface EntrySection {
  classSectionId: string;
  code: string;
  register: boolean;
}
interface Register {
  exam: { id: string; code: string; name: string; marksLocked: boolean };
  section: { id: string; code: string };
  healthVisible: boolean;
  remarkBank: Array<{ code: string; text: string }>;
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    remark: string | null;
    bankCode: string | null;
    daysPresent: number | null;
    daysTotal: number | null;
    health: {
      heightCm: string | null;
      weightKg: string | null;
      bmi: string | null;
      bloodGroup: string | null;
      recordedOn: string | null;
    } | null;
  }>;
}
const ERRORS: Record<string, string> = {
  'exams.entry_locked': 'The exam is locked; ask the coordinator to reopen it.',
  'exams.not_assigned': 'Only the class teacher of this section can fill the register.',
  'exams.attendance_invalid': 'Days present cannot exceed the total days.',
  'scope-denied': 'You are not allowed to open this section.',
  'validation-failed': 'Some values were not accepted.',
};

/** Sprint 15: the class teacher's exam register — remarks, exam attendance, height and weight. */
export default async function ExamRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{
    exam?: string;
    section?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let exams: Exam[];
  try {
    exams = await bff.api.fetch<{ data: Exam[] }>('/exams').then((r) => r.data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Exam register')} />
          <Card>{t(lang, 'You are not allowed to open exam registers in this school.')}</Card>
        </main>
      );
    throw error;
  }
  const exam = exams.find((e) => e.id === sp.exam) ?? exams[0];
  const sections = exam
    ? (
        await bff.api.fetch<{ data: EntrySection[] }>(`/exams/${exam.id}/entry/sections`)
      ).data.filter((s) => s.register)
    : [];
  const chosen = sections.find((s) => s.classSectionId === sp.section) ?? sections[0];
  let reg: Register | null = null;
  let loadError: string | null = null;
  if (exam && chosen) {
    try {
      reg = await bff.api.fetch<Register>(
        `/exams/${exam.id}/register?classSectionId=${chosen.classSectionId}`,
      );
    } catch (error) {
      if (error instanceof ApiError) loadError = ERRORS[error.problem.type] ?? error.problem.type;
      else throw error;
    }
  }
  const locked = !!reg?.exam.marksLocked;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 960, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Exam register')}
        title={exam ? `${exam.name} (${exam.code})` : t(lang, 'Exam register')}
        description={
          reg
            ? `${reg.section.code} · ${
                reg.healthVisible
                  ? t(lang, 'remarks, exam attendance, height and weight')
                  : t(lang, 'remarks, exam attendance')
              }`
            : t(lang, 'Class teachers fill the register for their section.')
        }
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Saved')}
          {sp.detail ? ` (${sp.detail})` : ''}.
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, ERRORS[sp.error] ?? sp.error)}
          {sp.detail ? ` — ${sp.detail}` : ''}
        </div>
      ) : null}
      <Card style={{ marginBottom: 'var(--sp-3)' }}>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" style={{ minWidth: 220 }}>
            <span className="ep-field__label">{t(lang, 'Exam')}</span>
            <select className="ep-input" name="exam" defaultValue={exam?.id ?? ''}>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.code})
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" style={{ minWidth: 160 }}>
            <span className="ep-field__label">{t(lang, 'Section')}</span>
            <select className="ep-input" name="section" defaultValue={chosen?.classSectionId ?? ''}>
              {sections.map((s) => (
                <option key={s.classSectionId} value={s.classSectionId}>
                  {s.code}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            {t(lang, 'Open register')}
          </Button>
        </form>
      </Card>
      {loadError ? <Card>{t(lang, loadError)}</Card> : null}
      {!loadError && exam && sections.length === 0 ? (
        <Card>{t(lang, 'You are not the class teacher of a section in this exam.')}</Card>
      ) : null}
      {reg && exam && chosen ? (
        <Card
          title={`${t(lang, 'Register')} · ${reg.section.code}`}
          actions={
            locked ? (
              <Badge tone="warning">{t(lang, 'Locked')}</Badge>
            ) : (
              <Badge tone="neutral">
                {reg.rows.length} {t(lang, 'pupils')}
              </Badge>
            )
          }
        >
          <form>
            <input type="hidden" name="examId" value={exam.id} />
            <input type="hidden" name="classSectionId" value={chosen.classSectionId} />
            <datalist id="remark-bank">
              {reg.remarkBank.map((b) => (
                <option key={b.code} value={b.text} />
              ))}
            </datalist>
            <div style={{ overflowX: 'auto' }}>
              <table
                className="ep-table ep-table--dense"
                style={{ width: '100%', minWidth: reg.healthVisible ? 900 : 640 }}
              >
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t(lang, 'Pupil')}</th>
                    <th>{t(lang, 'Remark')}</th>
                    <th>{t(lang, 'Present / total days')}</th>
                    {reg.healthVisible ? (
                      <>
                        <th>{t(lang, 'Height cm')}</th>
                        <th>{t(lang, 'Weight kg')}</th>
                        <th>{t(lang, 'Blood')}</th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {reg.rows.map((r) => (
                    <tr key={r.studentId}>
                      <td>{r.rollNo ?? ''}</td>
                      <td>
                        {r.name}
                        <div className="ep-kicker">
                          {r.admissionNo}
                          {r.health?.recordedOn
                            ? ` · ${t(lang, 'last health')} ${r.health.recordedOn}${r.health.bmi ? ` · BMI ${r.health.bmi}` : ''}`
                            : ''}
                        </div>
                      </td>
                      <td>
                        <input
                          className="ep-input"
                          name={`remark-${r.studentId}`}
                          list="remark-bank"
                          aria-label={`${t(lang, 'Remark')} · ${r.name}`}
                          defaultValue={r.remark ?? ''}
                          maxLength={600}
                          disabled={locked}
                          style={{ minWidth: 220 }}
                        />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <input
                          className="ep-input"
                          type="number"
                          name={`present-${r.studentId}`}
                          aria-label={`${t(lang, 'Days present')} · ${r.name}`}
                          min={0}
                          max={400}
                          defaultValue={r.daysPresent ?? ''}
                          disabled={locked}
                          style={{ width: 72 }}
                        />
                        {' / '}
                        <input
                          className="ep-input"
                          type="number"
                          name={`total-${r.studentId}`}
                          aria-label={`${t(lang, 'Total days')} · ${r.name}`}
                          min={1}
                          max={400}
                          defaultValue={r.daysTotal ?? ''}
                          disabled={locked}
                          style={{ width: 72 }}
                        />
                      </td>
                      {reg.healthVisible ? (
                        <>
                          <td>
                            <input
                              className="ep-input"
                              type="number"
                              step="0.1"
                              min={40}
                              max={250}
                              name={`height-${r.studentId}`}
                              aria-label={`${t(lang, 'Height')} · ${r.name}`}
                              defaultValue={r.health?.heightCm ?? ''}
                              disabled={locked}
                              style={{ width: 84 }}
                            />
                          </td>
                          <td>
                            <input
                              className="ep-input"
                              type="number"
                              step="0.1"
                              min={3}
                              max={200}
                              name={`weight-${r.studentId}`}
                              aria-label={`${t(lang, 'Weight')} · ${r.name}`}
                              defaultValue={r.health?.weightKg ?? ''}
                              disabled={locked}
                              style={{ width: 84 }}
                            />
                          </td>
                          <td>
                            <select
                              className="ep-input"
                              name={`blood-${r.studentId}`}
                              aria-label={`${t(lang, 'Blood group')} · ${r.name}`}
                              defaultValue={r.health?.bloodGroup ?? ''}
                              disabled={locked}
                            >
                              <option value="">—</option>
                              {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((g) => (
                                <option key={g} value={g}>
                                  {g}
                                </option>
                              ))}
                            </select>
                          </td>
                        </>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!locked ? (
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--sp-2)',
                  justifyContent: 'flex-end',
                  marginTop: 'var(--sp-3)',
                  flexWrap: 'wrap',
                }}
              >
                <Button type="submit" formAction={saveRemarks} variant="secondary">
                  {t(lang, 'Save remarks')}
                </Button>
                <Button type="submit" formAction={saveAttendance} variant="secondary">
                  {t(lang, 'Save exam attendance')}
                </Button>
                {reg.healthVisible ? (
                  <Button type="submit" formAction={saveHealth}>
                    {t(lang, 'Save height and weight')}
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
                {t(lang, 'The exam is locked; the coordinator can reopen it.')}
              </p>
            )}
          </form>
        </Card>
      ) : null}
    </main>
  );
}
