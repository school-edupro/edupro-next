'use client';
import { useRef, useState } from 'react';
import {
  changeMembers,
  deleteGroupV2,
  searchPeople,
  updateGroupV2,
  uploadGroupMembers,
} from '@/lib/comms-actions';
import { KIND_LABEL, type Group, type Member, type Rule, type RuleOptions } from '@/lib/comms';
import { RuleBuilder } from './RuleBuilder';

const TYPE_LABEL: Record<string, string> = {
  student: 'Student',
  employee: 'Employee',
  guardian: 'Parent',
  contact: 'Outside contact',
  user: 'Login',
};

const SEARCH_TYPES: Record<string, string> = {
  student: 'student,guardian',
  employee: 'employee',
  student_teacher: 'student,employee,guardian',
  mixed: 'student,employee,guardian',
  external: '',
};

interface UploadResult {
  rows: number;
  matched: number;
  problems: Array<{ row: number; value: string; reason: string }>;
  dryRun: boolean;
}

/**
 * A group's members (communication v2): add people by search, upload an Excel list (checked first,
 * then added or used to replace the members), remove members; a rule group shows who its rule picks
 * today and lets you change the rule.
 */
export function GroupDetail({
  group,
  members: initial,
  canManage,
  options,
  classes,
  sections,
}: {
  group: Group;
  members: Member[];
  canManage: boolean;
  options: RuleOptions;
  classes: Array<{ value: string; label: string }>;
  sections: Array<{ value: string; label: string; classId?: string }>;
}) {
  const [members, setMembers] = useState(initial);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Member[]>([]);
  const [rule, setRule] = useState<Rule>(group.rule ?? {});
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isRule = group.mode === 'rule';
  const canSearch = canManage && !isRule && SEARCH_TYPES[group.kind];
  const canUpload = canManage && !isRule;

  const shown = members.filter(
    (m) =>
      !filter ||
      `${m.name} ${m.ref ?? ''} ${m.detail ?? ''} ${m.mobile ?? ''}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );

  const sendFile = async (dryRun: boolean) => {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      setMsg({ ok: false, text: 'Choose an Excel file first.' });
      return;
    }
    const fd = new FormData();
    fd.set('id', group.id);
    fd.set('file', f);
    fd.set('mode', mode);
    fd.set('dryRun', String(dryRun));
    setBusy(dryRun ? 'check' : 'save');
    const r = await uploadGroupMembers(fd);
    setBusy(null);
    if (!r.ok) {
      setMsg({ ok: false, text: r.error });
      return;
    }
    setUpload(r.data);
    if (!dryRun) {
      setMsg({
        ok: true,
        text: `${String(r.data.matched)} members ${mode === 'replace' ? 'now in the group' : 'added'}.`,
      });
      window.location.reload();
    }
  };

  return (
    <div className="ep-grp">
      {msg ? (
        <p
          className={msg.ok ? 'ep-alert ep-alert--success' : 'ep-alert ep-alert--danger'}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </p>
      ) : null}

      <section className="ep-card" aria-labelledby="grp-members">
        <div className="ep-grp__head">
          <h2 className="ep-card__title" id="grp-members">
            {isRule ? 'Who the rule picks today' : 'Members'} ({members.length})
          </h2>
          <input
            type="search"
            className="ep-input ep-grp__filter"
            aria-label="Filter members"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {members.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
            <table className="ep-table">
              <caption className="ep-sr-only">Members of {group.name}</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Adm. no / code</th>
                  <th scope="col">Class / details</th>
                  <th scope="col">Mobile</th>
                  <th scope="col">Email</th>
                  {canManage && !isRule ? (
                    <th scope="col">
                      <span className="ep-sr-only">Remove</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map((m) => (
                  <tr key={`${m.type}:${m.id}`}>
                    <td>{m.name}</td>
                    <td>{TYPE_LABEL[m.type] ?? m.type}</td>
                    <td>{m.ref ?? '—'}</td>
                    <td>{m.detail ?? '—'}</td>
                    <td>{m.mobile ?? '—'}</td>
                    <td>{m.email ?? '—'}</td>
                    {canManage && !isRule ? (
                      <td>
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`Remove ${m.name}`}
                          onClick={async () => {
                            const r = await changeMembers(
                              group.id,
                              [],
                              [{ type: m.type, id: m.id }],
                            );
                            if (r.ok) setMembers(r.data.members);
                            else setMsg({ ok: false, text: r.error });
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 500 ? (
              <p className="ep-field__help">
                Showing 500 of {shown.length}; filter to find others.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="ep-field__help">
            {isRule
              ? 'Nobody matches the rule this year.'
              : 'No members yet. Add people below or upload an Excel list.'}
          </p>
        )}
      </section>

      {canSearch ? (
        <section className="ep-card" aria-labelledby="grp-add">
          <h2 className="ep-card__title" id="grp-add">
            Add people
          </h2>
          <label className="ep-field" htmlFor="grp-q">
            <span className="ep-field__label">Name, admission number or employee code</span>
            <input
              id="grp-q"
              type="search"
              className="ep-input"
              value={q}
              onChange={async (e) => {
                setQ(e.target.value);
                if (e.target.value.trim().length >= 2) {
                  const r = await searchPeople(e.target.value.trim(), SEARCH_TYPES[group.kind]!);
                  setFound(r.ok ? r.data.data : []);
                } else setFound([]);
              }}
            />
          </label>
          {found.length ? (
            <ul className="ep-compose__found">
              {found.map((m) => {
                const inGroup = members.some((x) => x.type === m.type && x.id === m.id);
                return (
                  <li key={`${m.type}:${m.id}`}>
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      disabled={inGroup}
                      onClick={async () => {
                        const r = await changeMembers(group.id, [{ type: m.type, id: m.id }], []);
                        if (r.ok) setMembers(r.data.members);
                        else setMsg({ ok: false, text: r.error });
                      }}
                    >
                      {inGroup ? '✓' : '+'} {m.name}
                    </button>
                    <span className="ep-field__help">
                      {TYPE_LABEL[m.type]}
                      {m.ref ? ` · ${m.ref}` : ''}
                      {m.detail ? ` · ${m.detail}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}

      {canUpload ? (
        <section className="ep-card" aria-labelledby="grp-upload">
          <h2 className="ep-card__title" id="grp-upload">
            Upload from Excel
          </h2>
          <p className="ep-field__help">
            {group.kind === 'external'
              ? 'Columns: Name, Mobile, Email; any other column (Organisation, Amount…) becomes a {{variable}}.'
              : group.kind === 'employee'
                ? 'Column: Employee Code.'
                : group.kind === 'student'
                  ? 'Column: Admission No (old admission numbers are recognised too).'
                  : 'Columns: Admission No and / or Employee Code.'}{' '}
            <a href={`/api/comms/group-template/${group.kind}`}>Download the template</a>
          </p>
          <div className="ep-wd__form">
            <label className="ep-field ep-wd__wide" htmlFor="grp-file">
              <span className="ep-field__label">Excel or CSV file</span>
              <input
                id="grp-file"
                ref={fileRef}
                type="file"
                className="ep-input"
                accept=".xlsx,.csv"
                onChange={() => setUpload(null)}
              />
            </label>
            <label className="ep-field" htmlFor="grp-mode">
              <span className="ep-field__label">The file’s people</span>
              <select
                id="grp-mode"
                className="ep-select"
                value={mode}
                onChange={(e) => setMode(e.target.value as 'add' | 'replace')}
              >
                <option value="add">Add to the members</option>
                <option value="replace">Replace the members</option>
              </select>
            </label>
          </div>
          <div className="ep-wdset__actions">
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              disabled={busy !== null}
              onClick={() => void sendFile(true)}
            >
              {busy === 'check' ? 'Checking…' : 'Check the file'}
            </button>
            {upload?.dryRun && upload.matched ? (
              <button
                type="button"
                className="ep-btn ep-btn--primary"
                disabled={busy !== null}
                onClick={() => void sendFile(false)}
              >
                {busy === 'save'
                  ? 'Saving…'
                  : mode === 'replace'
                    ? `Replace with ${String(upload.matched)}`
                    : `Add ${String(upload.matched)}`}
              </button>
            ) : null}
          </div>
          {upload ? (
            <div role="status" className="ep-compose__sheetres">
              <strong>{upload.matched}</strong> of {upload.rows} rows matched
              {upload.problems.length ? (
                <ul className="ep-compose__problems">
                  {upload.problems.slice(0, 20).map((p) => (
                    <li key={`${String(p.row)}-${p.value}`}>
                      Row {p.row}: {p.value ? `${p.value} — ` : ''}
                      {p.reason}
                    </li>
                  ))}
                  {upload.problems.length > 20 ? (
                    <li>and {upload.problems.length - 20} more</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {canManage ? (
        <section className="ep-card" aria-labelledby="grp-edit">
          <h2 className="ep-card__title" id="grp-edit">
            {isRule ? 'Rule and details' : 'Details'}
          </h2>
          <div className="ep-wd__form">
            <label className="ep-field ep-wd__wide" htmlFor="grp-name">
              <span className="ep-field__label">Name</span>
              <input
                id="grp-name"
                className="ep-input"
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="ep-field ep-wd__wide" htmlFor="grp-desc">
              <span className="ep-field__label">Description</span>
              <input
                id="grp-desc"
                className="ep-input"
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </div>
          {isRule ? (
            <RuleBuilder
              id="grp-rule"
              value={rule}
              onChange={setRule}
              options={options}
              classes={classes}
              sections={sections}
              people={
                group.kind === 'student'
                  ? 'students'
                  : group.kind === 'employee'
                    ? 'employees'
                    : 'both'
              }
            />
          ) : null}
          <div className="ep-wdset__actions">
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={busy !== null}
              onClick={async () => {
                setBusy('edit');
                const r = await updateGroupV2(group.id, {
                  name,
                  description: description || null,
                  ...(isRule ? { rule } : {}),
                });
                setBusy(null);
                if (r.ok) window.location.reload();
                else setMsg({ ok: false, text: r.error });
              }}
            >
              Save
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              onClick={async () => {
                if (
                  !window.confirm(
                    `Delete the group "${group.name}"? Messages already sent are kept.`,
                  )
                )
                  return;
                const r = await deleteGroupV2(group.id);
                if (r.ok) window.location.href = '/comms/groups?ok=1';
                else setMsg({ ok: false, text: r.error });
              }}
            >
              Delete group
            </button>
          </div>
          <p className="ep-field__help">
            {KIND_LABEL[group.kind]} · {isRule ? 'follows its rule' : 'kept by hand / Excel'}
          </p>
        </section>
      ) : null}
    </div>
  );
}
