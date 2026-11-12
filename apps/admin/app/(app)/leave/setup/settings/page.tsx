import { MessageTemplates } from '@/components/MessageTemplates';
import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { LeaveSettings } from '@/lib/leave';
import { saveLeaveSettings } from '@/lib/leave-actions';

/** Leave & attendance settings (docs/design/85, phase A). */
export default async function LeaveSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('leave.setup.view')) notFound();
  let d: LeaveSettings;
  try {
    d = await apiFetch<LeaveSettings>('/leave/setup/settings');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const s = d.settings;
  const ro = !d.can.manage;
  const num = (
    key: keyof typeof s,
    label: string,
    min: number,
    max: number,
    help: string,
    optional = false,
  ) => (
    <label className="ep-field" htmlFor={`ls-${key}`}>
      <span className="ep-field__label">{label}</span>
      <input
        id={`ls-${key}`}
        name={key}
        type="number"
        min={min}
        max={max}
        required={!optional}
        defaultValue={s[key] === null ? '' : String(s[key])}
        className="ep-input"
        disabled={ro}
      />
      <span className="ep-field__help">{help}</span>
    </label>
  );
  const check = (key: keyof typeof s, label: string, help?: string) => (
    <label className="ep-check" htmlFor={`ls-${key}`}>
      <input
        id={`ls-${key}`}
        name={key}
        type="checkbox"
        className="ep-check__input"
        defaultChecked={s[key] === true}
        disabled={ro}
      />
      <span className="ep-check__box" />
      {label}
      {help ? <span className="ep-field__help"> — {help}</span> : null}
    </label>
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Leave & attendance set-up', href: '/leave/setup' },
          { label: 'Settings' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Settings"
        description="How late marks, missing punches and absence turn into leave; punches and devices; what staff and the office may do; and the message channels."
      />
      <Notice params={sp} />
      <form action={saveLeaveSettings}>
        <section className="ep-card" aria-labelledby="ls-ded">
          <h2 id="ls-ded" className="ep-card__title">
            Deductions
          </h2>
          <div className="ep-form-section__body">
            {num(
              'lateMarksPerLeave',
              'Late marks for one day of leave',
              1,
              10,
              'Every so many late marks in a month = one day of leave, taken in the deduction order of the leave types (CL, then EL … loss of pay last).',
            )}
            {num(
              'missingPunchesPerLeave',
              'Missing punches for one day of leave',
              1,
              10,
              'The same for days with an IN or an OUT punch missing.',
            )}
            {num(
              'lopAfterDays',
              'Loss of pay after (days)',
              0,
              60,
              'An absent day with no leave applied and no correction asked for becomes loss of pay after so many days.',
            )}
            <label className="ep-field" htmlFor="ls-exceptionsFrom">
              <span className="ep-field__label">Count late marks and missing punches from</span>
              <input
                id="ls-exceptionsFrom"
                name="exceptionsFrom"
                type="date"
                defaultValue={s.exceptionsFrom ?? ''}
                className="ep-input"
                disabled={ro}
              />
              <span className="ep-field__help">
                A fresh start: earlier days are not counted. Empty: all.
              </span>
            </label>
          </div>
        </section>
        <section className="ep-card" aria-labelledby="ls-att" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="ls-att" className="ep-card__title">
            Attendance
          </h2>
          <div className="ep-form-section__body">
            <label className="ep-field" htmlFor="ls-defaultShiftId">
              <span className="ep-field__label">Default shift</span>
              <select
                id="ls-defaultShiftId"
                name="defaultShiftId"
                className="ep-select"
                defaultValue={s.defaultShiftId ?? ''}
                disabled={ro}
              >
                <option value="">None</option>
                {d.shifts.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.code})
                  </option>
                ))}
              </select>
              <span className="ep-field__help">For staff with no shift posting.</span>
            </label>
            {num(
              'punchGapMinutes',
              'Punches closer than (minutes) are one',
              1,
              120,
              'An OUT punch this soon after the IN is a double tap, not the OUT.',
            )}
            {num(
              'recheckDays',
              'Re-check days back',
              1,
              60,
              'Each night, days this far back are looked at again for punches that came late.',
            )}
            {num(
              'absentLookbackDays',
              'Mark absent days back',
              1,
              62,
              'Days with no punch and no leave this far back are marked absent each night.',
            )}
            {check(
              'lateReducesHours',
              'Late minutes lower the day’s hours',
              'a late day needs that much less to be present (up to the late rule’s minutes)',
            )}
            {check('allowTimeEdit', 'The office may change IN and OUT times on the register')}
          </div>
        </section>
        <section
          className="ep-card"
          aria-labelledby="ls-leave"
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <h2 id="ls-leave" className="ep-card__title">
            Leave
          </h2>
          <div className="ep-form-section__body">
            {check(
              'allowOnBehalf',
              'The office may apply leave for an employee',
              'approved at once; it replaces leave already on those days',
            )}
            {num(
              'backdateDays',
              'Leave for past days up to (days back)',
              0,
              366,
              'For the leave types whose Past days is "school" (Leave types sets each). 0: not for past days; empty: any past day of an open month. A month locked for payroll is never open; the office may enter any day.',
              true,
            )}
            {num(
              'correctionBackdateDays',
              'Attendance corrections for past days up to (days back)',
              0,
              366,
              'How far back an employee may ask to correct a day (7: a week). Empty: any day of an open month. The office corrects any day.',
              true,
            )}
          </div>
        </section>
        <section className="ep-card" aria-labelledby="ls-dev" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="ls-dev" className="ep-card__title">
            Devices and messages
          </h2>
          <div className="ep-form-section__body">
            <label className="ep-field" htmlFor="ls-deviceSerials">
              <span className="ep-field__label">This school’s device serials</span>
              <textarea
                id="ls-deviceSerials"
                name="deviceSerials"
                rows={3}
                className="ep-input"
                defaultValue={s.deviceSerials.join('\n')}
                disabled={ro}
              />
              <span className="ep-field__help">
                For punches read from the central device database: one serial a line (or
                comma-separated). The database connection itself is set on the server.
              </span>
            </label>
            <label className="ep-field" htmlFor="ls-missingPunchCc">
              <span className="ep-field__label">Missing-punch e-mails also to</span>
              <input
                id="ls-missingPunchCc"
                name="missingPunchCc"
                className="ep-input"
                defaultValue={s.missingPunchCc ?? ''}
                maxLength={500}
                placeholder="hr@school.example"
                disabled={ro}
              />
              <span className="ep-field__help">E-mail addresses, comma-separated.</span>
            </label>
            <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
              <legend className="ep-field__label">Send leave and attendance messages by</legend>
              {check('sendEmail', 'E-mail')}
              {check('sendWhatsapp', 'WhatsApp')}
              {check('sendApp', 'App notification')}
              {check('sendSms', 'SMS', 'only once the SMS templates are approved (DLT)')}
            </fieldset>
          </div>
        </section>
        {ro ? (
          <p className="ep-field__help">Only the leave office changes the settings.</p>
        ) : (
          <div className="ep-form-actions">
            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
              Save the settings
            </button>
          </div>
        )}
      </form>
      <div style={{ marginTop: 'var(--sp-4)' }}>
        <MessageTemplates templates={d.templates} search="leave_" />
      </div>
    </>
  );
}
