/** Shared pieces of the printed fee papers (0098–0100): money, dates and the school band. */
export const rupees = (v: string | number) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dmy = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};

export function SheetHead({
  school,
  title,
}: {
  school: { name: string; address: string };
  title: string;
}) {
  return (
    <div className="ep-print-sheet__head">
      <h2 className="ep-h3">{school.name}</h2>
      {school.address ? <p className="ep-field__help">{school.address}</p> : null}
      <p>
        <strong>{title}</strong>
      </p>
    </div>
  );
}

export function PupilMeta({
  student,
  extra,
}: {
  student: { name: string; admissionNo: string; section: string | null; guardian: string | null };
  extra: Array<[label: string, value: string]>;
}) {
  return (
    <div className="ep-print-sheet__meta">
      <div>
        Student: <strong>{student.name}</strong>
      </div>
      <div>
        Admission no.: <strong>{student.admissionNo}</strong>
      </div>
      <div>
        Class: <strong>{student.section ?? '—'}</strong>
      </div>
      <div>
        Parent / guardian: <strong>{student.guardian ?? '—'}</strong>
      </div>
      {extra.map(([label, value]) => (
        <div key={label}>
          {label}: <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
