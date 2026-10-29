import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { saveRemarkItems } from '@/lib/remark-actions';
import type { Exam } from '@/lib/types';

interface Sheet {
  section: { id: string; code: string };
  locked: boolean;
  categories: Array<{
    id: string;
    code: string;
    name: string;
    subjectName: string | null;
    freeText: boolean;
    may: boolean;
    bank: Array<{ code: string; text: string }>;
  }>;
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    items: Record<string, { text: string; bankCode: string | null }>;
  }>;
}

/**
 * Remarks by category of a section in an exam (docs/design/65, part 7): one remark per student and
 * category, from the category's list (or the teacher's own words where the category allows). The
 * class teacher writes every category, a subject teacher their subject's; the remarks lock closes it.
 */
export default async function ExamRemarksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string; ok?: string; error?: string; detail?: string }>;
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
  const sections = await apiFetch<{ data: Array<{ classSectionId: string; section: string }> }>(
    `/exams/${id}/entry-status`,
  )
    .then((r) => [...new Map(r.data.map((x) => [x.classSectionId, x.section])).entries()])
    .catch(() => [] as Array<[string, string]>);
  const sectionId = sections.find(([sid]) => sid === sp.section)?.[0] ?? sections[0]?.[0];
  const sheet = sectionId
    ? await apiFetch<Sheet>(`/exams/${id}/remark-items?classSectionId=${sectionId}`)
    : null;
  const cats = sheet?.categories ?? [];
  const open = !!sheet && !sheet.locked;
  const writable = cats.filter((k) => k.may);
  const back = `/exams/${id}/remarks${sectionId ? `?section=${sectionId}` : ''}`;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: exam.name, href: `/exams/${exam.id}` },
          { label: 'Remarks' },
        ]}
      />
      <PageHeader
        kicker={`Exams · ${exam.code}`}
        title={`Remarks by category · ${exam.name}`}
        description="One remark per student and category. Categories are set up under Exams → Remark categories; the class teacher's general remark stays in the exam register."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/exams/remarks">
            Remark categories
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
            <select className="ep-select" name="section" defaultValue={sectionId}>
              {sections.map(([sid, code]) => (
                <option key={sid} value={sid}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Open
          </Button>
        </form>
      </Card>
      {sheet && !cats.length ? (
        <Card>
          <p style={{ margin: 0 }}>
            No remark category is set up for this class: add them under{' '}
            <a href="/exams/remarks" style={{ textDecoration: 'underline' }}>
              Remark categories
            </a>
            .
          </p>
        </Card>
      ) : null}
      {sheet && cats.length ? (
        <Card
          elevated
          title={sheet.section.code}
          actions={
            sheet.locked ? (
              <Badge tone="warning">Locked</Badge>
            ) : (
              <Badge tone="neutral">{sheet.rows.length} students</Badge>
            )
          }
        >
          {cats.map((k) =>
            k.freeText ? (
              <datalist key={k.id} id={`rb-${k.id}`}>
                {k.bank.map((b) => (
                  <option key={b.code} value={b.text} />
                ))}
              </datalist>
            ) : null,
          )}
          <form action={saveRemarkItems}>
            <input type="hidden" name="examId" value={exam.id} />
            <input type="hidden" name="classSectionId" value={sheet.section.id} />
            <input type="hidden" name="back" value={back} />
            {writable.map((k) => (
              <input key={k.id} type="hidden" name="category" value={k.id} />
            ))}
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Remarks">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Remarks by category</caption>
                <thead>
                  <tr>
                    <th scope="col">Roll</th>
                    <th scope="col">Student</th>
                    {cats.map((k) => (
                      <th key={k.id} scope="col">
                        {k.name}
                        {k.subjectName ? (
                          <span className="ep-kicker" style={{ display: 'block' }}>
                            {k.subjectName}
                          </span>
                        ) : null}
                      </th>
                    ))}
                  </tr>
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
                      {cats.map((k) => {
                        const v = r.items[k.id]?.text ?? '';
                        const name = `r-${r.studentId}-${k.id}`;
                        const off = !open || !k.may;
                        const label = `${k.name} · ${r.name}`;
                        return (
                          <td key={k.id} style={{ minWidth: 220 }}>
                            {k.freeText ? (
                              <input
                                className="ep-input"
                                name={name}
                                list={`rb-${k.id}`}
                                aria-label={label}
                                maxLength={600}
                                defaultValue={v}
                                disabled={off}
                              />
                            ) : (
                              <select
                                className="ep-select"
                                name={name}
                                aria-label={label}
                                defaultValue={v}
                                disabled={off}
                              >
                                <option value="">-</option>
                                {k.bank.map((b) => (
                                  <option key={b.code} value={b.text}>
                                    {b.text}
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
            {open && writable.length ? (
              <div className="ep-form-actions" style={{ marginTop: 'var(--sp-3)' }}>
                <Button type="submit">Save the remarks</Button>
              </div>
            ) : (
              <p className="ep-field__help">
                {sheet.locked
                  ? 'Remarks are locked for the class in this exam; open them on the exam page.'
                  : 'You may view these only: the class teacher writes them, a subject teacher their subject’s.'}
              </p>
            )}
          </form>
        </Card>
      ) : null}
    </>
  );
}
