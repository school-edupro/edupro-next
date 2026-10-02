'use client';
import { useEffect, useRef, useState } from 'react';
import { deleteTemplate, previewTemplate, saveTemplate } from '@/lib/comms-actions';
import {
  CHANNEL_LABEL,
  smsParts,
  type Channel,
  type CommsTemplate,
  type TemplatePreview,
  type TemplateVariable,
} from '@/lib/comms';
import { HtmlEditor } from './HtmlEditor';

const LANGUAGES = [
  ['en', 'English'],
  ['en_US', 'English (US)'],
  ['hi', 'Hindi'],
  ['mr', 'Marathi'],
  ['gu', 'Gujarati'],
  ['bn', 'Bengali'],
  ['ta', 'Tamil'],
  ['te', 'Telugu'],
  ['kn', 'Kannada'],
  ['ml', 'Malayalam'],
  ['pa', 'Punjabi'],
] as const;

const codeOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, 't_$1')
    .slice(0, 60);

/**
 * Template master editor (communication v2). SMS: DLT content template id, entity id and sender id,
 * with a unit meter (Hindi counts as Unicode). WhatsApp: the name and language Meta approved, the
 * variable behind each {{1}}, {{2}}..., and the header type. Email: subject and an HTML body written
 * in the editor. Every channel has a variable picker and a live preview with sample values.
 */
