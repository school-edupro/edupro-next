import { Fragment } from 'react';
import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { MarkScheme } from '@/lib/mark-schemes';
import { sectionOptions } from '@/lib/sections';

interface Cell {
  v: number | null;
  max: number;
  code?: string;
}
interface Register {
  scheme: { id: string; name: string; termCode: string | null; status: string; version: number };
  place: string;
  view: 'marks' | 'merit';
  columns: Array<{ key: string; label: string; total: boolean }>;
  subjects: Array<{ code: string; name: string }>;
  /** the most subjects a student takes: Subject-1 … Subject-n (docs/design/67) */
  slots?: number;
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    section: string;
    subjects: Array<{
      code: string;
      name?: string;
      kind: string;
      values: Record<string, Cell | null>;
      grade: string | null;
      status: string;
    }>;
    total: number | null;
    max: number;
    pct: number | null;
    grade: string | null;
    division: string | null;
    result: string;
    rankInClass: number | null;
  }>;
  counts: Record<string, number>;
}

const RESULT: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  pass: { label: 'Pass', tone: 'success' },
  compartment: { label: 'Compartment', tone: 'warning' },
  fail: { label: 'Fail', tone: 'danger' },
  absent: { label: 'Absent', tone: 'danger' },
  incomplete: { label: 'Incomplete', tone: 'neutral' },
};
const fmt = (c: Cell | null | undefined) =>
  !c ? '' : c.code && (c.v === null || c.v === 0) ? c.code : c.v === null ? '' : String(c.v);

/**
 * A scheme's register (docs/design/65, part 3): a section or a whole class, by roll or as a merit
 * list; each subject's columns, its grade, then the total, %, grade, division, result and rank. Excel
 * and PDF of the same.
 */
export default async function SchemeRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sectionId?: string; classId?: string; view?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('exams.marks.view')) notFound();
  const s = await apiFetch<MarkScheme>(`/exams/schemes/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const prefixes = s.classes.map((k) => `${k.code}-`);
  const sections = (await sectionOptions()).filter((o) =>
    prefixes.some((p) => o.label.startsWith(p)),
  );
  const view = sp.view === 'merit' ? 'merit' : 'marks';
  const sectionId = sections.find((o) => o.value === sp.sectionId)?.value;
  const classId = s.classIds.includes(sp.classId ?? '') ? sp.classId : undefined;
  const where = sectionId
    ? `classSectionId=${sectionId}`
    : `classId=${classId ?? s.classIds[0] ?? ''}`;
  const reg = await apiFetch<Register>(`/exams/schemes/${id}/register?${where}&view=${view}`);
  const slots = Array.from(
    { length: reg.slots ?? Math.max(0, ...reg.rows.map((r) => r.subjects.length)) },
    (_, k) => k,
  );
  // the place and order in the path: View / Download add their own ?save=1
  const place = sectionId ? `s${sectionId}` : `c${classId ?? s.classIds[0] ?? ''}`;
  const file = (format: string) => `/api/exam-register/${s.id}/${format}/${place}/${view}`;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: 'Mark schemes', href: '/exams/schemes' },
          { label: s.name, href: `/exams/schemes/${s.id}` },
          { label: 'Register' },
        ]}
      />
      <PageHeader
        kicker={`Register · version ${String(s.version)}${s.status === 'draft' ? ' (draft)' : ''}`}
        title={`${s.name} · ${reg.place}`}
        description={Object.entries(reg.counts)
          .map(([k, n]) => `${RESULT[k]?.label ?? k} ${String(n)}`)
          .join(' · ')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={file('xlsx')}>
              Excel
            </a>
            <ViewDownload href={file('pdf')} what="the register" />
          </span>
        }
      />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" style={{ minWidth: 200 }}>
            <span className="ep-field__label">Section</span>
            <select className="ep-select" name="sectionId" defaultValue={sectionId ?? ''}>
              <option value="">The whole class</option>
              {sections.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {s.classIds.length > 1 ? (
            <label className="ep-field" style={{ minWidth: 160 }}>
              <span className="ep-field__label">Class (whole class)</span>
              <select className="ep-select" name="classId" defaultValue={classId ?? ''}>
                {s.classes.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.code}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="ep-field" style={{ minWidth: 160 }}>
            <span className="ep-field__label">Order</span>
            <select className="ep-select" name="view" defaultValue={view}>
              <option value="marks">By roll</option>
              <option value="merit">Merit list</option>
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
      </Card>
      <Card elevated>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Register">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Register</caption>
            <thead>
              <tr>
                <th scope="col" rowSpan={2}>
                  {view === 'merit' ? 'Rank' : 'Roll'}
                </th>
                <th scope="col" rowSpan={2}>
                  Student
                </th>
                {/* each student's own subjects in the class's order, additional last */}
                {slots.map((k) => (
                  <th key={k} scope="colgroup" colSpan={reg.columns.length + 2}>
                    Subject-{k + 1}
                  </th>
                ))}
                <th scope="col" rowSpan={2} style={{ textAlign: 'right' }}>
                  Total
                </th>
                <th scope="col" rowSpan={2} style={{ textAlign: 'right' }}>
                  %
                </th>
                <th scope="col" rowSpan={2}>
                  Grade
                </th>
                <th scope="col" rowSpan={2}>
                  Result
                </th>
                <th scope="col" rowSpan={2} style={{ textAlign: 'right' }}>
                  Rank
                </th>
              </tr>
              <tr>
                {slots.map((k) => (
                  <Fragment key={k}>
                    <th scope="col">Subject</th>
                    {reg.columns.map((c) => (
                      <th key={`${String(k)}-${c.key}`} scope="col" style={{ textAlign: 'right' }}>
                        {c.label}
                      </th>
                    ))}
                    <th scope="col">Grade</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {reg.rows.map((r) => (
                <tr key={r.studentId}>
                  <td>{view === 'merit' ? (r.rankInClass ?? '') : (r.rollNo ?? '')}</td>
                  <td>
                    {r.name}
                    <span className="ep-kicker" style={{ display: 'block' }}>
                      {r.admissionNo} · {r.section}
                    </span>
                  </td>
                  {slots.map((k) => {
                    const sub = r.subjects[k];
                    return (
                      <Fragment key={k}>
                        <td title={sub?.name}>{sub ? sub.code : ''}</td>
                        {reg.columns.map((c) => (
                          <td
                            key={`${String(k)}-${c.key}`}
                            style={{ textAlign: 'right', fontWeight: c.total ? 600 : undefined }}
                          >
                            {sub ? fmt(sub.values[c.key]) : ''}
                          </td>
                        ))}
                        <td>
                          {sub
                            ? sub.kind === 'additional'
                              ? `${sub.grade ?? ''} (addl.)`
                              : (sub.grade ?? '')
                            : ''}
                        </td>
                      </Fragment>
                    );
                  })}
                  <td style={{ textAlign: 'right' }}>
                    {r.total ?? ''} / {r.max}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.pct ?? ''}</td>
                  <td>{r.grade ?? ''}</td>
                  <td>
                    <Badge tone={RESULT[r.result]?.tone ?? 'neutral'}>
                      {RESULT[r.result]?.label ?? r.result}
                    </Badge>
                    {r.division ? (
                      <span className="ep-kicker" style={{ display: 'block' }}>
                        {r.division}
                      </span>
                    ) : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.rankInClass ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!reg.rows.length ? <p style={{ marginBottom: 0 }}>No students.</p> : null}
      </Card>
    </>
  );
}
