'use client';
import { FileLinks } from './FileLinks';
import { Badge, Drawer } from '@edupro/ui';
import { useId, useMemo, useState } from 'react';
import { bulkDecideProfileChanges, decidePortalChange, loadProfileApprovals } from '@/lib/actions';
import { STATUS_LABEL, STATUS_TONE, type ChangeView, type Inbox } from '@/lib/portal-profile';

type Box = 'mine' | 'all' | 'decided';
interface Filters {
  q: string;
  classSection: string;
  section: string;
  from: string;
  to: string;
}
const EMPTY: Filters = { q: '', classSection: '', section: '', from: '', to: '' };

const show = (v: string | number | null) =>
  v === null || v === '' ? <span className="ep-pa__empty">empty</span> : String(v);
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** A photo in a change request (current or new), opened through the request so approvers may see it. */
function PhotoValue({
  requestId,
  fileId,
  alt,
  size = 'md',
}: {
  requestId: string;
  fileId: string | number | null;
  alt: string;
  size?: 'sm' | 'md';
}) {
  if (fileId === null || fileId === '') return <span className="ep-pa__from">no photo</span>;
  return (
    <a href={`/api/profile-proofs/${requestId}/${String(fileId)}`} target="_blank" rel="noreferrer">
      <img
        className={`ep-pa__photo ep-pa__photo--${size}`}
        src={`/api/profile-proofs/${requestId}/${String(fileId)}/view`}
        alt={alt}
      />
    </a>
  );
}

/**
 * Profile approvals: changes that parents and students asked for, routed by the school's rules. The
 * approver compares old and new values with the proof, accepts or refuses field by field, or decides
 * many requests at once.
 */
