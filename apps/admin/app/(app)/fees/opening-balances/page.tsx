import {
  decideOpeningBalances__outcome,
  submitOpeningBalances__action,
} from '@/lib/choice-actions';
import { NoEnterSubmit } from '@/components/NoEnterSubmit';
import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import {
  decideOpeningBalances,
  submitOpeningBalances,
  uploadOpeningBalances,
} from '@/lib/fee-request-actions';
import type { Page } from '@/lib/types';

interface Row {
  row: number;
  admissionNo: string;
  name: string | null;
  section: string | null;
  before: string | null;
  opening: string | null;
  error: string | null;
}
interface Upload {
  id: string;
  fileName: string | null;
  rows: Row[];
  totalRows: number;
  goodRows: number;
  totalDr: string;
  totalCr: string;
  status: 'draft' | 'pending' | 'applied' | 'rejected' | 'cancelled';
  reason: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  decidedBy: string | null;
  decisionNote: string | null;
  workflowInstanceId: string | null;
  waitingWith: string | null;
  result: {
    applied: number;
    billsRebuilt: number;
    notRebuilt: Array<{ admissionNo: string; why: string }>;
  } | null;
}
const STATE: Record<Upload['status'], [string, 'neutral' | 'warning' | 'success' | 'danger']> = {
  draft: ['Checked, not sent', 'neutral'],
  pending: ['Waiting for approval', 'warning'],
  applied: ['Applied', 'success'],
  rejected: ['Rejected', 'danger'],
  cancelled: ['Dropped', 'neutral'],
};
const money = (v: string | number) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** plus = dues (Dr), minus = advance (Cr) */
const drcr = (v: string | null) => {
  const n = Number(v ?? 0);
  return n > 0 ? `${money(n)} Dr` : n < 0 ? `${money(-n)} Cr` : '—';
};

/**
 * Opening balances of many pupils from Excel: download the format (blank or with a class filled in),
 * upload it, read the check, send the file for approval. The figures reach the pupils only after
 * the approval (Fee setup → Approval levels).
 */
