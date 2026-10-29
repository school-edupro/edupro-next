import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { FileLinks } from '@/components/FileLinks';
import { PortfolioUpload } from '@/components/PortfolioUpload';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { removePhoto, saveLevels, saveWords } from './actions';

interface Exam {
  id: string;
  code: string;
  name: string;
}
interface EntrySection {
  classSectionId: string;
  code: string;
  register: boolean;
}
interface Item {
  id: string;
  name: string;
  area: string | null;
  parentId: string | null;
  kind: 'level' | 'text';
  heading: boolean;
}
interface Sheet {
  section: { id: string; code: string };
  locked: boolean;
  set: {
    name: string;
    grades: string[];
    kind: 'indicators' | 'hpc';
    levelWords: Record<string, string>;
  } | null;
  indicators: Item[];
  rows: Array<{
    studentId: string;
    name: string;
    rollNo: number | null;
    grades: Record<string, { grade: string | null; note: string | null }>;
    feedback?: Record<string, { text: string; byFamily: boolean }>;
    photos?: number;
  }>;
}
interface Photo {
  id: string;
  caption: string | null;
  indicator: string | null;
}
const ERRORS: Record<string, string> = {
  'exams.entry_locked': 'Indicator entry is locked; ask the coordinator to reopen it.',
  'exams.not_assigned': 'Only the class teacher of this section can enter these.',
  'exams.feedback_by_family':
    'The parent wrote this in the parent app; it is kept as they wrote it.',
  'exams.portfolio_full': 'A child has up to twelve photos in an exam; remove one first.',
  'scope-denied': 'You are not allowed to open this section.',
  'validation-failed': 'Some values were not accepted.',
};

/**
 * Indicators and the Holistic Progress Card (docs/design/65, part 5): the class teacher rates each
 * child on the area's competencies (a level, or a written note), and for the progress card writes the
 * child's words, the parent's and their own, and adds portfolio photos.
 */
