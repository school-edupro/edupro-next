import { Badge, Breadcrumbs, Button, Card, PageHeader, countedColumns } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { markSchemeStep } from '@/lib/exam-entry-actions';
import { ApiError, apiFetch } from '@/lib/api';
import { COLUMN_KIND, SCHEME_STATUS, type BuilderData, type MarkScheme } from '@/lib/mark-schemes';

/**
 * One mark register (docs/design/68): where it stands (draft, locked, replaced; what to fix), its
 * actions — Run, Edit, Lock / Unlock, Work out the term results (a locked result register), the merit
 * list by division and the promotion proposals — and each subject's columns at a glance.
 */
export default async function MarkRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const s = await apiFetch<MarkScheme>(`/exams/schemes/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const data = await apiFetch<BuilderData>(
    `/exams/schemes/builder?classIds=${s.classIds.join(',')}`,
  ).catch(() => null);
  const st = SCHEME_STATUS[s.status];
  const nameOf = (sid: string) => data?.subjects.find((x) => x.id === sid)?.name ?? sid;
  const step = (name: string, label: string, variant: 'primary' | 'secondary' | 'ghost') => (
    <form action={markSchemeStep}>
      <input type="hidden" name="id" value={s.id} />
      <input type="hidden" name="step" value={name} />
      <Button type="submit" size="sm" variant={variant}>
        {label}
      </Button>
    </form>
  );
  const result = s.purpose === 'result';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: 'Mark registers', href: '/exams/schemes' },
          { label: s.name },
        ]}
      />
      <PageHeader
        kicker={`Mark register · version ${String(s.version)}`}
        title={s.name}
        description={`${result ? `The ${s.termCode ?? ''} result of` : 'A register for'} ${s.classes.map((k) => k.code).join(', ')}. Reads ${s.exams.map((e) => `${e.key} = ${e.code ?? '?'}`).join(', ')}.`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {s.rights.run ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/exams/schemes/${s.id}/register`}
              >
                ▶ Run
              </a>
            ) : null}
            {s.rights.edit && s.status !== 'superseded' ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/exams/schemes/${s.id}/edit`}>
                Edit
              </a>
            ) : null}
            {s.status === 'locked' && result ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/exams/schemes/${s.id}/divisions`}
              >
                Merit by division
              </a>
            ) : null}
            {s.status === 'locked' && result ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/exams/schemes/${s.id}/promotion`}
              >
                Promotion proposals
              </a>
            ) : null}
            {s.rights.manage && s.status === 'draft' && !s.problems.length
              ? step('lock', 'Lock this version', 'primary')
              : null}
            {s.rights.manage && s.status === 'locked' && result
              ? step('compute', 'Work out the term results', 'primary')
              : null}
            {s.rights.manage && s.status === 'locked' ? step('unlock', 'Unlock', 'ghost') : null}
          </span>
        }
      />
      <Notice params={sp} />
      <Card elevated style={{ marginBottom: 'var(--sp-4)' }}>
        <p style={{ margin: 0 }}>
          <Badge tone={st.tone}>{st.label}</Badge>{' '}
          {s.status === 'locked'
            ? `Locked${s.lockedBy ? ` by ${s.lockedBy}` : ''}: a save makes its next version. ${result ? (s.computedAt ? `${String(s.results)} term results kept.` : 'Work out the term results when the marks are verified.') : ''}`
            : s.status === 'superseded'
              ? 'A later version replaced this one.'
              : 'A draft: it changes in place. Run it on a section to check, then lock it.'}
        </p>
        {s.problems.length ? (
          <div className="ep-alert ep-alert--warning" style={{ marginTop: 'var(--sp-3)' }}>
            To fix before locking:
            <ul style={{ margin: 'var(--sp-1) 0 0', paddingLeft: 'var(--sp-5)' }}>
              {s.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
      <Card elevated title="Subjects and their columns">
        <div
          className="ep-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Subjects and their columns"
        >
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Subjects and their columns</caption>
            <thead>
              <tr>
                <th scope="col">Subject</th>
                <th scope="col">Columns (printed; hidden ones in brackets)</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {s.def.subjects.map((x) => {
                const counted = countedColumns(x.columns);
                return (
                  <tr key={x.key}>
                    <td>
                      {x.slot ? (
                        <>
                          <strong>{x.slot.name}</strong>
                          <span className="ep-mr-col__desc">
                            {x.slot.members.map(nameOf).join(' · ')}
                          </span>
                        </>
                      ) : (
                        nameOf(x.subjectId ?? '')
                      )}
                    </td>
                    <td>
                      <span className="ep-mr-pills">
                        {x.columns.map((c) => (
                          <span
                            key={c.key}
                            className="ep-mr-chip"
                            data-kind={c.kind}
                            title={COLUMN_KIND[c.kind]}
                          >
                            {c.hidden ? `(${c.name})` : c.name}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td>
                      {counted
                        .map((k) => x.columns.find((c) => c.key === k)?.name ?? k)
                        .join(' + ')}
                      {x.totalOutOf ? ` → out of ${String(x.totalOutOf)}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
