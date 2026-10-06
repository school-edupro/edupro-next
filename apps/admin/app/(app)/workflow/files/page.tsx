import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { FilesNav } from '@/components/files/FilesNav';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { FILE_TONE, fileWhen, type FileNote } from '@/lib/file-movement';

const BOXES: Array<[string, string]> = [
  ['inbox', 'To approve'],
  ['mine', 'My files'],
  ['acted', 'Decided by me'],
  ['all', 'All'],
];
const STATUSES: Array<[string, string]> = [
  ['pending', 'In approval'],
  ['returned', 'Sent back'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['withdrawn', 'Withdrawn'],
];

/**
 * File movement: the files waiting for this person, the ones they raised, the ones they decided, and
 * all they may see (the office: every file). The list with its filters downloads as Excel or PDF.
 */
export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const box = BOXES.some(([b]) => b === sp.box) ? sp.box! : 'inbox';
  const filters: Record<string, string> = { box };
  if (STATUSES.some(([s]) => s === sp.status)) filters.status = sp.status!;
  for (const k of ['from', 'to'] as const)
    if (/^\d{4}-\d{2}-\d{2}$/.test(sp[k] ?? '')) filters[k] = sp[k]!;
  if (sp.q?.trim()) filters.q = sp.q.trim().slice(0, 80);
  const qs = new URLSearchParams(filters).toString();
  const list = await apiFetch<{
    data: FileNote[];
    inbox: number;
    returned: number;
    seesAll: boolean;
  }>(`/file-movement?${qs}`);
  return (
    <>
      <PageHeader
        kicker="Approvals"
        title="File movement"
        description="Files raised for approval move through the approvers their creator chose, level by level. An approved file can be downloaded as a PDF note sheet."
        actions={
          <>
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/workflow/files/new">
              + Add new approval
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/file-movement/export?${qs}&format=xlsx`}
            >
              Excel
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/file-movement/export?${qs}&format=pdf`}
            >
              PDF
            </a>
          </>
        }
      />
      <FilesNav current="/workflow/files" ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <nav className="ep-tabs-links" aria-label="Lists" style={{ marginBottom: 'var(--sp-3)' }}>
        {BOXES.map(([value, label]) => (
          <a
            key={value}
            href={`/workflow/files?box=${value}`}
            aria-current={box === value ? 'page' : undefined}
          >
            {label}
            {value === 'inbox' ? ` · ${String(list.inbox)}` : ''}
            {value === 'mine' && list.returned ? ` · ${String(list.returned)} sent back` : ''}
            {value === 'all' && !list.seesAll ? ' mine' : ''}
          </a>
        ))}
      </nav>
      <div className="ep-filter-band">
        <form method="get" className="ep-dlog__filters">
          <input type="hidden" name="box" value={box} />
          <SelectField
            id="fm-status"
            name="status"
            label="Status"
            defaultValue={filters.status ?? ''}
            options={[
              { value: '', label: 'Any status' },
              ...STATUSES.map(([value, label]) => ({ value, label })),
            ]}
          />
          <InputField
            id="fm-from"
            name="from"
            type="date"
            label="Raised from"
            defaultValue={filters.from ?? ''}
          />
          <InputField
            id="fm-to"
            name="to"
            type="date"
            label="Raised to"
            defaultValue={filters.to ?? ''}
          />
          <InputField
            id="fm-q"
            name="q"
            type="search"
            label="Subject, file no. or raised by"
            defaultValue={filters.q ?? ''}
            maxLength={80}
          />
          <Button type="submit">Show</Button>
          {Object.keys(filters).length > 1 ? (
            <a className="ep-btn ep-btn--secondary" href={`/workflow/files?box=${box}`}>
              Clear
            </a>
          ) : null}
        </form>
      </div>
      <Card>
        {list.data.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            {box === 'inbox' ? 'No file waits for your approval.' : 'Nothing here.'}
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Files">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Files for approval</caption>
              <thead>
                <tr>
                  <th scope="col">S.no</th>
                  <th scope="col">File no.</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Raised by</th>
                  <th scope="col">Raised on</th>
                  <th scope="col">Levels</th>
                  <th scope="col">With</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((n, i) => (
                  <tr key={n.id}>
                    <td>{i + 1}</td>
                    <th scope="row">
                      <a href={`/workflow/files/${n.id}`} style={{ textDecoration: 'underline' }}>
                        {n.number}
                      </a>
                    </th>
                    <td>
                      {n.subject}
                      {n.round > 1 ? <div className="ep-field__help">Round {n.round}</div> : null}
                    </td>
                    <td>
                      {n.createdBy}
                      <div className="ep-field__help">{n.designation}</div>
                    </td>
                    <td>{fileWhen(n.createdAt)}</td>
                    <td>
                      {n.approvedLevels} of {n.levels}
                    </td>
                    <td>{n.waitingOn ?? (n.status === 'returned' ? n.createdBy : '–')}</td>
                    <td>
                      <Badge tone={FILE_TONE[n.status] ?? 'neutral'}>{n.statusLabel}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
