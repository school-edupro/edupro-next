import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import { PortfolioUpload } from '@/components/exams/PortfolioUpload';
import { Notice } from '@/components/Notice';
import { removePortfolioPhoto, saveHpcFeedback, saveIndicatorEntries } from '@/lib/hpc-actions';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { Exam } from '@/lib/types';

interface Item {
  id: string;
  code: string;
  name: string;
  area: string | null;
  parentId: string | null;
  kind: 'level' | 'text';
  description: string | null;
  descriptors: Record<string, string>;
  heading: boolean;
}
interface Sheet {
  exam: { id: string; code: string; name: string; marksLocked: boolean };
  section: { id: string; code: string };
  locked: boolean;
  set: {
    id: string;
    code: string;
    name: string;
    grades: string[];
    kind: 'indicators' | 'hpc';
    levelWords: Record<string, string>;
  } | null;
  indicators: Item[];
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    grades: Record<string, { grade: string | null; note: string | null }>;
    feedback?: Record<string, { text: string; byFamily: boolean }>;
    photos?: number;
  }>;
}
interface Photo {
  id: string;
  studentId: string;
  caption: string | null;
  indicatorId: string | null;
  indicator: string | null;
}

/**
 * Indicators and the Holistic Progress Card of a section (docs/design/65, part 5): one area at a
 * time, a level (or a written note) per child and item, the goals as headings; for a progress card,
 * a child's own words, the parent's and the teacher's, and portfolio photos.
 */
