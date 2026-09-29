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
import { Notice } from '@/components/Notice';
import { boardImportCommit, boardImportValidate, masterExport } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';

interface BoardImport {
  id: string;
  board: string;
  classLabel: string;
  fileName: string | null;
  status: 'validated' | 'committed' | 'failed';
  totalRows: number;
  okRows: number;
  rejectedRows: number;
  unmatchedRows: number;
  report: Array<{ row: number; column: string; message: string }>;
  createdAt: string;
}
interface BoardRow extends Record<string, string | null> {
  id: string;
}
interface Analysis extends Record<string, string | number | null> {
  class_label: string;
  subject_code: string;
}

/** Sprint 18: board result import and analysis. */
export default async function BoardResultsPage({
  searchParams,
}: {
  searchParams: Promise<{
    classLabel?: string;
    q?: string;
    import?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams({ size: '200' });
  if (sp.classLabel) q.set('classLabel', sp.classLabel);
  if (sp.q) q.set('q', sp.q);
  const [t, b, me, list, imports] = await Promise.all([
    getTranslations('pages.exams_board_results'),
    getTranslations('boardResults'),
    getMe(),
    apiFetch<{ data: BoardRow[]; page: { total: number }; analysis: Analysis[] }>(
      `/exams/board-results?${q.toString()}`,
    ),
    apiFetch<{ data: BoardImport[] }>('/exams/board-results/imports').then((x) => x.data),
  ]);
  const canImport = me.permissions.includes('exams.board_result.import');
  const current = imports.find((i) => i.id === sp.import) ?? null;
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            {(['xlsx', 'pdf'] as const).map((format) => (
              <form key={format} action={masterExport}>
                <input type="hidden" name="master" value="__dataset__" />
                <input type="hidden" name="dataset" value="board_results" />
                <input type="hidden" name="back" value="/exams/board-results" />
                <input type="hidden" name="format" value={format} />
                <Button type="submit" variant="secondary" size="sm">
                  {b(format === 'xlsx' ? 'excel' : 'pdf')}
                </Button>
              </form>
            ))}
          </span>
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        {canImport ? (
          <Card title={b('upload')}>
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
                <label className="ep-field">
                  <span className="ep-field__label">{b('file')}</span>
                  <input
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
            {imports.length ? (
              <details style={{ marginTop: 'var(--sp-3)' }}>
                <summary className="ep-kicker">{b('recent')}</summary>
                <table className="ep-table ep-table--dense">
                  <tbody>
                    {imports.map((i) => (
                      <tr key={i.id}>
                        <td>{i.createdAt.slice(0, 16).replace('T', ' ')}</td>
                        <td>
                          {i.board} {i.classLabel}
                        </td>
                        <td>
                          <Badge
                            tone={
                              i.status === 'committed'
                                ? 'success'
                                : i.status === 'failed'
                                  ? 'danger'
                                  : 'warning'
                            }
                          >
                            {i.status}
                          </Badge>
                        </td>
                        <td>
                          {b('rows', {
                            ok: i.okRows,
                            total: i.totalRows,
                            rejected: i.rejectedRows,
                            unmatched: i.unmatchedRows,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ) : null}
          </Card>
        ) : null}
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
              { key: 'd', header: b('distinctions'), numeric: true, render: (x) => x.distinctions },
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
      </div>
      <Card
        title={`${b('results')} · ${list.page.total}`}
        style={{ marginTop: 'var(--sp-5)' }}
        actions={
          <form
            method="get"
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
          >
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
            { key: 'p', header: b('practical'), numeric: true, render: (x) => x.practical ?? '' },
            { key: 'tot', header: b('total'), numeric: true, render: (x) => x.total ?? '' },
            { key: 'g', header: b('grade'), render: (x) => x.grade ?? '' },
            { key: 'res', header: b('result'), render: (x) => x.result ?? '' },
          ]}
          rows={list.data}
          rowKey={(x) => x.id}
          emptyTitle="—"
        />
      </Card>
    </>
  );
}
