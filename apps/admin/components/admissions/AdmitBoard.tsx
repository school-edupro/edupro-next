'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { admitBulk } from '@/lib/admission-admit-actions';

interface Candidate {
  id: string;
  number: string | null;
  admissionNo: string | null;
  candidate: string | null;
  gender: string;
  category: string | null;
  status: string;
  section: string | null;
}
interface Section {
  id: string;
  name: string;
  capacity: number | null;
  enrolled: number;
}

/**
 * Admit in bulk (docs/design/39, part 6): every candidate who paid the admission fee gets a section —
 * chosen one by one, or spread over the sections by the room each has (boys and girls alternated) —
 * then all are admitted together; one that cannot be is reported and the rest go through.
 */
export function AdmitBoard({
  candidates,
  sections,
  canAdmit,
}: {
  candidates: Candidate[];
  sections: Section[];
  canAdmit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const waiting = candidates.filter((c) => c.status === 'fee_paid');
  const [pick, setPick] = useState<Record<string, string>>({});
  const [joinedOn, setJoinedOn] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const spread = () => {
    const room = new Map(sections.map((s) => [s.id, (s.capacity ?? 40) - s.enrolled]));
    const order = [...waiting].sort(
      (a, b) =>
        a.gender.localeCompare(b.gender) || (a.candidate ?? '').localeCompare(b.candidate ?? ''),
    );
    // alternate boys and girls so each section gets a mix
    const byGender = new Map<string, Candidate[]>();
    for (const c of order) byGender.set(c.gender, [...(byGender.get(c.gender) ?? []), c]);
    const mixed: Candidate[] = [];
    const lists = [...byGender.values()];
    for (let i = 0; mixed.length < order.length; i += 1)
      for (const l of lists) if (l[i]) mixed.push(l[i]!);
    const next: Record<string, string> = {};
    for (const c of mixed) {
      const best = [...room.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!best) break;
      next[c.id] = best[0];
      room.set(best[0], best[1] - 1);
    }
    setPick(next);
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      {sections.length === 0 ? (
        <p className="ep-alert ep-alert--warning" role="status">
          The class has no section in the session&rsquo;s year yet: add sections under Academics
          first.
        </p>
      ) : (
        <div className="ep-table-wrap">
          <table className="ep-table">
            <caption className="ep-sr-only">Sections</caption>
            <thead>
              <tr>
                <th scope="col">Section</th>
                <th scope="col">Pupils</th>
                <th scope="col">Room</th>
                <th scope="col">Chosen here</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.enrolled}</td>
                  <td>{s.capacity !== null ? s.capacity - s.enrolled : '-'}</td>
                  <td>{Object.values(pick).filter((x) => x === s.id).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {candidates.length === 0 ? (
        <p style={{ margin: 0 }}>Nobody has paid the admission fee in this class yet.</p>
      ) : (
        <div className="ep-table-wrap">
          <table className="ep-table">
            <caption className="ep-sr-only">Candidates to admit</caption>
            <thead>
              <tr>
                <th scope="col">Admission no.</th>
                <th scope="col">Candidate</th>
                <th scope="col">Category</th>
                <th scope="col">Section</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id}>
                  <td>{c.admissionNo ?? '-'}</td>
                  <td>
                    <a href={`/admissions/registrations/${c.id}`}>{c.candidate ?? c.number}</a>
                    <div className="ep-kicker">
                      {c.number} · {c.gender}
                    </div>
                  </td>
                  <td>{c.category ?? '-'}</td>
                  <td>
                    {c.status === 'admitted' ? (
                      <Badge tone="success">Admitted{c.section ? ` · ${c.section}` : ''}</Badge>
                    ) : (
                      <select
                        className="ep-select"
                        aria-label={`Section for ${c.candidate ?? c.number ?? ''}`}
                        value={pick[c.id] ?? ''}
                        disabled={!canAdmit}
                        onChange={(e) => setPick({ ...pick, [c.id]: e.target.value })}
                      >
                        <option value="">Not now</option>
                        {sections.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canAdmit && waiting.length && sections.length ? (
        <div className="ep-rp__row">
          <button type="button" className="ep-btn ep-btn--secondary" onClick={spread}>
            Spread over the sections
          </button>
          <label className="ep-field">
            <span className="ep-field__label">Joining date (blank: first day of the year)</span>
            <input
              className="ep-input"
              type="date"
              value={joinedOn}
              onChange={(e) => setJoinedOn(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending || !Object.values(pick).some(Boolean)}
            onClick={() =>
              start(async () => {
                const items = Object.entries(pick)
                  .filter(([, s]) => s)
                  .map(([applicationId, classSectionId]) => ({ applicationId, classSectionId }));
                const r = await admitBulk(items, joinedOn || undefined);
                if (r.ok) {
                  const failed = r.data.results.filter((x) => !x.ok);
                  setMsg({
                    tone: failed.length ? 'danger' : 'success',
                    text: `${String(r.data.admitted)} admitted.${failed.length ? ` Not admitted: ${failed.map((f) => f.error).join('; ')}` : ''}`,
                  });
                  setPick({});
                  router.refresh();
                } else setMsg({ tone: 'danger', text: r.error });
              })
            }
          >
            Admit {Object.values(pick).filter(Boolean).length}
          </button>
        </div>
      ) : null}
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}
