'use client';
import { Drawer, FormRow, InputField, SelectField } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { addCopies, changeCopyStatus, editCopy } from '@/lib/library-books-actions';
import type { BookCopy, BookSetup } from '@/lib/library-books';
import { CopyFields, copyPayload, emptyCopy, type CopyState } from './CopyFields';

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** The statuses a copy may move to from where it is, with what each means. */
function choices(status: BookCopy['status']) {
  const all = [
    ['withdrawn', 'Withdrawn (discarded, weeded out)'],
    ['lost', 'Lost'],
    ['lost_paid', 'Lost and paid'],
    ['damaged', 'Damaged'],
    ['found', 'Found again'],
    ['available', 'Back in use'],
  ] as const;
  return all.filter(([k]) => {
    if (status === 'issued') return k === 'lost' || k === 'lost_paid';
    if (status === 'available') return ['withdrawn', 'lost', 'lost_paid', 'damaged'].includes(k);
    if (status === 'lost') return k === 'found';
    if (status === 'damaged') return ['withdrawn', 'available', 'lost'].includes(k);
    if (status === 'withdrawn') return k === 'available';
    return false;
  });
}

function fromCopy(c: BookCopy): CopyState {
  return {
    libraryId: c.libraryId,
    count: '1',
    typed: false,
    accessionNos: '',
    accessionedOn: c.accessionedOn,
    shelfId: c.shelfId ?? '',
    rack: c.rack ?? '',
    barcode: c.barcode ?? '',
    acquisition: c.acquisition ?? '',
    vendorId: c.vendorId ?? '',
    donor: c.donor ?? '',
    billNo: c.billNo ?? '',
    billDate: c.billDate ?? '',
    poNo: c.poNo ?? '',
    price: c.price ?? '',
    remarks: c.remarks ?? '',
  };
}

