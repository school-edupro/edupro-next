'use client';
import { useEffect, useState } from 'react';
import { ChipPicker, type ChipOption } from '@/components/ChipPicker';
import { HtmlEditor } from '@/components/comms/HtmlEditor';
import { publishNoticeNow, saveNoticeDraft } from '@/lib/actions';
import { noticeReach } from '@/lib/notice-actions';

type Kind = 'notice' | 'circular' | 'office_order';
type Who = 'students' | 'employees' | 'everyone';
const KINDS: Array<{ id: Kind; label: string; help: string }> = [
  {
    id: 'notice',
    label: 'Notice',
    help: 'For students and parents; shows under Notices in their portal.',
  },
  { id: 'circular', label: 'Circular', help: 'A formal circular; students, employees or both.' },
  { id: 'office_order', label: 'Office order', help: 'For employees; shows under Office orders.' },
];
const nowLocal = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 16);

/**
 * Compose a notice or an office order, laid out like Communication → Compose: what it is, who it is
 * for (with a live count), the subject and the message in the same editor, attachments and options;
 * on the right the preview of the portal card. Save it as a draft or publish it.
 */
export function NoticeCompose({
  classes,
  sections,
  employees,
}: {
  classes: ChipOption[];
  sections: ChipOption[];
  employees: ChipOption[];
}) {
  const [kind, setKind] = useState<Kind>('notice');
  const [who, setWho] = useState<Who>('students');
  const [classIds, setClassIds] = useState<string[]>([]);
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [ack, setAck] = useState(false);
  const [mail, setMail] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [reach, setReach] = useState<{ students: number; employees: number } | null>(null);
  const audience: Who = kind === 'office_order' ? 'employees' : who;
  const forStudents = audience !== 'employees';
  const forStaff = audience !== 'students';
  const targets = [
    ...(forStudents ? classIds.map((id) => ({ type: 'class', id })) : []),
    ...(forStudents || forStaff ? sectionIds.map((id) => ({ type: 'class_section', id })) : []),
    ...(forStaff ? employeeIds.map((id) => ({ type: 'employee', id })) : []),
  ];
  const key = JSON.stringify([kind, audience, targets]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void noticeReach({ kind, audience, targets }).then((r) => {
        if (live) setReach(r);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // the count follows the audience chosen (the key holds the kind, the audience and the targets)
  }, [key]);
  const empty = !title.trim() || !body.replace(/<[^>]+>/g, '').trim();
  return (
    <form action={publishNoticeNow} className="ep-compose">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="audience" value={audience} />
      <input type="hidden" name="bodyFormat" value="html" />
      <div className="ep-compose__main">
        <section className="ep-card" aria-labelledby="nc-step1">
          <h2 className="ep-card__title" id="nc-step1">
            1. What is it
          </h2>
          <div className="ep-compose__aud" role="radiogroup" aria-label="Kind">
            {KINDS.map((k) => (
              <label
                key={k.id}
                className="ep-compose__audopt"
                data-on={kind === k.id ? 'true' : undefined}
                htmlFor={`nc-kind-${k.id}`}
              >
                <input
                  id={`nc-kind-${k.id}`}
                  type="radio"
                  name="nc-kind"
                  checked={kind === k.id}
                  onChange={() => setKind(k.id)}
                />
                <span>
                  <strong>{k.label}</strong>
                  <span className="ep-field__help">{k.help}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
        <section className="ep-card" aria-labelledby="nc-step2">
          <h2 className="ep-card__title" id="nc-step2">
            2. Who is it for
          </h2>
          {kind === 'office_order' ? (
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              An office order goes to employees.
            </p>
          ) : (
            <div className="ep-compose__aud" role="radiogroup" aria-label="Audience">
              {(
                [
                  ['students', 'Students and parents', 'Their portal'],
                  ['employees', 'Employees', 'The teacher app'],
                  ['everyone', 'Everyone', 'Both'],
                ] as Array<[Who, string, string]>
              ).map(([id, label, help]) => (
                <label
                  key={id}
                  className="ep-compose__audopt"
                  data-on={who === id ? 'true' : undefined}
                  htmlFor={`nc-who-${id}`}
                >
                  <input
                    id={`nc-who-${id}`}
                    type="radio"
                    name="nc-who"
                    checked={who === id}
                    onChange={() => setWho(id)}
                  />
                  <span>
                    <strong>{label}</strong>
                    <span className="ep-field__help">{help}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="ep-wd__form" style={{ marginTop: 'var(--sp-3)' }}>
            {forStudents ? (
              <>
                <ChipPicker
                  name="classIds"
                  label="Only these classes (every section of the class)"
                  options={classes}
                  value={classIds}
                  onChange={setClassIds}
                />
                <ChipPicker
                  name="classSectionIds"
                  label="Only these sections"
                  options={sections}
                  value={sectionIds}
                  onChange={setSectionIds}
                />
              </>
            ) : null}
            {forStaff ? (
              <ChipPicker
                name="employeeIds"
                label="Only these employees"
                options={employees}
                value={employeeIds}
                onChange={setEmployeeIds}
              />
            ) : null}
          </div>
          <p className="ep-field__help" role="status" style={{ marginBottom: 0 }}>
            {targets.length === 0 ? 'Nothing chosen: it goes to all of them. ' : ''}
            {reach
              ? `Reaches ${[
                  forStudents ? `${String(reach.students)} student(s)` : '',
                  forStaff ? `${String(reach.employees)} employee(s)` : '',
                ]
                  .filter(Boolean)
                  .join(' and ')}.`
              : 'Counting…'}
          </p>
        </section>
        <section className="ep-card" aria-labelledby="nc-step3">
          <h2 className="ep-card__title" id="nc-step3">
            3. Write it
          </h2>
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <label className="ep-field" htmlFor="nc-title">
              <span className="ep-field__label">Subject *</span>
              <input
                id="nc-title"
                name="title"
                className="ep-input"
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <HtmlEditor
              id="nc-body"
              name="body"
              label="Message *"
              value={body}
              onChange={setBody}
            />
            <label className="ep-field" htmlFor="nc-files">
              <span className="ep-field__label">Attachments (PDF or image, up to 10)</span>
              <input
                id="nc-files"
                name="files"
                type="file"
                className="ep-input"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp"
              />
            </label>
          </div>
        </section>
        <section className="ep-card" aria-labelledby="nc-step4">
          <h2 className="ep-card__title" id="nc-step4">
            4. When and how
          </h2>
          <div className="ep-wd__form">
            <label className="ep-field" htmlFor="nc-publish-at">
              <span className="ep-field__label">Show in the portal from (date and time)</span>
              <input
                id="nc-publish-at"
                name="publishAt"
                type="datetime-local"
                className="ep-input"
                defaultValue={nowLocal()}
              />
            </label>
            <label className="ep-field" htmlFor="nc-until">
              <span className="ep-field__label">Take it down after (date, optional)</span>
              <input id="nc-until" name="publishUntil" type="date" className="ep-input" />
            </label>
          </div>
          <div style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
            <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
              <input
                type="checkbox"
                name="ackRequired"
                value="1"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              Ask for an acknowledgement
            </label>
            <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
              <input
                type="checkbox"
                name="alsoEmail"
                value="1"
                checked={mail}
                onChange={(e) => setMail(e.target.checked)}
              />
              Also send by e-mail when published
            </label>
            <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
              <input
                type="checkbox"
                name="isPinned"
                value="1"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              Pin it on top of the list
            </label>
          </div>
        </section>
      </div>
      <aside>
        <div className="ep-card ep-compose__sticky">
          <h2 className="ep-card__title">Preview</h2>
          <p className="ep-kicker" style={{ marginTop: 0 }}>
            {KINDS.find((k) => k.id === kind)?.label}
            {pinned ? ' · pinned' : ''}
          </p>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              color: 'var(--text-heading)',
            }}
          >
            {title || 'Subject'}
          </div>
          {body.replace(/<[^>]+>/g, '').trim() ? (
            <div className="ep-prose ep-note" dangerouslySetInnerHTML={{ __html: body }} />
          ) : (
            <p className="ep-field__help">The message shows here as you write.</p>
          )}
          <ul className="ep-field__help" style={{ paddingLeft: 'var(--sp-4)' }}>
            <li>
              {forStudents && forStaff
                ? 'Shows in the parent / student portal and the teacher app.'
                : forStudents
                  ? 'Shows in the parent / student portal under Notices.'
                  : 'Shows in the teacher app under Office orders.'}
            </li>
            {ack ? <li>Each reader is asked to acknowledge it.</li> : null}
            {mail ? (
              <li>
                Also e-mailed once to the guardians and employees it is for (attachments stay in the
                portal).
              </li>
            ) : null}
          </ul>
          <div className="ep-wdset__actions">
            <button
              type="submit"
              className="ep-btn ep-btn--secondary"
              formAction={saveNoticeDraft}
              disabled={empty}
            >
              Save draft
            </button>
            <button
              type="submit"
              className="ep-btn ep-btn--primary"
              formAction={publishNoticeNow}
              disabled={empty}
            >
              Publish
            </button>
          </div>
          {empty ? (
            <p className="ep-field__help" style={{ marginBottom: 0 }}>
              Write the subject and the message first.
            </p>
          ) : null}
        </div>
      </aside>
    </form>
  );
}