export default async function OpeningBalancesPage({
  searchParams,
}: {
  searchParams: Promise<{ upload?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canUpload = me.permissions.includes('fees.bulk.upload');
  const canDecide = me.permissions.includes('fees.adjustment.approve');
  const [files, classes, open] = await Promise.all([
    canUpload
      ? apiFetch<{ data: Upload[] }>('/fees/opening/uploads')
          .then((r) => r.data)
          .catch(() => [])
      : Promise.resolve([] as Upload[]),
    apiFetch<Page<{ id: string; code: string; name: string }>>('/academics/classes?size=200')
      .then((r) => r.data)
      .catch(() => []),
    sp.upload && /^\d+$/.test(sp.upload)
      ? apiFetch<Upload>(`/fees/opening/uploads/${sp.upload}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader
        kicker="Fees"
        title="Opening balances from Excel"
        description="What each pupil owed (dues, Dr) or had paid in advance (Cr) before this session, for many pupils at once. Use it when moving from the old software, or to correct figures. From the second year on, Carry forward to new year does this by itself."
      />
      <Notice params={sp} />
      {!canUpload ? (
        <Card>You do not have the right to upload fee files.</Card>
      ) : (
        <>
          <Card title="1. Download the format">
            <p className="ep-field__help">
              Blank, or with the pupils of one class already written and their present opening
              balance filled in. Three columns matter: the admission number, the amount, and Dr
              (dues) or Cr (advance). Name and class are only for reading.
            </p>
            <form
              method="get"
              action="/api/fees/format"
              style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'end', flexWrap: 'wrap' }}
            >
              <input type="hidden" name="kind" value="opening" />
              <label className="ep-field" htmlFor="obClass">
                <span className="ep-field__label">Class</span>
                <select className="ep-select" id="obClass" name="classId" defaultValue="">
                  <option value="">Blank format (no pupils)</option>
                  {classes.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.code} · {k.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="secondary">
                Download Excel
              </Button>
            </form>
          </Card>

          <Card title="2. Upload the filled file" style={{ marginTop: 'var(--sp-4)' }}>
            <form
              action={uploadOpeningBalances}
              style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'end', flexWrap: 'wrap' }}
            >
              <label className="ep-field" htmlFor="obFile">
                <span className="ep-field__label">Excel file (.xlsx) *</span>
                <input
                  className="ep-input"
                  id="obFile"
                  name="file"
                  type="file"
                  accept=".xlsx"
                  required
                />
              </label>
              <Button type="submit">Upload and check</Button>
            </form>
            <p className="ep-field__help">
              The file is only checked and shown below. Nothing changes for any pupil yet.
            </p>
          </Card>

          {open ? (
            <Card
              title={`3. Check: ${open.fileName ?? `file ${open.id}`}`}
              style={{ marginTop: 'var(--sp-4)' }}
              actions={<Badge tone={STATE[open.status][1]}>{STATE[open.status][0]}</Badge>}
            >
              <p>
                <strong>{open.goodRows}</strong> of {open.totalRows} rows can be applied · dues{' '}
                <strong>{money(open.totalDr)}</strong> · advance{' '}
                <strong>{money(open.totalCr)}</strong>
                {open.totalRows > open.goodRows ? (
                  <>
                    {' '}
                    · <strong>{open.totalRows - open.goodRows}</strong> row(s) with a problem are
                    left out
                  </>
                ) : null}
              </p>
              {open.status === 'pending' && open.waitingWith ? (
                <p className="ep-field__help">
                  With {open.waitingWith}. <a href="/workflow/inbox">My approvals</a>
                </p>
              ) : null}
              {open.result ? (
                <p className="ep-alert ep-alert--success" role="status">
                  Applied to {open.result.applied} pupil(s); {open.result.billsRebuilt} bill(s) made
                  again.
                  {open.result.notRebuilt.length > 0
                    ? ` Bill not made for: ${open.result.notRebuilt
                        .slice(0, 10)
                        .map((x) => x.admissionNo)
                        .join(', ')} (make it from Fees → Demands).`
                    : ''}
                </p>
              ) : null}
              <div className="ep-table-wrap">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Rows of the file</caption>
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Admission no.</th>
                      <th scope="col">Pupil</th>
                      <th scope="col">Class</th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Now
                      </th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Becomes
                      </th>
                      <th scope="col">Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...open.rows]
                      .sort((a, b) => Number(Boolean(b.error)) - Number(Boolean(a.error)))
                      .slice(0, 300)
                      .map((r) => (
                        <tr key={r.row}>
                          <td>{r.row}</td>
                          <td>{r.admissionNo || '—'}</td>
                          <td>{r.name ?? '—'}</td>
                          <td>{r.section ?? '—'}</td>
                          <td style={{ textAlign: 'right' }}>{drcr(r.before)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {r.error ? '—' : <strong>{drcr(r.opening)}</strong>}
                          </td>
                          <td>
                            {r.error ? (
                              <Badge tone="danger">{r.error}</Badge>
                            ) : (
                              <Badge tone="success">OK</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {open.rows.length > 300 ? (
                <p className="ep-field__help">
                  The first 300 rows are shown (rows with a problem first).
                </p>
              ) : null}
              {open.status === 'draft' ? (
                <form
                  action={submitOpeningBalances}
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-3)',
                    alignItems: 'end',
                    flexWrap: 'wrap',
                    marginTop: 'var(--sp-3)',
                  }}
                >
                  <input type="hidden" name="id" value={open.id} />
                  <label className="ep-field" htmlFor="obReason" style={{ flex: '1 1 18rem' }}>
                    <span className="ep-field__label">Reason</span>
                    <input
                      className="ep-input"
                      id="obReason"
                      name="reason"
                      maxLength={300}
                      placeholder="Opening balances from the old software"
                    />
                  </label>
                  <Button
                    type="submit"
                    formAction={submitOpeningBalances__action.bind(null, 'submit')}
                    disabled={open.goodRows === 0}
                  >
                    Send {open.goodRows} row(s) for approval
                  </Button>
                  <Button
                    type="submit"
                    formAction={submitOpeningBalances__action.bind(null, 'cancel')}
                    variant="ghost"
                  >
                    Drop this file
                  </Button>
                </form>
              ) : null}
              {open.status === 'pending' && !open.workflowInstanceId && canDecide ? (
                <form
                  action={decideOpeningBalances}
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-3)',
                    alignItems: 'end',
                    flexWrap: 'wrap',
                    marginTop: 'var(--sp-3)',
                  }}
                >
                  <NoEnterSubmit />
                  <input type="hidden" name="id" value={open.id} />
                  <label className="ep-field" htmlFor="obNote">
                    <span className="ep-field__label">Note</span>
                    <input className="ep-input" id="obNote" name="note" maxLength={300} />
                  </label>
                  <Button
                    type="submit"
                    formAction={decideOpeningBalances__outcome.bind(null, 'approved')}
                  >
                    Approve and apply
                  </Button>
                  <Button
                    type="submit"
                    formAction={decideOpeningBalances__outcome.bind(null, 'rejected')}
                    variant="secondary"
                  >
                    Reject
                  </Button>
                </form>
              ) : null}
            </Card>
          ) : null}

          <Card title="Files of this session" style={{ marginTop: 'var(--sp-4)' }}>
            {files.length === 0 ? (
              <p>No file has been uploaded yet.</p>
            ) : (
              <div className="ep-table-wrap">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Opening balance files</caption>
                  <thead>
                    <tr>
                      <th scope="col">Uploaded</th>
                      <th scope="col">File</th>
                      <th scope="col">Rows</th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Dues (Dr)
                      </th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Advance (Cr)
                      </th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((u) => (
                      <tr key={u.id}>
                        <td>
                          {new Date(u.uploadedAt).toLocaleString('en-IN')}
                          <div className="ep-field__help">{u.uploadedBy ?? ''}</div>
                        </td>
                        <td>
                          <a href={`/fees/opening-balances?upload=${u.id}`}>
                            {u.fileName ?? `File ${u.id}`}
                          </a>
                        </td>
                        <td>
                          {u.goodRows} of {u.totalRows}
                        </td>
                        <td style={{ textAlign: 'right' }}>{money(u.totalDr)}</td>
                        <td style={{ textAlign: 'right' }}>{money(u.totalCr)}</td>
                        <td>
                          <Badge tone={STATE[u.status][1]}>{STATE[u.status][0]}</Badge>
                          {u.status === 'pending' && u.waitingWith ? (
                            <div className="ep-field__help">with {u.waitingWith}</div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
