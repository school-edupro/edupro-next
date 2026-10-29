import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { saveRemarkItems } from './actions';

interface Exam {
  id: string;
  code: string;
  name: string;
}
interface Sheet {
  section: { id: string; code: string };
  locked: boolean;
  categories: Array<{
    id: string;
    name: string;
    subjectName: string | null;
    freeText: boolean;
    may: boolean;
    bank: Array<{ code: string; text: string }>;
  }>;
  rows: Array<{
    studentId: string;
    name: string;
    rollNo: number | null;
    items: Record<string, { text: string }>;
  }>;
}
const ERRORS: Record<string, string> = {
  'exams.entry_locked': 'Remarks are locked; ask the coordinator to reopen them.',
  'exams.not_assigned':
    'You write only your own sections’ remarks (a subject teacher, their subject’s).',
  'exams.remark_list_only': 'This category takes one of its listed remarks only.',
  'validation-failed': 'Some values were not accepted.',
};

/**
 * Remarks by category (docs/design/65, part 7): the class teacher writes every category of the
 * section; a subject teacher the category of their subject (for example "English remarks").
 */
export default async function RemarksPage({
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
          <PageHeader kicker="EduPro" title={t(lang, 'Remarks')} />
          <Card>{t(lang, 'You are not allowed to open exam registers in this school.')}</Card>
        </main>
      );
    throw error;
  }
  const exam = exams.find((e) => e.id === sp.exam) ?? exams[0];
  const sections = exam
    ? (
        await bff.api.fetch<{ data: Array<{ classSectionId: string; code: string }> }>(
          `/exams/${exam.id}/entry/sections`,
        )
      ).data
    : [];
  const chosen = sections.find((s) => s.classSectionId === sp.section) ?? sections[0];
  let sheet: Sheet | null = null;
  let loadError: string | null = null;
  if (exam && chosen) {
    try {
      sheet = await bff.api.fetch<Sheet>(
        `/exams/${exam.id}/remark-items?classSectionId=${chosen.classSectionId}`,
      );
    } catch (error) {
      if (error instanceof ApiError) loadError = ERRORS[error.problem.type] ?? error.problem.type;
      else throw error;
    }
  }
  const cats = (sheet?.categories ?? []).filter((k) => k.may);
  const open = !!sheet && !sheet.locked;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 1100, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Remarks')}
        title={exam ? `${exam.name} (${exam.code})` : t(lang, 'Remarks')}
        description={t(lang, 'One remark per pupil and category; the report card prints them.')}
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
          {t(lang, 'Saved')}.
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
      {loadError ? <Card>{t(lang, loadError)}</Card> : null}
      {sheet && !cats.length ? (
        <Card>{t(lang, 'There is no remark category for you to write in this section.')}</Card>
      ) : null}
      {sheet && exam && chosen && cats.length ? (
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
          {cats.map((k) =>
            k.freeText ? (
              <datalist key={k.id} id={`rb-${k.id}`}>
                {k.bank.map((b) => (
                  <option key={b.code} value={b.text} />
                ))}
              </datalist>
            ) : null,
          )}
          <form action={saveRemarkItems}>
            <input type="hidden" name="examId" value={exam.id} />
            <input type="hidden" name="classSectionId" value={chosen.classSectionId} />
            {cats.map((k) => (
              <input key={k.id} type="hidden" name="category" value={k.id} />
            ))}
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label={t(lang, 'Remarks')}
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">{t(lang, 'Remarks')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t(lang, 'Roll')}</th>
                    <th scope="col">{t(lang, 'Pupil')}</th>
                    {cats.map((k) => (
                      <th key={k.id} scope="col">
                        {k.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((r) => (
                    <tr key={r.studentId}>
                      <td>{r.rollNo ?? ''}</td>
                      <td>
                        <input type="hidden" name="studentId" value={r.studentId} />
                        {r.name}
                      </td>
                      {cats.map((k) => {
                        const v = r.items[k.id]?.text ?? '';
                        const name = `r-${r.studentId}-${k.id}`;
                        return (
                          <td key={k.id} style={{ minWidth: 220 }}>
                            {k.freeText ? (
                              <input
                                className="ep-input"
                                name={name}
                                list={`rb-${k.id}`}
                                aria-label={`${k.name} · ${r.name}`}
                                maxLength={600}
                                defaultValue={v}
                                disabled={!open}
                              />
                            ) : (
                              <select
                                className="ep-input"
                                name={name}
                                aria-label={`${k.name} · ${r.name}`}
                                defaultValue={v}
                                disabled={!open}
                              >
                                <option value="">-</option>
                                {k.bank.map((b) => (
                                  <option key={b.code} value={b.text}>
                                    {b.text}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {open ? (
              <div className="ep-form-actions" style={{ marginTop: 'var(--sp-3)' }}>
                <Button type="submit">{t(lang, 'Save')}</Button>
              </div>
            ) : null}
          </form>
        </Card>
      ) : null}
    </main>
  );
}