export default async function ExamIndicatorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    section?: string;
    area?: string;
    student?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('exams.marks.view')) notFound();
  const exam = await apiFetch<Exam>(`/exams/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const sections = await apiFetch<{ data: Array<{ classSectionId: string; code: string }> }>(
    `/exams/${id}/entry/sections`,
  )
    .then((r) => r.data)
    .catch(() => []);
  const section = sections.find((x) => x.classSectionId === sp.section) ?? sections[0];
  const sheet = section
    ? await apiFetch<Sheet>(`/exams/${id}/indicators?classSectionId=${section.classSectionId}`)
    : null;
  const canEnter = me.permissions.includes('exams.indicator.enter');
  const open = canEnter && !!sheet && !sheet.locked;
  const items = sheet?.indicators ?? [];
  const areas = [...new Set(items.map((i) => i.area ?? 'Other'))];
  const area = areas.includes(sp.area ?? '') ? sp.area! : areas[0];
  const top = items.filter((i) => !i.parentId && (i.area ?? 'Other') === area);
  const groups = top.map((i) => ({
    item: i,
    kids: items.filter((k) => k.parentId === i.id),
  }));
  const cells = groups.flatMap((g) => (g.kids.length ? g.kids : [g.item]));
  const hasGoals = groups.some((g) => g.kids.length);
  const hpc = sheet?.set?.kind === 'hpc';
  const child = sheet?.rows.find((r) => r.studentId === sp.student) ?? sheet?.rows[0];
  const photos =
    hpc && section && child
      ? await apiFetch<{ data: Photo[] }>(
          `/exams/${id}/portfolio?classSectionId=${section.classSectionId}&studentId=${child.studentId}`,
        )
          .then((r) => r.data)
          .catch(() => [] as Photo[])
      : [];
  const q = (more: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({
      section: section?.classSectionId,
      area,
      student: child?.studentId,
      ...more,
    }))
      if (v) u.set(k, v);
    return `/exams/${id}/indicators?${u.toString()}`;
  };
  const level = (g: string) =>
    sheet?.set?.levelWords[g] ? `${g} (${sheet.set.levelWords[g]})` : g;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: exam.name, href: `/exams/${exam.id}` },
          { label: 'Indicators and HPC' },
        ]}
      />
      <PageHeader
        kicker={`Exams · ${exam.code}`}
        title={`Indicators and progress card · ${exam.name}`}
        description={
          sheet?.set
            ? `${sheet.section.code} · ${sheet.set.name} · levels ${sheet.set.grades.map(level).join(', ')}`
            : 'Choose the section.'
        }
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/exams/${exam.id}`}>
            The exam
          </a>
        }
      />
      <Notice params={sp} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" style={{ minWidth: 200 }}>
            <span className="ep-field__label">Section</span>
            <select className="ep-select" name="section" defaultValue={section?.classSectionId}>
              {sections.map((x) => (
                <option key={x.classSectionId} value={x.classSectionId}>
                  {x.code}
                </option>
              ))}
            </select>
          </label>
          {areas.length ? (
            <label className="ep-field" style={{ minWidth: 260 }}>
              <span className="ep-field__label">Area</span>
              <select className="ep-select" name="area" defaultValue={area}>
                {areas.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button type="submit" variant="secondary">
            Open
          </Button>
        </form>
      </Card>
      {sheet && !sheet.set ? (
        <Card>
          <p style={{ margin: 0 }}>
            {sheet.section.code} has no indicator set in this exam: choose one on{' '}
            <a href={`/exams/${exam.id}`} style={{ textDecoration: 'underline' }}>
              the exam&rsquo;s page
            </a>
            .
          </p>
        </Card>
      ) : null}
      {sheet?.set && section ? (
        <>
          <Card
            style={{ marginBottom: 'var(--sp-4)' }}
            elevated
            title={`${sheet.section.code} · ${area ?? ''}`}
            actions={
              sheet.locked ? (
                <Badge tone="warning">Locked</Badge>
              ) : (
                <Badge tone="neutral">{sheet.rows.length} children</Badge>
              )
            }
          >
            <form action={saveIndicatorEntries}>
              <input type="hidden" name="examId" value={exam.id} />
              <input type="hidden" name="classSectionId" value={section.classSectionId} />
              <input type="hidden" name="back" value={q({})} />
              {cells.map((c) => (
                <input key={c.id} type="hidden" name="item" value={c.id} />
              ))}
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Indicators">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Indicators of {area}</caption>
                  <thead>
                    <tr>
                      <th scope="col" rowSpan={hasGoals ? 2 : 1}>
                        Roll
                      </th>
                      <th scope="col" rowSpan={hasGoals ? 2 : 1}>
                        Child
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
                          <span className="ep-kicker" style={{ display: 'block' }}>
                            {r.admissionNo}
                          </span>
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
                                  style={{ minWidth: 180 }}
                                />
                              ) : (
                                <select
                                  className="ep-select"
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
                  <Button type="submit">Save {area}</Button>
                </div>
              ) : (
                <p className="ep-field__help">
                  {sheet.locked
                    ? 'Indicator entry is locked for the class in this exam; open it on the exam page.'
                    : 'You may view these only: the class teachers enter them (the indicator entry right).'}
                </p>
              )}
            </form>
          </Card>
          {hpc && child ? (
            <Card elevated title={`In our words and the portfolio · ${child.name}`}>
              <form
                method="get"
                style={{
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  alignItems: 'flex-end',
                  flexWrap: 'wrap',
                }}
              >
                <input type="hidden" name="section" value={section.classSectionId} />
                {area ? <input type="hidden" name="area" value={area} /> : null}
                <label className="ep-field" style={{ minWidth: 240 }}>
                  <span className="ep-field__label">Child</span>
                  <select className="ep-select" name="student" defaultValue={child.studentId}>
                    {sheet.rows.map((r) => (
                      <option key={r.studentId} value={r.studentId}>
                        {r.rollNo ? `${String(r.rollNo)} · ` : ''}
                        {r.name} · {r.photos ?? 0} photos
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" variant="secondary">
                  Open
                </Button>
              </form>
              <div className="ep-rp" style={{ marginTop: 'var(--sp-3)' }}>
                <form action={saveHpcFeedback}>
                  <input type="hidden" name="examId" value={exam.id} />
                  <input type="hidden" name="classSectionId" value={section.classSectionId} />
                  <input type="hidden" name="studentId" value={child.studentId} />
                  <input type="hidden" name="back" value={q({})} />
                  {(
                    [
                      ['self', 'All about me (the child’s words, as told to the teacher)'],
                      ['parent', 'The parent’s feedback'],
                      ['teacher', 'The teacher’s observations'],
                    ] as const
                  ).map(([k, label]) => {
                    const f = child.feedback?.[k];
                    const theirs = k === 'parent' && f?.byFamily;
                    return (
                      <label key={k} className="ep-field">
                        <span className="ep-field__label">{label}</span>
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
                            Written by the parent in the parent app: kept as they wrote it.
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                  {open ? (
                    <div className="ep-form-actions">
                      <Button type="submit" variant="secondary">
                        Save the words
                      </Button>
                    </div>
                  ) : null}
                </form>
                <section aria-label="Portfolio">
                  <h3 className="ep-cdash__h3" style={{ marginTop: 0 }}>
                    Portfolio
                  </h3>
                  {photos.length ? (
                    <ul style={{ paddingLeft: 'var(--sp-4)' }}>
                      {photos.map((p) => (
                        <li key={p.id} style={{ marginBottom: 'var(--sp-2)' }}>
                          {p.caption ?? 'Photo'}
                          {p.indicator ? ` · ${p.indicator}` : ''}{' '}
                          <ViewDownload
                            href={`/api/exam-portfolio/${exam.id}/${p.id}`}
                            what={`the photo ${p.caption ?? ''}`.trim()}
                          />
                          {open ? (
                            <form action={removePortfolioPhoto} style={{ display: 'inline' }}>
                              <input type="hidden" name="examId" value={exam.id} />
                              <input type="hidden" name="itemId" value={p.id} />
                              <input type="hidden" name="back" value={q({})} />{' '}
                              <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                                Remove
                              </button>
                            </form>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ep-field__help">
                      No photo yet (up to twelve; the card prints six).
                    </p>
                  )}
                  {open ? (
                    <PortfolioUpload
                      examId={exam.id}
                      classSectionId={section.classSectionId}
                      studentId={child.studentId}
                      items={items
                        .filter((i) => !i.heading && i.kind === 'level')
                        .map((i) => ({ id: i.id, name: i.name }))}
                    />
                  ) : null}
                </section>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}
