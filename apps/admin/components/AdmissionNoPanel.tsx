import { Card } from '@edupro/ui';
import { changeAdmissionNo } from '@/lib/actions';

/** Admission number on the full profile: its history, and the administrators' change with a reason. */
export function AdmissionNoPanel({
  studentId,
  admissionNo,
  history,
  canChange,
}: {
  studentId: string;
  admissionNo: string;
  history: Array<{
    oldNo: string;
    newNo: string;
    reason: string;
    changedBy: string | null;
    changedAt: string;
  }>;
  canChange: boolean;
}) {
  if (!canChange && !history.length) return null;
  return (
    <Card title="Admission number" style={{ marginBottom: 'var(--sp-4)' }}>
      <p style={{ marginTop: 0 }}>
        Current: <strong>{admissionNo}</strong>. Every screen, receipt and report shows the current
        number; an old number still finds the student.
      </p>
      {history.length ? (
        <ul className="ep-wd__docs">
          {history.map((h) => (
            <li key={h.changedAt}>
              {h.oldNo} → <strong>{h.newNo}</strong> · {h.reason} ·{' '}
              <span className="ep-field__help">
                {h.changedBy ?? ''} {new Date(h.changedAt).toLocaleString('en-IN')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {canChange ? (
        <details className="ep-wd__act">
          <summary>Change the admission number</summary>
          <form action={changeAdmissionNo} className="ep-wd__form">
            <input type="hidden" name="id" value={studentId} />
            <label className="ep-field" htmlFor="adm-new">
              <span className="ep-field__label">New admission number</span>
              <input
                id="adm-new"
                name="admissionNo"
                className="ep-input"
                required
                maxLength={40}
                pattern="[A-Za-z0-9/\-]+"
              />
            </label>
            <label className="ep-field ep-wd__wide" htmlFor="adm-reason">
              <span className="ep-field__label">Reason</span>
              <input
                id="adm-reason"
                name="reason"
                className="ep-input"
                required
                minLength={3}
                maxLength={300}
                placeholder="e.g. typed wrongly at admission"
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              Change
            </button>
          </form>
        </details>
      ) : null}
    </Card>
  );
}
