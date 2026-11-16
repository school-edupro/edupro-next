'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Person {
  id: string;
  name: string;
  no: string;
  detail: string | null;
  left: boolean;
}
interface StudentHit {
  id: string;
  name: string;
  admissionNo: string;
  className: string | null;
  left: boolean;
}
interface EmployeeHit {
  id: string;
  name: string;
  code: string;
  designation: string | null;
  department: string | null;
  left: boolean;
}

/**
 * The issue page's first step (16 Nov 2026): the certificate, then the person from a dropdown that follows it —
 * students for a student certificate, employees for a staff one — searchable as you type (name, number, class or
 * designation), those the certificate's rule wants first. Choosing one shows its checks and paper.
 */
export function IssuePicker({
  types,
  type,
  person,
  keep,
}: {
  types: Array<{ code: string; name: string; staff: boolean }>;
  type: string;
  person: Person | null;
  /** carried in the address (a request being answered) */
  keep: Record<string, string>;
}) {
  const router = useRouter();
  const t = types.find((x) => x.code === type) ?? null;
  const staff = !!t?.staff;
  const who = staff ? 'employee' : 'student';
  const listId = useId();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  const go = (over: Record<string, string>) => {
    const u = new URLSearchParams(keep);
    for (const [k, v] of Object.entries(over)) if (v) u.set(k, v);
    router.push(`/certificates/issue?${u.toString()}`);
  };

  useEffect(() => {
    if (!t || !open) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      fetch(
        `/api/certificates-people?kind=${staff ? 'employee' : 'student'}&type=${encodeURIComponent(t.code)}&q=${encodeURIComponent(q)}`,
        { signal: ctl.signal, cache: 'no-store' },
      )
        .then(async (r) => {
          const j = (await r.json()) as { rows?: Array<StudentHit | EmployeeHit> };
          setRows(
            (j.rows ?? []).map((h) =>
              'code' in h
                ? {
                    id: h.id,
                    name: h.name,
                    no: h.code,
                    detail: [h.designation, h.department].filter(Boolean).join(' · ') || null,
                    left: h.left,
                  }
                : {
                    id: h.id,
                    name: h.name,
                    no: h.admissionNo,
                    detail: h.className,
                    left: h.left,
                  },
            ),
          );
          setActive(-1);
        })
        .catch(() => undefined)
        .finally(() => setBusy(false));
    }, 200);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [q, open, t, staff]);

  // a click outside closes the list
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const choose = (p: Person) => {
    setOpen(false);
    setActive(-1);
    go({ type: t!.code, [staff ? 'employee' : 'student']: p.id });
  };

  return (
    <div className="ep-ipick">
      <label className="ep-field" htmlFor="ipType" style={{ margin: 0 }}>
        <span className="ep-field__label">Certificate</span>
        <select
          id="ipType"
          className="ep-select"
          value={type}
          onChange={(e) => go({ type: e.target.value })}
        >
          <option value="">Choose…</option>
          {[...types.filter((x) => !x.staff), ...types.filter((x) => x.staff)].map((x) => (
            <option key={x.code} value={x.code}>
              {x.name}
              {x.staff ? ' (staff)' : ''}
            </option>
          ))}
        </select>
      </label>
      {t ? (
        <div className="ep-field ep-ipick__combo" ref={box} style={{ margin: 0 }}>
          <label className="ep-field__label" htmlFor="ipPerson">
            {staff ? 'Employee' : 'Student'}
          </label>
          {person ? (
            <p className="ep-ipick__chosen">
              <strong>{person.name}</strong> · {person.no}
              {person.detail ? ` · ${person.detail}` : ''}
              {person.left ? <span className="ep-badge ep-badge--neutral">Left</span> : null}
            </p>
          ) : null}
          <div className="ep-ipick__wrap">
            <input
              id="ipPerson"
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={
                open && active >= 0 && rows[active] ? `${listId}-${String(active)}` : undefined
              }
              className="ep-input"
              placeholder={
                person
                  ? `Choose another ${who}…`
                  : staff
                    ? 'Choose or type a name, employee code, designation or department'
                    : 'Choose or type a name, admission no. or class (e.g. VI-A)'
              }
              value={q}
              autoComplete="off"
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setOpen(true);
                  setActive((a) => Math.min(rows.length - 1, a + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === 'Enter' && open && active >= 0 && rows[active]) {
                  e.preventDefault();
                  choose(rows[active]);
                } else if (e.key === 'Escape') setOpen(false);
              }}
            />
            {open ? (
              <ul id={listId} role="listbox" className="ep-ipick__list" aria-label={`${who}s`}>
                {busy && !rows.length ? (
                  <li className="ep-ipick__note" role="presentation">
                    Looking…
                  </li>
                ) : !rows.length ? (
                  <li className="ep-ipick__note" role="presentation">
                    No {who} matches.
                  </li>
                ) : (
                  rows.map((p, i) => (
                    <li
                      key={p.id}
                      id={`${listId}-${String(i)}`}
                      role="option"
                      aria-selected={i === active}
                      className="ep-ipick__opt"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(p);
                      }}
                      onMouseEnter={() => setActive(i)}
                    >
                      <span>
                        <strong>{p.name}</strong> · {p.no}
                      </span>
                      <span className="ep-ipick__detail">
                        {p.detail ?? ''}
                        {p.left ? <span className="ep-badge ep-badge--neutral">Left</span> : null}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
          <span className="ep-field__help">
            {staff
              ? 'Employees in service first (those who have left first for a certificate on leaving).'
              : 'Students on the rolls in class order (those leaving first for a TC); type to narrow.'}
          </span>
        </div>
      ) : null}
    </div>
  );
}