/** A copy's two actions: its details (library, shelf, rack, barcode, source) and its status. */
export function CopyActions({
  titleId,
  copy,
  setup,
}: {
  titleId: string;
  copy: BookCopy;
  setup: BookSetup;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<'edit' | 'status' | null>(null);
  const [value, setValue] = useState<CopyState>(() => fromCopy(copy));
  const allowed = choices(copy.status);
  const [status, setStatus] = useState<string>(allowed[0]?.[0] ?? '');
  const [on, setOn] = useState(today());
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState(copy.price ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const close = () => {
    setOpen(null);
    setError(null);
  };
  const saveEdit = () =>
    start(async () => {
      const r = await editCopy(titleId, copy.id, copyPayload(value, 'edit'));
      if (!r.ok) return setError(r.error);
      close();
      router.refresh();
    });
  const saveStatus = () => {
    if (reason.trim().length < 3) return setError('Give the reason (at least 3 characters).');
    start(async () => {
      const r = await changeCopyStatus(titleId, copy.id, {
        status,
        on,
        reason: reason.trim(),
        ...(status === 'lost_paid' ? { amount: Number(amount) || 0 } : {}),
      });
      if (!r.ok) return setError(r.error);
      close();
      setReason('');
      router.refresh();
    });
  };
  if (copy.status === 'sold') return null;
  return (
    <span className="ep-book__copy-actions">
      <button
        type="button"
        className="ep-btn ep-btn--ghost ep-btn--sm"
        aria-label={`Edit copy ${copy.accessionNo}`}
        onClick={() => {
          setValue(fromCopy(copy));
          setOpen('edit');
        }}
      >
        Edit
      </button>
      {allowed.length ? (
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          aria-label={`Change the status of copy ${copy.accessionNo}`}
          onClick={() => {
            setStatus(allowed[0]![0]);
            setOpen('status');
          }}
        >
          Status
        </button>
      ) : null}
      <Drawer
        open={open === 'edit'}
        title={`Copy ${copy.accessionNo}`}
        onClose={close}
        width="lg"
        footer={
          <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending}
              onClick={saveEdit}
            >
              Save
            </button>
            <button type="button" className="ep-btn ep-btn--ghost" onClick={close}>
              Cancel
            </button>
          </span>
        }
      >
        {error && open === 'edit' ? (
          <p className="ep-alert ep-alert--danger" role="alert">
            {error}
          </p>
        ) : null}
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          The accession number stays. A change of library, shelf or rack is kept in the copy’s
          history.
        </p>
        {open === 'edit' ? (
          <CopyFields
            setup={setup}
            value={value}
            onChange={setValue}
            mode="edit"
            idPrefix={`cp-${copy.id}`}
          />
        ) : null}
      </Drawer>
      <Drawer
        open={open === 'status'}
        title={`Status of copy ${copy.accessionNo}`}
        onClose={close}
        width="md"
        footer={
          <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending}
              onClick={saveStatus}
            >
              Save
            </button>
            <button type="button" className="ep-btn ep-btn--ghost" onClick={close}>
              Cancel
            </button>
          </span>
        }
      >
        {error && open === 'status' ? (
          <p className="ep-alert ep-alert--danger" role="alert">
            {error}
          </p>
        ) : null}
        {copy.status === 'issued' && copy.loan ? (
          <p className="ep-alert ep-alert--warning" role="status">
            On loan to {copy.loan.borrower} ({copy.loan.ref}). Marking it lost closes the loan.
          </p>
        ) : null}
        {open === 'status' ? (
          <>
            <SelectField
              id={`st-${copy.id}`}
              label="Now"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={allowed.map(([k, label]) => ({ value: k, label }))}
            />
            <FormRow columns={2}>
              <InputField
                id={`st-on-${copy.id}`}
                label="On"
                type="date"
                required
                max={today()}
                value={on}
                onChange={(e) => setOn(e.target.value)}
              />
              {status === 'lost_paid' ? (
                <InputField
                  id={`st-amt-${copy.id}`}
                  label="Amount received (₹)"
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              ) : null}
            </FormRow>
            <InputField
              id={`st-why-${copy.id}`}
              label="Reason"
              required
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              help="Kept in the copy’s history"
            />
          </>
        ) : null}
      </Drawer>
    </span>
  );
}

/** More copies of a title: numbered from the series, or the numbers typed. */
export function AddCopies({
  titleId,
  setup,
  materialTypeId,
}: {
  titleId: string;
  setup: BookSetup;
  materialTypeId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<CopyState>(() => emptyCopy(setup));
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await addCopies(titleId, copyPayload(value, 'new'));
      if (!r.ok) return setMsg({ tone: 'danger', text: r.error });
      setAdded(r.accessionNos);
      setMsg({ tone: 'success', text: `Added: ${r.accessionNos.join(', ')}.` });
      setOpen(false);
      setValue(emptyCopy(setup));
      router.refresh();
    });
  return (
    <>
      {msg ? (
        <p className={`ep-alert ep-alert--${msg.tone}`} role="status">
          <span>
            {msg.text}{' '}
            {msg.tone === 'success' && added.length ? (
              <a href={`/library/labels?list=${encodeURIComponent(added.join(','))}`}>
                Print their labels
              </a>
            ) : null}
          </span>
        </p>
      ) : null}
      <button
        type="button"
        className="ep-btn ep-btn--secondary ep-btn--sm"
        onClick={() => setOpen(true)}
      >
        + Add copies
      </button>
      <Drawer
        open={open}
        title="Add copies"
        onClose={() => setOpen(false)}
        width="lg"
        footer={
          <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending}
              onClick={save}
            >
              Add
            </button>
            <button type="button" className="ep-btn ep-btn--ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </span>
        }
      >
        {open ? (
          <CopyFields
            setup={setup}
            value={value}
            onChange={setValue}
            mode="new"
            materialTypeId={materialTypeId ?? undefined}
            idPrefix="add-copy"
          />
        ) : null}
      </Drawer>
    </>
  );
}
