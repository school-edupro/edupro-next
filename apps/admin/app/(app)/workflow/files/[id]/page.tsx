import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { FileLinks } from '@/components/FileLinks';
import { FileNoteForm } from '@/components/files/FileNoteForm';
import { FilesNav } from '@/components/files/FilesNav';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { FILE_ACTION, FILE_TONE, fileWhen, type FileNoteDetail } from '@/lib/file-movement';
import { approveFile, rejectFile, returnFile, withdrawFile } from '@/lib/file-movement-actions';

const LEVEL: Record<string, [string, 'warning' | 'success' | 'danger' | 'neutral' | 'info']> = {
  waiting: ['Next', 'neutral'],
  pending: ['With this approver', 'warning'],
  approved: ['Approved', 'success'],
  returned: ['Sent back', 'info'],
  rejected: ['Rejected', 'danger'],
  void: ['Not reached', 'neutral'],
};

/**
 * A file: the note and its attachments, the approvers level by level, and the whole history. The
 * approver it is with approves, sends it back or rejects; the creator corrects a file that was sent
 * back (it starts again from L1), and downloads the PDF once it is approved.
 */
export default async function FilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; edit?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const f = await apiFetch<FileNoteDetail>(`/file-movement/${encodeURIComponent(id)}`);
  const editing = f.canResubmit && sp.edit === '1';
  const people = editing
    ? await apiFetch<{ data: Array<{ id: string; name: string }> }>('/file-movement/people')
    : null;
  return (
    <>
      <PageHeader
        kicker={`File movement · ${f.number}`}
        title={f.subject}
        description={`Raised by ${f.createdBy}${f.designation ? ` (${f.designation})` : ''} on ${fileWhen(f.createdAt)}${f.round > 1 ? ` · round ${String(f.round)}` : ''}`}
        actions={
          <>
            <Badge tone={FILE_TONE[f.status] ?? 'neutral'}>{f.statusLabel}</Badge>
            {f.canDownload ? (
              <a
                className="ep-btn ep-btn--primary ep-btn--sm"
                href={`/api/file-movement/${f.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Download PDF
              </a>
            ) : null}
          </>
        }
      />
      <FilesNav current="/workflow/files" ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {editing && people ? (
        <Card title="Correct and submit again" style={{ marginBottom: 'var(--sp-4)' }}>
          <FileNoteForm
            id={f.id}
            people={people.data.map((p) => ({ value: p.id, label: p.name }))}
            subject={f.subject}
            bodyHtml={f.bodyHtml}
            files={f.files}
            approvers={f.levelsNow.map((l) => l.employeeId)}
          />
        </Card>
      ) : (
        <>
          {f.canResubmit ? (
            <Card style={{ marginBottom: 'var(--sp-4)' }}>
              <p style={{ marginTop: 0 }}>
                This file was <strong>sent back</strong>
                {(() => {
                  const last = [...f.history].reverse().find((h) => h.action === 'returned');
                  return last ? ` by ${last.by}: “${last.remark ?? ''}”` : '';
                })()}
                . Correct it and submit again; it will start from the L1 approver.
              </p>
              <a className="ep-btn ep-btn--primary" href={`/workflow/files/${f.id}?edit=1`}>
                Correct and submit again
              </a>
            </Card>
          ) : null}
          <Card title="Approval message" style={{ marginBottom: 'var(--sp-4)' }}>
            <div className="ep-prose ep-note" dangerouslySetInnerHTML={{ __html: f.bodyHtml }} />
            <h3 className="ep-cdash__h3" style={{ marginTop: 'var(--sp-4)' }}>
              Attachments
            </h3>
            {f.files.length ? (
              <ul className="ep-cdash__list">
                {f.files.map((x, i) => (
                  <li key={x.id}>
                    Attachment {i + 1}{' '}
                    <FileLinks
                      href={`/api/file-movement/${f.id}/${x.id}`}
                      label={`attachment ${String(i + 1)} of ${f.number}`}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ep-field__help" style={{ margin: 0 }}>
                None attached.
              </p>
            )}
          </Card>
        </>
      )}
      <Card
        title={`Approvers${f.round > 1 ? ` · round ${String(f.round)}` : ''}`}
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        <ol className="ep-steps">
          {f.levelsNow.map((l) => (
            <li
              key={l.level}
              data-state={
                l.status === 'approved'
                  ? 'approved'
                  : l.status === 'pending'
                    ? 'pending'
                    : l.status === 'rejected' || l.status === 'returned'
                      ? 'rejected'
                      : undefined
              }
            >
              <div className="ep-steps__head">
                <strong>
                  L{l.level} · {l.name}
                </strong>
                <Badge tone={LEVEL[l.status]?.[1] ?? 'neutral'}>
                  {LEVEL[l.status]?.[0] ?? l.status}
                </Badge>
              </div>
              <div className="ep-field__help">
                {[l.designation, l.actedAt ? fileWhen(l.actedAt) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {l.remark ? <div>“{l.remark}”</div> : null}
            </li>
          ))}
        </ol>
        {f.canDecide ? (
          <form action={approveFile} className="ep-hd__form" style={{ marginTop: 'var(--sp-3)' }}>
            <input type="hidden" name="id" value={f.id} />
            <label className="ep-field" htmlFor="fm-remark">
              <span className="ep-field__label">
                Remark (needed to send back or reject; optional when approving)
              </span>
              <textarea
                id="fm-remark"
                name="remark"
                className="ep-input"
                rows={2}
                maxLength={1000}
              />
            </label>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <Button type="submit" formAction={approveFile}>
                Approve
              </Button>
              <Button type="submit" formAction={returnFile} variant="secondary">
                Send back to the creator
              </Button>
              <Button type="submit" formAction={rejectFile} variant="secondary">
                Reject
              </Button>
            </div>
          </form>
        ) : null}
        {f.canWithdraw && !editing ? (
          <form action={withdrawFile} style={{ marginTop: 'var(--sp-3)' }}>
            <input type="hidden" name="id" value={f.id} />
            <Button type="submit" variant="ghost" size="sm">
              Withdraw this file
            </Button>
          </form>
        ) : null}
      </Card>
      <Card title="History">
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="History">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Every step of this file</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Round</th>
                <th scope="col">Level</th>
                <th scope="col">By</th>
                <th scope="col">What</th>
                <th scope="col">Remark</th>
              </tr>
            </thead>
            <tbody>
              {f.history.map((h, i) => (
                <tr key={String(i)}>
                  <td>{fileWhen(h.at)}</td>
                  <td>{h.round}</td>
                  <td>{h.level ? `L${String(h.level)}` : '–'}</td>
                  <td>{h.by}</td>
                  <td>{FILE_ACTION[h.action] ?? h.action}</td>
                  <td>{h.remark ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