export function ProfileApprovals({
  initial,
  initialBox,
  sections,
}: {
  initial: Inbox;
  initialBox: Box;
  sections: Array<{ id: string; title: string }>;
}) {
  const [inbox, setInbox] = useState(initial);
  const [box, setBox] = useState<Box>(initialBox);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(
    null,
  );
  const [open, setOpen] = useState<ChangeView | null>(null);
  const [bulkNote, setBulkNote] = useState('');
  const classList = useId();
  const sectionTitle = useMemo(() => new Map(sections.map((s) => [s.id, s.title])), [sections]);

  const load = async (b: Box, f: Filters, p: number) => {
    setBusy(true);
    const qs = new URLSearchParams({ box: b, page: String(p), size: '50' });
    for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
    const r = await loadProfileApprovals(qs.toString());
    setBusy(false);
    if (r.ok) {
      setInbox(r.data);
      setSelected(new Set());
    } else setMsg({ tone: 'danger', text: r.error });
  };
  const switchBox = (b: Box) => {
    setBox(b);
    setPage(1);
    setMsg(null);
    void load(b, filters, 1);
  };
  const actionable = inbox.data.filter((r) => r.canAct);
  const allChecked = actionable.length > 0 && actionable.every((r) => selected.has(r.id));
  const classes = [...new Set(inbox.data.map((r) => r.classSection).filter(Boolean))] as string[];

  const bulk = async (approve: boolean) => {
    if (!approve && !bulkNote.trim()) {
      setMsg({ tone: 'warning', text: 'Write the reason for refusing in the note first.' });
      return;
    }
    setBusy(true);
    const r = await bulkDecideProfileChanges({
      ids: [...selected],
      approve,
      note: bulkNote.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) {
      setMsg({ tone: 'danger', text: r.error });
      return;
    }
    const failed = r.data.results.filter((x) => !x.ok);
    setMsg({
      tone: failed.length ? 'warning' : 'success',
      text: `${String(r.data.done)} ${approve ? 'approved' : 'refused'}${
        failed.length
          ? `; ${String(failed.length)} not done: ${failed
              .map((x) => {
                const row = inbox.data.find((y) => y.id === x.id);
                return `${row?.studentName ?? x.id} (${x.error ?? 'error'})`;
              })
              .join('; ')}`
          : ''
      }.`,
    });
    setBulkNote('');
    await load(box, filters, page);
  };

  return (
    <div className="ep-pa">
      <div className="ep-pa__boxes" role="group" aria-label="Which requests">
        <button
          type="button"
          className="ep-pa__box"
          aria-pressed={box === 'mine'}
          onClick={() => switchBox('mine')}
        >
          Awaiting me{' '}
          <Badge tone={inbox.awaitingMe ? 'warning' : 'neutral'}>{inbox.awaitingMe}</Badge>
        </button>
        {inbox.canSeeAll ? (
          <>
            <button
              type="button"
              className="ep-pa__box"
              aria-pressed={box === 'all'}
              onClick={() => switchBox('all')}
            >
              All waiting
            </button>
            <button
              type="button"
              className="ep-pa__box"
              aria-pressed={box === 'decided'}
              onClick={() => switchBox('decided')}
            >
              Decided
            </button>
          </>
        ) : null}
      </div>

      <form
        className="ep-pa__filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
          setPage(1);
          void load(box, draft, 1);
        }}
      >
        <label className="ep-field">
          <span className="ep-field__label">Student, admission no or parent</span>
          <input
            className="ep-input"
            type="search"
            value={draft.q}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Class</span>
          <input
            className="ep-input"
            list={classList}
            value={draft.classSection}
            placeholder="e.g. VI-A"
            onChange={(e) => setDraft({ ...draft, classSection: e.target.value })}
          />
          <datalist id={classList}>
            {classes.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Part of the profile</span>
          <select
            className="ep-input"
            value={draft.section}
            onChange={(e) => setDraft({ ...draft, section: e.target.value })}
          >
            <option value="">Any</option>
            {sections
              .filter((s) => s.id !== 'documents')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Asked from</span>
          <input
            className="ep-input"
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">to</span>
          <input
            className="ep-input"
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <div className="ep-pa__fbtns">
          <button type="submit" className="ep-btn ep-btn--secondary" disabled={busy}>
            Apply
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--ghost"
            onClick={() => {
              setDraft(EMPTY);
              setFilters(EMPTY);
              setPage(1);
              void load(box, EMPTY, 1);
            }}
          >
            Clear
          </button>
        </div>
      </form>

      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'success' ? 'status' : 'alert'}
        >
          {msg.text}
        </div>
      ) : null}

      {selected.size ? (
        <div className="ep-pa__bulk" role="region" aria-label="Decide the selected requests">
          <strong>{selected.size} selected</strong>
          <label className="ep-field ep-pa__bulknote">
            <span className="ep-sr-only">Note for the families</span>
            <input
              className="ep-input"
              maxLength={500}
              value={bulkNote}
              placeholder="Note for the families (needed when refusing)"
              onChange={(e) => setBulkNote(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={busy}
            onClick={() => void bulk(true)}
          >
            Approve selected
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--danger"
            disabled={busy}
            onClick={() => void bulk(false)}
          >
            Refuse selected
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--ghost"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      ) : null}

      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Profile change requests"
      >
        <table className="ep-table ep-pa__table">
          <thead>
            <tr>
              <th scope="col" className="ep-pa__check">
                {box !== 'decided' ? (
                  <input
                    type="checkbox"
                    aria-label="Select every request I can decide on this page"
                    checked={allChecked}
                    disabled={!actionable.length}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? new Set(actionable.map((r) => r.id)) : new Set(),
                      )
                    }
                  />
                ) : null}
              </th>
              <th scope="col">Student</th>
              <th scope="col">Change asked (now → asked)</th>
              <th scope="col">Proof</th>
              <th scope="col">Asked by</th>
              <th scope="col">{box === 'decided' ? 'Outcome' : 'Stage'}</th>
              <th scope="col">
                <span className="ep-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {inbox.data.map((r) => (
              <tr key={r.id} aria-selected={selected.has(r.id) || undefined}>
                <td className="ep-pa__check">
                  {r.canAct ? (
                    <input
                      type="checkbox"
                      aria-label={`Select the request for ${r.studentName}`}
                      checked={selected.has(r.id)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(r.id);
                          else n.delete(r.id);
                          return n;
                        })
                      }
                    />
                  ) : null}
                </td>
                <td>
                  <a href={`/people/students/${r.studentId}`}>
                    <strong>{r.studentName}</strong>
                  </a>
                  <div className="ep-field__help">
                    {r.admissionNo}
                    {r.classSection ? ` · ${r.classSection}` : ''}
                  </div>
                </td>
                <td>
                  <ul className="ep-pa__items">
                    {r.items.map((it) => (
                      <li key={it.key} data-status={it.status}>
                        <span className="ep-pa__label">{it.label}</span>{' '}
                        {it.photo ? (
                          <PhotoValue
                            requestId={r.id}
                            fileId={it.from}
                            alt="Current photo"
                            size="sm"
                          />
                        ) : (
                          <span className="ep-pa__from">{show(it.from)}</span>
                        )}
                        <span aria-hidden="true"> → </span>
                        <span className="ep-sr-only"> to </span>
                        {it.photo ? (
                          <PhotoValue requestId={r.id} fileId={it.to} alt="New photo" size="sm" />
                        ) : (
                          <strong>{show(it.to)}</strong>
                        )}
                        {it.status !== 'pending' ? (
                          <Badge tone={it.status === 'approved' ? 'success' : 'danger'}>
                            {it.status === 'approved' ? 'accepted' : 'refused'}
                          </Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {r.reason ? <div className="ep-field__help">“{r.reason}”</div> : null}
                </td>
                <td>
                  {r.proofs.length
                    ? r.proofs.map((p) => (
                        <div key={p.fileId} className="ep-filecell">
                          {p.label}
                          <FileLinks
                            href={`/api/profile-proofs/${r.id}/${p.fileId}`}
                            label={p.label}
                          />
                        </div>
                      ))
                    : '—'}
                </td>
                <td>
                  {r.requestedBy ?? '—'}
                  <div className="ep-field__help">
                    {r.audience === 'student' ? 'Student' : 'Parent'} · {when(r.createdAt)}
                  </div>
                </td>
                <td>
                  {r.status === 'pending' ? (
                    <>
                      <Badge tone="warning">
                        Step {r.level} of {r.levels}
                      </Badge>
                      <div className="ep-field__help">{r.waitingFor}</div>
                    </>
                  ) : (
                    <>
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      <div className="ep-field__help">
                        {r.decidedBy ?? ''}
                        {r.decidedAt ? ` · ${when(r.decidedAt)}` : ''}
                      </div>
                    </>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className={`ep-btn ep-btn--sm ${r.canAct ? 'ep-btn--secondary' : 'ep-btn--ghost'}`}
                    onClick={() => setOpen(r)}
                  >
                    {r.canAct ? 'Review' : 'Details'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!inbox.data.length ? (
          <p className="ep-pa__none">
            {box === 'mine'
              ? 'Nothing is waiting for you. New requests from parents and students appear here.'
              : 'No requests match.'}
          </p>
        ) : null}
      </div>

      {inbox.page.total > inbox.page.size ? (
        <nav className="ep-pa__pager" aria-label="Pages">
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            disabled={page <= 1 || busy}
            onClick={() => {
              setPage(page - 1);
              void load(box, filters, page - 1);
            }}
          >
            Previous
          </button>
          <span>
            Page {page} of {Math.ceil(inbox.page.total / inbox.page.size)} · {inbox.page.total}{' '}
            requests
          </span>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            disabled={page * inbox.page.size >= inbox.page.total || busy}
            onClick={() => {
              setPage(page + 1);
              void load(box, filters, page + 1);
            }}
          >
            Next
          </button>
        </nav>
      ) : null}

      {open ? (
        <ReviewDrawer
          row={open}
          sectionTitle={sectionTitle}
          canOverride={inbox.canOverride}
          onClose={() => setOpen(null)}
          onDone={async (text) => {
            setOpen(null);
            setMsg({ tone: 'success', text });
            await load(box, filters, page);
          }}
        />
      ) : null}
    </div>
  );
}

function ReviewDrawer({
  row,
  sectionTitle,
  canOverride,
  onClose,
  onDone,
}: {
  row: ChangeView;
  sectionTitle: Map<string, string>;
  canOverride: boolean;
  onClose: () => void;
  onDone: (text: string) => Promise<void>;
}) {
  const pending = row.items.filter((i) => i.status === 'pending');
  const [choice, setChoice] = useState<Record<string, boolean>>(
    Object.fromEntries(pending.map((i) => [i.key, true])),
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refusing = Object.values(choice).some((v) => !v);
  const lastStep = row.level >= row.levels;
  const submit = async () => {
    if (refusing && !note.trim()) {
      setError('Write the reason for refusing; the family sees it.');
      return;
    }
    setBusy(true);
    const r = await decidePortalChange(row.id, { fields: choice, note: note.trim() || undefined });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const accepted = Object.values(choice).filter(Boolean).length;
    await onDone(
      r.data.status === 'pending'
        ? `${row.studentName}: ${String(accepted)} accepted, sent to ${r.data.waitingFor ?? 'the next approver'}.`
        : `${row.studentName}: ${STATUS_LABEL[r.data.status].toLowerCase()}.`,
    );
  };
  return (
    <Drawer
      open
      width="lg"
      title={`${row.studentName} · ${row.admissionNo}`}
      onClose={onClose}
      footer={
        row.canAct ? (
          <>
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              onClick={() => setChoice(Object.fromEntries(pending.map((i) => [i.key, false])))}
            >
              Refuse all
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              onClick={() => setChoice(Object.fromEntries(pending.map((i) => [i.key, true])))}
            >
              Accept all
            </button>
            <button type="button" className="ep-btn ep-btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? 'Saving…' : 'Save decision'}
            </button>
          </>
        ) : (
          <button type="button" className="ep-btn ep-btn--secondary" onClick={onClose}>
            Close
          </button>
        )
      }
    >
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {row.classSection ? `${row.classSection} · ` : ''}asked by {row.requestedBy ?? 'family'} (
        {row.audience === 'student' ? 'student' : 'parent'}) on {when(row.createdAt)}.{' '}
        {row.status === 'pending'
          ? lastStep || canOverride
            ? 'Accepted fields are saved to the profile when you save.'
            : `Accepted fields go on to step ${String(row.level + 1)}: ${row.route[row.level]?.label ?? ''}.`
          : null}
      </p>
      {row.reason ? (
        <p>
          <strong>Reason given:</strong> {row.reason}
        </p>
      ) : null}
      <div className="ep-pa__route" aria-label="Approval route">
        {row.route.map((s, i) => (
          <span
            key={i}
            data-state={
              i + 1 < row.level
                ? 'done'
                : i + 1 === row.level && row.status === 'pending'
                  ? 'now'
                  : row.status === 'pending'
                    ? 'next'
                    : 'done'
            }
          >
            {i + 1}. {s.label}
          </span>
        ))}
      </div>
      <table className="ep-table ep-table--dense">
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">On file now</th>
            <th scope="col">Asked for</th>
            <th scope="col">Decision</th>
          </tr>
        </thead>
        <tbody>
          {row.items.map((it) => (
            <tr key={it.key}>
              <th scope="row">
                {it.label}
                <div className="ep-field__help">{sectionTitle.get(it.section) ?? it.section}</div>
              </th>
              <td>
                {it.photo ? (
                  <PhotoValue requestId={row.id} fileId={it.from} alt="Current photo" />
                ) : (
                  show(it.from)
                )}
              </td>
              <td>
                {it.photo ? (
                  <PhotoValue requestId={row.id} fileId={it.to} alt="New photo" />
                ) : (
                  <strong>{show(it.to)}</strong>
                )}
              </td>
              <td>
                {it.status === 'pending' && row.canAct ? (
                  <fieldset className="ep-pa__choice">
                    <legend className="ep-sr-only">{it.label}</legend>
                    <label>
                      <input
                        type="radio"
                        name={`d-${it.key}`}
                        checked={choice[it.key] === true}
                        onChange={() => setChoice((c) => ({ ...c, [it.key]: true }))}
                      />{' '}
                      Accept
                    </label>
                    <label>
                      <input
                        type="radio"
                        name={`d-${it.key}`}
                        checked={choice[it.key] === false}
                        onChange={() => setChoice((c) => ({ ...c, [it.key]: false }))}
                      />{' '}
                      Refuse
                    </label>
                  </fieldset>
                ) : (
                  <Badge
                    tone={
                      it.status === 'approved'
                        ? 'success'
                        : it.status === 'rejected'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {it.status === 'approved'
                      ? 'accepted'
                      : it.status === 'rejected'
                        ? 'refused'
                        : 'waiting'}
                  </Badge>
                )}
                {it.note ? <div className="ep-field__help">{it.note}</div> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {row.proofs.length ? (
        <>
          <h3 className="ep-pa__h">Proof documents</h3>
          <ul>
            {row.proofs.map((p) => (
              <li key={p.fileId} className="ep-pa__proof">
                <span className="ep-filecell">
                  {p.label}
                  <FileLinks href={`/api/profile-proofs/${row.id}/${p.fileId}`} label={p.label} />
                </span>
                {/\.(png|jpe?g|webp|gif)$/i.test(p.fileName ?? '') ? (
                  <img
                    className="ep-pa__preview"
                    src={`/api/profile-proofs/${row.id}/${p.fileId}`}
                    alt={`${p.label} preview`}
                  />
                ) : /\.pdf$/i.test(p.fileName ?? '') ? (
                  <iframe
                    className="ep-pa__preview ep-pa__preview--pdf"
                    src={`/api/profile-proofs/${row.id}/${p.fileId}`}
                    title={`${p.label} preview`}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {row.canAct ? (
        <label className="ep-field">
          <span className="ep-field__label">Note for the family{refusing ? ' *' : ''}</span>
          <textarea
            className="ep-input"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              refusing
                ? 'Why is it refused? e.g. the PIN code does not match the proof'
                : 'Optional'
            }
          />
        </label>
      ) : null}
      {error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {error}
        </div>
      ) : null}
      {row.history?.length ? (
        <>
          <h3 className="ep-pa__h">History</h3>
          <ol className="ep-pa__history">
            {row.history.map((h, i) => (
              <li key={i}>
                Step {h.level}: <strong>{h.decision}</strong> by {h.actor ?? '—'} · {when(h.at)}
                {h.note ? ` — ${h.note}` : ''}
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </Drawer>
  );
}
