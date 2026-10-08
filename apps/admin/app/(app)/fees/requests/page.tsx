import {
  Alert,
  Badge,
  Button,
  Card,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import {
  approveCollection,
  approveFeeBatch,
  approveFeeChange,
  dropCollection,
  rejectCollection,
  rejectFeeBatch,
  rejectFeeChange,
  requestFeeChange,
  submitCollection,
  uploadCollection,
  uploadSettlementDates,
} from '@/lib/fee-request-actions';
import type { FeePeriod } from '@/lib/types';

interface Req {
  id: string;
  kind: 'late_fee' | 'transfer' | 'date_change';
  status: string;
  student: string;
  admissionNo: string;
  receiptNo: string | null;
  receiptAmount: string | null;
  receivedOn: string | null;
  clearedOn: string | null;
  period: string | null;
  ledger: string | null;
  amount: string | null;
  toStudent: string | null;
  toAdmissionNo: string | null;
  newReceivedOn: string | null;
  newClearedOn: string | null;
  batchId: string | null;
  reason: string;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decisionNote: string | null;
  result: { newReceiptNo?: string } | null;
}
interface UploadRow {
  row: number;
  admissionNo: string;
  name: string | null;
  section: string | null;
  amount: number;
  mode: string;
  receivedOn: string;
  ledger: string;
  reference: string | null;
  instrumentNo: string | null;
  bankName: string | null;
  error: string | null;
}
interface Upload {
  id: string;
  fileName: string | null;
  rows?: UploadRow[];
  totalRows: number;
  goodRows: number;
  totalAmount: string;
  status: 'draft' | 'pending' | 'posted' | 'rejected' | 'cancelled';
  reason: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  decidedBy: string | null;
  decisionNote?: string | null;
  receipts?: Array<{ row: number; receiptNo: string | null }> | null;
}

const TABS = [
  ['list', 'Requests'],
  ['new', 'New request'],
  ['settlement', 'Settlement dates from Excel'],
  ['collection', 'Collection from Excel'],
] as const;
type Tab = (typeof TABS)[number][0];

const money = (v: string | number | null) =>
  `₹${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
const tone = (s: string) =>
  s === 'pending' || s === 'draft'
    ? 'warning'
    : s === 'approved' || s === 'posted'
      ? 'success'
      : s === 'rejected'
        ? 'danger'
        : 'neutral';
const KIND: Record<Req['kind'], string> = {
  late_fee: 'Late-fee waiver',
  transfer: 'Move receipt to another pupil',
  date_change: 'Date correction',
};

function what(r: Req) {
  if (r.kind === 'late_fee')
    return `${r.period ?? ''}${r.ledger === 'hostel' ? ' (hostel)' : ''}: charge ${money(r.amount)} as late fee${Number(r.amount) === 0 ? ' (waived)' : ''}`;
  if (r.kind === 'transfer')
    return `Receipt ${r.receiptNo ?? ''} (${money(r.receiptAmount)}) → ${r.toStudent ?? ''} (${r.toAdmissionNo ?? ''})${r.result?.newReceiptNo ? `; new receipt ${r.result.newReceiptNo}` : ''}`;
  return `Receipt ${r.receiptNo ?? ''}: ${r.newReceivedOn ? `receipt date → ${dmy(r.newReceivedOn)}` : ''}${r.newReceivedOn && r.newClearedOn ? ', ' : ''}${r.newClearedOn ? `settlement date → ${dmy(r.newClearedOn)}` : ''}`;
}

/** Fee changes that wait for approval: waivers, transfers, date corrections and the Excel uploads. */
export default async function FeeRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : 'list';
  const me = await getMe();
  const canAsk = me.permissions.includes('fees.adjustment.request');
  const canApprove = me.permissions.includes('fees.adjustment.approve');
  const canUpload = me.permissions.includes('fees.bulk.upload');
  const [requests, periods, uploads, upload] = await Promise.all([
    tab === 'list' && canAsk
      ? apiFetch<{ data: Req[] }>(`/fees/requests${sp.status ? `?status=${sp.status}` : ''}`).then(
          (r) => r.data,
        )
      : Promise.resolve<Req[]>([]),
    tab === 'new'
      ? apiFetch<{ data: FeePeriod[] }>('/fees/periods').then((r) => r.data)
      : Promise.resolve<FeePeriod[]>([]),
    tab === 'collection' && canUpload
      ? apiFetch<{ data: Upload[] }>('/fees/requests/collections').then((r) => r.data)
      : Promise.resolve<Upload[]>([]),
    tab === 'collection' && canUpload && sp.upload
      ? apiFetch<Upload>(`/fees/requests/collections/${sp.upload}`).catch(() => null)
      : Promise.resolve<Upload | null>(null),
  ]);
  let bad: Array<{ row: number; receiptNo: string; error: string }> = [];
  if (sp.bad) {
    try {
      bad = JSON.parse(Buffer.from(sp.bad, 'base64url').toString('utf8'));
    } catch {
      bad = [];
    }
  }
  const batches = [
    ...new Set(requests.filter((r) => r.batchId && r.status === 'pending').map((r) => r.batchId!)),
  ];
  return (
    <>
      <PageHeader
        kicker="Fees"
        title="Approvals and uploads"
        description="The accounts desk asks for a late-fee waiver, a receipt moved to another pupil or a date correction; the school admin approves. Bulk settlement dates and bulk collection come from Excel and also wait for approval."
      />
      <Notice params={sp} />
      <nav
        aria-label="Approvals and uploads"
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
          marginBottom: 'var(--sp-4)',
        }}
      >
        {TABS.map(([k, label]) => (
          <a
            key={k}
            className={`ep-btn ep-btn--sm ${k === tab ? '' : 'ep-btn--ghost'}`}
            href={`/fees/requests?tab=${k}`}
            aria-current={k === tab ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>

      {tab === 'list' ? (
        <Card title="Requests of this year">
          <form
            method="get"
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'flex-end',
              marginBottom: 'var(--sp-3)',
            }}
          >
            <input type="hidden" name="tab" value="list" />
            <SelectField
              id="status"
              name="status"
              label="Status"
              defaultValue={sp.status ?? ''}
              options={[
                { value: '', label: 'All' },
                { value: 'pending', label: 'Waiting' },
                { value: 'approved', label: 'Approved' },
                { value: 'rejected', label: 'Rejected' },
              ]}
            />
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </form>
          {canApprove && batches.length > 0 ? (
            <div style={{ display: 'grid', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
              {batches.map((b) => (
                <form
                  key={b}
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <input type="hidden" name="batchId" value={b} />
                  <span>
                    Excel file with{' '}
                    {requests.filter((r) => r.batchId === b && r.status === 'pending').length} date
                    correction(s) waiting:
                  </span>
                  <Button type="submit" size="sm" formAction={approveFeeBatch}>
                    Approve all in this file
                  </Button>
                  <Button type="submit" size="sm" variant="secondary" formAction={rejectFeeBatch}>
                    Reject all
                  </Button>
                </form>
              ))}
            </div>
          ) : null}
          {requests.length === 0 ? (
            <p className="ep-field__help">No request yet.</p>
          ) : (
            <div className="ep-table-wrap">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Fee change requests</caption>
                <thead>
                  <tr>
                    <th scope="col">Asked on</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Pupil</th>
                    <th scope="col">What</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Asked by</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="ep-sr-only">Decide</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td>{when(r.requestedAt)}</td>
                      <td>{KIND[r.kind]}</td>
                      <td>
                        {r.student} ({r.admissionNo})
                      </td>
                      <td>{what(r)}</td>
                      <td>{r.reason}</td>
                      <td>{r.requestedBy ?? '—'}</td>
                      <td>
                        <Badge tone={tone(r.status)}>
                          {r.status === 'pending' ? 'Waiting' : r.status}
                        </Badge>
                        {r.decidedBy ? (
                          <div className="ep-field__help">by {r.decidedBy}</div>
                        ) : null}
                      </td>
                      <td>
                        {canApprove && r.status === 'pending' ? (
                          <form style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                            <input type="hidden" name="id" value={r.id} />
                            <Button type="submit" size="sm" formAction={approveFeeChange}>
                              Approve
                            </Button>
                            <Button
                              type="submit"
                              size="sm"
                              variant="secondary"
                              formAction={rejectFeeChange}
                            >
                              Reject
                            </Button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === 'new' ? (
        canAsk ? (
          <div style={{ display: 'grid', gap: 'var(--sp-5)' }}>
            <Card title="Waive or reduce a late fee">
              <form action={requestFeeChange}>
                <input type="hidden" name="kind" value="late_fee" />
                <FormRow columns={4}>
                  <InputField
                    id="lfAdm"
                    name="admissionNo"
                    label="Admission no."
                    required
                    maxLength={40}
                  />
                  <SelectField
                    id="lfPeriod"
                    name="periodId"
                    label="Instalment month"
                    required
                    options={periods.map((p) => ({ value: p.id, label: p.name }))}
                  />
                  <SelectField
                    id="lfLedger"
                    name="ledger"
                    label="Fee type"
                    options={[
                      { value: 'school', label: 'Regular fee' },
                      { value: 'hostel', label: 'Hostel fee' },
                    ]}
                  />
                  <InputField
                    id="lfAmount"
                    name="amount"
                    label="Late fee to charge (0 = waive)"
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    defaultValue={0}
                  />
                </FormRow>
                <FormRow columns={1}>
                  <InputField
                    id="lfReason"
                    name="reason"
                    label="Reason"
                    required
                    minLength={3}
                    maxLength={300}
                  />
                </FormRow>
                <p className="ep-field__help">
                  Choose the first month of the instalment (for a quarter: April, July, October,
                  January). The same route covers a part waiver: type what should still be charged.
                  A cheque-bounce charge is waived under Fees → Adjustments (waiver).
                </p>
                <FormActions>
                  <Button type="submit">Send for approval</Button>
                </FormActions>
              </form>
            </Card>
            <Card title="Move a receipt to another pupil">
              <form action={requestFeeChange}>
                <input type="hidden" name="kind" value="transfer" />
                <FormRow columns={3}>
                  <InputField
                    id="trReceipt"
                    name="receiptNo"
                    label="Receipt no. (as printed)"
                    required
                    maxLength={60}
                  />
                  <InputField
                    id="trTo"
                    name="toAdmissionNo"
                    label="Move to admission no."
                    required
                    maxLength={40}
                  />
                  <InputField
                    id="trReason"
                    name="reason"
                    label="Reason"
                    required
                    minLength={3}
                    maxLength={300}
                  />
                </FormRow>
                <p className="ep-field__help">
                  For a parent who paid twice into one child’s account. On approval the receipt is
                  cancelled for the first pupil and a new receipt, with the same date, mode and
                  amount, is made for the other. A receipt with a refund cannot be moved.
                </p>
                <FormActions>
                  <Button type="submit">Send for approval</Button>
                </FormActions>
              </form>
            </Card>
            <Card title="Correct a receipt date or a settlement date">
              <form action={requestFeeChange}>
                <input type="hidden" name="kind" value="date_change" />
                <FormRow columns={4}>
                  <InputField
                    id="dcReceipt"
                    name="receiptNo"
                    label="Receipt no. (as printed)"
                    required
                    maxLength={60}
                  />
                  <InputField
                    id="dcReceived"
                    name="newReceivedOn"
                    label="New receipt date"
                    type="date"
                  />
                  <InputField
                    id="dcCleared"
                    name="newClearedOn"
                    label="Settlement date"
                    type="date"
                  />
                  <InputField
                    id="dcReason"
                    name="reason"
                    label="Reason"
                    required
                    minLength={3}
                    maxLength={300}
                  />
                </FormRow>
                <p className="ep-field__help">
                  Fill one date or both. The receipt date must stay in the same financial year and
                  in a month that is not closed. Late fee already collected on the receipt is not
                  worked out again.
                </p>
                <FormActions>
                  <Button type="submit">Send for approval</Button>
                </FormActions>
              </form>
            </Card>
          </div>
        ) : (
          <Card>You do not have the right to raise fee requests.</Card>
        )
      ) : null}

      {tab === 'settlement' ? (
        <Card title="Settlement dates from Excel">
          {canUpload ? (
            <>
              <p className="ep-field__help">
                1. Download the format. 2. One receipt per row with its settlement date (and a new
                receipt date only if it was wrong). 3. Upload. Good rows wait for the school admin
                under Requests; rows that cannot be used are listed here with the reason.
              </p>
              <p>
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href="/api/fees/format?kind=settlement"
                >
                  Download the Excel format
                </a>
              </p>
              <form action={uploadSettlementDates}>
                <FormRow columns={3}>
                  <label className="ep-field">
                    <span className="ep-field__label">Excel file</span>
                    <input className="ep-input" type="file" name="file" accept=".xlsx" required />
                  </label>
                  <InputField
                    id="stReason"
                    name="reason"
                    label="Reason"
                    required
                    minLength={3}
                    maxLength={300}
                  />
                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <Button type="submit">Check and send for approval</Button>
                  </div>
                </FormRow>
              </form>
              {sp.rows ? (
                <div style={{ marginTop: 'var(--sp-4)' }}>
                  <Alert tone={Number(sp.badCount) > 0 ? 'warning' : 'success'}>
                    {sp.good} of {sp.rows} row(s) sent for approval
                    {Number(sp.badCount) > 0 ? `; ${sp.badCount} row(s) not used.` : '.'}
                  </Alert>
                  {bad.length > 0 ? (
                    <div className="ep-table-wrap">
                      <table className="ep-table ep-table--dense">
                        <caption className="ep-sr-only">Rows not used</caption>
                        <thead>
                          <tr>
                            <th scope="col">Excel row</th>
                            <th scope="col">Receipt no.</th>
                            <th scope="col">Why</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bad.map((b) => (
                            <tr key={b.row}>
                              <td>{b.row}</td>
                              <td>{b.receiptNo}</td>
                              <td>{b.error}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <p>You do not have the right to upload fee files.</p>
          )}
        </Card>
      ) : null}

      {tab === 'collection' ? (
        canUpload ? (
          <div style={{ display: 'grid', gap: 'var(--sp-5)' }}>
            <Card title="Collection from Excel">
              <p className="ep-field__help">
                1. Download the format. 2. One payment per row: admission no., amount, mode, date.
                3. Upload: every row is checked and shown. 4. When no row is in error, send it for
                approval. Receipts are made only after the school admin approves, all rows together.
              </p>
              <p>
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href="/api/fees/format?kind=collection"
                >
                  Download the Excel format
                </a>
              </p>
              <form action={uploadCollection}>
                <FormRow columns={3}>
                  <label className="ep-field">
                    <span className="ep-field__label">Excel file</span>
                    <input className="ep-input" type="file" name="file" accept=".xlsx" required />
                  </label>
                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <Button type="submit">Check the file</Button>
                  </div>
                </FormRow>
              </form>
            </Card>
            {upload ? (
              <Card
                title={`File ${upload.fileName ?? upload.id}: ${upload.goodRows} of ${upload.totalRows} row(s) good, ${money(upload.totalAmount)}`}
              >
                <p>
                  <Badge tone={tone(upload.status)}>
                    {upload.status === 'draft'
                      ? 'Checked, not sent'
                      : upload.status === 'pending'
                        ? 'Waiting for approval'
                        : upload.status === 'posted'
                          ? 'Receipts made'
                          : upload.status}
                  </Badge>{' '}
                  {upload.reason ? `Reason: ${upload.reason}` : ''}
                </p>
                <div className="ep-table-wrap">
                  <table className="ep-table ep-table--dense">
                    <caption className="ep-sr-only">Rows of the file</caption>
                    <thead>
                      <tr>
                        <th scope="col">Row</th>
                        <th scope="col">Adm. no.</th>
                        <th scope="col">Pupil</th>
                        <th scope="col">Class</th>
                        <th scope="col">Date</th>
                        <th scope="col">Mode</th>
                        <th scope="col">Fee type</th>
                        <th scope="col">Ref. / cheque</th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Amount
                        </th>
                        <th scope="col">Check</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(upload.rows ?? []).map((r) => {
                        const made = upload.receipts?.find((x) => x.row === r.row)?.receiptNo;
                        return (
                          <tr key={r.row}>
                            <td>{r.row}</td>
                            <td>{r.admissionNo}</td>
                            <td>{r.name ?? '—'}</td>
                            <td>{r.section ?? '—'}</td>
                            <td>
                              {/^\d{4}-/.test(r.receivedOn) ? dmy(r.receivedOn) : r.receivedOn}
                            </td>
                            <td>{r.mode.toUpperCase()}</td>
                            <td>{r.ledger === 'hostel' ? 'Hostel' : 'Regular'}</td>
                            <td>{r.instrumentNo ?? r.reference ?? '—'}</td>
                            <td style={{ textAlign: 'right' }}>{money(r.amount)}</td>
                            <td>
                              {r.error ? (
                                <Badge tone="danger">{r.error}</Badge>
                              ) : made ? (
                                <Badge tone="success">Receipt {made}</Badge>
                              ) : (
                                <Badge tone="success">Good</Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {upload.status === 'draft' ? (
                  <form style={{ marginTop: 'var(--sp-4)' }}>
                    <input type="hidden" name="id" value={upload.id} />
                    {upload.goodRows === upload.totalRows ? (
                      <FormRow columns={3}>
                        <InputField
                          id="colReason"
                          name="reason"
                          label="Reason / source of the file"
                          maxLength={300}
                        />
                        <div
                          style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-2)' }}
                        >
                          <Button type="submit" formAction={submitCollection}>
                            Send for approval
                          </Button>
                          <Button type="submit" variant="secondary" formAction={dropCollection}>
                            Drop this file
                          </Button>
                        </div>
                      </FormRow>
                    ) : (
                      <>
                        <p className="ep-field__help">
                          Correct the rows marked in red in your Excel file and upload it again.
                        </p>
                        <Button type="submit" variant="secondary" formAction={dropCollection}>
                          Drop this file
                        </Button>
                      </>
                    )}
                  </form>
                ) : null}
                {upload.status === 'pending' && canApprove ? (
                  <form style={{ marginTop: 'var(--sp-4)' }}>
                    <input type="hidden" name="id" value={upload.id} />
                    <FormRow columns={3}>
                      <InputField
                        id="colNote"
                        name="note"
                        label="Note (optional)"
                        maxLength={300}
                      />
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-2)' }}>
                        <Button type="submit" formAction={approveCollection}>
                          Approve and make {upload.totalRows} receipt(s)
                        </Button>
                        <Button type="submit" variant="secondary" formAction={rejectCollection}>
                          Reject
                        </Button>
                      </div>
                    </FormRow>
                  </form>
                ) : null}
              </Card>
            ) : null}
            <Card title="Files of this year">
              {uploads.length === 0 ? (
                <p className="ep-field__help">No file yet.</p>
              ) : (
                <div className="ep-table-wrap">
                  <table className="ep-table ep-table--dense">
                    <caption className="ep-sr-only">Collection files</caption>
                    <thead>
                      <tr>
                        <th scope="col">Uploaded</th>
                        <th scope="col">File</th>
                        <th scope="col">By</th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Rows
                        </th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Amount
                        </th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uploads.map((u) => (
                        <tr key={u.id}>
                          <td>{when(u.uploadedAt)}</td>
                          <td>
                            <a href={`/fees/requests?tab=collection&upload=${u.id}`}>
                              {u.fileName ?? `File ${u.id}`}
                            </a>
                          </td>
                          <td>{u.uploadedBy ?? '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            {u.goodRows}/{u.totalRows}
                          </td>
                          <td style={{ textAlign: 'right' }}>{money(u.totalAmount)}</td>
                          <td>
                            <Badge tone={tone(u.status)}>
                              {u.status === 'draft'
                                ? 'Checked, not sent'
                                : u.status === 'pending'
                                  ? 'Waiting'
                                  : u.status === 'posted'
                                    ? 'Receipts made'
                                    : u.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        ) : (
          <Card>You do not have the right to upload fee files.</Card>
        )
      ) : null}
    </>
  );
}
