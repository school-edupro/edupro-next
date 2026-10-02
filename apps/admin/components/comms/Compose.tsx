'use client';
import { useMemo, useRef, useState } from 'react';
import {
  composePreview,
  composeSend,
  readRecipientSheet,
  searchPeople,
  uploadAttachment,
} from '@/lib/comms-actions';
import {
  CHANNEL_LABEL,
  SEND_TO_LABEL,
  SKIP_LABEL,
  smsParts,
  type Attachment,
  type Channel,
  type CommsTemplate,
  type ComposePayload,
  type ComposePreview,
  type Group,
  type Member,
  type Rule,
  type RuleOptions,
  type SendTo,
  type SheetResult,
  type TemplateVariable,
} from '@/lib/comms';
import { CheckList } from './CheckList';
import { HtmlEditor } from './HtmlEditor';
import { RuleBuilder } from './RuleBuilder';

type Audience =
  | 'class_section'
  | 'class'
  | 'filter'
  | 'group'
  | 'individuals'
  | 'upload'
  | 'route'
  | 'students'
  | 'employees'
  | 'everyone';

const AUDIENCES: Array<{ id: Audience; label: string; help: string }> = [
  { id: 'class_section', label: 'Sections', help: 'Students of the sections you tick' },
  { id: 'class', label: 'Classes', help: 'Students of whole classes' },
  {
    id: 'filter',
    label: 'Master-wise',
    help: 'House, category, gender, stream, route, department…',
  },
  { id: 'group', label: 'Groups', help: 'Student, employee, PTA or outside-contact groups' },
  { id: 'individuals', label: 'Selected people', help: 'Search students, employees or parents' },
  {
    id: 'upload',
    label: 'Excel list',
    help: 'Admission No / Employee Code, or Name + Mobile / Email',
  },
  { id: 'route', label: 'Transport routes', help: 'Students on the routes you tick' },
  { id: 'students', label: 'All students', help: 'Every enrolled student this year' },
  { id: 'employees', label: 'All employees', help: 'Every active employee' },
  { id: 'everyone', label: 'Everyone', help: 'All students and employees' },
];

const CHANNELS: Channel[] = ['sms', 'whatsapp', 'email'];
const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Compose (communication v2): one message to SMS, WhatsApp and email at once, to sections, classes,
 * a master-wise rule, groups, chosen people, an Excel list or everyone; "send to" decides whether a
 * student's message goes to the family contact, both parents, the student or all. Preview shows who
 * is reached per channel, SMS units, the cost and whether approval is needed; then send.
 */
