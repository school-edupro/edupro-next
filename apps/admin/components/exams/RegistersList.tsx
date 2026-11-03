'use client';
import { Badge, Button, Dialog, Drawer } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import type { GradeRegisterRow } from '@/lib/grade-registers';
import { SCHEME_STATUS, type RegisterRow } from '@/lib/mark-schemes';
import {
  copyRegister,
  deletedRegisters,
  registerAccess,
  registerStaff,
  registerStep,
  registerVersions,
  removeRights,
  restoreRegister,
  restoreVersion,
  rightsReport,
  saveRegisterAccess,
  setGradeAccessType,
  type AccessRow,
  type RegisterKind,
} from '@/lib/register-actions';

type Row = RegisterRow | GradeRegisterRow;
const isMark = (r: Row): r is RegisterRow => 'purpose' in r;

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso))
    : '';

/** class tokens: "X" never matches "IX"; a word that is not a class matches classes starting with it */
function matches(row: Row, q: string) {
  const words = q.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const codes = row.classes.map((k) => k.code.toUpperCase());
  return words.some(
    (w) =>
      codes.includes(w) || codes.some((c) => c.startsWith(w)) || row.name.toUpperCase().includes(w),
  );
}

type Rights = Pick<
  AccessRow,
  'userId' | 'name' | 'designation' | 'run' | 'edit' | 'delete' | 'assign'
>;

/**
 * The mark registers (docs/design/68) as the school's Term Mark Register lists them, and the grade
 * registers (docs/design/69) as its Grade Register does: search by class, a row per register with its
 * classes, who made and last changed it, and its actions — Run (a new tab), Edit, Versions, Copy, Assign,
 * Access (grade registers: All or As per mapping), Lock / Unlock, Delete (click twice); the bin and the
 * Rights report.
 */