export default async function IndicatorsPage({
  searchParams,
}: {
  searchParams: Promise<{
    exam?: string;
    section?: string;
    area?: string;
    student?: string;
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
          <PageHeader kicker="EduPro" title={t(lang, 'Indicators and progress card')} />
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
        `/exams/${exam.id}/indicators?classSectionId=${chosen.classSectionId}`,
      );
    } catch (error) {
      if (error instanceof ApiError) loadError = ERRORS[error.problem.type] ?? error.problem.type;
      else throw error;
    }
  }
  const items = sheet?.indicators ?? [];
  const areas = [...new Set(items.map((i) => i.area ?? 'Other'))];
  const area = areas.includes(sp.area ?? '') ? sp.area! : areas[0];
  const groups = items
    .filter((i) => !i.parentId && (i.area ?? 'Other') === area)
    .map((i) => ({ item: i, kids: items.filter((k) => k.parentId === i.id) }));
  const cells = groups.flatMap((g) => (g.kids.length ? g.kids : [g.item]));
  const hasGoals = groups.some((g) => g.kids.length);
  const open = !!sheet && !sheet.locked;
  const hpc = sheet?.set?.kind === 'hpc';
  const child = sheet?.rows.find((r) => r.studentId === sp.student) ?? sheet?.rows[0];
  const photos =
    hpc && exam && chosen && child
      ? await bff.api
          .fetch<{ data: Photo[] }>(
            `/exams/${exam.id}/portfolio?classSectionId=${chosen.classSectionId}&studentId=${child.studentId}`,
          )
          .then((r) => r.data)
          .catch(() => [] as Photo[])
      : [];
  const level = (g: string) =>
    sheet?.set?.levelWords[g] ? `${t(lang, g)} (${t(lang, sheet.set.levelWords[g])})` : t(lang, g);
  const hidden = (studentId?: string) =>
    exam && chosen ? (
      <>
        <input type="hidden" name="examId" value={exam.id} />
        <input type="hidden" name="classSectionId" value={chosen.classSectionId} />
        <input type="hidden" name="area" value={area ?? ''} />
        {studentId ? <input type="hidden" name="child" value={studentId} /> : null}
      </>
    ) : null;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 1100, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Indicators and progress card')}
        title={exam ? `${exam.name} (${exam.code})` : t(lang, 'Indicators and progress card')}
        description={
          sheet?.set
            ? `${sheet.section.code} · ${sheet.set.name}`
            : t(lang, 'Class teachers rate their section on the indicators of the exam.')
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
          {areas.length ? (
            <label className="ep-field" style={{ minWidth: 220 }}>
              <span className="ep-field__label">{t(lang, 'Area')}</span>
              <select className="ep-input" name="area" defaultValue={area}>
                {areas.map((a) => (
                  <option key={a} value={a}>
                    {t(lang, a)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button type="submit" variant="secondary">
            {t(lang, 'Open')}
          </Button>
        </form>
      </Card>
      {loadError ? <Card>{t(lang, loadError)}</Card> : null}
      {!loadError && exam && sections.length === 0 ? (
        <Card>{t(lang, 'You are not the class teacher of a section in this exam.')}</Card>
      ) : null}
      {sheet && !sheet.set ? (
        <Card>{t(lang, 'This section has no indicators in this exam.')}</Card>
      ) : null}
      {sheet?.set && exam && chosen ? (
        <Card
          title={`${sheet.section.code} · ${t(lang, area ?? '')}`}
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
          <form action={saveLevels}>
            {hidden()}
            {cells.map((c) => (
              <input key={c.id} type="hidden" name="item" value={c.id} />
            ))}
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label={t(lang, 'Indicators')}
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">{t(lang, 'Indicators')}</caption>
                <thead>
                  <tr>
                    <th scope="col" rowSpan={hasGoals ? 2 : 1}>
                      {t(lang, 'Roll')}
                    </th>
                    <th scope="col" rowSpan={hasGoals ? 2 : 1}>
                      {t(lang, 'Pupil')}
                    </th>
                    {groups.map((g) =>
                      g.kids.length ? (
                        <th key={g.item.id} scope="colgroup" colSpan={g.kids.length}>
                          {g.item.name}
                        </th>
                      ) : (
                        <th key={g.item.id} scope="col" rowSpan={hasGoals ? 2 : 1}>
                          {g.item.name}
                        </th>
                      ),
                    )}
                  </tr>
                  {hasGoals ? (
                    <tr>
                      {groups.flatMap((g) =>
                        g.kids.map((k) => (
                          <th key={k.id} scope="col">
                            {k.name}
                          </th>
                        )),
                      )}
                    </tr>
                  ) : null}
                </thead>
                <tbody>
                  {sheet.rows.map((r) => (
                    <tr key={r.studentId}>
                      <td>{r.rollNo ?? ''}</td>
                      <td>
                        <input type="hidden" name="studentId" value={r.studentId} />
                        {r.name}
                      </td>
                      {cells.map((c) => {
                        const v = r.grades[c.id];
                        const k = `${r.studentId}-${c.id}`;
                        return (
                          <td key={c.id}>
                            {c.kind === 'text' ? (
                              <input
                                className="ep-input"
                                name={`n-${k}`}
                                aria-label={`${c.name} · ${r.name}`}
                                defaultValue={v?.note ?? ''}
                                maxLength={600}
                                disabled={!open}
                                style={{ minWidth: 160 }}
                              />
                            ) : (
                              <select
                                className="ep-input"
                                name={`l-${k}`}
                                aria-label={`${c.name} · ${r.name}`}
                                defaultValue={v?.grade ?? ''}
                                disabled={!open}
                              >
                                <option value="">-</option>
                                {sheet.set!.grades.map((g) => (
                                  <option key={g} value={g}>
                                    {level(g)}
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
      {hpc && sheet && exam && chosen && child ? (
        <Card
          title={`${t(lang, 'In our words and the portfolio')} · ${child.name}`}
          style={{ marginTop: 'var(--sp-3)' }}
        >
          <form
            method="get"
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <input type="hidden" name="exam" value={exam.id} />
            <input type="hidden" name="section" value={chosen.classSectionId} />
            {area ? <input type="hidden" name="area" value={area} /> : null}
            <label className="ep-field" style={{ minWidth: 220 }}>
              <span className="ep-field__label">{t(lang, 'Pupil')}</span>
              <select className="ep-input" name="student" defaultValue={child.studentId}>
                {sheet.rows.map((r) => (
                  <option key={r.studentId} value={r.studentId}>
                    {r.rollNo ? `${String(r.rollNo)} · ` : ''}
                    {r.name} · {r.photos ?? 0} {t(lang, 'photos')}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="secondary">
              {t(lang, 'Open')}
            </Button>
          </form>
          <form action={saveWords} style={{ marginTop: 'var(--sp-3)' }}>
            {hidden()}
            <input type="hidden" name="studentId" value={child.studentId} />
            {(
              [
                ['self', 'All about me (the child’s words)'],
                ['parent', 'The parent’s feedback'],
                ['teacher', 'My observations'],
              ] as const
            ).map(([k, label]) => {
              const f = child.feedback?.[k];
              const theirs = k === 'parent' && f?.byFamily;
              return (
                <label key={k} className="ep-field">
                  <span className="ep-field__label">{t(lang, label)}</span>
                  <textarea
                    className="ep-input"
                    name={theirs ? undefined : k}
                    rows={3}
                    maxLength={2000}
                    defaultValue={f?.text ?? ''}
                    disabled={!open || Boolean(theirs)}
                  />
                  {theirs ? (
                    <span className="ep-field__help">
                      {t(lang, 'Written by the parent in the parent app.')}
                    </span>
                  ) : null}
                </label>
              );
            })}
            {open ? (
              <Button type="submit" variant="secondary">
                {t(lang, 'Save the words')}
              </Button>
            ) : null}
          </form>
          <h3 className="ep-cdash__h3">{t(lang, 'Portfolio')}</h3>
          {photos.length ? (
            <ul style={{ paddingLeft: 'var(--sp-4)' }}>
              {photos.map((p) => (
                <li key={p.id} style={{ marginBottom: 'var(--sp-2)' }}>
                  {p.caption ?? t(lang, 'Photo')}
                  {p.indicator ? ` · ${p.indicator}` : ''}{' '}
                  <FileLinks
                    url={`/api/portfolio/${exam.id}/${p.id}`}
                    saveUrl={`/api/portfolio/${exam.id}/${p.id}?save=1`}
                    label={p.caption ?? t(lang, 'Photo')}
                    viewLabel={t(lang, 'View')}
                    saveLabel={t(lang, 'Download')}
                  />
                  {open ? (
                    <form action={removePhoto} style={{ display: 'inline' }}>
                      {hidden(child.studentId)}
                      <input type="hidden" name="itemId" value={p.id} />{' '}
                      <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                        {t(lang, 'Remove')}
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">
              {t(lang, 'No photo yet (up to twelve; the card prints six).')}
            </p>
          )}
          {open ? (
            <PortfolioUpload
              examId={exam.id}
              classSectionId={chosen.classSectionId}
              studentId={child.studentId}
              items={items
                .filter((i) => !i.heading && i.kind === 'level')
                .map((i) => ({ id: i.id, name: i.name }))}
              words={{
                photo: t(lang, 'Photo (PNG or JPEG, up to 1 MB)'),
                caption: t(lang, 'Caption'),
                shows: t(lang, 'Shows (optional)'),
                add: t(lang, 'Add the photo'),
                added: t(lang, 'Added.'),
                type: t(lang, 'Choose a PNG or JPEG photo'),
                size: t(lang, 'The photo is larger than 1 MB'),
                choose: t(lang, 'Choose a photo'),
              }}
            />
          ) : null}
        </Card>
      ) : null}
    </main>
  );
}
