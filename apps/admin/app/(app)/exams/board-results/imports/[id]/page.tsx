import { Badge, Breadcrumbs, Button, Card, DataTable, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { DialogButton } from '@/components/leave/DialogButton';
import {
  refreshBoardDetails,
  relearnBoardImport,
  saveBoardImport,
  uploadDetailsSheet,
} from '@/lib/board-actions';
import {
  LAYOUT_HOW,
  RESULT_WORDS,
  statusOf,
  when,
  type BoardImportDetail,
  type BoardProblem,
  type GazetteCandidate,
  type GazetteFigures,
} from '@/lib/board-results';

type Subject = GazetteFigures['subjects'][number];

/**
 * One upload of CBSE's result file (docs/design/88): the figures; what to do next (save it — replacing an earlier
 * saved file of the same class and year — or ask the AI again when its layout failed the checks); the file and the
 * layout it was read with; then, folded, the problems, the results by word, the subjects and every candidate.
 */
export default async function BoardImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('exams.board_result.view')) notFound();
  let u: BoardImportDetail;
  try {
    u = await apiFetch<BoardImportDetail>(`/exams/board-results/imports/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const canImport = me.permissions.includes('exams.board_result.import');
  const f = u.figures as Partial<GazetteFigures>;
  const results = f.results ?? {};
  const passed = results.PASS ?? 0;
  const found = (f.matched?.roll ?? 0) + (f.matched?.name ?? 0);
  const errors = f.problems?.errors ?? 0;
  const warnings = f.problems?.warnings ?? 0;
  const state = statusOf(u);
  const title = u.fileName ?? `CBSE result file ${u.id}`;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Board results', href: '/exams/board-results' },
          { label: 'Uploads', href: '/exams/board-results?tab=upload' },
          { label: title },
        ]}
      />
      <PageHeader
        kicker={`Class ${u.classLabel} · ${String(u.examYear ?? '')} board examination · CBSE result file`}
        title={title}
        description={`${u.academicYear ? `${u.academicYear} · ` : ''}uploaded ${when(u.createdAt)}${u.by ? ` by ${u.by}` : ''}.`}
        actions={<Badge tone={state.tone}>{state.word}</Badge>}
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis">
        <KpiTile label="Candidates" value={String(f.candidates ?? u.totalRows)} />
        <KpiTile label="Appeared" value={String(f.appeared ?? 0)} hint="with marks printed" />
        <KpiTile label="Passed" value={String(passed)} />
        <KpiTile
          label="Other results"
          value={String((f.candidates ?? 0) - passed)}
          hint={
            Object.keys(results)
              .filter((w) => w !== 'PASS')
              .join(', ') || 'none'
          }
        />
        <KpiTile
          label="Students found"
          value={`${String(found)} of ${String(f.candidates ?? 0)}`}
          hint={`${String(f.matched?.roll ?? 0)} by board roll no, ${String(f.matched?.name ?? 0)} by name`}
        />
        <KpiTile
          label="Problems"
          value={String(errors)}
          hint={warnings ? `and ${String(warnings)} to look at` : 'none to look at'}
        />
      </div>

      <Card title="Next step">
        {u.replacedAt ? (
          <p style={{ margin: 0 }}>
            A later file of Class {u.classLabel} ({String(u.examYear ?? '')}) took this one&apos;s
            place.{' '}
            {u.replacedBy ? (
              <a
                href={`/exams/board-results/imports/${u.replacedBy}`}
                style={{ textDecoration: 'underline' }}
              >
                Open the later file
              </a>
            ) : null}
          </p>
        ) : u.status === 'committed' ? (
          <p style={{ margin: 0 }}>
            Saved {when(u.committedAt)}. Its results are on{' '}
            <a href="/exams/board-results?tab=results" style={{ textDecoration: 'underline' }}>
              Results
            </a>{' '}
            and{' '}
            <a href="/exams/board-results?tab=analysis" style={{ textDecoration: 'underline' }}>
              Analysis
            </a>
            .
          </p>
        ) : u.status === 'failed' ? (
          <div className="ep-alert ep-alert--danger" role="alert">
            <div>
              <p style={{ margin: 0 }}>
                <strong>
                  {String(f.problems?.candidatesWithErrors ?? u.rejectedRows)} candidates did not
                  pass their checks, so this file cannot be saved as it was read.
                </strong>{' '}
                {u.layoutHow === 'claude'
                  ? 'The AI may have misread the layout: ask it again — it is told which checks failed (still without any name or mark).'
                  : 'Check that this is CBSE’s result file for this class, then upload it again.'}
              </p>
              {canImport && u.layoutHow === 'claude' ? (
                <form action={relearnBoardImport} style={{ marginTop: 'var(--sp-2)' }}>
                  <input type="hidden" name="id" value={u.id} />
                  <Button type="submit" variant="secondary" size="sm">
                    Ask the AI again
                  </Button>
                </form>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              Nothing is saved yet. Look over the figures and anything below, then save.
              {u.replaces
                ? ` Saving replaces the results saved from ${u.replaces.fileName ?? 'the earlier file'} (${when(u.replaces.committedAt)}).`
                : ''}
            </p>
            {canImport ? (
              <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                <ConfirmAction
                  action={saveBoardImport}
                  fields={{ id: u.id }}
                  label="Save these results"
                  title={`Save the results of ${String(f.candidates ?? 0)} candidates`}
                  confirmLabel="Save"
                  variant="primary"
                >
                  Class {u.classLabel}, {String(u.examYear ?? '')} board examination.
                  {u.replaces
                    ? ' The results saved from the earlier file of this class and year are replaced.'
                    : ''}
                  {f.matched?.none
                    ? ` ${String(f.matched.none)} candidates were not found among the students; they are kept by roll number.`
                    : ''}
                </ConfirmAction>
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href="/exams/board-results?tab=upload"
                >
                  Upload a different file
                </a>
              </span>
            ) : null}
          </>
        )}
      </Card>

      {u.saved ? (
        <Card title="Students and details">
          <p style={{ marginTop: 0 }}>
            <strong>
              {String(u.saved.roll + u.saved.name + u.saved.picked)} of{' '}
              {String(f.candidates ?? u.totalRows)}
            </strong>{' '}
            candidates are linked to their students ({String(u.saved.roll)} by board roll number,{' '}
            {String(u.saved.name)} by name, {String(u.saved.picked)} picked)
            {u.saved.none ? `; ${String(u.saved.none)} not found yet` : ''}
            {u.saved.notOurs ? `; ${String(u.saved.notOurs)} not our students` : ''}. Their section,
            stream, category, religion, EWS, CWSN, boarder and staff ward come from the records (
            {String(u.saved.fromRecord)})
            {u.saved.fromSheet ? ` or the details sheet (${String(u.saved.fromSheet)})` : ''}.
          </p>
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className={`ep-btn ep-btn--sm ${u.saved.none ? 'ep-btn--primary' : 'ep-btn--secondary'}`}
              href={`/exams/board-results/imports/${u.id}/review`}
            >
              Review students{u.saved.none ? ` (${String(u.saved.none)} not found)` : ''}
            </a>
            {canImport ? (
              <>
                <ConfirmAction
                  action={refreshBoardDetails}
                  fields={{ id: u.id }}
                  label="Take the details again from the records"
                  title="Take the details again from the records"
                  confirmLabel="Take them again"
                  variant="ghost"
                >
                  After a record was put right: every linked candidate&apos;s section, stream,
                  category, religion, EWS, CWSN, boarder and staff ward are read again. Values from
                  the details sheet are replaced.
                </ConfirmAction>
                <DialogButton
                  id="details-sheet"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  label="Upload the details sheet"
                  title="Upload the details sheet (optional)"
                >
                  <form action={uploadDetailsSheet} className="ep-cert-fields">
                    <input type="hidden" name="id" value={u.id} />
                    <p className="ep-field__help" style={{ gridColumn: '1 / -1', margin: 0 }}>
                      Only where the records are not enough: the school&apos;s old sheet with two
                      sheets — (1) BoardRollNo, admission number, section, stream, category (Boarder
                      / Staff / Other), SC/ST/OBC/GEN, religion, EWS, CWSN; (2) Section,
                      SubjectCode, Teacher and, if only some, their board roll numbers. Its values
                      override the records for those candidates; a candidate not found is linked by
                      the admission number.
                    </p>
                    <label className="ep-field" htmlFor="dsFile" style={{ gridColumn: '1 / -1' }}>
                      <span className="ep-field__label">The details sheet (.xlsx) *</span>
                      <input
                        id="dsFile"
                        name="file"
                        type="file"
                        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        className="ep-input"
                        required
                      />
                    </label>
                    <div>
                      <Button type="submit">Upload</Button>
                    </div>
                  </form>
                </DialogButton>
              </>
            ) : null}
          </span>
        </Card>
      ) : null}

      <Card title="The file and its layout">
        <dl className="ep-facts">
          <div>
            <dt>The file</dt>
            <dd>
              <FileLinks href={`/exams/board-results/imports/${u.id}/file`} label={title} />
            </dd>
          </div>
          <div>
            <dt>Layout</dt>
            <dd>
              {u.layout ? u.layout.name : '—'}
              {u.layoutHow ? (
                <span className="ep-field__help" style={{ display: 'block' }}>
                  {LAYOUT_HOW[u.layoutHow]}
                </span>
              ) : null}
            </dd>
          </div>
          {f.layout ? (
            <div>
              <dt>The AI reader</dt>
              <dd>
                {f.layout.model} saw the column headings and a few lines with{' '}
                {String(f.layout.masked)} names and numbers masked (
                {String(f.layout.usage.inputTokens + f.layout.usage.outputTokens)} tokens).
                {f.layout.notes ? (
                  <span className="ep-field__help" style={{ display: 'block' }}>
                    {f.layout.notes}
                  </span>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      <FoldCard
        id="problems"
        title="Problems"
        hint={
          errors || warnings
            ? `${String(errors)} to fix · ${String(warnings)} to look at`
            : 'Every record passed its checks'
        }
        open={errors > 0}
      >
        <DataTable<BoardProblem & { k: number }>
          caption="Problems found while reading the file"
          density="dense"
          columns={[
            {
              key: 'l',
              header: 'Line',
              numeric: true,
              render: (p) => String(p.line ?? p.row ?? ''),
            },
            { key: 'r', header: 'Roll no', render: (p) => p.roll ?? '' },
            { key: 'f', header: 'Field', render: (p) => p.field ?? p.column ?? '' },
            { key: 'm', header: 'What', render: (p) => p.message },
            {
              key: 'v',
              header: 'Kind',
              render: (p) => (
                <Badge tone={p.level === 'warning' ? 'warning' : 'danger'}>
                  {p.level === 'warning' ? 'To look at' : 'To fix'}
                </Badge>
              ),
            },
          ]}
          rows={u.report.map((p, k) => ({ ...p, k }))}
          rowKey={(p) => String(p.k)}
          emptyTitle="Every record passed its checks"
        />
      </FoldCard>

      <FoldCard
        id="results"
        title="Results"
        hint={Object.entries(results)
          .map(([w, n]) => `${w} ${String(n)}`)
          .join(' · ')}
        open
      >
        <DataTable<{ word: string; n: number }>
          caption="Candidates by result"
          density="dense"
          columns={[
            { key: 'w', header: 'Result', render: (x) => <strong>{x.word}</strong> },
            { key: 'm', header: 'Means', render: (x) => RESULT_WORDS[x.word] ?? 'As printed' },
            { key: 'n', header: 'Candidates', numeric: true, render: (x) => String(x.n) },
          ]}
          rows={Object.entries(results).map(([word, n]) => ({ word, n }))}
          rowKey={(x) => x.word}
          emptyTitle="—"
        />
      </FoldCard>

      <FoldCard
        id="subjects"
        title="Subjects"
        hint={`${String(f.subjects?.length ?? 0)} subject codes`}
      >
        <DataTable<Subject>
          caption="Subjects in the file"
          density="dense"
          columns={[
            {
              key: 'c',
              header: 'Subject',
              render: (s) => (
                <>
                  <strong>{s.code}</strong> {u.subjectNames[s.code] ?? ''}
                </>
              ),
            },
            { key: 'n', header: 'Candidates', numeric: true, render: (s) => String(s.candidates) },
            { key: 'a', header: 'Absent', numeric: true, render: (s) => String(s.absent) },
            { key: 'h', header: 'Highest', numeric: true, render: (s) => String(s.highest ?? '—') },
            { key: 'v', header: 'Average', numeric: true, render: (s) => String(s.average ?? '—') },
          ]}
          rows={f.subjects ?? []}
          rowKey={(s) => s.code}
          emptyTitle="—"
        />
      </FoldCard>

      <FoldCard
        id="candidates"
        title="Candidates"
        hint={`${String(u.candidates.length)} candidates · ${String(found)} found among the students`}
      >
        <DataTable<GazetteCandidate>
          caption="Candidates as read from the file"
          density="dense"
          columns={[
            { key: 'r', header: 'Roll no', render: (c) => <strong>{c.roll}</strong> },
            {
              key: 'n',
              header: 'Name in the file',
              render: (c) => (
                <>
                  {c.name}
                  <span className="ep-ctype__num">
                    {c.sex}
                    {c.flag ? ` · flag ${c.flag}` : ''}
                  </span>
                </>
              ),
            },
            {
              key: 's',
              header: 'Subjects (code marks grade)',
              render: (c) =>
                c.subjects
                  .map((s) =>
                    `${s.code} ${s.absent ? 'AB' : String(s.marks ?? '—')} ${s.grade}`.trim(),
                  )
                  .join(' · '),
            },
            {
              key: 'res',
              header: 'Result',
              render: (c) => (
                <>
                  {c.result || '—'}
                  {c.compartment.length ? (
                    <span className="ep-ctype__num">Compartment {c.compartment.join(', ')}</span>
                  ) : null}
                </>
              ),
            },
            {
              key: 'st',
              header: 'Student',
              render: (c) =>
                c.studentId ? (
                  <>
                    <a href={`/people/students/${c.studentId}`}>{c.student}</a>
                    <span className="ep-ctype__num">
                      {c.admissionNo} · {c.match === 'roll' ? 'by board roll no' : 'by name'}
                    </span>
                  </>
                ) : (
                  <Badge tone="warning">Not found</Badge>
                ),
            },
          ]}
          rows={u.candidates}
          rowKey={(c) => c.roll}
          emptyTitle="No candidates"
        />
      </FoldCard>
    </>
  );
}
