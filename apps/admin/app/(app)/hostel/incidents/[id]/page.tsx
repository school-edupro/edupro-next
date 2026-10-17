import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { FileLinks } from '@/components/FileLinks';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { addIncidentNote } from '@/lib/hostel-actions';
import { INCIDENT_CATEGORIES, INCIDENT_STATUS, incidentWhen, type Incident } from '@/lib/incidents';
import { notFound } from 'next/navigation';

interface Note {
  id: string;
  body: string;
  statusTo: Incident['status'] | null;
  fileIds: string[];
  at: string;
  by: string | null;
}
interface Detail extends Omit<Incident, 'notes'> {
  recordedAt: string;
  fileIds: string[];
  notes: Note[];
}

/**
 * One hostel incident: what happened, who was told, the photos and documents, and the follow-up trail.
 * A note may move it to follow-up, back to open, or close it (the note is the closing remark).
 */
export default async function HostelIncidentPage({
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
  let i: Detail;
  try {
    i = await apiFetch(`/hostel/incidents/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const canWrite = me.permissions.includes('hostel.incident.manage');
  const status = INCIDENT_STATUS[i.status];
  const files = (ids: string[], what: string) =>
    ids.length ? (
      <div className="ep-filecell">
        <span className="ep-field__help">Files</span>
        {ids.map((f, n) => (
          <FileLinks
            key={f}
            href={`/api/files/${f}/download`}
            label={`${what} file ${String(n + 1)}`}
          />
        ))}
      </div>
    ) : null;
  const facts: Array<[string, React.ReactNode]> = [
    ['Pupil', `${i.name} · ${i.admissionNo}`],
    ['Hostel', i.hostel],
    ['When', incidentWhen(i.occurredAt)],
    ['Kind', INCIDENT_CATEGORIES.find(([k]) => k === i.category)?.[1] ?? i.category],
    ['Severity', i.severity === 'serious' ? 'Serious' : 'Minor'],
    ['Recorded', `${incidentWhen(i.recordedAt)} by ${i.recordedBy ?? '—'}`],
    ['Parent', i.parentToldAt ? `Told ${incidentWhen(i.parentToldAt)}` : 'Not told'],
    ['Principal', i.principalToldAt ? `Told ${incidentWhen(i.principalToldAt)}` : '—'],
  ];
  return (
    <>
      <Breadcrumbs items={[{ label: 'Incidents', href: '/hostel/incidents' }, { label: i.name }]} />
      <PageHeader
        kicker="Hostel · Incident"
        title={`${i.name} · ${INCIDENT_CATEGORIES.find(([k]) => k === i.category)?.[1] ?? i.category}`}
        actions={<Badge tone={status[1]}>{status[0]}</Badge>}
      />
      <HostelNav current="/hostel/incidents" permissions={me.permissions} />
      <Notice params={sp} />
      <Card title="What happened" style={{ marginBottom: 'var(--sp-4)' }}>
        <dl
          className="ep-dl"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
            gap: 'var(--sp-2)',
          }}
        >
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt className="ep-field__help">{k}</dt>
              <dd style={{ margin: 0 }}>{v}</dd>
            </div>
          ))}
        </dl>
        <p style={{ marginBottom: 0 }}>{i.what}</p>
        {i.action ? <p className="ep-field__help">Action taken: {i.action}</p> : null}
        {files(i.fileIds, 'incident')}
        {i.status === 'closed' ? (
          <p style={{ marginBottom: 0 }}>
            <Badge tone="success">Closed</Badge> {i.closedAt ? incidentWhen(i.closedAt) : ''} by{' '}
            {i.closedBy ?? '—'}
            {i.closingRemark ? ` · ${i.closingRemark}` : ''}
          </p>
        ) : null}
      </Card>
      <Card
        title={`Follow-up · ${String(i.notes.length)} note(s)`}
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {i.notes.length === 0 ? (
          <p className="ep-field__help">No follow-up yet.</p>
        ) : (
          <ol
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'grid',
              gap: 'var(--sp-3)',
            }}
          >
            {i.notes.map((n) => (
              <li key={n.id} className="ep-card" style={{ padding: 'var(--sp-3)' }}>
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong>{n.by ?? '—'}</strong>
                  <span className="ep-field__help">{incidentWhen(n.at)}</span>
                  {n.statusTo ? (
                    <Badge tone={INCIDENT_STATUS[n.statusTo][1]}>
                      → {INCIDENT_STATUS[n.statusTo][0]}
                    </Badge>
                  ) : null}
                </div>
                <p style={{ margin: 'var(--sp-2) 0 0' }}>{n.body}</p>
                {files(n.fileIds, 'note')}
              </li>
            ))}
          </ol>
        )}
      </Card>
      {canWrite ? (
        <Card title={i.status === 'closed' ? 'Reopen with a note' : 'Add a follow-up note'}>
          <form action={addIncidentNote} className="hs-form" style={{ maxWidth: '44rem' }}>
            <input type="hidden" name="id" value={i.id} />
            <label className="ep-field" htmlFor="in-body">
              <span className="ep-field__label">Note * (when closing: the closing remark)</span>
              <textarea
                id="in-body"
                name="body"
                className="ep-input"
                rows={3}
                required
                minLength={2}
                maxLength={1000}
              />
            </label>
            <label className="ep-field" htmlFor="in-status">
              <span className="ep-field__label">Then</span>
              <select
                id="in-status"
                name="statusTo"
                className="ep-select"
                defaultValue={i.status === 'closed' ? 'follow_up' : ''}
                required={i.status === 'closed'}
              >
                {i.status === 'closed' ? null : (
                  <option value="">Keep it {status[0].toLowerCase()}</option>
                )}
                {i.status !== 'follow_up' ? <option value="follow_up">In follow-up</option> : null}
                {i.status !== 'open' ? <option value="open">Open</option> : null}
                {i.status !== 'closed' ? <option value="closed">Close the incident</option> : null}
              </select>
            </label>
            <label className="ep-field" htmlFor="in-files">
              <span className="ep-field__label">
                Photos or documents (PDF, JPEG, PNG; up to 5 MB each)
              </span>
              <input
                id="in-files"
                name="files"
                type="file"
                multiple
                className="ep-input"
                accept="application/pdf,image/jpeg,image/png,image/webp"
              />
            </label>
            <div>
              <Button type="submit">Save the note</Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
