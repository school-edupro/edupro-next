import type { StaffOption } from '@/lib/payroll-inputs';

/** The month's staff as a searchable drop-down (the id is submitted). */
export function StaffSelect({
  id,
  staff,
  name = 'employeeId',
  label = 'Employee',
  value,
}: {
  id: string;
  staff: StaffOption[];
  name?: string;
  label?: string;
  value?: string;
}) {
  return (
    <label className="ep-field" htmlFor={id}>
      <span className="ep-field__label">{label}</span>
      <select id={id} name={name} className="ep-select" required defaultValue={value ?? ''}>
        <option value="" disabled>
          Choose…
        </option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code} · {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A month field (YYYY-MM). */
export function MonthField({
  id,
  name,
  label,
  value,
  required = true,
  help,
}: {
  id: string;
  name: string;
  label: string;
  value?: string;
  required?: boolean;
  help?: string;
}) {
  return (
    <label className="ep-field" htmlFor={id}>
      <span className="ep-field__label">{label}</span>
      <input
        id={id}
        name={name}
        type="month"
        className="ep-input"
        required={required}
        defaultValue={value ?? ''}
      />
      {help ? <span className="ep-field__help">{help}</span> : null}
    </label>
  );
}

/** A reason field (3 to 200 letters). */
export function ReasonField({
  id,
  label = 'Reason',
  name = 'reason',
}: {
  id: string;
  label?: string;
  name?: string;
}) {
  return (
    <label className="ep-field" htmlFor={id}>
      <span className="ep-field__label">{label}</span>
      <input id={id} name={name} className="ep-input" required minLength={3} maxLength={200} />
    </label>
  );
}