export function Compose({
  templates,
  variables,
  classes,
  sections,
  routes,
  groups,
  ruleOptions,
  attachmentMaxMb,
}: {
  templates: CommsTemplate[];
  variables: TemplateVariable[];
  classes: Array<{ value: string; label: string }>;
  sections: Array<{ value: string; label: string; classId?: string }>;
  routes: Array<{ value: string; label: string }>;
  groups: Group[];
  ruleOptions: RuleOptions;
  attachmentMaxMb: number;
}) {
  const byChannel = (ch: Channel) => templates.filter((t) => t.channel === ch);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<'general' | 'service'>('general');
  const [scheduledAt, setScheduledAt] = useState('');
  const [on, setOn] = useState<Record<Channel, boolean>>({
    sms: byChannel('sms').length > 0,
    whatsapp: false,
    email: false,
  });
  const [tpl, setTpl] = useState<Record<Channel, string>>({
    sms: byChannel('sms')[0]?.id ?? '',
    whatsapp: byChannel('whatsapp')[0]?.id ?? '',
    email: byChannel('email')[0]?.id ?? '',
  });
  const [audience, setAudience] = useState<Audience>('class_section');
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [rule, setRule] = useState<Rule>({ people: 'students' });
  const [people, setPeople] = useState<Member[]>([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Member[]>([]);
  const [sheet, setSheet] = useState<SheetResult | null>(null);
  const [sendTo, setSendTo] = useState<SendTo>('primary');
  const [body, setBody] = useState('');
  const [html, setHtml] = useState(false);
  const [subject, setSubject] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ComposePreview | null>(null);
  const [done, setDone] = useState<{ id: string; needsApproval: boolean; status: string } | null>(
    null,
  );
  const sheetRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const chosen = CHANNELS.filter((c) => on[c] && tpl[c]);
  const studentsInvolved =
    !['employees'].includes(audience) && !(audience === 'filter' && rule.people === 'employees');
  const payload = useMemo<ComposePayload | null>(() => {
    if (!chosen.length || !title.trim() || !body.trim()) return null;
    const p: ComposePayload = {
      title: title.trim(),
      category,
      channels: chosen.map((c) => ({ channel: c, templateId: tpl[c] })),
      body,
      bodyFormat: html && on.email ? 'html' : 'text',
      ...(on.email && subject.trim() ? { subject: subject.trim() } : {}),
      audience,
      targets: [],
      sendTo,
      attachments: files.map((f) => f.id),
      ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
    };
    if (['class_section', 'class', 'route', 'group'].includes(audience))
      p.targets = (picked[audience] ?? []).map((id) => ({ type: audience, id }));
    if (audience === 'filter') p.rule = rule;
    if (audience === 'individuals') p.targets = people.map((m) => ({ type: m.type, id: m.id }));
    if (audience === 'upload' && sheet) {
      if (sheet.targets.length) {
        p.audience = 'individuals';
        p.targets = sheet.targets;
      } else p.upload = sheet.upload;
    }
    return p;
  }, [
    chosen,
    title,
    category,
    tpl,
    body,
    html,
    on.email,
    subject,
    audience,
    sendTo,
    files,
    scheduledAt,
    picked,
    rule,
    people,
    sheet,
  ]);

  const reset = () => {
    setPreview(null);
    setDone(null);
    setError(null);
  };
  const run = async (what: 'preview' | 'send') => {
    if (!payload) {
      setError('Add a title, the message and at least one channel with its template.');
      return;
    }
    setBusy(what);
    setError(null);
    const r = what === 'preview' ? await composePreview(payload) : await composeSend(payload);
    setBusy(null);
    if (!r.ok) {
      setError([r.error, ...(r.errors ?? [])].join(' · '));
      return;
    }
    if (what === 'preview') setPreview(r.data as ComposePreview);
    else setDone(r.data as { id: string; needsApproval: boolean; status: string });
  };

  const smsText = body ? smsParts(html ? body.replace(/<[^>]+>/g, ' ') : body) : null;
  const tplOf = (c: Channel) => templates.find((t) => t.id === tpl[c]);

  if (done)
    return (
      <div className="ep-card ep-compose__done" role="status">
        <h2 className="ep-card__title">
          {done.needsApproval ? 'Sent for approval' : 'Message is on its way'}
        </h2>
        <p>
          {done.needsApproval
            ? 'The principal approves it from My approvals; it goes out as soon as it is approved.'
            : 'Messages are queued with the providers. Delivery, read and failures show on the request.'}
        </p>
        <div className="ep-wdset__actions">
          <a className="ep-btn ep-btn--primary" href={`/comms/requests/${done.id}`}>
            Open the request
          </a>
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            onClick={() => {
              setDone(null);
              setPreview(null);
              setTitle('');
              setBody('');
              setSubject('');
              setFiles([]);
            }}
          >
            Write another
          </button>
        </div>
      </div>
    );

  return (
    <div className="ep-compose">
      <div className="ep-compose__main">
        <section className="ep-card" aria-labelledby="c-step1">
          <h2 className="ep-card__title" id="c-step1">
            1 · Message and channels
          </h2>
          <div className="ep-wd__form">
            <label className="ep-field ep-wd__wide" htmlFor="c-title">
              <span className="ep-field__label">Title *</span>
              <input
                id="c-title"
                className="ep-input"
                maxLength={160}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  reset();
                }}
                placeholder="e.g. Holiday on Friday"
              />
            </label>
            <label className="ep-field" htmlFor="c-cat">
              <span className="ep-field__label">Type</span>
              <select
                id="c-cat"
                className="ep-select"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as 'general' | 'service');
                  reset();
                }}
              >
                <option value="general">General (respects opt-outs and quiet hours)</option>
                <option value="service">Important (fees, attendance, safety)</option>
              </select>
            </label>
            <label className="ep-field" htmlFor="c-when">
              <span className="ep-field__label">Send at (optional)</span>
              <input
                id="c-when"
                type="datetime-local"
                className="ep-input"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </label>
          </div>
          <div className="ep-compose__channels">
            {CHANNELS.map((c) => {
              const list = byChannel(c);
              return (
                <div key={c} className="ep-compose__channel" data-on={on[c] ? 'true' : undefined}>
                  <label className="ep-roles__tick" htmlFor={`c-on-${c}`}>
                    <input
                      id={`c-on-${c}`}
                      type="checkbox"
                      checked={on[c]}
                      disabled={!list.length}
                      onChange={(e) => {
                        setOn({ ...on, [c]: e.target.checked });
                        reset();
                      }}
                    />{' '}
                    <strong>{CHANNEL_LABEL[c]}</strong>
                  </label>
                  {list.length ? (
                    <label className="ep-field" htmlFor={`c-tpl-${c}`}>
                      <span className="ep-field__label">{CHANNEL_LABEL[c]} template</span>
                      <select
                        id={`c-tpl-${c}`}
                        className="ep-select"
                        value={tpl[c]}
                        disabled={!on[c]}
                        onChange={(e) => {
                          setTpl({ ...tpl, [c]: e.target.value });
                          reset();
                        }}
                      >
                        {list.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="ep-field__help">
                      No active {CHANNEL_LABEL[c]} template. <a href="/comms/templates">Add one</a>
                    </p>
                  )}
                  {on[c] && tplOf(c) ? (
                    <p className="ep-compose__tpl">
                      {tplOf(c)!.format === 'html'
                        ? 'HTML email template'
                        : tplOf(c)!.body.slice(0, 160)}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className="ep-card" aria-labelledby="c-step2">
          <h2 className="ep-card__title" id="c-step2">
            2 · Who receives it
          </h2>
          <div className="ep-compose__aud" role="radiogroup" aria-label="Audience">
            {AUDIENCES.map((a) => (
              <label
                key={a.id}
                className="ep-compose__audopt"
                data-on={audience === a.id ? 'true' : undefined}
                htmlFor={`c-aud-${a.id}`}
              >
                <input
                  id={`c-aud-${a.id}`}
                  type="radio"
                  name="c-aud"
                  checked={audience === a.id}
                  onChange={() => {
                    setAudience(a.id);
                    reset();
                  }}
                />
                <span>
                  <strong>{a.label}</strong>
                  <span className="ep-field__help">{a.help}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="ep-compose__pick">
            {audience === 'class_section' ? (
              <CheckList
                id="c-sec"
                legend="Sections"
                options={sections}
                value={picked.class_section ?? []}
                onChange={(v) => {
                  setPicked({ ...picked, class_section: v });
                  reset();
                }}
              />
            ) : null}
            {audience === 'class' ? (
              <CheckList
                id="c-cls"
                legend="Classes"
                options={classes}
                value={picked.class ?? []}
                onChange={(v) => {
                  setPicked({ ...picked, class: v });
                  reset();
                }}
              />
            ) : null}
            {audience === 'route' ? (
              <CheckList
                id="c-route"
                legend="Routes"
                options={routes}
                value={picked.route ?? []}
                onChange={(v) => {
                  setPicked({ ...picked, route: v });
                  reset();
                }}
                empty="No transport routes."
              />
            ) : null}
            {audience === 'group' ? (
              <CheckList
                id="c-grp"
                legend="Groups"
                options={groups.map((g) => ({
                  value: g.id,
                  label: g.name,
                  hint: `${String(g.members)} · ${g.mode === 'rule' ? 'rule' : g.kind.replace('_', ' + ')}`,
                }))}
                value={picked.group ?? []}
                onChange={(v) => {
                  setPicked({ ...picked, group: v });
                  reset();
                }}
                empty="No groups yet."
              />
            ) : null}
            {audience === 'filter' ? (
              <RuleBuilder
                id="c-rule"
                value={rule}
                onChange={(r) => {
                  setRule(r);
                  reset();
                }}
                options={ruleOptions}
                classes={classes}
                sections={sections}
              />
            ) : null}
            {audience === 'individuals' ? (
              <div className="ep-compose__people">
                <div className="ep-wd__form">
                  <label className="ep-field ep-wd__wide" htmlFor="c-q">
                    <span className="ep-field__label">Find students, employees or parents</span>
                    <input
                      id="c-q"
                      type="search"
                      className="ep-input"
                      placeholder="Name, admission no or employee code"
                      value={q}
                      onChange={async (e) => {
                        setQ(e.target.value);
                        if (e.target.value.trim().length >= 2) {
                          const r = await searchPeople(
                            e.target.value.trim(),
                            'student,employee,guardian',
                          );
                          setFound(r.ok ? r.data.data : []);
                        } else setFound([]);
                      }}
                    />
                  </label>
                </div>
                {found.length ? (
                  <ul className="ep-compose__found" aria-label="Search results">
                    {found.map((m) => (
                      <li key={`${m.type}:${m.id}`}>
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          disabled={people.some((p) => p.type === m.type && p.id === m.id)}
                          onClick={() => {
                            setPeople([...people, m]);
                            reset();
                          }}
                        >
                          + {m.name}
                        </button>
                        <span className="ep-field__help">
                          {m.type}
                          {m.ref ? ` · ${m.ref}` : ''}
                          {m.detail ? ` · ${m.detail}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {people.length ? (
                  <ul className="ep-chips" aria-label="Chosen people">
                    {people.map((m) => (
                      <li key={`${m.type}:${m.id}`} className="ep-chip">
                        {m.name}
                        <button
                          type="button"
                          aria-label={`Remove ${m.name}`}
                          onClick={() => {
                            setPeople(people.filter((p) => !(p.type === m.type && p.id === m.id)));
                            reset();
                          }}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {audience === 'upload' ? (
              <div className="ep-compose__sheet">
                <p className="ep-field__help">
                  Columns: <strong>Admission No</strong> or <strong>Employee Code</strong> to reach
                  school people, or <strong>Name</strong> with <strong>Mobile</strong> and/or{' '}
                  <strong>Email</strong> for anyone else (other columns become variables such as{' '}
                  {'{{amount}}'}).{' '}
                  <a href="/api/comms/group-template/external">Download a sample</a>
                </p>
                <div className="ep-wd__form">
                  <label className="ep-field ep-wd__wide" htmlFor="c-sheet">
                    <span className="ep-field__label">Excel or CSV file</span>
                    <input
                      id="c-sheet"
                      ref={sheetRef}
                      type="file"
                      className="ep-input"
                      accept=".xlsx,.csv"
                    />
                  </label>
                  <button
                    type="button"
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    disabled={busy === 'sheet'}
                    onClick={async () => {
                      const f = sheetRef.current?.files?.[0];
                      if (!f) return;
                      const fd = new FormData();
                      fd.set('file', f);
                      setBusy('sheet');
                      const r = await readRecipientSheet(fd);
                      setBusy(null);
                      reset();
                      if (r.ok) setSheet(r.data);
                      else setError(r.error);
                    }}
                  >
                    {busy === 'sheet' ? 'Reading…' : 'Read the list'}
                  </button>
                </div>
                {sheet ? (
                  <div className="ep-compose__sheetres" role="status">
                    <strong>
                      {sheet.targets.length
                        ? `${String(sheet.targets.length)} school people matched`
                        : `${String(sheet.upload.length)} contacts read`}
                    </strong>{' '}
                    from {sheet.rows} rows
                    {sheet.variables.length ? (
                      <> · variables: {sheet.variables.map((v) => `{{${v}}}`).join(', ')}</>
                    ) : null}
                    {sheet.problems.length ? (
                      <ul className="ep-compose__problems">
                        {sheet.problems.slice(0, 10).map((p) => (
                          <li key={`${String(p.row)}-${p.value}`}>
                            Row {p.row}: {p.value ? `${p.value} — ` : ''}
                            {p.reason}
                          </li>
                        ))}
                        {sheet.problems.length > 10 ? (
                          <li>and {sheet.problems.length - 10} more</li>
                        ) : null}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {studentsInvolved ? (
            <fieldset className="ep-compose__sendto">
              <legend className="ep-field__label">For students, send to</legend>
              {(Object.keys(SEND_TO_LABEL) as SendTo[]).map((s) => (
                <label key={s} className="ep-roles__tick" htmlFor={`c-st-${s}`}>
                  <input
                    id={`c-st-${s}`}
                    type="radio"
                    name="c-sendto"
                    checked={sendTo === s}
                    onChange={() => {
                      setSendTo(s);
                      reset();
                    }}
                  />{' '}
                  {SEND_TO_LABEL[s]}
                </label>
              ))}
            </fieldset>
          ) : null}
        </section>

        <section className="ep-card" aria-labelledby="c-step3">
          <h2 className="ep-card__title" id="c-step3">
            3 · Text
          </h2>
          {on.email ? (
            <div className="ep-wd__form">
              <label className="ep-field ep-wd__wide" htmlFor="c-subject">
                <span className="ep-field__label">
                  Email subject (optional; the title when empty)
                </span>
                <input
                  id="c-subject"
                  className="ep-input"
                  maxLength={200}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </label>
              <label className="ep-roles__tick" htmlFor="c-html">
                <input
                  id="c-html"
                  type="checkbox"
                  checked={html}
                  onChange={(e) => {
                    setHtml(e.target.checked);
                    reset();
                  }}
                />{' '}
                Write with formatting (HTML editor)
              </label>
            </div>
          ) : null}
          {html && on.email ? (
            <HtmlEditor
              id="c-body-html"
              label="Message *"
              value={body}
              onChange={(v) => {
                setBody(v);
                setPreview(null);
              }}
              variables={variables}
            />
          ) : (
            <label className="ep-field" htmlFor="c-body">
              <span className="ep-field__label">Message *</span>
              <textarea
                id="c-body"
                className="ep-input"
                rows={6}
                maxLength={4000}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setPreview(null);
                }}
                placeholder="Goes into each template’s {{body}}"
              />
            </label>
          )}
          {smsText && on.sms ? (
            <p className="ep-field__help" aria-live="polite">
              {smsText.length} characters · about {smsText.units} SMS part
              {smsText.units === 1 ? '' : 's'} per number
              {smsText.unicode ? ' (Unicode: 70 characters a part)' : ''} plus the template text.
              The SMS text must match the DLT template.
            </p>
          ) : null}
          {on.email || on.whatsapp ? (
            <div className="ep-compose__files">
              <span className="ep-field__label">
                Attachments (PDF or image, up to {attachmentMaxMb} MB each; email and WhatsApp only)
              </span>
              {files.length ? (
                <ul className="ep-chips">
                  {files.map((f) => (
                    <li key={f.id} className="ep-chip">
                      {f.name} · {(f.size / 1024 / 1024).toFixed(1)} MB
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => setFiles(files.filter((x) => x.id !== f.id))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {files.length < 5 ? (
                <div className="ep-wd__form">
                  <label className="ep-field" htmlFor="c-file">
                    <span className="ep-sr-only">Choose an attachment</span>
                    <input
                      id="c-file"
                      ref={fileRef}
                      type="file"
                      className="ep-input"
                      accept="application/pdf,image/png,image/jpeg,image/webp"
                    />
                  </label>
                  <button
                    type="button"
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    disabled={busy === 'file'}
                    onClick={async () => {
                      const f = fileRef.current?.files?.[0];
                      if (!f) return;
                      if (f.size > attachmentMaxMb * 1024 * 1024) {
                        setError(`Each attachment can be at most ${String(attachmentMaxMb)} MB`);
                        return;
                      }
                      const fd = new FormData();
                      fd.set('file', f);
                      setBusy('file');
                      const r = await uploadAttachment(fd);
                      setBusy(null);
                      if (r.ok) {
                        setFiles([...files, r.data]);
                        if (fileRef.current) fileRef.current.value = '';
                      } else setError(r.error);
                    }}
                  >
                    {busy === 'file' ? 'Uploading…' : 'Attach'}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <aside className="ep-compose__side" aria-label="Preview and send">
        <div className="ep-card ep-compose__sticky">
          <h2 className="ep-card__title">Preview</h2>
          {error ? (
            <p className="ep-alert ep-alert--danger" role="alert">
              {error}
            </p>
          ) : null}
          {preview ? (
            <div aria-live="polite">
              <p>
                <strong>{preview.total}</strong> message{preview.total === 1 ? '' : 's'} to{' '}
                <strong>{preview.people}</strong> {preview.people === 1 ? 'person' : 'people'}
              </p>
              <table className="ep-compose__ptable">
                <thead>
                  <tr>
                    <th scope="col">Channel</th>
                    <th scope="col">Send</th>
                    <th scope="col">Skipped</th>
                    <th scope="col">Units</th>
                    <th scope="col">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(preview.byChannel).map(([c, v]) => (
                    <tr key={c}>
                      <th scope="row">{CHANNEL_LABEL[c as Channel]}</th>
                      <td>{v.send}</td>
                      <td>{v.skipped}</td>
                      <td>{v.units}</td>
                      <td>{money(v.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.skipped ? (
                <p className="ep-field__help">
                  Skipped:{' '}
                  {Object.entries(preview.skippedReasons)
                    .map(([k, v]) => `${String(v)} ${SKIP_LABEL[k] ?? k}`)
                    .join(', ')}
                </p>
              ) : null}
              {preview.quietHours ? (
                <p className="ep-field__help">
                  Quiet hours: general messages go out at{' '}
                  {new Date(preview.quietHours).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  .
                </p>
              ) : null}
              <p className={preview.needsApproval ? 'ep-compose__approval' : 'ep-field__help'}>
                {preview.needsApproval
                  ? 'Needs the principal’s approval before it goes out.'
                  : 'Goes out straight away (no approval needed).'}
              </p>
              {preview.rendered.map((r) => (
                <details key={r.channel} className="ep-compose__render">
                  <summary>
                    {CHANNEL_LABEL[r.channel as Channel]} as the first person sees it
                    {r.channel === 'sms'
                      ? ` · ${String(r.units)} part${r.units === 1 ? '' : 's'}`
                      : ''}
                  </summary>
                  {r.subject ? (
                    <p>
                      <strong>{r.subject}</strong>
                    </p>
                  ) : null}
                  <p className="ep-compose__text">{r.text}</p>
                </details>
              ))}
              {preview.sample.length ? (
                <details className="ep-compose__render">
                  <summary>First recipients</summary>
                  <ul>
                    {preview.sample.map((s, i) => (
                      <li key={i}>
                        {CHANNEL_LABEL[s.channel as Channel]} · {s.name} · {s.address}
                        {s.student ? ` · ${s.student}` : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : (
            <p className="ep-field__help">
              Check who is reached, the SMS units and the cost before sending.
            </p>
          )}
          <div className="ep-wdset__actions">
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              disabled={busy !== null}
              onClick={() => void run('preview')}
            >
              {busy === 'preview' ? 'Checking…' : 'Preview'}
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={busy !== null || !preview || preview.total === 0}
              onClick={() => void run('send')}
            >
              {busy === 'send' ? 'Sending…' : preview?.needsApproval ? 'Send for approval' : 'Send'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