export function RegistersList({
  rows,
  classes,
  canCreate,
  canAssign,
  kind = 'mark',
}: {
  rows: Row[];
  classes: Array<{ id: string; code: string }>;
  canCreate: boolean;
  canAssign: boolean;
  kind?: RegisterKind;
}) {
  const base = kind === 'grade' ? '/exams/grade-registers' : '/exams/schemes';
  const noun = kind === 'grade' ? 'grade register' : 'mark register';
  const Noun = kind === 'grade' ? 'Grade register' : 'Mark register';
  const router = useRouter();
  const [q, setQ] = useState('');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  // dialogs and drawers
  const [copyOf, setCopyOf] = useState<Row | null>(null);
  const [copyName, setCopyName] = useState('');
  const [copyClasses, setCopyClasses] = useState<string[]>([]);
  const [versionsOf, setVersionsOf] = useState<Row | null>(null);
  const [versions, setVersions] = useState<
    Array<{
      id: string;
      version: number;
      status: string;
      updatedAt: string;
      updatedBy: string | null;
    }>
  >([]);
  const [restoreName, setRestoreName] = useState('');
  const [binOpen, setBinOpen] = useState(false);
  const [bin, setBin] = useState<
    Array<{
      id: string;
      name: string;
      version: number;
      classes: string[];
      deletedAt: string;
      deletedBy: string | null;
    }>
  >([]);
  const [binName, setBinName] = useState<Record<string, string>>({});
  const [assignOf, setAssignOf] = useState<Row | null>(null);
  const [accessOf, setAccessOf] = useState<GradeRegisterRow | null>(null);
  const [accessType, setAccessType] = useState<'all' | 'mapping'>('all');
  const [people, setPeople] = useState<Rights[]>([]);
  const [mine, setMine] = useState<Record<string, boolean>>({});
  const [staff, setStaff] = useState<
    Array<{ userId: string; name: string; designation: string | null }>
  >([]);
  const [pick, setPick] = useState('');
  const [rightsOpen, setRightsOpen] = useState(false);
  const [report, setReport] = useState<Array<Rights & { chainId: string; register: string }>>([]);
  const [rq, setRq] = useState('');
  const [off, setOff] = useState<string[]>([]);

  const shown = useMemo(() => rows.filter((r) => matches(r, q)), [rows, q]);
  const fail = (error: string) => setMsg({ tone: 'danger', text: error });
  const ok = (text: string) => {
    setMsg({ tone: 'success', text });
    router.refresh();
  };

  const step = (r: Row, s: 'lock' | 'unlock' | 'delete') =>
    start(async () => {
      const out = await registerStep(r.id, s, kind);
      if (!out.ok) return fail(out.error);
      setArmed(null);
      ok(
        s === 'lock'
          ? `${r.name} locked`
          : s === 'unlock'
            ? `${r.name} unlocked`
            : `${r.name} moved to the bin`,
      );
    });
  const openVersions = (r: Row) =>
    start(async () => {
      const out = await registerVersions(r.id, kind);
      if (!out.ok) return fail(out.error);
      setVersions(out.data.data);
      setRestoreName('');
      setVersionsOf(r);
    });
  const openBin = () =>
    start(async () => {
      const out = await deletedRegisters(kind);
      if (!out.ok) return fail(out.error);
      setBin(out.data.data);
      setBinOpen(true);
    });
  const openAssign = (r: Row) =>
    start(async () => {
      const [a, st] = await Promise.all([registerAccess(r.id, kind), registerStaff()]);
      if (!a.ok) return fail(a.error);
      setPeople(a.data.data);
      setMine(a.data.mine);
      setStaff(st.ok ? st.data.data : []);
      setPick('');
      setAssignOf(r);
    });
  const openRights = () =>
    start(async () => {
      const out = await rightsReport(kind);
      if (!out.ok) return fail(out.error);
      setReport(out.data.data);
      setOff([]);
      setRightsOpen(true);
    });

  return (
    <>
      <div className="ep-mr-toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
        <label className="ep-field" style={{ margin: 0, minWidth: '16rem' }}>
          <span className="ep-field__label">Search by class</span>
          <input
            className="ep-input"
            type="search"
            value={q}
            placeholder="e.g. VI or IX X"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQ('');
            }}
          />
        </label>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" onClick={openBin} loading={pending && binOpen}>
          Deleted
        </Button>
        {canAssign ? (
          <Button variant="ghost" size="sm" onClick={openRights}>
            Rights report
          </Button>
        ) : null}
        {canCreate ? (
          <a className="ep-btn ep-btn--primary ep-btn--sm" href={`${base}/new`}>
            + New {noun}
          </a>
        ) : null}
      </div>
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {msg.text}
        </div>
      ) : null}
      {shown.length ? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={`${Noun}s`}>
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">{`${Noun}s`}</caption>
            <thead>
              <tr>
                <th scope="col">Sr</th>
                <th scope="col">{Noun}</th>
                <th scope="col">Classes</th>
                {kind === 'grade' ? <th scope="col">Assessments</th> : null}
                <th scope="col">Created by</th>
                <th scope="col">Updated by</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td>
                    {isMark(r) ? (
                      <a
                        href={`/exams/schemes/${r.id}`}
                        style={{ textDecoration: 'underline', fontWeight: 600 }}
                      >
                        {r.name}
                      </a>
                    ) : (
                      <strong>{r.name}</strong>
                    )}{' '}
                    <span className="ep-mr-pills">
                      <Badge tone={SCHEME_STATUS[r.status].tone}>
                        {r.status === 'locked'
                          ? `Locked v${String(r.version)}`
                          : `v${String(r.version)} ${SCHEME_STATUS[r.status].label}`}
                      </Badge>
                      {r.inUse ? (
                        <Badge tone="success">{`v${String(r.inUse)} locked in use`}</Badge>
                      ) : null}
                      {isMark(r) && r.purpose === 'result' ? (
                        <Badge tone="info">{`Result · ${r.termCode ?? ''}`}</Badge>
                      ) : null}
                      {r.sameName ? <Badge tone="warning">Same name</Badge> : null}
                    </span>
                    {isMark(r) ? (
                      <span className="ep-mr-col__desc">
                        {r.subjects} subjects ·{' '}
                        {r.layout === 'vertical'
                          ? 'Subject-1, Subject-2 …'
                          : 'subjects in the header'}
                        {r.type === 'examwise' ? ' · exam-wise' : ''}
                        {r.assignees.length
                          ? ` · ${r.assignees.map((a) => `${a.name} (${a.rights})`).join(', ')}`
                          : ''}
                      </span>
                    ) : (
                      <span className="ep-mr-col__desc">
                        {r.assignees.length
                          ? r.assignees.map((a) => `${a.name} (${a.rights})`).join(' · ')
                          : 'not assigned'}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="ep-mr-pills">
                      {r.classes.map((k) => (
                        <Badge key={k.id} tone="neutral">
                          {k.code}
                        </Badge>
                      ))}
                    </span>
                  </td>
                  {isMark(r) ? null : <td>{r.assessments.join(', ')}</td>}
                  <td>
                    {r.createdBy ?? ''}
                    <span className="ep-mr-col__desc">{when(r.createdAt)}</span>
                  </td>
                  <td>
                    {r.updatedBy ?? ''}
                    <span className="ep-mr-col__desc">{when(r.updatedAt)}</span>
                  </td>
                  <td>
                    <span className="ep-mr-row-actions">
                      {r.rights.run && isMark(r) ? (
                        <a
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                          href={`/exams/schemes/${r.id}/register`}
                          target="_blank"
                          rel="noopener"
                        >
                          ▶ Run
                        </a>
                      ) : null}
                      {r.rights.edit ? (
                        <a
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          href={`${base}/${r.id}/edit`}
                        >
                          Edit
                        </a>
                      ) : null}
                      {r.rights.edit && (r.version > 1 || r.inUse) ? (
                        <Button size="sm" variant="ghost" onClick={() => openVersions(r)}>
                          Versions
                        </Button>
                      ) : null}
                      {canCreate ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setCopyName(`${r.name} (Copy)`);
                            setCopyClasses(r.classIds);
                            setCopyOf(r);
                          }}
                        >
                          Copy
                        </Button>
                      ) : null}
                      {r.rights.assign ? (
                        <Button size="sm" variant="ghost" onClick={() => openAssign(r)}>
                          Assign
                        </Button>
                      ) : null}
                      {!isMark(r) && r.rights.manage ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setAccessType(r.accessType);
                            setAccessOf(r);
                          }}
                        >
                          {r.accessType === 'mapping' ? 'Access: As per mapping' : 'Access: All'}
                        </Button>
                      ) : null}
                      {r.rights.manage && r.status === 'draft' && !r.inUse ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => step(r, 'lock')}
                          disabled={r.problems.length > 0}
                          title={r.problems.join('; ') || 'Pin it: a save makes the next version'}
                        >
                          Lock
                        </Button>
                      ) : null}
                      {r.rights.manage && r.status === 'locked' ? (
                        <Button size="sm" variant="ghost" onClick={() => step(r, 'unlock')}>
                          Unlock
                        </Button>
                      ) : null}
                      {r.rights.delete && r.status === 'draft' ? (
                        <Button
                          size="sm"
                          variant={armed === r.id ? 'danger' : 'ghost'}
                          onClick={() => {
                            if (armed === r.id) step(r, 'delete');
                            else {
                              setArmed(r.id);
                              window.setTimeout(
                                () => setArmed((a) => (a === r.id ? null : a)),
                                2600,
                              );
                            }
                          }}
                        >
                          {armed === r.id ? 'Sure? Click again' : 'Delete'}
                        </Button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ margin: 0 }}>
          {rows.length ? 'No register for these classes.' : `No ${noun} yet.`}{' '}
          {canCreate && !rows.length
            ? kind === 'grade'
              ? 'Make one with “+ New grade register”.'
              : 'Make one with “+ New mark register”, or start from a ready-made scheme below.'
            : ''}
        </p>
      )}

      <Dialog
        open={copyOf !== null}
        title={`Copy ${copyOf?.name ?? ''}`}
        onClose={() => setCopyOf(null)}
        primary={{
          label: 'Copy and save',
          loading: pending,
          onClick: () =>
            start(async () => {
              const out = await copyRegister(copyOf!.id, copyName.trim(), copyClasses, kind);
              if (!out.ok) return fail(out.error);
              setCopyOf(null);
              ok(
                `Copied as ${out.data.name}${out.data.dropped.length ? `; left out (the classes do not have them): ${out.data.dropped.join(', ')}` : ''}`,
              );
            }),
        }}
      >
        <p style={{ marginTop: 0 }}>
          {kind === 'grade'
            ? 'Every setting (assessments, indicators left out, labels, order, display, Overall and the grade scale) is copied and saved at once; the people given rights are not. Each class prints its own indicator set when it runs.'
            : 'Every subject, column, code, grade and display setting is copied and saved at once. A subject the new classes do not have is left out; maximum marks are read from each class’s exams when it runs.'}
        </p>
        <label className="ep-field">
          <span className="ep-field__label">New register name</span>
          <input
            className="ep-input"
            value={copyName}
            maxLength={kind === 'grade' ? 150 : 120}
            onChange={(e) => setCopyName(e.target.value)}
          />
        </label>
        <div className="ep-mr-tiles" role="group" aria-label="Classes of the copy">
          {classes.map((k) => (
            <label key={k.id} className="ep-mr-tile">
              <input
                type="checkbox"
                checked={copyClasses.includes(k.id)}
                onChange={(e) =>
                  setCopyClasses((c) =>
                    e.target.checked ? [...c, k.id] : c.filter((x) => x !== k.id),
                  )
                }
              />
              <span>{k.code}</span>
            </label>
          ))}
        </div>
      </Dialog>

      <Drawer
        open={versionsOf !== null}
        title={`Versions · ${versionsOf?.name ?? ''}`}
        onClose={() => setVersionsOf(null)}
        width="md"
      >
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Restoring a version always makes a new register (version 1, unlocked) with the people this
          one is given to; this register stays as it is.
        </p>
        {canCreate ? (
          <label className="ep-field">
            <span className="ep-field__label">Name of the restored register</span>
            <input
              className="ep-input"
              value={restoreName}
              maxLength={120}
              placeholder={`${versionsOf?.name ?? ''} (vN)`}
              onChange={(e) => setRestoreName(e.target.value)}
            />
          </label>
        ) : null}
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Versions</caption>
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">State</th>
              <th scope="col">Saved</th>
              <th scope="col">
                <span className="ep-sr-only">Restore</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td>v{v.version}</td>
                <td>
                  {v.status === 'superseded'
                    ? 'Replaced'
                    : v.status === 'draft'
                      ? 'Draft (current)'
                      : v.status === 'locked'
                        ? 'Locked'
                        : 'Deleted'}
                </td>
                <td>
                  {when(v.updatedAt)} {v.updatedBy ? `· ${v.updatedBy}` : ''}
                </td>
                <td>
                  {canCreate ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        start(async () => {
                          const out = await restoreVersion(
                            v.id,
                            restoreName.trim() || `${versionsOf!.name} (v${String(v.version)})`,
                            kind,
                          );
                          if (!out.ok) return fail(out.error);
                          setVersionsOf(null);
                          ok(`Restored as ${out.data.name}`);
                        })
                      }
                    >
                      Restore
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Drawer>

      <Drawer open={binOpen} title="Deleted registers" onClose={() => setBinOpen(false)} width="md">
        {!bin.length ? <p style={{ marginTop: 0 }}>The bin is empty.</p> : null}
        {bin.map((b) => (
          <div key={b.id} className="ep-mr-col" style={{ gridTemplateColumns: '1fr auto' }}>
            <span>
              <strong>{b.name}</strong> v{b.version} · {b.classes.join(', ')}
              <span className="ep-mr-col__desc">
                Deleted {when(b.deletedAt)} {b.deletedBy ? `by ${b.deletedBy}` : ''}
              </span>
              <input
                className="ep-input"
                aria-label={`New name for ${b.name} (if its name is taken now)`}
                placeholder="A new name, if its name is taken now"
                value={binName[b.id] ?? ''}
                onChange={(e) => setBinName((n) => ({ ...n, [b.id]: e.target.value }))}
              />
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                start(async () => {
                  const out = await restoreRegister(b.id, binName[b.id]?.trim() || undefined, kind);
                  if (!out.ok) return fail(out.error);
                  setBin((x) => x.filter((y) => y.id !== b.id));
                  ok(`${out.data.name} restored`);
                })
              }
            >
              Restore
            </Button>
          </div>
        ))}
      </Drawer>

      <Dialog
        open={assignOf !== null}
        title={`Assign · ${assignOf?.name ?? ''}`}
        onClose={() => setAssignOf(null)}
        size="lg"
        primary={{
          label: 'Save assignment',
          loading: pending,
          onClick: () =>
            start(async () => {
              const out = await saveRegisterAccess(
                assignOf!.id,
                people.map((p) => ({
                  userId: p.userId,
                  run: p.run,
                  edit: p.edit,
                  delete: p.delete,
                  assign: p.assign,
                })),
                kind,
              );
              if (!out.ok) return fail(out.error);
              setAssignOf(null);
              ok('Assignment saved');
            }),
        }}
      >
        <p style={{ marginTop: 0 }}>
          The people given rights on this register.{' '}
          {mine.manage ? '' : 'You can pass on only the rights you hold, not Assign.'}
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
          <label className="ep-field" style={{ margin: 0, flex: 1 }}>
            <span className="ep-field__label">Add a person</span>
            <select className="ep-select" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose staff</option>
              {staff
                .filter((x) => !people.some((p) => p.userId === x.userId))
                .map((x) => (
                  <option key={x.userId} value={x.userId}>
                    {x.name}
                    {x.designation ? ` · ${x.designation}` : ''}
                  </option>
                ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={!pick}
            onClick={() => {
              const x = staff.find((y) => y.userId === pick);
              if (x)
                setPeople((p) => [
                  ...p,
                  {
                    userId: x.userId,
                    name: x.name,
                    designation: x.designation,
                    run: true,
                    edit: false,
                    delete: false,
                    assign: false,
                  },
                ]);
              setPick('');
            }}
          >
            Add
          </Button>
        </div>
        <table className="ep-table ep-table--dense" style={{ marginTop: 'var(--sp-3)' }}>
          <caption className="ep-sr-only">People and their rights</caption>
          <thead>
            <tr>
              <th scope="col">Person</th>
              {(['run', 'edit', 'delete', 'assign'] as const).map((k) => (
                <th key={k} scope="col">
                  {k[0]!.toUpperCase() + k.slice(1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.userId}>
                <td>
                  {p.name}
                  {p.designation ? <span className="ep-mr-col__desc">{p.designation}</span> : null}
                </td>
                {(['run', 'edit', 'delete', 'assign'] as const).map((k) => (
                  <td key={k}>
                    <input
                      type="checkbox"
                      aria-label={`${p.name}: ${k}`}
                      checked={p[k]}
                      disabled={!mine.manage && (k === 'assign' || (k !== 'run' && !mine[k]))}
                      onChange={(e) =>
                        setPeople((list) =>
                          list.map((x) =>
                            x.userId === p.userId ? { ...x, [k]: e.target.checked } : x,
                          ),
                        )
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!people.length ? <p className="ep-field__help">Nobody yet: add staff above.</p> : null}
      </Dialog>

      <Dialog
        open={accessOf !== null}
        title={`Access type · ${accessOf?.name ?? ''}`}
        onClose={() => setAccessOf(null)}
        primary={{
          label: 'Save',
          loading: pending,
          onClick: () =>
            start(async () => {
              const out = await setGradeAccessType(accessOf!.id, accessType);
              if (!out.ok) return fail(out.error);
              setAccessOf(null);
              ok(
                accessType === 'mapping'
                  ? 'Access: As per mapping — teachers see only the indicator areas given to them'
                  : 'Access: All',
              );
            }),
        }}
      >
        <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="ep-field__label">Who sees which indicators when it runs</legend>
          <div className="ep-mr-tiles">
            <label className="ep-mr-tile">
              <input
                type="radio"
                name="access-type"
                checked={accessType === 'all'}
                onChange={() => setAccessType('all')}
              />
              <span>
                All
                <small>Everyone who may run it sees every indicator</small>
              </span>
            </label>
            <label className="ep-mr-tile">
              <input
                type="radio"
                name="access-type"
                checked={accessType === 'mapping'}
                onChange={() => setAccessType('mapping')}
              />
              <span>
                As per mapping
                <small>
                  A teacher sees only the indicator areas of their Indicator assignment (managers
                  see all)
                </small>
              </span>
            </label>
          </div>
        </fieldset>
      </Dialog>

      <Drawer
        open={rightsOpen}
        title="Rights report"
        onClose={() => setRightsOpen(false)}
        width="lg"
      >
        <div className="ep-mr-toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
          <label className="ep-field" style={{ margin: 0, flex: 1 }}>
            <span className="ep-field__label">Filter by register or person</span>
            <input
              className="ep-input"
              type="search"
              value={rq}
              onChange={(e) => setRq(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant="danger"
            disabled={!off.length}
            onClick={() =>
              start(async () => {
                const pairs = off.map((k) => {
                  const [chainId, userId] = k.split('|');
                  return { chainId: chainId!, userId: userId! };
                });
                const out = await removeRights(pairs, kind);
                if (!out.ok) return fail(out.error);
                setReport((r) => r.filter((x) => !off.includes(`${x.chainId}|${x.userId}`)));
                setOff([]);
                ok(`${String(out.data.removed)} right(s) removed`);
              })
            }
          >
            Remove ticked
          </Button>
        </div>
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Who holds which right on which register</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="ep-sr-only">Tick to remove</span>
              </th>
              <th scope="col">Register</th>
              <th scope="col">Person</th>
              <th scope="col">Rights</th>
            </tr>
          </thead>
          <tbody>
            {report
              .filter(
                (x) =>
                  !rq.trim() ||
                  `${x.register} ${x.name}`.toLowerCase().includes(rq.trim().toLowerCase()),
              )
              .map((x) => {
                const k = `${x.chainId}|${x.userId}`;
                return (
                  <tr key={k}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Remove ${x.name} from ${x.register}`}
                        checked={off.includes(k)}
                        onChange={(e) =>
                          setOff((o) => (e.target.checked ? [...o, k] : o.filter((y) => y !== k)))
                        }
                      />
                    </td>
                    <td>{x.register}</td>
                    <td>
                      {x.name}
                      {x.designation ? (
                        <span className="ep-mr-col__desc">{x.designation}</span>
                      ) : null}
                    </td>
                    <td>
                      {[
                        x.run && 'Run',
                        x.edit && 'Edit',
                        x.delete && 'Delete',
                        x.assign && 'Assign',
                      ]
                        .filter(Boolean)
                        .join(' + ')}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        {!report.length ? (
          <p className="ep-field__help">Nobody has been given a register yet.</p>
        ) : null}
      </Drawer>
    </>
  );
}