export function TemplateEditor({
  template,
  channel: newChannel,
  variables,
  canManage,
  takenCodes = [],
}: {
  template: CommsTemplate | null;
  channel: Channel;
  variables: TemplateVariable[];
  canManage: boolean;
  /** codes already used by templates of this channel (a new template's code must differ) */
  takenCodes?: string[];
}) {
  const channel = (template?.channel as Channel | undefined) ?? newChannel;
  const [name, setName] = useState(template?.name ?? '');
  const [code, setCode] = useState(template?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(Boolean(template));
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [format, setFormat] = useState<'text' | 'html'>(
    template?.format ?? (channel === 'email' ? 'html' : 'text'),
  );
  const [category, setCategory] = useState(template?.category ?? 'general');
  const [dlt, setDlt] = useState(template?.dltTemplateId ?? '');
  const [entity, setEntity] = useState(template?.dltEntityId ?? '');
  const [sender, setSender] = useState(template?.senderId ?? '');
  const [waName, setWaName] = useState(template?.waTemplateName ?? '');
  const [waLang, setWaLang] = useState(template?.waLanguage ?? 'en');
  const [waParams, setWaParams] = useState<string[]>(template?.waParams ?? []);
  const [waHeader, setWaHeader] = useState(template?.waHeader ?? 'none');
  const [status, setStatus] = useState(template?.status ?? 'active');
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const msgRef = useRef<HTMLParagraphElement>(null);
  const taken = new Set(takenCodes);
  /** the code from the name, made unique among this channel's templates (fee_due, fee_due_2...) */
  const freeCode = (base: string) => {
    if (!base || !taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}_${String(n)}`)) n += 1;
    return `${base}_${String(n)}`.slice(0, 60);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if (!body.trim()) {
        setPreview(null);
        return;
      }
      void previewTemplate({ channel, subject, body, format }).then((r) => {
        if (r.ok) setPreview(r.data);
      });
    }, 500);
    return () => clearTimeout(t);
  }, [channel, subject, body, format]);

  const insert = (key: string) => {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  /** What still needs filling in before the template can be saved, in plain words. */
  const problems = (): string[] => {
    const out: string[] = [];
    if (name.trim().length < 2) out.push('Enter a name (at least 2 characters)');
    if (!template) {
      if (!/^[a-z][a-z0-9_]{1,59}$/.test(code))
        out.push(
          'Code: lower-case letters, digits and _ only, starting with a letter (e.g. fee_reminder)',
        );
      else if (taken.has(code))
        out.push(`Code "${code}" is already used by another ${CHANNEL_LABEL[channel]} template`);
    }
    if (channel === 'sms') {
      if (!dlt.trim()) out.push('Enter the DLT content template id (from your DLT portal)');
      else if (!/^\d{6,30}$/.test(dlt.trim())) out.push('DLT content template id: digits only');
      if (entity && !/^\d{6,30}$/.test(entity.trim())) out.push('Principal entity id: digits only');
    }
    if (channel === 'email' && !subject.trim()) out.push('Enter the email subject');
    if (!body.trim()) out.push(channel === 'email' ? 'Write the email body' : 'Write the text');
    if (channel === 'whatsapp' && waParams.some((p) => !p))
      out.push('Choose a variable for every WhatsApp parameter, or remove the empty one');
    return out;
  };

  const showMsg = (m: { ok: boolean; text: string }) => {
    setMsg(m);
    requestAnimationFrame(() =>
      msgRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
  };

  const save = async () => {
    const missing = problems();
    if (missing.length) {
      showMsg({ ok: false, text: missing.join(' · ') });
      return;
    }
    setBusy(true);
    setMsg(null);
    const common = {
      name,
      subject: channel === 'email' ? subject : undefined,
      body,
      format: channel === 'email' ? format : 'text',
      category,
      ...(channel === 'sms'
        ? {
            dltTemplateId: dlt.trim(),
            dltEntityId: entity.trim() || undefined,
            senderId: sender || undefined,
          }
        : {}),
      ...(channel === 'email' ? { senderId: sender || undefined } : {}),
      ...(channel === 'whatsapp'
        ? {
            waTemplateName: waName,
            waLanguage: waLang,
            waParams: waParams.filter(Boolean),
            waHeader,
          }
        : {}),
    };
    const r = await saveTemplate(
      template?.id ?? null,
      template ? { ...common, status } : { ...common, code, channel },
    );
    setBusy(false);
    if (!r.ok) showMsg({ ok: false, text: [r.error, ...(r.errors ?? [])].join(' · ') });
    else if (!template) window.location.href = `/comms/templates/${r.data.id}?ok=1`;
    else showMsg({ ok: true, text: 'Saved.' });
  };

  const meter = channel === 'sms' && body ? smsParts(preview?.text ?? body) : null;
  const vars = variables.filter((v) => v.key !== 'subject');
  const disabled = !canManage;

  return (
    <div className="ep-tpl">
      <div className="ep-tpl__form ep-card">
        <div className="ep-wd__form">
          <label className="ep-field ep-wd__wide" htmlFor="t-name">
            <span className="ep-field__label">Name *</span>
            <input
              id="t-name"
              className="ep-input"
              maxLength={120}
              value={name}
              disabled={disabled}
              onChange={(e) => {
                setName(e.target.value);
                if (!codeTouched) setCode(freeCode(codeOf(e.target.value)));
              }}
              placeholder={`e.g. Fee reminder (${CHANNEL_LABEL[channel]})`}
            />
          </label>
          <label className="ep-field" htmlFor="t-code">
            <span className="ep-field__label">Code *</span>
            <input
              id="t-code"
              className="ep-input"
              value={code}
              disabled={Boolean(template) || disabled}
              pattern="[a-z][a-z0-9_]{1,59}"
              onChange={(e) => {
                setCode(e.target.value);
                setCodeTouched(true);
              }}
            />
          </label>
          <label className="ep-field" htmlFor="t-cat">
            <span className="ep-field__label">Type</span>
            <select
              id="t-cat"
              className="ep-select"
              value={category}
              disabled={disabled}
              onChange={(e) => setCategory(e.target.value as 'service' | 'general')}
            >
              <option value="general">General</option>
              <option value="service">Important (fees, attendance, safety)</option>
            </select>
          </label>
          {template ? (
            <label className="ep-field" htmlFor="t-status">
              <span className="ep-field__label">Status</span>
              <select
                id="t-status"
                className="ep-select"
                value={status}
                disabled={disabled}
                onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          ) : null}
        </div>

        {channel === 'sms' ? (
          <fieldset className="ep-tpl__group">
            <legend className="ep-field__label">DLT registration (TRAI)</legend>
            <div className="ep-wd__form">
              <label className="ep-field" htmlFor="t-dlt">
                <span className="ep-field__label">DLT content template id *</span>
                <input
                  id="t-dlt"
                  className="ep-input"
                  inputMode="numeric"
                  maxLength={40}
                  value={dlt}
                  disabled={disabled}
                  onChange={(e) => setDlt(e.target.value.trim())}
                />
              </label>
              <label className="ep-field" htmlFor="t-entity">
                <span className="ep-field__label">Principal entity id</span>
                <input
                  id="t-entity"
                  className="ep-input"
                  inputMode="numeric"
                  maxLength={40}
                  value={entity}
                  disabled={disabled}
                  onChange={(e) => setEntity(e.target.value.trim())}
                />
              </label>
              <label className="ep-field" htmlFor="t-sender">
                <span className="ep-field__label">Sender id (header)</span>
                <input
                  id="t-sender"
                  className="ep-input"
                  maxLength={11}
                  value={sender}
                  disabled={disabled}
                  onChange={(e) => setSender(e.target.value.toUpperCase())}
                  placeholder="e.g. ALPHAS"
                />
              </label>
            </div>
            <p className="ep-field__help">
              The text must match the template registered on DLT word for word; only the{' '}
              {'{{variables}}'} change.
            </p>
          </fieldset>
        ) : null}

        {channel === 'whatsapp' ? (
          <fieldset className="ep-tpl__group">
            <legend className="ep-field__label">Approved by Meta</legend>
            <div className="ep-wd__form">
              <label className="ep-field" htmlFor="t-wa">
                <span className="ep-field__label">Template name *</span>
                <input
                  id="t-wa"
                  className="ep-input"
                  maxLength={120}
                  value={waName}
                  disabled={disabled}
                  onChange={(e) => setWaName(e.target.value.toLowerCase())}
                  placeholder="e.g. school_circular"
                />
              </label>
              <label className="ep-field" htmlFor="t-lang">
                <span className="ep-field__label">Language</span>
                <select
                  id="t-lang"
                  className="ep-select"
                  value={waLang}
                  disabled={disabled}
                  onChange={(e) => setWaLang(e.target.value)}
                >
                  {LANGUAGES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l} ({v})
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="t-header">
                <span className="ep-field__label">Header</span>
                <select
                  id="t-header"
                  className="ep-select"
                  value={waHeader}
                  disabled={disabled}
                  onChange={(e) =>
                    setWaHeader(e.target.value as 'none' | 'text' | 'image' | 'document')
                  }
                >
                  <option value="none">None</option>
                  <option value="text">Text</option>
                  <option value="document">Document (PDF attachment)</option>
                  <option value="image">Image (attachment)</option>
                </select>
              </label>
            </div>
            <div className="ep-tpl__params">
              <span className="ep-field__label">Parameters in Meta’s order</span>
              {waParams.map((p, i) => (
                <label key={i} className="ep-tpl__param" htmlFor={`t-p-${String(i)}`}>
                  <span>{`{{${String(i + 1)}}}`}</span>
                  <select
                    id={`t-p-${String(i)}`}
                    className="ep-select"
                    value={p}
                    disabled={disabled}
                    onChange={(e) =>
                      setWaParams(waParams.map((x, j) => (j === i ? e.target.value : x)))
                    }
                  >
                    <option value="">Choose…</option>
                    {vars.map((v) => (
                      <option key={v.key} value={v.key}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    aria-label={`Remove parameter ${String(i + 1)}`}
                    disabled={disabled}
                    onClick={() => setWaParams(waParams.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </label>
              ))}
              <button
                type="button"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                disabled={disabled || waParams.length >= 20}
                onClick={() => setWaParams([...waParams, ''])}
              >
                Add parameter
              </button>
            </div>
          </fieldset>
        ) : null}

        {channel === 'email' ? (
          <div className="ep-wd__form">
            <label className="ep-field ep-wd__wide" htmlFor="t-subject">
              <span className="ep-field__label">Subject *</span>
              <input
                id="t-subject"
                className="ep-input"
                maxLength={200}
                value={subject}
                disabled={disabled}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. {{title}} – {{school}}"
              />
            </label>
            <label className="ep-field" htmlFor="t-from">
              <span className="ep-field__label">From address (optional)</span>
              <input
                id="t-from"
                className="ep-input"
                maxLength={120}
                value={sender}
                disabled={disabled}
                onChange={(e) => setSender(e.target.value)}
                placeholder="School office <office@school.in>"
              />
            </label>
            <label className="ep-roles__tick" htmlFor="t-format">
              <input
                id="t-format"
                type="checkbox"
                checked={format === 'html'}
                disabled={disabled}
                onChange={(e) => setFormat(e.target.checked ? 'html' : 'text')}
              />{' '}
              HTML editor
            </label>
          </div>
        ) : null}

        {channel === 'email' && format === 'html' ? (
          <HtmlEditor
            id="t-body-html"
            label="Email body *"
            value={body}
            onChange={setBody}
            variables={vars}
          />
        ) : (
          <>
            <label className="ep-field" htmlFor="t-body">
              <span className="ep-field__label">Text *</span>
              <textarea
                id="t-body"
                ref={bodyRef}
                className="ep-input"
                rows={7}
                maxLength={4000}
                value={body}
                disabled={disabled}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <div className="ep-tpl__vars" aria-label="Insert a variable">
              {vars.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className="ep-chip ep-tpl__var"
                  title={v.label}
                  disabled={disabled}
                  onClick={() => insert(v.key)}
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          </>
        )}
        {meter ? (
          <p className="ep-field__help" aria-live="polite">
            {meter.length} characters · {meter.units} SMS part{meter.units === 1 ? '' : 's'}
            {meter.unicode ? ' · Unicode (Hindi or special characters: 70 a part)' : ''} with sample
            values
          </p>
        ) : null}
        {msg ? (
          <p
            ref={msgRef}
            className={msg.ok ? 'ep-alert ep-alert--success' : 'ep-alert ep-alert--danger'}
            role={msg.ok ? 'status' : 'alert'}
          >
            {msg.text}
          </p>
        ) : null}
        {canManage ? (
          <div className="ep-wdset__actions">
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : template ? 'Save' : 'Create template'}
            </button>
            {template ? (
              <button
                type="button"
                className="ep-btn ep-btn--ghost"
                onClick={async () => {
                  if (!window.confirm('Delete this template? Sent messages keep their text.'))
                    return;
                  const r = await deleteTemplate(template.id);
                  if (r.ok) window.location.href = '/comms/templates?ok=1';
                  else setMsg({ ok: false, text: r.error });
                }}
              >
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <aside className="ep-card ep-tpl__preview" aria-label="Preview with sample values">
        <h2 className="ep-card__title">Preview</h2>
        {preview ? (
          <>
            {preview.subject ? (
              <p>
                <strong>{preview.subject}</strong>
              </p>
            ) : null}
            {preview.html ? (
              <iframe
                className="ep-tpl__frame"
                title="Email preview"
                sandbox=""
                srcDoc={preview.html}
              />
            ) : (
              <p className={channel === 'whatsapp' ? 'ep-tpl__bubble' : 'ep-compose__text'}>
                {preview.text}
              </p>
            )}
            {preview.unknownVariables.length ? (
              <p className="ep-alert ep-alert--warning">
                Not a known variable: {preview.unknownVariables.map((v) => `{{${v}}}`).join(', ')}.
                It stays empty unless the send supplies it (e.g. an Excel column).
              </p>
            ) : null}
          </>
        ) : (
          <p className="ep-field__help">Type the text to see it with sample values.</p>
        )}
      </aside>
    </div>
  );
}
