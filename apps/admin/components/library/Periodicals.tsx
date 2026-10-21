'use client';
import {
  Badge,
  Drawer,
  FormActions,
  FormRow,
  FormSection,
  InputField,
  SelectField,
} from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  addSpecialIssue,
  cancelSubscription,
  markIssue,
  receiveIssues,
  saveSubscription,
} from '@/lib/library-books-actions';
import {
  FREQUENCIES,
  dmy,
  type DueIssue,
  type PeriodicalIssue,
  type SubscriptionSetup,
  type SubscriptionView,
} from '@/lib/library-books';

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const yearOn = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCFullYear(x.getUTCFullYear() + 1);
  return new Date(x.getTime() - 86_400_000).toISOString().slice(0, 10);
};

/**
 * A periodical subscription (docs/design/36-library.md, part 6): the periodical (its frequency and
 * vendor come with it), the library, the period and the first issue, the copies, the cost, the order and
 * the bill, the grace days before an issue is late.
 */
export function SubscriptionForm({
  setup,
  initial,
}: {
  setup: SubscriptionSetup;
  initial?: SubscriptionView;
}) {
  const router = useRouter();
  const start = initial?.startsOn ?? today();
  const [v, setV] = useState({
    periodicalId: initial?.periodicalId ?? '',
    libraryId: initial?.libraryId ?? setup.libraries[0]?.id ?? '',
    vendorId: initial?.vendorId ?? '',
    frequency: initial?.frequency ?? '',
    startsOn: start,
    endsOn: initial?.endsOn ?? yearOn(start),
    firstIssueOn: initial?.firstIssueOn ?? '',
    copies: String(initial?.copies ?? 1),
    cost: initial?.cost ?? '',
    orderNo: initial?.orderNo ?? '',
    billNo: initial?.billNo ?? '',
    billDate: initial?.billDate ?? '',
    graceDays: String(initial?.graceDays ?? 7),
    notes: initial?.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start_] = useTransition();
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const periodical = setup.periodicals.find((p) => p.id === v.periodicalId);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = {
      periodicalId: v.periodicalId,
      libraryId: v.libraryId,
      startsOn: v.startsOn,
      endsOn: v.endsOn,
      copies: Number(v.copies) || 1,
      graceDays: Number(v.graceDays) || 0,
      ...(v.vendorId ? { vendorId: v.vendorId } : {}),
      ...(v.frequency ? { frequency: v.frequency } : {}),
      ...(v.firstIssueOn ? { firstIssueOn: v.firstIssueOn } : {}),
      ...(v.cost.trim() ? { cost: Number(v.cost) } : {}),
      ...(v.orderNo.trim() ? { orderNo: v.orderNo.trim() } : {}),
      ...(v.billNo.trim() ? { billNo: v.billNo.trim() } : {}),
      ...(v.billDate ? { billDate: v.billDate } : {}),
      ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
    };
    start_(async () => {
      const r = await saveSubscription(body, initial?.id);
      if (!r.ok) {
        setError(r.error);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      router.push(
        `/library/periodicals/${r.id}?ok=1&detail=${encodeURIComponent(initial ? 'Saved: the expected issues follow.' : 'Subscribed: its issues are expected.')}`,
      );
    });
  };
  return (
    <form onSubmit={submit}>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          <span>Not saved. {error}</span>
        </p>
      ) : null}
      <FormSection title="The periodical">
        <FormRow columns={3}>
          <SelectField
            id="sb-periodical"
            label="Periodical"
            required
            value={v.periodicalId}
            onChange={(e) => {
              const p = setup.periodicals.find((x) => x.id === e.target.value);
              set({
                periodicalId: e.target.value,
                frequency: p?.frequency ?? '',
                vendorId: p?.vendorId ?? v.vendorId,
              });
            }}
            options={[
              {
                value: '',
                label: setup.periodicals.length ? 'Choose' : 'Add periodicals in Library setup',
              },
              ...setup.periodicals.map((p) => ({
                value: p.id,
                label: `${p.name}${p.kind ? ` (${p.kind})` : ''}`,
              })),
            ]}
          />
          <SelectField
            id="sb-library"
            label="Library"
            required
            value={v.libraryId}
            onChange={(e) => set({ libraryId: e.target.value })}
            options={setup.libraries.map((l) => ({ value: l.id, label: l.name }))}
          />
          <SelectField
            id="sb-frequency"
            label="Frequency"
            required
            value={v.frequency}
            onChange={(e) => set({ frequency: e.target.value })}
            options={[
              { value: '', label: 'Choose' },
              ...FREQUENCIES.map((f) => ({ value: f, label: f })),
            ]}
            help={periodical?.frequency ? `The periodical’s: ${periodical.frequency}` : undefined}
          />
        </FormRow>
      </FormSection>
      <FormSection
        title="The period"
        description="The issues are expected from the first issue, at the frequency, to the end."
      >
        <FormRow columns={4}>
          <InputField
            id="sb-start"
            label="From"
            type="date"
            required
            value={v.startsOn}
            onChange={(e) =>
              set({
                startsOn: e.target.value,
                ...(initial ? {} : { endsOn: e.target.value ? yearOn(e.target.value) : v.endsOn }),
              })
            }
          />
          <InputField
            id="sb-end"
            label="To"
            type="date"
            required
            min={v.startsOn}
            value={v.endsOn}
            onChange={(e) => set({ endsOn: e.target.value })}
          />
          <InputField
            id="sb-first"
            label="First issue expected"
            type="date"
            min={v.startsOn}
            max={v.endsOn}
            value={v.firstIssueOn}
            onChange={(e) => set({ firstIssueOn: e.target.value })}
            help="Empty: the first day"
          />
          <InputField
            id="sb-grace"
            label="Late after (days)"
            type="number"
            min={0}
            max={90}
            value={v.graceDays}
            onChange={(e) => set({ graceDays: e.target.value })}
          />
        </FormRow>
      </FormSection>
      <FormSection title="Copies and cost">
        <FormRow columns={3}>
          <InputField
            id="sb-copies"
            label="Copies of each issue"
            type="number"
            min={1}
            max={50}
            required
            value={v.copies}
            onChange={(e) => set({ copies: e.target.value })}
          />
          <SelectField
            id="sb-vendor"
            label="Vendor"
            value={v.vendorId}
            onChange={(e) => set({ vendorId: e.target.value })}
            options={[
              {
                value: '',
                label: periodical?.vendor ? `The periodical’s: ${periodical.vendor}` : '—',
              },
              ...setup.vendors.map((x) => ({ value: x.id, label: x.name })),
            ]}
          />
          <InputField
            id="sb-cost"
            label="Cost of the subscription (₹)"
            type="number"
            min={0}
            step="0.01"
            value={v.cost}
            onChange={(e) => set({ cost: e.target.value })}
          />
        </FormRow>
        <FormRow columns={3}>
          <InputField
            id="sb-order"
            label="Order no."
            maxLength={40}
            value={v.orderNo}
            onChange={(e) => set({ orderNo: e.target.value })}
          />
          <InputField
            id="sb-bill"
            label="Bill no."
            maxLength={40}
            value={v.billNo}
            onChange={(e) => set({ billNo: e.target.value })}
          />
          <InputField
            id="sb-billdate"
            label="Bill date"
            type="date"
            max={today()}
            value={v.billDate}
            onChange={(e) => set({ billDate: e.target.value })}
          />
        </FormRow>
        <InputField
          id="sb-notes"
          label="Notes"
          maxLength={500}
          value={v.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </FormSection>
      <FormActions sticky>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          {pending ? 'Saving…' : initial ? 'Save the changes' : 'Subscribe'}
        </button>
        <a
          className="ep-btn ep-btn--ghost"
          href={
            initial
              ? `/library/periodicals/${initial.id}`
              : '/library/periodicals?tab=subscriptions'
          }
        >
          Cancel
        </a>
      </FormActions>
    </form>
  );
}

