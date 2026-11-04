import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { SheetCard } from '@/components/SheetCard';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { saveHeightWeight } from './actions';

interface Exam {
  id: string;
  code: string;
  name: string;
  areas?: string[];
}
interface EntrySection {
  classSectionId: string;
  code: string;
  register: boolean;
}
interface Reading {
  heightCm: string | null;
  weightKg: string | null;
  bmi: string | null;
  bloodGroup: string | null;
  recordedOn: string;
  examName: string | null;
}
interface Sheet {
  section: { id: string; code: string };
  takes: boolean;
  locked: boolean;
  canEnter: boolean;
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    current: Reading | null;
    last: Reading | null;
  }>;
}
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const ERRORS: Record<string, string> = {
  'exams.entry_locked':
    'Height and weight is locked for this class; ask the coordinator to reopen it.',
  'exams.not_assigned': 'Only the class teacher of this section enters height and weight.',
  'exams.area_off': 'This exam does not take height and weight.',
  'validation-failed': 'A value was not accepted: height 40 to 250 cm, weight 3 to 200 kg.',
  'scope-denied': 'You are not allowed to open this section.',
};

/**
 * Height and weight (docs/design/71, part 3): the class teacher's section for each exam that takes it
 * (Term I, Term II), each pupil's last reading beside this one, BMI worked out on saving; by Excel too.
 */
export default async function HeightWeightPage({
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
    exams = await bff.api
      .fetch<{ data: Exam[] }>('/exams')
      .then((r) => r.data.filter((e) => !e.areas || e.areas.includes('health')));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Height and weight')} />
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
  let sheet: Sheet | null = null;
  let loadError: string | null = null;
  if (exam && chosen) {
    try {
      sheet = await bff.api.fetch<Sheet>(
        `/exams/${exam.id}/health?classSectionId=${chosen.classSectionId}`,
      );
    } catch (error) {
      if (error instanceof ApiError) loadError = ERRORS[error.problem.type] ?? error.problem.type;
      else throw error;
    }
  }
  const open = !!sheet && sheet.takes && !sheet.locked && sheet.canEnter;
  const done = sheet?.rows.filter((r) => r.current?.heightCm || r.current?.weightKg).length ?? 0;
  const read = (x: Reading | null) =>
    x
      ? `${x.heightCm ?? '-'} cm · ${x.weightKg ?? '-'} kg${x.bmi ? ` · BMI ${x.bmi}` : ''} (${x.examName ?? t(lang, 'health check')}, ${x.recordedOn})`
      : '—';
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 1100, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Height and weight')}
        title={exam ? `${exam.name} (${exam.code})` : t(lang, 'Height and weight')}
        description={
          sheet
            ? `${sheet.section.code} · ${String(done)} ${t(lang, 'of')} ${String(sheet.rows.length)} ${t(lang, 'entered')}`
            : t(lang, 'The class teacher enters each pupil’s height and weight in the term exams.')
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
            {t(lang, 'Open')}
          </Button>
        </form>
      </Card>
      {!exams.length ? (
        <Card>{t(lang, 'No exam of this year takes height and weight.')}</Card>
      ) : null}
      {loadError ? <Card>{t(lang, loadError)}</Card> : null}
      {!loadError && exam && sections.length === 0 ? (
        <Card>{t(lang, 'You are not the class teacher of a section in this exam.')}</Card>
      ) : null}
      {sheet && !sheet.takes ? (
        <Card>{t(lang, 'This exam does not take height and weight.')}</Card>
      ) : null}
      {sheet && sheet.takes && exam && chosen ? (
        <Card
          title={sheet.section.code}
          actions={
            sheet.locked ? (
              <Badge tone="warning">{t(lang, 'Locked')}</Badge>
            ) : (
              <Badge tone="neutral">
                {sheet.rows.length} {t(lang, 'pupils')}
              </Badge>
            )
          }
        >
          <form action={saveHeightWeight}>
            <input type="hidden" name="examId" value={exam.id} />
            <input type="hidden" name="classSectionId" value={chosen.classSectionId} />
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label={t(lang, 'Height and weight')}
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">{t(lang, 'Height and weight')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t(lang, 'Roll')}</th>
                    <th scope="col">{t(lang, 'Pupil')}</th>
                    <th scope="col">{t(lang, 'Last reading')}</th>
                    <th scope="col">{t(lang, 'Height cm')}</th>
                    <th scope="col">{t(lang, 'Weight kg')}</th>
                    <th scope="col">BMI</th>
                    <th scope="col">{t(lang, 'Blood')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((r) => {
                    const blood = r.current?.bloodGroup ?? r.last?.bloodGroup ?? '';
                    return (
                      <tr key={r.studentId}>
                        <td>{r.rollNo ?? ''}</td>
                        <td>
                          <input type="hidden" name="studentId" value={r.studentId} />
                          <input
                            type="hidden"
                            name={`oh-${r.studentId}`}
                            value={r.current?.heightCm ?? ''}
                          />
                          <input
                            type="hidden"
                            name={`ow-${r.studentId}`}
                            value={r.current?.weightKg ?? ''}
                          />
                          <input type="hidden" name={`ob-${r.studentId}`} value={blood} />
                          {r.name}
                          <div className="ep-kicker">{r.admissionNo}</div>
                        </td>
                        <td className="ep-field__help">{read(r.last)}</td>
                        <td>
                          <input
                            className="ep-input"
                            type="number"
                            step="0.1"
                            min={40}
                            max={250}
                            name={`h-${r.studentId}`}
                            aria-label={`${t(lang, 'Height cm')} · ${r.name}`}
                            defaultValue={r.current?.heightCm ?? ''}
                            disabled={!open}
                            style={{ width: 96 }}
                          />
                        </td>
                        <td>
                          <input
                            className="ep-input"
                            type="number"
                            step="0.1"
                            min={3}
                            max={200}
                            name={`w-${r.studentId}`}
                            aria-label={`${t(lang, 'Weight kg')} · ${r.name}`}
                            defaultValue={r.current?.weightKg ?? ''}
                            disabled={!open}
                            style={{ width: 96 }}
                          />
                        </td>
                        <td>{r.current?.bmi ?? '—'}</td>
                        <td>
                          <select
                            className="ep-input"
                            name={`b-${r.studentId}`}
                            aria-label={`${t(lang, 'Blood')} · ${r.name}`}
                            defaultValue={blood}
                            disabled={!open}
                          >
                            <option value="">-</option>
                            {BLOOD.map((b) => (
                              <option key={b} value={b}>
                                {b}
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
              <div className="ep-form-actions" style={{ marginTop: 'var(--sp-3)' }}>
                <Button type="submit">{t(lang, 'Save height and weight')}</Button>
              </div>
            ) : (
              <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
                {sheet.locked
                  ? t(lang, 'The exam is locked; the coordinator can reopen it.')
                  : t(lang, 'Only the class teacher of this section enters height and weight.')}
              </p>
            )}
          </form>
        </Card>
      ) : null}
      {sheet && sheet.takes && exam && chosen ? (
        <SheetCard
          kind="health"
          examId={exam.id}
          sectionId={chosen.classSectionId}
          lang={lang}
          canUpload={open}
          help={t(
            lang,
            'The sheet lists the section with each pupil’s last reading; fill height in cm and weight in kg (BMI is worked out).',
          )}
        />
      ) : null}
    </main>
  );
}
