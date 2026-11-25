import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { FileNoteForm } from '@/components/FileNoteForm';
import { FilesNav } from '@/components/FilesNav';
import { bff } from '@/lib/bff';
import { FILE_ACTION, FILE_TONE, fileWhen, type FileNoteDetail } from '@/lib/file-movement';
import { approveFile, rejectFile, returnFile, withdrawFile } from '@/lib/file-movement-actions';
import { currentLang, t } from '@/lib/i18n';

const LEVEL: Record<string, [string, 'warning' | 'success' | 'danger' | 'neutral' | 'info']> = {
  waiting: ['Next', 'neutral'],
  pending: ['With this approver', 'warning'],
  approved: ['Approved', 'success'],
  returned: ['Sent back', 'info'],
  rejected: ['Rejected', 'danger'],
  void: ['Not reached', 'neutral'],
};

/**
 * A file on the staff website, as the admin's: the note and its attachments, the approvers level by level, and the whole history. The
 * approver it is with approves, sends it back or rejects; the creator corrects a file that was sent
 * back (it starts again from L1), and downloads the PDF once it is approved.
 */
export default async function StaffFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; edit?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const lang = await currentLang();
  let f: FileNoteDetail;
  try {
    f = await bff.api.fetch<FileNoteDetail>(`/file-movement/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
  const editing = f.canResubmit && sp.edit === '1';
  const people = editing
    ? await bff.api.fetch<{ data: Array<{ id: string; name: string }> }>('/file-movement/people')
    : null;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '72rem', margin: '0 auto' }}>
      <PageHeader
        kicker={`${t(lang, 'File movement')} · ${f.number}`}
        title={f.subject}
        description={`${t(lang, 'Raised by')} ${f.createdBy}${f.designation ? ` (${f.designation})` : ''} · ${fileWhen(f.createdAt)}${f.round > 1 ? ` · ${t(lang, 'Round')} ${String(f.round)}` : ''}`}
        actions={
          <>
            <Badge tone={FILE_TONE[f.status] ?? 'neutral'}>{t(lang, f.statusLabel)}</Badge>
            {f.canDownload ? (
              <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                {t(lang, 'Note sheet (PDF)')}
                <FileLinks
                  url={`/api/file-movement/${f.id}/pdf`}
                  saveUrl={`/api/file-movement/${f.id}/pdf?save=1`}
                  label={`${f.number} note sheet`}
                />
              </span>
            ) : null}
          </>
        }
      />
      <FilesNav current="/files" ok={sp.ok} lang={lang} />
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || t(lang, 'That did not work. Please try again.')}
        </p>
      ) : null}
      {editing && people ? (
        <Card title={t(lang, 'Correct and submit again')} style={{ marginBottom: 'var(--sp-4)' }}>
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
                {t(lang, 'This file was sent back')}
                {(() => {
                  const last = [...f.history].reverse().find((h) => h.action === 'returned');
                  return last ? ` · ${last.by}: “${last.remark ?? ''}”` : '';
                })()}
                . {t(lang, 'Correct it and submit again; it will start from the L1 approver.')}
              </p>
              <a className="ep-btn ep-btn--primary" href={`/files/${f.id}?edit=1`}>
                {t(lang, 'Correct and submit again')}
              </a>
            </Card>
          ) : null}
          <Card title={t(lang, 'Approval message')} style={{ marginBottom: 'var(--sp-4)' }}>
            <div className="ep-prose ep-note" dangerouslySetInnerHTML={{ __html: f.bodyHtml }} />
            <h3 className="ep-cdash__h3" style={{ marginTop: 'var(--sp-4)' }}>
              {t(lang, 'Attachments')}
            </h3>
            {f.files.length ? (
              <ul className="ep-cdash__list">
                {f.files.map((x, i) => (
                  <li key={x.id}>
                    {t(lang, 'Attachment')} {i + 1}{' '}
                    <FileLinks
                      url={`/api/file-movement/${f.id}/${x.id}`}
                      saveUrl={`/api/file-movement/${f.id}/${x.id}?save=1`}
                      label={`attachment ${String(i + 1)} of ${f.number}`}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ep-field__help" style={{ margin: 0 }}>
                {t(lang, 'None attached.')}
              </p>
            )}
          </Card>
        </>
      )}
      <Card
        title={`${t(lang, 'Approvers')}${f.round > 1 ? ` · ${t(lang, 'Round')} ${String(f.round)}` : ''}`}
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
                  {t(lang, LEVEL[l.status]?.[0] ?? l.status)}
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
                {t(lang, 'Remark (needed to send back or reject; optional when approving)')}
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
                {t(lang, 'Approve')}
              </Button>
              <Button type="submit" formAction={returnFile} variant="secondary">
                {t(lang, 'Send back to the creator')}
              </Button>
              <Button type="submit" formAction={rejectFile} variant="secondary">
                {t(lang, 'Reject')}
              </Button>
            </div>
          </form>
        ) : null}
        {f.canWithdraw && !editing ? (
          <form action={withdrawFile} style={{ marginTop: 'var(--sp-3)' }}>
            <input type="hidden" name="id" value={f.id} />
            <Button type="submit" variant="ghost" size="sm">
              {t(lang, 'Withdraw this file')}
            </Button>
          </form>
        ) : null}
      </Card>
      <Card title={t(lang, 'History')}>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={t(lang, 'History')}>
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">{t(lang, 'Every step of this file')}</caption>
            <thead>
              <tr>
                <th scope="col">{t(lang, 'When')}</th>
                <th scope="col">{t(lang, 'Round')}</th>
                <th scope="col">{t(lang, 'Level')}</th>
                <th scope="col">{t(lang, 'By')}</th>
                <th scope="col">{t(lang, 'What')}</th>
                <th scope="col">{t(lang, 'Remark')}</th>
              </tr>
            </thead>
            <tbody>
              {f.history.map((h, i) => (
                <tr key={String(i)}>
                  <td>{fileWhen(h.at)}</td>
                  <td>{h.round}</td>
                  <td>{h.level ? `L${String(h.level)}` : '–'}</td>
                  <td>{h.by}</td>
                  <td>{t(lang, FILE_ACTION[h.action] ?? h.action)}</td>
                  <td>{h.remark ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
