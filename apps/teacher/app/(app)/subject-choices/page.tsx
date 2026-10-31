import { Button, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { AutoSubmit } from '@/components/AutoSubmit';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { bringLastYear, saveChoices } from './actions';

interface Section {
  id: string;
  code: string;
  students: number;
  canEdit: boolean;
}
interface Subject {
  id: string;
  code: string;
  name: string;
  take: 'all' | 'group' | 'free';
  groupId: string | null;
}
interface Choices {
  section: { id: string; code: string };
  fromExams: boolean;
  subjects: Subject[];
  groups: Array<{
    id: string;
    name: string;
    kind: 'optional' | 'additional';
    min: number;
    max: number;
    subjectIds: string[];
  }>;
  streams: Array<{ id: string; name: string; subjectIds: string[] }>;
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    stream: string | null;
    subjects: Array<{ subjectId: string; kind: string }>;
    marked: string[];
  }>;
  canEdit: boolean;
}

/**
 * Subject choices of the class teacher's section (docs/design/67): the stream, the subject of each
 * choice group and the other subjects each student takes; the compulsory subjects come with them. A
 * subject with marks this year stays. The office sets the class's groups and streams.
 */
export default async function SubjectChoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    section?: string;
    ok?: string;
    copied?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let sections: Section[];
  try {
    sections = await bff.api
      .fetch<{ data: Section[] }>('/exams/subject-choices/sections')
      .then((r) => r.data.filter((s) => s.canEdit));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) sections = [];
    else throw error;
  }
  const chosen = sections.find((s) => s.id === sp.section) ?? sections[0];
  const data = chosen
    ? await bff.api.fetch<Choices>(`/exams/subject-choices?classSectionId=${chosen.id}`)
    : null;
  const code = (id: string) => data?.subjects.find((x) => x.id === id)?.code ?? '';
  const nameOf = (id: string) => {
    const x = data?.subjects.find((s) => s.id === id);
    return x ? `${x.name} (${x.code})` : '';
  };
  const compulsory = data?.subjects.filter((x) => x.take === 'all') ?? [];
  const free = data?.subjects.filter((x) => x.take === 'free') ?? [];
  const showStream = !!data && (data.streams.length > 0 || data.rows.some((r) => r.stream));
  const open = !!data?.canEdit;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 1100, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Marks')}
        title={t(lang, 'Subject choices')}
        description={t(
          lang,
          'The subjects each student of your section takes this year. The report card and the mark register follow them.',
        )}
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
          {sp.copied !== undefined
            ? `${sp.copied} ${t(lang, "students given last year's subjects")}.`
            : `${t(lang, 'Saved')}.`}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      {!sections.length ? (
        <Card>
          {t(
            lang,
            "A section's class teacher sets its students' subject choices; you are not the class teacher of a section this year.",
          )}
        </Card>
      ) : (
        <>
          <Card style={{ marginBottom: 'var(--sp-3)' }}>
            <form
              method="get"
              style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end' }}
            >
              <label className="ep-field" style={{ minWidth: '12rem' }}>
                <span className="ep-field__label">{t(lang, 'Section')}</span>
                <select className="ep-select" name="section" defaultValue={chosen?.id}>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} ({s.students})
                    </option>
                  ))}
                </select>
              </label>
              <AutoSubmit />
            </form>
          </Card>
          {data ? (
            <Card title={`${data.section.code}`}>
              {compulsory.length ? (
                <p className="ep-field__help" style={{ marginTop: 0 }}>
                  <strong>{t(lang, 'Everyone takes')}</strong>{' '}
                  {compulsory.map((x) => x.code).join(' · ')}.{' '}
                  {t(lang, 'A subject with marks this year stays.')}
                </p>
              ) : null}
              {!showStream && !data.groups.length && !free.length ? (
                <p>{t(lang, 'Every subject of the class is compulsory: nothing to choose.')}</p>
              ) : (
                <form action={saveChoices}>
                  <input type="hidden" name="classSectionId" value={data.section.id} />
                  {data.groups.map((g) => (
                    <input key={g.id} type="hidden" name="groupId" value={g.id} />
                  ))}
                  {data.streams.map((s) => (
                    <span key={s.id}>
                      <input type="hidden" name="streamName" value={s.name} />
                      <input type="hidden" name={`ss-${s.name}`} value={s.subjectIds.join(',')} />
                    </span>
                  ))}
                  <div
                    className="ep-table-wrap"
                    tabIndex={0}
                    role="region"
                    aria-label={t(lang, 'Subject choices')}
                  >
                    <table className="ep-table ep-table--dense">
                      <caption className="ep-sr-only">{t(lang, 'Subject choices')}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{t(lang, 'Roll')}</th>
                          <th scope="col">{t(lang, 'Student')}</th>
                          {showStream ? <th scope="col">{t(lang, 'Stream')}</th> : null}
                          {data.groups.map((g) => (
                            <th key={g.id} scope="col">
                              {g.name}
                            </th>
                          ))}
                          {free.length ? <th scope="col">{t(lang, 'Other subjects')}</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {data.rows.map((r) => {
                          const has = new Set(r.subjects.map((x) => x.subjectId));
                          const locked = (id: string) => has.has(id) && r.marked.includes(id);
                          return (
                            <tr key={r.studentId}>
                              <td>{r.rollNo ?? ''}</td>
                              <th scope="row">
                                <input type="hidden" name="studentId" value={r.studentId} />
                                <input
                                  type="hidden"
                                  name={`stream0-${r.studentId}`}
                                  value={r.stream ?? ''}
                                />
                                <input
                                  type="hidden"
                                  name={`set-${r.studentId}`}
                                  value={r.subjects.length ? '1' : ''}
                                />
                                <input
                                  type="hidden"
                                  name={`marked-${r.studentId}`}
                                  value={r.marked.filter((id) => has.has(id)).join(',')}
                                />
                                {r.name}
                                <span className="ep-kicker" style={{ display: 'block' }}>
                                  {r.admissionNo}
                                  {r.subjects.length
                                    ? ''
                                    : ` · ${t(lang, 'not set: takes every subject')}`}
                                </span>
                              </th>
                              {showStream ? (
                                <td>
                                  {data.streams.length ? (
                                    <select
                                      className="ep-select"
                                      name={`stream-${r.studentId}`}
                                      aria-label={`${t(lang, 'Stream')} · ${r.name}`}
                                      defaultValue={r.stream ?? ''}
                                      disabled={!open}
                                    >
                                      <option value="">-</option>
                                      {data.streams.map((s) => (
                                        <option key={s.id} value={s.name}>
                                          {s.name}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <>
                                      <input
                                        type="hidden"
                                        name={`stream-${r.studentId}`}
                                        value={r.stream ?? ''}
                                      />
                                      {r.stream}
                                    </>
                                  )}
                                </td>
                              ) : null}
                              {data.groups.map((g) => (
                                <td key={g.id}>
                                  {g.max === 1 ? (
                                    <select
                                      className="ep-select"
                                      name={`g-${r.studentId}-${g.id}`}
                                      aria-label={`${g.name} · ${r.name}`}
                                      defaultValue={g.subjectIds.find((id) => has.has(id)) ?? ''}
                                      disabled={!open || g.subjectIds.some(locked)}
                                    >
                                      <option value="">-</option>
                                      {g.subjectIds.map((id) => (
                                        <option key={id} value={id}>
                                          {nameOf(id)}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <fieldset
                                      style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
                                    >
                                      <legend className="ep-sr-only">{`${g.name} · ${r.name}`}</legend>
                                      {g.subjectIds.map((id) => (
                                        <label key={id} style={{ marginRight: 'var(--sp-2)' }}>
                                          <input
                                            type="checkbox"
                                            name={`g-${r.studentId}-${g.id}`}
                                            value={id}
                                            defaultChecked={has.has(id)}
                                            disabled={!open || locked(id)}
                                          />{' '}
                                          <abbr title={nameOf(id)}>{code(id)}</abbr>
                                        </label>
                                      ))}
                                    </fieldset>
                                  )}
                                </td>
                              ))}
                              {free.length ? (
                                <td>
                                  <fieldset
                                    style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
                                  >
                                    <legend className="ep-sr-only">{`${t(lang, 'Other subjects')} · ${r.name}`}</legend>
                                    {free.map((x) => (
                                      <label key={x.id} style={{ marginRight: 'var(--sp-2)' }}>
                                        <input
                                          type="checkbox"
                                          name={`f-${r.studentId}`}
                                          value={x.id}
                                          defaultChecked={has.has(x.id)}
                                          disabled={!open || locked(x.id)}
                                        />{' '}
                                        <abbr title={x.name}>{x.code}</abbr>
                                      </label>
                                    ))}
                                  </fieldset>
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {open ? (
                    <div className="ep-form-actions">
                      <Button type="submit">{t(lang, 'Save the choices')}</Button>
                    </div>
                  ) : null}
                </form>
              )}
              {open && !data.fromExams ? (
                <form action={bringLastYear} style={{ marginTop: 'var(--sp-4)' }}>
                  <input type="hidden" name="classSectionId" value={data.section.id} />
                  <p className="ep-field__help">
                    {t(
                      lang,
                      "Students without choices take their last year's subjects and stream.",
                    )}
                  </p>
                  <Button type="submit" variant="secondary" size="sm">
                    {t(lang, "Bring last year's choices")}
                  </Button>
                </form>
              ) : null}
            </Card>
          ) : null}
        </>
      )}
    </main>
  );
}
