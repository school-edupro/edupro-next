import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { SchemeEditor } from '@/components/exams/SchemeEditor';
import { Notice } from '@/components/Notice';
import { markSchemeStep } from '@/lib/exam-entry-actions';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { SCHEME_STATUS, type MarkScheme } from '@/lib/mark-schemes';
import type { Exam, GradeScale } from '@/lib/types';

/**
 * One mark scheme (docs/design/65, part 3): its exams and columns (changed while a draft), then Lock
 * (a version), Work out the term results (a locked result scheme), a new version, and the register.
 */
export default async function MarkSchemePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('exams.master.view')) notFound();
  const canManage = me.permissions.includes('exams.master.manage');
  const s = await apiFetch<MarkScheme>(`/exams/schemes/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const [exams, scales] = await Promise.all([
    apiFetch<{ data: Exam[] }>('/exams').then((r) => r.data),
    apiFetch<{ data: GradeScale[] }>('/exams/grade-scales').then((r) => r.data),
  ]);
  const st = SCHEME_STATUS[s.status];
  const step = (name: string, label: string, variant: 'primary' | 'secondary' | 'ghost') => (
    <form action={markSchemeStep}>
      <input type="hidden" name="id" value={s.id} />
      <input type="hidden" name="step" value={name} />
      <Button type="submit" size="sm" variant={variant}>
        {label}
      </Button>
    </form>
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: 'Mark schemes', href: '/exams/schemes' },
          { label: s.name },
        ]}
      />
      <PageHeader
        kicker={`Mark scheme · version ${String(s.version)}`}
        title={s.name}
        description={`${s.purpose === 'result' ? `The ${s.termCode ?? ''} result of` : 'A register for'} ${s.classes.map((k) => k.code).join(', ')}. Reads ${s.exams.map((e) => `${e.key} = ${e.code ?? '?'}`).join(', ')}.`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/exams/schemes/${s.id}/register`}
            >
              {s.status === 'draft' ? 'Try it (register)' : 'Register'}
            </a>
            {s.status === 'locked' && s.purpose === 'result' ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/exams/schemes/${s.id}/divisions`}
              >
                Merit by division
              </a>
            ) : null}
            {canManage && s.status === 'draft' && !s.problems.length
              ? step('lock', 'Lock this version', 'primary')
              : null}
            {canManage && s.status === 'locked' && s.purpose === 'result'
              ? step('compute', 'Work out the term results', 'primary')
              : null}
            {canManage && s.status !== 'draft' ? step('new-version', 'New version', 'ghost') : null}
            {canManage && s.status === 'draft' ? step('remove', 'Remove the draft', 'ghost') : null}
          </span>
        }
      />
      <Notice params={sp} />
      <Card elevated style={{ marginBottom: 'var(--sp-4)' }}>
        <p style={{ margin: 0 }}>
          <Badge tone={st.tone}>{st.label}</Badge>{' '}
          {s.status === 'locked'
            ? `Locked${s.lockedBy ? ` by ${s.lockedBy}` : ''}. ${s.purpose === 'result' ? (s.computedAt ? `${String(s.results)} term results kept.` : 'Work out the term results when the marks are verified.') : ''}`
            : s.status === 'superseded'
              ? 'A later version replaced this one.'
              : 'A draft: change the columns, try it on a section, then lock it.'}
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
      <Card elevated title="Exams, columns and rules">
        <SchemeEditor
          id={s.id}
          def={s.def}
          readOnly={!canManage || s.status !== 'draft'}
          exams={exams.map((e) => ({ id: e.id, code: e.code, name: e.name }))}
          scales={scales.map((g) => ({ id: g.id, code: g.code, name: g.name }))}
        />
      </Card>
    </>
  );
}
