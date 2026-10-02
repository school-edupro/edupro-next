'use client';
import { useState, useTransition } from 'react';
import { saveRollNumbers } from '@/lib/actions';

interface Row {
  studentId: string;
  name: string;
  admissionNo: string;
  gender: string;
  rollNo: number | null;
}

/** Roll numbers of one section: renumber by a rule or by hand, then save. */
export function RollNumbersEditor({
  sectionId,
  students,
  disabled,
}: {
  sectionId: string;
  students: Row[];
  disabled?: boolean;
}) {
  const [rows, setRows] = useState(
    students.map((s) => ({ ...s, value: s.rollNo ? String(s.rollNo) : '' })),
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const renumber = (rule: 'name' | 'gender' | 'admission') => {
    const sorted = [...rows].sort((a, b) =>
      rule === 'admission'
        ? a.admissionNo.localeCompare(b.admissionNo, undefined, { numeric: true })
        : rule === 'gender'
          ? b.gender.localeCompare(a.gender) || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name),
    );
    setRows(sorted.map((r, i) => ({ ...r, value: String(i + 1) })));
    setMsg(null);
  };
  const save = () =>
    start(async () => {
      const rolls = rows.map((r) => ({ studentId: r.studentId, rollNo: Number(r.value) }));
      if (rolls.some((r) => !Number.isInteger(r.rollNo) || r.rollNo < 1)) {
        setMsg({ ok: false, text: 'Give every student a roll number from 1 to 999' });
        return;
      }
      const res = await saveRollNumbers(sectionId, rolls);
      setMsg(res.ok ? { ok: true, text: 'Roll numbers saved.' } : { ok: false, text: res.error });
    });
  return (
    <div>
      <div className="ep-wdset__actions" style={{ marginTop: 0 }}>
        <span className="ep-field__help">Renumber:</span>
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          disabled={disabled}
          onClick={() => renumber('name')}
        >
          By name
        </button>
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          disabled={disabled}
          onClick={() => renumber('gender')}
        >
          Girls first, then by name
        </button>
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          disabled={disabled}
          onClick={() => renumber('admission')}
        >
          By admission no
        </button>
      </div>
      <div className="ep-table-wrap">
        <table className="ep-table">
          <caption className="ep-sr-only">Roll numbers</caption>
          <thead>
            <tr>
              <th scope="col">Roll no</th>
              <th scope="col">Student</th>
              <th scope="col">Admission no</th>
              <th scope="col">Gender</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.studentId}>
                <td>
                  <label className="ep-sr-only" htmlFor={`roll-${r.studentId}`}>
                    Roll number of {r.name}
                  </label>
                  <input
                    id={`roll-${r.studentId}`}
                    className="ep-input"
                    style={{ maxWidth: '5rem' }}
                    inputMode="numeric"
                    maxLength={3}
                    value={r.value}
                    disabled={disabled}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs.map((x) =>
                          x.studentId === r.studentId
                            ? { ...x, value: e.target.value.replace(/\D/g, '') }
                            : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>{r.name}</td>
                <td>{r.admissionNo}</td>
                <td>{r.gender}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ep-wdset__actions">
        <button
          type="button"
          className="ep-btn ep-btn--primary"
          disabled={disabled || pending}
          onClick={save}
        >
          {pending ? 'Saving…' : 'Save roll numbers'}
        </button>
        <span aria-live="polite" className={msg?.ok ? 'ep-field__help' : 'ep-field__error'}>
          {msg?.text}
        </span>
      </div>
    </div>
  );
}
