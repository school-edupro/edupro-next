import type { ReactNode } from 'react';

export interface WorkSheetEntry {
  text: string;
  files: number;
  attachments?: Array<{ workId: string; fileId: string }>;
  dueOn: string | null;
  sections: string[];
}
/** The View and Download links of a file attached to an entry (each app has its own file route). */
export type WorkFileLinks = (workId: string, fileId: string, n: number) => ReactNode;
export interface WorkSheetRow {
  subject: { id: string; code: string; name: string };
  sections: string[];
  homework: WorkSheetEntry | null;
  classwork: WorkSheetEntry | null;
  assignment: WorkSheetEntry | null;
}
export interface WorkSheetData {
  date: string;
  mode: 'daily' | 'assignment';
  options: Array<{ classSectionId: string; section: string; classId?: string }>;
  /** The classes the caller posts for; picking one offers its sections, all ticked. */
  classes?: Array<{ id: string; name: string }>;
  classId?: string | null;
  chosen: string[];
  rows: WorkSheetRow[];
  /** The "publish on" the sheet starts with (school time, as a date-time field takes it). */
  publishAt: string;
  publishTime: string | null;
  maxMb: number;
}
export interface WorkSheetProps {
  sheet: WorkSheetData;
  /** The page the filter form reloads, e.g. `/daily-work`. */
  path: string;
  /** Kept in the address when the filter reloads (the tab of the page). */
  view: string;
  action: (fd: FormData) => void | Promise<void>;
  fileLinks?: WorkFileLinks;
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';

function Posted({
  entry,
  all,
  fileLinks,
}: {
  entry: WorkSheetEntry | null;
  all: number;
  fileLinks?: WorkFileLinks;
}): ReactNode {
  if (!entry) return null;
  const files = entry.attachments ?? [];
  return (
    <span className="ep-sheet__posted">
      Posted{entry.sections.length < all ? ` for ${entry.sections.join(', ')}` : ''}
      {entry.files ? ` · ${String(entry.files)} file(s) attached` : ''}
      {fileLinks && files.length ? (
        <span className="ep-sheet__files">
          {files.map((f, i) => (
            <span key={f.fileId}>{fileLinks(f.workId, f.fileId, i + 1)}</span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The day's sheet: pick the date and the classes, then a row per subject with a box for the homework and
 * one for the classwork (or the assignment and its due date), each with its attachments, saved in one go.
 */
export function WorkSheet({ sheet, path, view, action, fileLinks }: WorkSheetProps) {
  const assignment = sheet.mode === 'assignment';
  const all = sheet.chosen.length;
  const sections = sheet.options.filter((o) => sheet.classId && o.classId === sheet.classId);
  const box = (
    row: WorkSheetRow,
    key: 'hw' | 'cw' | 'as',
    label: string,
    entry: WorkSheetEntry | null,
  ) => (
    <td>
      <textarea
        className="ep-input ep-sheet__box"
        name={`${key}:${row.subject.id}`}
        rows={3}
        maxLength={8000}
        defaultValue={entry?.text ?? ''}
        placeholder={`Enter ${label.toLowerCase()}…`}
        aria-label={`${row.subject.name}: ${label}`}
      />
      <Posted entry={entry} all={all} fileLinks={fileLinks} />
    </td>
  );
  const pick = (row: WorkSheetRow, key: 'hwf' | 'cwf' | 'asf', label: string) => (
    <td>
      <input
        className="ep-input ep-sheet__pick"
        type="file"
        name={`${key}:${row.subject.id}`}
        multiple
        accept={ACCEPT}
        aria-label={`${row.subject.name}: ${label}`}
      />
    </td>
  );
  return (
    <div className="ep-sheet">
      <form method="get" action={path} className="ep-sheet__filter">
        <input type="hidden" name="view" value={view} />
        <label className="ep-field">
          <span className="ep-field__label">Select date</span>
          <input className="ep-input" type="date" name="date" defaultValue={sheet.date} required />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Class</span>
          <select className="ep-select" name="c" defaultValue={sheet.classId ?? ''} required>
            <option value="">Select a class</option>
            {(sheet.classes ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {sections.length ? (
          <fieldset className="ep-sheet__classes">
            <legend className="ep-field__label">Sections (untick one to leave it out)</legend>
            <div className="ep-sheet__chips">
              {sections.map((o) => (
                <label key={o.classSectionId} className="ep-sheet__chip">
                  <input
                    type="checkbox"
                    name="s"
                    value={o.classSectionId}
                    defaultChecked={sheet.chosen.includes(o.classSectionId)}
                  />
                  <span>{o.section}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <button type="submit" className="ep-btn ep-btn--primary">
          Show subjects
        </button>
      </form>

      {all === 0 ? (
        <p className="ep-sheet__hint">
          {(sheet.classes ?? []).length
            ? 'Select the class and press Show subjects. Every section of the class you teach comes ticked, and the same entry is posted to each of them.'
            : 'No class is assigned to you for daily work.'}
        </p>
      ) : sheet.rows.length === 0 ? (
        <p className="ep-sheet__hint">
          No subject is assigned to you in this class. A teacher, the class teacher too, posts only
          for the subjects given in Teacher assignments; ask the office to add yours.
        </p>
      ) : (
        <form action={action}>
          <input type="hidden" name="date" value={sheet.date} />
          <input type="hidden" name="mode" value={sheet.mode} />
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="c" value={sheet.classId ?? ''} />
          {sheet.chosen.map((id) => (
            <input key={id} type="hidden" name="sections" value={id} />
          ))}
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Subjects">
            <table className="ep-table ep-sheet__table">
              <caption className="ep-sr-only">
                {assignment ? 'Assignments' : 'Homework and classwork'} by subject
              </caption>
              <thead>
                <tr>
                  <th scope="col">Subject</th>
                  {assignment ? (
                    <>
                      <th scope="col">Assignment</th>
                      <th scope="col">Due on</th>
                      <th scope="col">Attachment</th>
                    </>
                  ) : (
                    <>
                      <th scope="col">Homework</th>
                      <th scope="col">Classwork</th>
                      <th scope="col">Homework file</th>
                      <th scope="col">Classwork file</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((row) => (
                  <tr key={row.subject.id}>
                    <th scope="row" className="ep-sheet__subject">
                      <input type="hidden" name="subject" value={row.subject.id} />
                      <span className="ep-sheet__name">{row.subject.name}</span>
                      {row.sections.length < all ? (
                        <span className="ep-sheet__posted">{row.sections.join(', ')} only</span>
                      ) : null}
                    </th>
                    {assignment ? (
                      <>
                        {box(row, 'as', 'Assignment', row.assignment)}
                        <td>
                          <input
                            className="ep-input"
                            type="date"
                            name={`due:${row.subject.id}`}
                            min={sheet.date}
                            defaultValue={row.assignment?.dueOn ?? ''}
                            aria-label={`${row.subject.name}: due on`}
                          />
                        </td>
                        {pick(row, 'asf', 'attachment')}
                      </>
                    ) : (
                      <>
                        {box(row, 'hw', 'Homework', row.homework)}
                        {box(row, 'cw', 'Classwork', row.classwork)}
                        {pick(row, 'hwf', 'homework file')}
                        {pick(row, 'cwf', 'classwork file')}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ep-sheet__foot">
            <label className="ep-field">
              <span className="ep-field__label">Publish on (date and time)</span>
              <input
                className="ep-input"
                type="datetime-local"
                name="publishAt"
                defaultValue={sheet.publishAt}
                required
              />
              <span className="ep-field__help">
                Parents and students see it from this time.
                {sheet.publishTime ? ` The school's usual time is ${sheet.publishTime}.` : ''}
              </span>
            </label>
            <label className="ep-sheet__ack">
              <input type="checkbox" name="ackRequired" value="1" />
              Ask the parent / student to acknowledge
            </label>
            <p className="ep-field__help">
              Fill only the subjects you want to post; a box left empty changes nothing. A file can
              be a PDF or a photo, up to {sheet.maxMb} MB each.
            </p>
            <button type="submit" className="ep-btn ep-btn--primary">
              Save and publish
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---- the report ---------------------------------------------------------------------------------
export interface WorkReportItem {
  id: string;
  kind: 'homework' | 'classwork' | 'assignment';
  section: string;
  subjectName: string | null;
  title: string;
  body: string;
  assignedOn: string;
  dueOn: string | null;
  postedBy: string | null;
  files: Array<{ id: string }>;
  publishAt: string;
  scheduled: boolean;
  ackRequired: boolean;
  ackCount: number;
}
export interface WorkReportProps {
  items: WorkReportItem[];
  mode: 'daily' | 'assignment';
  /** A link beside each entry (who acknowledged, remove…). */
  extra?: (item: WorkReportItem) => ReactNode;
  fileLinks?: WorkFileLinks;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

/** What was posted, a line per day, class and subject: homework beside classwork, with its publish time. */
export function WorkReport({ items, mode, extra, fileLinks }: WorkReportProps) {
  const assignment = mode === 'assignment';
  const lines = new Map<string, WorkReportItem[]>();
  for (const it of items) {
    if (assignment !== (it.kind === 'assignment')) continue;
    const k = `${it.assignedOn}|${it.section}|${it.subjectName ?? ''}`;
    lines.set(k, [...(lines.get(k) ?? []), it]);
  }
  const cell = (list: WorkReportItem[], kind: WorkReportItem['kind']) => {
    const hits = list.filter((x) => x.kind === kind);
    return (
      <td>
        {hits.map((x) => (
          <div key={x.id} className="ep-sheet__entry">
            <div className="ep-sheet__text">{x.body || x.title}</div>
            {x.files.length ? (
              <div className="ep-sheet__files">
                <span>Attachments</span>
                {fileLinks
                  ? x.files.map((f, i) => <span key={f.id}>{fileLinks(x.id, f.id, i + 1)}</span>)
                  : ` ${String(x.files.length)}`}
              </div>
            ) : null}
            <div className="ep-sheet__meta">
              {x.scheduled ? 'Publishes ' : 'Published '}
              {when(x.publishAt)}
              {x.postedBy ? ` · ${x.postedBy}` : ''}
              {x.dueOn ? ` · due ${x.dueOn}` : ''}
              {extra ? <> {extra(x)}</> : null}
            </div>
          </div>
        ))}
      </td>
    );
  };
  if (!lines.size) return <p className="ep-sheet__hint">Nothing was posted in these days.</p>;
  return (
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Report">
      <table className="ep-table ep-table--dense ep-sheet__report">
        <caption className="ep-sr-only">
          {assignment ? 'Assignments' : 'Homework and classwork'} posted
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Class</th>
            <th scope="col">Subject</th>
            {assignment ? (
              <th scope="col">Assignment</th>
            ) : (
              <>
                <th scope="col">Homework</th>
                <th scope="col">Classwork</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {[...lines.entries()].map(([k, list]) => (
            <tr key={k}>
              <td>{day(list[0]!.assignedOn)}</td>
              <td>{list[0]!.section}</td>
              <td>{list[0]!.subjectName ?? ''}</td>
              {assignment ? (
                cell(list, 'assignment')
              ) : (
                <>
                  {cell(list, 'homework')}
                  {cell(list, 'classwork')}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
