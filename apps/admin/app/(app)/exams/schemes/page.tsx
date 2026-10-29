import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { createMarkScheme } from '@/lib/exam-entry-actions';
import { apiFetch, getMe } from '@/lib/api';
import { SCHEME_STATUS, type MarkScheme, type SchemePreset } from '@/lib/mark-schemes';
import type { ClassRow, Exam, Page } from '@/lib/types';

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(iso))
    : '';

/**
 * Mark schemes (docs/design/65, part 3): how a term's marks are made from the exams (the old Dynamic
 * Mark Register). A result scheme makes its classes' term results (ranks, promotion, report cards); a
 * register is a sheet of the same kind of numbers. Start from a ready-made DPS Noida scheme or blank.
 */
export default async function MarkSchemesPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('exams.master.view')) notFound();
  const canManage = me.permissions.includes('exams.master.manage');
  const [list, presets, exams, classes] = await Promise.all([
    apiFetch<{ data: MarkScheme[] }>('/exams/schemes').then((r) => r.data),
    apiFetch<{ data: SchemePreset[] }>('/exams/schemes/presets').then((r) => r.data),
    apiFetch<{ data: Exam[] }>('/exams').then((r) => r.data),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
  ]);
  const preset = presets.find((p) => p.code === sp.preset) ?? null;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Exams', href: '/exams' }, { label: 'Mark schemes' }]} />
      <PageHeader
        kicker="Exams"
        title="Mark schemes"
        description="How a term's marks are made from the exams: averages, best of N, conversions to a maximum, attendance slabs, rounding and the pass rules. A locked result scheme makes its classes' term results; a register is a sheet of any scheme."
      />
      <Notice params={sp} />
      <div className="ep-rp">
        <Card elevated title="Schemes of the year">
          {list.length ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Mark schemes">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Mark schemes</caption>
                <thead>
                  <tr>
                    <th scope="col">Scheme</th>
                    <th scope="col">Classes</th>
                    <th scope="col">Status</th>
                    <th scope="col">Term results</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((x) => (
                    <tr key={x.id}>
                      <td>
                        <a href={`/exams/schemes/${x.id}`} style={{ textDecoration: 'underline' }}>
                          {x.name}
                        </a>
                        <span className="ep-kicker" style={{ display: 'block' }}>
                          {x.purpose === 'result' ? `Result · ${x.termCode ?? ''}` : 'Register'} ·
                          version {x.version}
                        </span>
                      </td>
                      <td>{x.classes.map((k) => k.code).join(', ')}</td>
                      <td>
                        <Badge tone={SCHEME_STATUS[x.status].tone}>
                          {SCHEME_STATUS[x.status].label}
                        </Badge>
                        {x.problems.length ? (
                          <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                            {x.problems.length} to fix
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {x.purpose === 'result'
                          ? x.computedAt
                            ? `${String(x.results)} · ${when(x.computedAt)}`
                            : 'not worked out'
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ margin: 0 }}>
              No scheme yet. Start from a ready-made one: its columns follow the old report cards.
            </p>
          )}
        </Card>
        {canManage ? (
          <Card elevated title="New scheme">
            <form method="get" style={{ marginBottom: 'var(--sp-3)' }}>
              <label className="ep-field">
                <span className="ep-field__label">Start from</span>
                <select className="ep-select" name="preset" defaultValue={preset?.code ?? ''}>
                  <option value="">Blank (build the columns yourself)</option>
                  {presets.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="ep-form-actions">
                <Button type="submit" variant="secondary" size="sm">
                  Choose
                </Button>
              </div>
            </form>
            {preset ? (
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                {preset.description} Columns: {preset.columns.join(', ')}.
              </p>
            ) : null}
            <form action={createMarkScheme} className="ep-rp__act">
              <input type="hidden" name="preset" value={preset?.code ?? ''} />
              <label className="ep-field">
                <span className="ep-field__label">Name</span>
                <input
                  className="ep-input"
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={preset ? `${preset.name} result` : ''}
                />
              </label>
              <div className="ep-rp__row">
                <label className="ep-field">
                  <span className="ep-field__label">Kind</span>
                  <select className="ep-select" name="purpose" defaultValue="result">
                    <option value="result">Result of a term</option>
                    <option value="register">A register only</option>
                  </select>
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">Term (for a result)</span>
                  <input className="ep-input" name="termCode" maxLength={12} placeholder="T1" />
                </label>
              </div>
              <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="ep-field__label">Classes</legend>
                <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                  {classes.map((k) => (
                    <label key={k.id} className="ep-check" htmlFor={`cls-${k.id}`}>
                      <input
                        id={`cls-${k.id}`}
                        className="ep-check__input"
                        type="checkbox"
                        name="classId"
                        value={k.id}
                      />{' '}
                      {k.code}
                    </label>
                  ))}
                </div>
              </fieldset>
              {preset ? (
                preset.examKeys.map((k) => (
                  <label key={k.key} className="ep-field">
                    <span className="ep-field__label">
                      {k.key}: {k.label}
                    </span>
                    <select className="ep-select" name={`map:${k.key}`} required defaultValue="">
                      <option value="">Choose the exam</option>
                      {exams.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.code} · {e.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))
              ) : (
                <label className="ep-field">
                  <span className="ep-field__label">The first exam it reads</span>
                  <select className="ep-select" name="examId" required defaultValue="">
                    <option value="">Choose the exam</option>
                    {exams.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.code} · {e.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="ep-form-actions">
                <Button type="submit">Make the scheme</Button>
              </div>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
