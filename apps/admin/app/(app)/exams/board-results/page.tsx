import {
  Badge,
  Button,
  Card,
  DataTable,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FoldCard } from '@/components/FoldCard';
import { DialogButton } from '@/components/leave/DialogButton';
import { Notice } from '@/components/Notice';
import { boardImportCommit, boardImportValidate, masterExport } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import {
  addBoardTeacher,
  removeBoardTeacher,
  saveBoardSubject,
  setBoardLayout,
  uploadGazette,
} from '@/lib/board-actions';
import {
  statusOf,
  when,
  type BoardImport,
  type BoardLayout,
  type BoardSubjectKind,
  type BoardSubjectRow,
  type BoardTab,
  type BoardTeachers,
  type BoardYear,
} from '@/lib/board-results';

interface BoardRow extends Record<string, string | null> {
  id: string;
}
interface Analysis extends Record<string, string | number | null> {
  class_label: string;
  subject_code: string;
}

const TABS: BoardTab[] = ['upload', 'results', 'analysis', 'teachers', 'setup'];
const KINDS: BoardSubjectKind[] = ['language', 'main', 'skill', 'additional', 'internal'];

/**
 * Board results (docs/design/88): Upload CBSE's result file (the .TXT gazette, read with a known layout or one the
 * AI learns from masked lines) or an Excel / CSV file; Results; Analysis; Set-up (the layouts).
 */