/** An issue received (the day, the copies, volume and number), marked missing, or put back. */
export function IssueActions({
  issue,
  copies,
}: {
  issue: PeriodicalIssue | DueIssue;
  copies: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<'receive' | 'missing' | null>(null);
  const [on, setOn] = useState(today());
  const [n, setN] = useState(String(copies));
  const [volume, setVolume] = useState('');
  const [no, setNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const status = 'status' in issue ? issue.status : 'expected';
  const done = (r: { ok: true } | { ok: false; error: string }) => {
    if (!r.ok) return setError(r.error);
    setOpen(null);
    setError(null);
    router.refresh();
  };
  const name = `${'periodical' in issue ? `${issue.periodical} ` : ''}${issue.label}`;
  return (
    <span className="ep-book__copy-actions">
      {status === 'expected' ? (
        <>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            aria-label={`Received: ${name}`}
            onClick={() => setOpen('receive')}
          >
            Received
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            aria-label={`Missing: ${name}`}
            onClick={() => setOpen('missing')}
          >
            Missing
          </button>
        </>
      ) : (
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          aria-label={`Undo: ${name}`}
          disabled={pending}
          onClick={() => start(async () => done(await markIssue(issue.id, 'undo')))}
        >
          Undo
        </button>
      )}
      <Drawer
        open={open !== null}
        title={open === 'receive' ? `Received: ${name}` : `Missing: ${name}`}
        onClose={() => setOpen(null)}
        width="sm"
        footer={
          <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending}
              onClick={() =>
                start(async () =>
                  done(
                    open === 'receive'
                      ? await markIssue(issue.id, 'receive', {
                          on,
                          copies: Number(n) || 0,
                          ...(volume.trim() ? { volume: volume.trim() } : {}),
                          ...(no.trim() ? { issueNo: no.trim() } : {}),
                          ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
                        })
                      : remarks.trim().length < 3
                        ? { ok: false, error: 'Say what happened (at least 3 characters).' }
                        : await markIssue(issue.id, 'missing', { remarks: remarks.trim() }),
                  ),
                )
              }
            >
              Save
            </button>
            <button type="button" className="ep-btn ep-btn--ghost" onClick={() => setOpen(null)}>
              Cancel
            </button>
          </span>
        }
      >
        {error ? (
          <p className="ep-alert ep-alert--danger" role="alert">
            {error}
          </p>
        ) : null}
        {open === 'receive' ? (
          <>
            <FormRow columns={2}>
              <InputField
                id={`is-on-${issue.id}`}
                label="Received on"
                type="date"
                required
                max={today()}
                value={on}
                onChange={(e) => setOn(e.target.value)}
              />
              <InputField
                id={`is-n-${issue.id}`}
                label="Copies"
                type="number"
                min={0}
                max={50}
                value={n}
                onChange={(e) => setN(e.target.value)}
              />
            </FormRow>
            <FormRow columns={2}>
              <InputField
                id={`is-vol-${issue.id}`}
                label="Volume"
                maxLength={20}
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
              />
              <InputField
                id={`is-no-${issue.id}`}
                label="Number"
                maxLength={20}
                value={no}
                onChange={(e) => setNo(e.target.value)}
              />
            </FormRow>
          </>
        ) : null}
        {open ? (
          <InputField
            id={`is-rem-${issue.id}`}
            label={open === 'missing' ? 'What happened' : 'Remarks'}
            maxLength={300}
            required={open === 'missing'}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            help={
              open === 'missing'
                ? 'It goes on the list of issues to claim from the vendor'
                : undefined
            }
          />
        ) : null}
      </Drawer>
    </span>
  );
}

/** The morning's check-in: the issues expected by today (late first), ticked and received together. */
export function DueIssues({ issues, manage }: { issues: DueIssue[]; manage: boolean }) {
  const router = useRouter();
  const [ticked, setTicked] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const all = issues.length > 0 && ticked.length === issues.length;
  const receive = () =>
    start(async () => {
      const r = await receiveIssues(ticked, today());
      if (!r.ok) return setMsg({ tone: 'danger', text: r.error });
      setMsg({ tone: 'success', text: `${String(r.received)} received today.` });
      setTicked([]);
      router.refresh();
    });
  if (!issues.length)
    return <p className="ep-field__help">Nothing to receive: every issue expected so far is in.</p>;
  return (
    <>
      {msg ? (
        <p className={`ep-alert ep-alert--${msg.tone}`} role="status">
          {msg.text}
        </p>
      ) : null}
      {manage ? (
        <div className="ep-hero__actions" style={{ marginBottom: 'var(--sp-2)' }}>
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            disabled={!ticked.length || pending}
            onClick={receive}
          >
            Received today ({ticked.length})
          </button>
        </div>
      ) : null}
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Issues to receive (scrolls sideways)"
      >
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Issues to receive</caption>
          <thead>
            <tr>
              {manage ? (
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="Tick every issue"
                    checked={all}
                    onChange={(e) => setTicked(e.target.checked ? issues.map((i) => i.id) : [])}
                  />
                </th>
              ) : null}
              <th scope="col">Periodical</th>
              <th scope="col">Issue</th>
              <th scope="col">Expected</th>
              <th scope="col">Library · vendor</th>
              {manage ? (
                <th scope="col">
                  <span className="ep-sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {issues.map((i) => (
              <tr key={i.id}>
                {manage ? (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Tick ${i.periodical} ${i.label}`}
                      checked={ticked.includes(i.id)}
                      onChange={(e) =>
                        setTicked((t) =>
                          e.target.checked ? [...t, i.id] : t.filter((x) => x !== i.id),
                        )
                      }
                    />
                  </td>
                ) : null}
                <td>
                  <a href={`/library/periodicals/${i.subscriptionId}`}>{i.periodical}</a>
                </td>
                <td>
                  {i.label}
                  {i.special ? <Badge tone="info">Special</Badge> : null}
                </td>
                <td>
                  {dmy(i.expectedOn)}
                  {i.late ? (
                    <div>
                      <Badge tone="danger">Late {i.days} days</Badge>
                    </div>
                  ) : null}
                </td>
                <td>
                  {i.library}
                  <div className="ep-field__help">{i.vendor ?? '—'}</div>
                </td>
                {manage ? (
                  <td>
                    <IssueActions issue={i} copies={i.copies} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Cancel a subscription from a day; add a special issue. */
export function SubscriptionTools({ s }: { s: SubscriptionView }) {
  const router = useRouter();
  const [open, setOpen] = useState<'cancel' | 'special' | null>(null);
  const [on, setOn] = useState(
    today() < s.startsOn ? s.startsOn : today() > s.endsOn ? s.endsOn : today(),
  );
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      if (text.trim().length < (open === 'cancel' ? 3 : 2))
        return setError(open === 'cancel' ? 'Give the reason.' : 'Name the issue.');
      const r =
        open === 'cancel'
          ? await cancelSubscription(s.id, { on, reason: text.trim() })
          : await addSpecialIssue(s.id, { expectedOn: on, label: text.trim() });
      if (!r.ok) return setError(r.error);
      setOpen(null);
      setText('');
      setError(null);
      router.refresh();
    });
  return (
    <>
      <button
        type="button"
        className="ep-btn ep-btn--ghost ep-btn--sm"
        onClick={() => setOpen('special')}
      >
        + Special issue
      </button>
      <button
        type="button"
        className="ep-btn ep-btn--ghost ep-btn--sm"
        onClick={() => setOpen('cancel')}
      >
        Cancel the subscription
      </button>
      <Drawer
        open={open !== null}
        title={open === 'cancel' ? 'Cancel the subscription' : 'A special issue'}
        onClose={() => setOpen(null)}
        width="sm"
        footer={
          <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button
              type="button"
              className={`ep-btn ${open === 'cancel' ? 'ep-btn--danger' : 'ep-btn--primary'}`}
              disabled={pending}
              onClick={save}
            >
              {open === 'cancel' ? 'Cancel it' : 'Add'}
            </button>
            <button type="button" className="ep-btn ep-btn--ghost" onClick={() => setOpen(null)}>
              Back
            </button>
          </span>
        }
      >
        {error ? (
          <p className="ep-alert ep-alert--danger" role="alert">
            {error}
          </p>
        ) : null}
        {open === 'cancel' ? (
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            The issues expected after the day are taken off; those received stay.
          </p>
        ) : null}
        <InputField
          id="st-on"
          label={open === 'cancel' ? 'From' : 'Expected on'}
          type="date"
          min={s.startsOn}
          max={s.endsOn}
          value={on}
          onChange={(e) => setOn(e.target.value)}
        />
        <InputField
          id="st-text"
          label={open === 'cancel' ? 'Reason' : 'Issue'}
          maxLength={open === 'cancel' ? 300 : 80}
          placeholder={open === 'cancel' ? undefined : 'For example: Diwali special'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Drawer>
    </>
  );
}
