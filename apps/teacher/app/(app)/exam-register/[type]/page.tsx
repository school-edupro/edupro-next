import {
  Alert,
  Breadcrumbs,
  Card,
  PageHeader,
  RegisterDownloads,
  RegisterSheet,
  type StudentRegisterResponse,
} from '@edupro/ui';
import { notFound } from 'next/navigation';
import { AutoSubmit } from '@/components/AutoSubmit';
import { RegisterTabs } from '@/components/RegisterTabs';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { currentLang } from '@/lib/i18n';

const ABOUT: Record<StudentRegisterResponse['type'], string> = {
  remark:
    'The remarks written in the exams picked: the general remark, each remark category used and participation, a column each, with "Promoted to" when given.',
  attendance:
    "Each exam's days present, days and %; with two or more exams the overall %. Students below the cut-off are marked and listed under the summary.",
  health:
    "Each exam's height, weight and BMI; with two or more exams the change from the first to the last; the class averages under the sheet.",
};
const NOTHING: Record<StudentRegisterResponse['type'], string> = {
  remark: 'No exam has remarks for this class yet.',
  attendance: 'No exam has attendance for this class yet.',
  health: 'No exam has heights or weights for this class yet.',
};

/**
 * The staff website's Remark, Attendance and Height & Weight registers (docs/design/97): the admin's page, for the
 * sections the person teaches. The legacy Student Registers (docs/design/69, part 1): the Remark, Attendance and Height & Weight
 * registers of a class — a section or all sections — for one or more exams (those with entries), on
 * screen and as PDF / Excel. Nothing is saved. A manager of mark registers sees every section; anyone
 * else the sections they teach.
 */
export default async function StudentRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<{
    classId?: string;
    section?: string;
    exam?: string | string[];
    cutoff?: string;
    bmi?: string;
  }>;
}) {
  const { type } = await params;
  if (!['remark', 'attendance', 'health'].includes(type)) notFound();
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.classId && /^\d{1,18}$/.test(sp.classId)) q.set('classId', sp.classId);
  if (sp.section && /^(all|\d{1,18})$/.test(sp.section)) q.set('section', sp.section);
  const exams = (Array.isArray(sp.exam) ? sp.exam : sp.exam ? [sp.exam] : []).filter((x) =>
    /^\d{1,18}$/.test(x),
  );
  if (exams.length) q.set('exams', exams.slice(0, 30).join(','));
  if (sp.cutoff && /^\d{1,3}$/.test(sp.cutoff) && Number(sp.cutoff) <= 100)
    q.set('cutoff', sp.cutoff);
  if (sp.bmi === '0' || sp.bmi === '1') q.set('bmi', sp.bmi);
  const [me, lang, reg] = await Promise.all([
    getMe(),
    currentLang(),
    apiFetch<StudentRegisterResponse>(`/exams/registers/${type}?${q.toString()}`).catch(
      (e: unknown) => {
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
        throw e;
      },
    ),
  ]);
  const klass = reg.classes.find((k) => k.id === reg.classId);
  const shown = {
    ...(reg.classId ? { classId: reg.classId } : {}),
    ...(reg.section ? { section: reg.section } : {}),
    exams: reg.picked.join(','),
    ...(reg.type === 'attendance' ? { cutoff: String(reg.cutoff) } : {}),
    ...(reg.type === 'health' ? { bmi: reg.bmi ? '1' : '0' } : {}),
  };
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 1400, margin: '0 auto' }}>
      <Breadcrumbs
        items={[{ label: 'Exam register', href: '/exam-register' }, { label: reg.title }]}
      />
      <PageHeader kicker="Registers" title={reg.title} description={ABOUT[reg.type]} />
      <RegisterTabs current={reg.type} permissions={me.permissions} lang={lang} />
      {!reg.classes.length ? (
        <Alert tone="warning" title="No class is open to you">
          The registers show the sections you teach this year (class teacher, subject teacher or
          coordinator), as set by the school in Teacher assignments.
        </Alert>
      ) : (
        <Card style={{ marginBottom: 'var(--sp-4)' }}>
          <form method="get" className="ep-streg-form">
            <div className="ep-mr-toolbar">
              <label className="ep-field" style={{ margin: 0, minWidth: '12rem' }}>
                <span className="ep-field__label">Class</span>
                <select className="ep-select" name="classId" defaultValue={reg.classId ?? ''}>
                  {reg.classes.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" style={{ margin: 0, minWidth: '10rem' }}>
                <span className="ep-field__label">Section</span>
                <select className="ep-select" name="section" defaultValue={reg.section ?? ''}>
                  {reg.sections.length > 1 ? <option value="all">All sections</option> : null}
                  {reg.sections.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.code}
                    </option>
                  ))}
                </select>
              </label>
              {reg.type === 'attendance' ? (
                <label className="ep-field" style={{ margin: 0, width: '8rem' }}>
                  <span className="ep-field__label">Cut-off %</span>
                  <input
                    className="ep-input"
                    type="number"
                    name="cutoff"
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={reg.cutoff}
                  />
                </label>
              ) : null}
              {reg.type === 'health' ? (
                <label className="ep-field" style={{ margin: 0, minWidth: '8rem' }}>
                  <span className="ep-field__label">BMI</span>
                  <select className="ep-select" name="bmi" defaultValue={reg.bmi ? '1' : '0'}>
                    <option value="1">Show</option>
                    <option value="0">Hide</option>
                  </select>
                </label>
              ) : null}
            </div>
            {reg.exams.length ? (
              <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="ep-field__label">Exams</legend>
                <div className="ep-mr-tiles">
                  {reg.exams.map((e) => (
                    <label key={e.id} className="ep-mr-tile">
                      <input
                        type="checkbox"
                        name="exam"
                        value={e.id}
                        defaultChecked={reg.picked.includes(e.id)}
                      />
                      <span>
                        {e.code}
                        <small>{e.name}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <div className="ep-mr-toolbar">
              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                Show
              </button>
            </div>
            <AutoSubmit />
          </form>
          {reg.places.length ? (
            <div className="ep-mr-toolbar" style={{ marginTop: 'var(--sp-3)' }}>
              <RegisterDownloads
                target={{
                  path: `/api/student-register/${reg.type}`,
                  query: shown,
                  all: { section: 'all' },
                }}
              />
            </div>
          ) : null}
        </Card>
      )}
      {reg.classes.length && !reg.exams.length ? (
        <Alert tone="info">{NOTHING[reg.type]}</Alert>
      ) : null}
      {reg.places.map((p) => (
        <Card key={p.id} elevated style={{ marginBottom: 'var(--sp-4)' }}>
          <h2 className="ep-streg-place">
            {klass?.name ?? ''} · {p.place}
          </h2>
          {p.notes.length ? (
            <ul className="ep-streg-notes">
              {p.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          {p.sheets.map((sheet, i) => (
            <section key={`${p.id}-${String(i)}`} className="ep-streg-sheet">
              {sheet.title ? <h3 className="ep-streg-title">{sheet.title}</h3> : null}
              {sheet.note ? <p className="ep-field__help">{sheet.note}</p> : null}
              <RegisterSheet
                sheet={sheet}
                label={`${reg.title} · ${p.place}${sheet.title ? ` · ${sheet.title}` : ''}`}
              />
            </section>
          ))}
        </Card>
      ))}
    </main>
  );
}