export default async function BoardResultsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    classLabel?: string;
    examYear?: string;
    subjects?: string;
    q?: string;
    import?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, b, me] = await Promise.all([
    getTranslations('pages.exams_board_results'),
    getTranslations('boardResults'),
    getMe(),
  ]);
  const canImport = me.permissions.includes('exams.board_result.import');
  const tab: BoardTab = TABS.includes(sp.tab as BoardTab)
    ? (sp.tab as BoardTab)
    : sp.import || canImport
      ? 'upload'
      : 'results';
  const q = new URLSearchParams({ size: '200' });
  if (sp.classLabel) q.set('classLabel', sp.classLabel);
  if (sp.q) q.set('q', sp.q);
  const cls = sp.classLabel === 'XII' ? 'XII' : 'X';
  const subjectsCls = sp.subjects === 'XII' ? 'XII' : 'X';
  const [list, imports, years, layouts, teachers, subjects] = await Promise.all([
    tab === 'results' || tab === 'analysis'
      ? apiFetch<{ data: BoardRow[]; page: { total: number }; analysis: Analysis[] }>(
          `/exams/board-results?${q.toString()}`,
        )
      : null,
    tab === 'upload'
      ? apiFetch<{ data: BoardImport[] }>('/exams/board-results/imports').then((x) => x.data)
      : ([] as BoardImport[]),
    tab === 'upload' && canImport
      ? apiFetch<{ data: BoardYear[] }>('/exams/board-results/years').then((x) => x.data)
      : ([] as BoardYear[]),
    tab === 'setup'
      ? apiFetch<{ data: BoardLayout[] }>('/exams/board-results/layouts').then((x) => x.data)
      : ([] as BoardLayout[]),
    tab === 'teachers'
      ? apiFetch<BoardTeachers>(
          `/exams/board-results/teachers?classLabel=${cls}${/^\d{4}$/.test(sp.examYear ?? '') ? `&examYear=${sp.examYear!}` : ''}`,
        )
      : null,
    tab === 'setup'
      ? apiFetch<{
          rows: BoardSubjectRow[];
          options: Array<{ id: string; name: string; code: string }>;
        }>(`/exams/board-results/subjects?classLabel=${subjectsCls}`)
      : null,
  ]);
  const current = imports.find((i) => i.id === sp.import && i.kind === 'sheet') ?? null;
  const yearNow = years.find((y) => y.current) ?? years[0];

  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={b('pageHelp')}
        actions={
          tab === 'results' ? (
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              {(['xlsx', 'pdf'] as const).map((format) => (
                <form key={format} action={masterExport}>
                  <input type="hidden" name="master" value="__dataset__" />
                  <input type="hidden" name="dataset" value="board_results" />
                  <input type="hidden" name="back" value="/exams/board-results?tab=results" />
                  <input type="hidden" name="format" value={format} />
                  <Button type="submit" variant="secondary" size="sm">
                    {b(format === 'xlsx' ? 'excel' : 'pdf')}
                  </Button>
                </form>
              ))}
            </span>
          ) : undefined
        }
      />
      <Notice params={sp} />
      <nav
        className="ep-tabs-links"
        aria-label={t('title')}
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {TABS.map((x) => (
          <a
            key={x}
            href={`/exams/board-results?tab=${x}`}
            aria-current={tab === x ? 'page' : undefined}
          >
            {b(`tab_${x}`)}
          </a>
        ))}
      </nav>

      {tab === 'upload' ? (
        <div style={{ display: 'grid', gap: 'var(--sp-5)' }}>
          {canImport ? (
            <Card title={b('gazette')}>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                {b('gazetteHelp')}
              </p>
              <form action={uploadGazette}>
                <FormRow columns={3}>
                  <SelectField
                    id="gzClass"
                    name="classLabel"
                    label={b('classLabel')}
                    required
                    options={[
                      { value: 'X', label: 'X' },
                      { value: 'XII', label: 'XII' },
                    ]}
                  />
                  <SelectField
                    id="gzYear"
                    name="academicYearId"
                    label={b('academicYear')}
                    required
                    defaultValue={yearNow?.id ?? ''}
                    options={years.map((y) => ({
                      value: y.id,
                      label: b('examOf', { year: y.name, exam: y.examYear }),
                    }))}
                  />
                  <label className="ep-field" htmlFor="gzFile">
                    <span className="ep-field__label">{b('gazetteFile')} *</span>
                    <input
                      id="gzFile"
                      className="ep-input"
                      type="file"
                      name="file"
                      accept=".txt,.TXT,text/plain"
                      required
                    />
                  </label>
                </FormRow>
                <p className="ep-field__help">{b('aiNote')}</p>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="submit">{b('uploadCheck')}</Button>
                </div>
              </form>
            </Card>
          ) : null}

          <Card title={b('uploads')}>
            <DataTable<BoardImport>
              caption={b('uploads')}
              density="dense"
              columns={[
                {
                  key: 'f',
                  header: b('fileCol'),
                  render: (i) => (
                    <a
                      href={
                        i.kind === 'gazette'
                          ? `/exams/board-results/imports/${i.id}`
                          : `/exams/board-results?tab=upload&import=${i.id}`
                      }
                    >
                      {i.fileName || b(i.kind === 'gazette' ? 'kind_gazette' : 'kind_sheet')}
                    </a>
                  ),
                },
                { key: 'c', header: b('classLabel'), render: (i) => i.classLabel },
                {
                  key: 'y',
                  header: b('examYear'),
                  render: (i) => (i.examYear ? String(i.examYear) : '—'),
                },
                {
                  key: 'k',
                  header: b('kind'),
                  render: (i) => b(i.kind === 'gazette' ? 'kind_gazette' : 'kind_sheet'),
                },
                {
                  key: 'n',
                  header: b('candidates'),
                  numeric: true,
                  render: (i) => String(i.figures.candidates ?? i.totalRows),
                },
                {
                  key: 's',
                  header: b('state'),
                  render: (i) => {
                    const s = statusOf(i);
                    return <Badge tone={s.tone}>{b(`state_${s.key}`)}</Badge>;
                  },
                },
                { key: 'w', header: b('uploadedOn'), render: (i) => when(i.createdAt) },
              ]}
              rows={imports}
              rowKey={(i) => i.id}
              emptyTitle={b('noUploads')}
            />
          </Card>

          {canImport ? (
            <FoldCard
              id="sheet-import"
              title={b('sheet')}
              hint={b('sheetHint')}
              open={Boolean(current)}
            >
              <form action={boardImportValidate}>
                <FormRow columns={3}>
                  <InputField
                    id="board"
                    name="board"
                    label={b('board')}
                    defaultValue="CBSE"
                    pattern="[A-Z]{2,10}"
                  />
                  <SelectField
                    id="classLabel"
                    name="classLabel"
                    label={b('classLabel')}
                    options={[
                      { value: 'X', label: 'X' },
                      { value: 'XII', label: 'XII' },
                    ]}
                  />
                  <label className="ep-field" htmlFor="sheetFile">
                    <span className="ep-field__label">{b('file')}</span>
                    <input
                      id="sheetFile"
                      className="ep-input"
                      type="file"
                      name="file"
                      accept=".csv,.xlsx"
                      required
                    />
                  </label>
                </FormRow>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="submit" variant="secondary">
                    {b('validate')}
                  </Button>
                </div>
              </form>
              {current ? (
                <div className="ep-master__report">
                  <strong>{b('report')}</strong> · {current.fileName ?? ''} ·{' '}
                  {b('rows', {
                    ok: current.okRows,
                    total: current.totalRows,
                    rejected: current.rejectedRows,
                    unmatched: current.unmatchedRows,
                  })}
                  {current.status === 'validated' ? (
                    <form action={boardImportCommit} style={{ marginTop: 'var(--sp-2)' }}>
                      <input type="hidden" name="importId" value={current.id} />
                      <Button type="submit">{b('commit', { ok: current.okRows })}</Button>
                    </form>
                  ) : null}
                  {current.status === 'committed' ? (
                    <div>
                      <Badge tone="success">{b('committed')}</Badge>
                    </div>
                  ) : null}
                  {current.status === 'failed' ? (
                    <p className="ep-field__help">{b('failed')}</p>
                  ) : null}
                  {current.report.length ? (
                    <table className="ep-table ep-table--dense">
                      <tbody>
                        {current.report.slice(0, 50).map((r, i) => (
                          <tr key={i}>
                            <td>{r.row || ''}</td>
                            <td>{r.column}</td>
                            <td>{r.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>
              ) : null}
            </FoldCard>
          ) : null}
        </div>
      ) : null}

      {tab === 'analysis' && list ? (
        <Card title={b('analysis')}>
          <DataTable<Analysis>
            caption={b('analysis')}
            density="dense"
            columns={[
              { key: 'c', header: b('classLabel'), render: (x) => x.class_label },
              {
                key: 's',
                header: b('subject'),
                render: (x) => `${x.subject_code} · ${x.subject_name ?? ''}`,
              },
              { key: 'n', header: b('candidates'), numeric: true, render: (x) => x.candidates },
              { key: 'm', header: b('mean'), numeric: true, render: (x) => x.mean ?? '' },
              { key: 'h', header: b('highest'), numeric: true, render: (x) => x.highest ?? '' },
              { key: 'l', header: b('lowest'), numeric: true, render: (x) => x.lowest ?? '' },
              { key: 'p', header: b('passed'), numeric: true, render: (x) => x.passed },
              {
                key: 'd',
                header: b('distinctions'),
                numeric: true,
                render: (x) => x.distinctions,
              },
              {
                key: 'u',
                header: b('unlinked'),
                numeric: true,
                render: (x) =>
                  Number(x.unlinked) ? <Badge tone="warning">{x.unlinked}</Badge> : 0,
              },
            ]}
            rows={list.analysis}
            rowKey={(x) => `${x.class_label}-${x.subject_code}`}
            emptyTitle="—"
          />
        </Card>
      ) : null}

      {tab === 'results' && list ? (
        <Card
          title={`${b('results')} · ${list.page.total}`}
          actions={
            <form
              method="get"
              style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
            >
              <input type="hidden" name="tab" value="results" />
              <SelectField
                id="fc"
                name="classLabel"
                label={b('classLabel')}
                defaultValue={sp.classLabel ?? ''}
                options={[
                  { value: '', label: '—' },
                  { value: 'X', label: 'X' },
                  { value: 'XII', label: 'XII' },
                ]}
              />
              <InputField
                id="fq"
                name="q"
                label={b('search')}
                defaultValue={sp.q ?? ''}
                maxLength={80}
              />
              <Button type="submit" variant="secondary" size="sm">
                {b('search')}
              </Button>
            </form>
          }
        >
          <DataTable<BoardRow>
            caption={b('results')}
            density="dense"
            columns={[
              { key: 'r', header: b('rollNo'), render: (x) => <strong>{x.roll_no}</strong> },
              {
                key: 'c',
                header: b('candidate'),
                render: (x) => (
                  <>
                    {x.candidate_name ?? ''}
                    <div className="ep-kicker">
                      {x.student ? `${x.student} · ${x.admission_no}` : b('unlinked')}
                    </div>
                  </>
                ),
              },
              {
                key: 's',
                header: b('subject'),
                render: (x) => `${x.subject_code} · ${x.subject_name ?? ''}`,
              },
              { key: 't', header: b('theory'), numeric: true, render: (x) => x.theory ?? '' },
              {
                key: 'p',
                header: b('practical'),
                numeric: true,
                render: (x) => x.practical ?? '',
              },
              { key: 'tot', header: b('total'), numeric: true, render: (x) => x.total ?? '' },
              { key: 'g', header: b('grade'), render: (x) => x.grade ?? '' },
              { key: 'res', header: b('result'), render: (x) => x.result ?? '' },
            ]}
            rows={list.data}
            rowKey={(x) => x.id}
            emptyTitle="—"
          />
        </Card>
      ) : null}

      {tab === 'teachers' && teachers ? (
        <Card title={b('teachers')}>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {b('teachersHelp')}
          </p>
          <form
            method="get"
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
              marginBottom: 'var(--sp-3)',
            }}
          >
            <input type="hidden" name="tab" value="teachers" />
            <SelectField
              id="tCls"
              name="classLabel"
              label={b('classLabel')}
              defaultValue={cls}
              options={[
                { value: 'X', label: 'X' },
                { value: 'XII', label: 'XII' },
              ]}
            />
            <SelectField
              id="tYear"
              name="examYear"
              label={b('examYear')}
              defaultValue={String(teachers.examYear ?? '')}
              options={teachers.years.map((y) => ({ value: String(y), label: String(y) }))}
            />
            <Button type="submit" variant="secondary" size="sm">
              {b('show')}
            </Button>
            {canImport && teachers.examYear ? (
              <DialogButton
                id="set-teacher"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                label={b('setTeacher')}
                title={b('setTeacher')}
              >
                <form action={addBoardTeacher} className="ep-cert-fields">
                  <input type="hidden" name="classLabel" value={teachers.classLabel} />
                  <input type="hidden" name="examYear" value={String(teachers.examYear)} />
                  <p className="ep-field__help" style={{ gridColumn: '1 / -1', margin: 0 }}>
                    {b('setTeacherHelp')}
                  </p>
                  <SelectField
                    id="stSection"
                    name="section"
                    label={b('section')}
                    required
                    options={[
                      ...new Set(
                        teachers.rows.map((r) => r.section).filter((x): x is string => Boolean(x)),
                      ),
                    ].map((x) => ({ value: x, label: x }))}
                  />
                  <SelectField
                    id="stCode"
                    name="code"
                    label={b('subjectCol')}
                    required
                    options={[...new Map(teachers.rows.map((r) => [r.code, r.name])).entries()].map(
                      ([code, name]) => ({
                        value: code,
                        label: `${code} ${name ?? ''}`.trim(),
                      }),
                    )}
                  />
                  <SelectField
                    id="stEmp"
                    name="employeeId"
                    label={b('teacher')}
                    options={[
                      { value: '', label: b('orName') },
                      ...teachers.options.map((e) => ({
                        value: e.id,
                        label: `${e.name} · ${e.code}`,
                      })),
                    ]}
                  />
                  <InputField
                    id="stName"
                    name="teacherName"
                    label={b('teacherName')}
                    maxLength={120}
                  />
                  <label className="ep-field" htmlFor="stRolls" style={{ gridColumn: '1 / -1' }}>
                    <span className="ep-field__label">{b('rollsField')}</span>
                    <textarea id="stRolls" name="rolls" className="ep-input" rows={2} />
                    <span className="ep-field__help">{b('rollsHelp')}</span>
                  </label>
                  <div>
                    <Button type="submit">{b('save')}</Button>
                  </div>
                </form>
              </DialogButton>
            ) : null}
          </form>
          <DataTable<BoardTeachers['rows'][number] & { k: string }>
            caption={b('teachers')}
            density="dense"
            columns={[
              {
                key: 's',
                header: b('subjectCol'),
                render: (r) => (
                  <>
                    <strong>{r.code}</strong> {r.name ?? ''}
                  </>
                ),
              },
              { key: 'sec', header: b('section'), render: (r) => r.section ?? '—' },
              {
                key: 'n',
                header: b('candidates'),
                numeric: true,
                render: (r) => String(r.candidates),
              },
              {
                key: 't',
                header: b('teacher'),
                render: (r) =>
                  r.teachers.map((t, i) => (
                    <div key={i}>
                      {t.name ?? <Badge tone="warning">{b('noTeacher')}</Badge>}
                      {r.teachers.length > 1 ? ` (${String(t.candidates)})` : ''}
                    </div>
                  )),
              },
              {
                key: 'o',
                header: b('changedHere'),
                render: (r) =>
                  r.overrides.length
                    ? r.overrides.map((o) => (
                        <div
                          key={o.id}
                          style={{
                            display: 'flex',
                            gap: 'var(--sp-2)',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span>
                            {o.name}
                            {o.rolls.length ? ` · ${o.rolls.join(', ')}` : ''}
                          </span>
                          {canImport ? (
                            <form action={removeBoardTeacher}>
                              <input type="hidden" name="id" value={o.id} />
                              <input type="hidden" name="classLabel" value={teachers.classLabel} />
                              <input
                                type="hidden"
                                name="examYear"
                                value={String(teachers.examYear ?? '')}
                              />
                              <Button type="submit" variant="ghost" size="sm">
                                {b('remove')}
                                <span className="ep-sr-only"> {o.name}</span>
                              </Button>
                            </form>
                          ) : null}
                        </div>
                      ))
                    : '—',
              },
            ]}
            rows={teachers.rows.map((r) => ({ ...r, k: `${r.code}-${r.section ?? ''}` }))}
            rowKey={(r) => r.k}
            emptyTitle={b('noYear')}
          />
        </Card>
      ) : null}

      {tab === 'setup' ? (
        <Card title={b('layouts')}>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {b('layoutsHelp')}
          </p>
          <DataTable<BoardLayout>
            caption={b('layouts')}
            density="dense"
            columns={[
              { key: 'n', header: b('layoutName'), render: (l) => <strong>{l.name}</strong> },
              { key: 'c', header: b('classLabel'), render: (l) => l.classLabel },
              {
                key: 's',
                header: b('source'),
                render: (l) =>
                  l.source === 'built-in'
                    ? b('src_builtin')
                    : l.source === 'claude'
                      ? `${b('src_claude')}${l.model ? ` (${l.model})` : ''}`
                      : b('src_edited'),
              },
              {
                key: 'f',
                header: b('learnedFrom'),
                render: (l) =>
                  l.learnedFrom ? (
                    <a href={`/exams/board-results/imports/${l.learnedFrom.importId}`}>
                      {l.learnedFrom.fileName ?? b('kind_gazette')}
                    </a>
                  ) : (
                    '—'
                  ),
              },
              { key: 'w', header: b('learnedOn'), render: (l) => when(l.createdAt) },
              {
                key: 'a',
                header: b('state'),
                render: (l) => (
                  <Badge tone={l.active ? 'success' : 'neutral'}>
                    {b(l.active ? 'inUse' : 'switchedOff')}
                  </Badge>
                ),
              },
              {
                key: 'x',
                header: b('actions'),
                render: (l) =>
                  l.source !== 'built-in' && canImport ? (
                    <ConfirmAction
                      action={setBoardLayout}
                      fields={{ id: l.key.slice(3), active: String(!l.active) }}
                      label={b(l.active ? 'switchOff' : 'switchOn')}
                      title={b(l.active ? 'switchOff' : 'switchOn')}
                      confirmLabel={b(l.active ? 'switchOff' : 'switchOn')}
                      variant="ghost"
                    >
                      {b(l.active ? 'switchOffHelp' : 'switchOnHelp')}
                    </ConfirmAction>
                  ) : null,
              },
            ]}
            rows={layouts}
            rowKey={(l) => l.key}
            emptyTitle="—"
          />
        </Card>
      ) : null}

      {tab === 'setup' && subjects ? (
        <Card
          title={b('cbseSubjects')}
          style={{ marginTop: 'var(--sp-5)' }}
          actions={
            <nav className="ep-tabs-links" aria-label={b('cbseSubjects')}>
              {(['X', 'XII'] as const).map((x) => (
                <a
                  key={x}
                  href={`/exams/board-results?tab=setup&subjects=${x}`}
                  aria-current={subjectsCls === x ? 'page' : undefined}
                >
                  {b('classLabel')} {x}
                </a>
              ))}
            </nav>
          }
        >
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {b('cbseSubjectsHelp')}
          </p>
          <DataTable<BoardSubjectRow>
            caption={b('cbseSubjects')}
            density="dense"
            columns={[
              { key: 'c', header: b('code'), render: (x) => <strong>{x.code}</strong> },
              {
                key: 'n',
                header: b('name'),
                render: (x) => x.name ?? <Badge tone="warning">{b('notNamed')}</Badge>,
              },
              { key: 'k', header: b('kindCol'), render: (x) => b(`kind_${x.kind}`) },
              { key: 's', header: b('schoolSubject'), render: (x) => x.subject?.name ?? '—' },
              {
                key: 'u',
                header: b('candidates'),
                numeric: true,
                render: (x) => String(x.candidates),
              },
              {
                key: 'e',
                header: b('actions'),
                render: (x) =>
                  canImport ? (
                    <DialogButton
                      id={`subj-${x.id}`}
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      label={
                        <>
                          {b('edit')}
                          <span className="ep-sr-only"> {x.code}</span>
                        </>
                      }
                      title={`${x.code} ${x.name ?? ''}`.trim()}
                    >
                      <form action={saveBoardSubject} className="ep-cert-fields">
                        <input type="hidden" name="id" value={x.id} />
                        <input type="hidden" name="classLabel" value={subjectsCls} />
                        <InputField
                          id={`sn-${x.id}`}
                          name="name"
                          label={b('name')}
                          defaultValue={x.name ?? ''}
                          required
                          maxLength={120}
                        />
                        <SelectField
                          id={`sk-${x.id}`}
                          name="kind"
                          label={b('kindCol')}
                          defaultValue={x.kind}
                          options={KINDS.map((k) => ({ value: k, label: b(`kind_${k}`) }))}
                        />
                        <SelectField
                          id={`ss-${x.id}`}
                          name="subjectId"
                          label={b('schoolSubject')}
                          defaultValue={x.subject?.id ?? ''}
                          options={[
                            { value: '', label: '—' },
                            ...subjects.options.map((o) => ({
                              value: o.id,
                              label: `${o.name} (${o.code})`,
                            })),
                          ]}
                        />
                        <div>
                          <Button type="submit">{b('save')}</Button>
                        </div>
                      </form>
                    </DialogButton>
                  ) : null,
              },
            ]}
            rows={subjects.rows}
            rowKey={(x) => x.id}
            emptyTitle="—"
          />
          {canImport ? (
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <DialogButton
                id="subj-add"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                label={b('addCode')}
                title={b('addCode')}
              >
                <form action={saveBoardSubject} className="ep-cert-fields">
                  <input type="hidden" name="classLabel" value={subjectsCls} />
                  <InputField
                    id="naCode"
                    name="code"
                    label={b('code')}
                    required
                    pattern="[0-9]{3}"
                    maxLength={3}
                  />
                  <InputField id="naName" name="name" label={b('name')} required maxLength={120} />
                  <SelectField
                    id="naKind"
                    name="kind"
                    label={b('kindCol')}
                    defaultValue="main"
                    options={KINDS.map((k) => ({ value: k, label: b(`kind_${k}`) }))}
                  />
                  <SelectField
                    id="naSubject"
                    name="subjectId"
                    label={b('schoolSubject')}
                    options={[
                      { value: '', label: '—' },
                      ...subjects.options.map((o) => ({
                        value: o.id,
                        label: `${o.name} (${o.code})`,
                      })),
                    ]}
                  />
                  <div>
                    <Button type="submit">{b('save')}</Button>
                  </div>
                </form>
              </DialogButton>
            </div>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
