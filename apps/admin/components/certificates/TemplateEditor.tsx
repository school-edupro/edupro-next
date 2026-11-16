'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/nav-icons';
import { PAGE_SIZES, fitPaper, type CertificateTemplateDetail } from '@/lib/certificates';

type Group = CertificateTemplateDetail['catalogue'][number];

/** EduPro's blocks as short button names. */
const BLOCK_LABEL: Record<string, string> = {
  '{{{blocks.letterhead}}}': 'Letterhead',
  '{{{blocks.signatures}}}': 'Signature boxes',
  '{{{blocks.duplicate}}}': 'DUPLICATE mark',
  '{{{blocks.footer}}}': 'Footer: number and QR',
};

/**
 * "Insert a detail": every detail a certificate can print, by its plain name, with a search; the chosen one goes where
 * the cursor is in the wording.
 */
function DetailPicker({ groups, onPick }: { groups: Group[]; onPick: (token: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) => !k || i.label.toLowerCase().includes(k) || i.token.toLowerCase().includes(k),
        ),
      }))
      .filter((g) => g.items.length);
  }, [groups, q]);
  return (
    <div
      className="ep-ctpl__picker"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="ep-btn ep-btn--secondary ep-btn--sm"
        aria-expanded={open}
        aria-controls="tplDetails"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="plus" size={16} /> Insert a detail
      </button>
      {open ? (
        <div id="tplDetails" className="ep-ctpl__panel">
          <div className="ep-ctpl__panelhead">
            <label className="ep-field" htmlFor="tplDetailSearch" style={{ margin: 0, flex: 1 }}>
              <span className="ep-sr-only">Find a detail</span>
              <input
                id="tplDetailSearch"
                ref={search}
                type="search"
                className="ep-input"
                placeholder="Find a detail, e.g. father, class, date"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
          <div className="ep-ctpl__list">
            {shown.length ? (
              shown.map((g) => (
                <section key={g.group} aria-label={g.group}>
                  <p className="ep-ctpl__group">{g.group}</p>
                  <ul>
                    {g.items.map((i) => (
                      <li key={i.token}>
                        <button
                          type="button"
                          className="ep-ctpl__item"
                          onClick={() => {
                            onPick(i.token);
                            setOpen(false);
                            setQ('');
                          }}
                        >
                          <span>{i.label}</span>
                          <code>{i.token}</code>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            ) : (
              <p className="ep-field__help">No detail matches.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The certificate template editor (docs/design/87; rebuilt 16 Nov 2026): the paper as it prints, large and in view,
 * with a sample of the chosen type; beside it the name, the paper and the wording, with "Insert a detail" (plain names,
 * searchable), EduPro's blocks and simple formatting as buttons; the styles under Advanced; one Save bar. A save is a
 * new version: certificates already issued keep theirs.
 */
export function TemplateEditor({
  t,
  action,
}: {
  t: CertificateTemplateDetail;
  action: (fd: FormData) => void | Promise<void>;
}) {
  const pageOf = (w: string, h: string) =>
    PAGE_SIZES.find((p) => p.w === w && p.h === h)?.value ?? 'a4p';
  const [name, setName] = useState(t.name);
  const [page, setPage] = useState(pageOf(t.pageWidth, t.pageHeight));
  const [body, setBody] = useState(t.bodyHtml);
  const [css, setCss] = useState(t.stylesCss);
  const [html, setHtml] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const first = useRef(true);
  const changed =
    body !== t.bodyHtml ||
    css !== t.stylesCss ||
    name !== t.name ||
    page !== pageOf(t.pageWidth, t.pageHeight);
  const blocks = t.catalogue.find((g) => g.group.startsWith('Blocks'))?.items ?? [];
  const details = t.catalogue.filter((g) => !g.group.startsWith('Blocks'));

  // leaving with unsaved changes asks first
  useEffect(() => {
    if (!changed || saving) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed, saving]);

  useEffect(() => {
    if (!t.forType) return;
    const size = PAGE_SIZES.find((p) => p.value === page) ?? PAGE_SIZES[0]!;
    const ctl = new AbortController();
    // the first picture at once; then a moment after the typing stops
    const wait = first.current ? 0 : 700;
    first.current = false;
    const timer = setTimeout(() => {
      setState('busy');
      fetch('/api/certificates-template-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          typeCode: t.forType,
          pageWidth: size.w,
          pageHeight: size.h,
          bodyHtml: body || ' ',
          stylesCss: css,
        }),
        signal: ctl.signal,
      })
        .then(async (r) => {
          const j = (await r.json()) as { html?: string; detail?: string };
          if (!r.ok || !j.html) {
            setState('error');
            setError(j.detail ?? 'The preview could not be made');
            return;
          }
          setHtml(j.html);
          setError(null);
          setState('idle');
        })
        .catch((e: unknown) => {
          if ((e as { name?: string }).name === 'AbortError') return;
          setState('error');
          setError('The preview could not be made');
        });
    }, wait);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [body, css, page, t.forType]);

  /** Puts text where the cursor is (or around the selection, when `after` is given). */
  const put = (before: string, after = '') => {
    const el = area.current;
    if (!el) {
      setBody((b) => b + before + after);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + before + body.slice(start, end) + after + body.slice(end);
    setBody(next);
    const caret = after ? end + before.length : start + before.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const sampleOf = (code: string) => {
    if (code === t.forType) return;
    if (changed && !window.confirm('Your changes are not saved. Leave them and change the sample?'))
      return;
    setSaving(true);
    window.location.href = `/certificates/setup/templates/${t.id}?type=${encodeURIComponent(code)}`;
  };

  return (
    <form action={action} className="ep-ctpl" onSubmit={() => setSaving(true)}>
      <input type="hidden" name="id" value={t.id} />
      <input type="hidden" name="type" value={t.forType ?? ''} />
      <div className="ep-ctpl__edit">
        <div className="ep-cert-fields">
          <label className="ep-field" htmlFor="tplName">
            <span className="ep-field__label">Name *</span>
            <input
              id="tplName"
              name="name"
              className="ep-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
            <span className="ep-field__help">How the layout is called in the lists.</span>
          </label>
          <label className="ep-field" htmlFor="tplPage">
            <span className="ep-field__label">Paper</span>
            <select
              id="tplPage"
              name="page"
              className="ep-select"
              value={page}
              onChange={(e) => setPage(e.target.value)}
            >
              {PAGE_SIZES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <section className="ep-ctpl__wording" aria-labelledby="tplWording">
          <h3 id="tplWording" className="ep-tpl__h">
            Wording
          </h3>
          <p className="ep-ctype__note">
            What prints on the paper. Words in <code>{'{{ }}'}</code> are filled in for each
            certificate: put the cursor where one should go, then insert it.
          </p>
          <div className="ep-ctpl__tools" role="toolbar" aria-label="Insert into the wording">
            <DetailPicker groups={details} onPick={(token) => put(token)} />
            {blocks.map((b) => (
              <button
                key={b.token}
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                title={b.label}
                onClick={() => put(b.token)}
              >
                {BLOCK_LABEL[b.token] ?? b.label.split(':')[0]}
              </button>
            ))}
            <span className="ep-ctpl__sep" aria-hidden="true" />
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              title="Make the selected words bold"
              onClick={() => put('<strong>', '</strong>')}
            >
              <strong>B</strong>
              <span className="ep-sr-only"> Bold</span>
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              title="Start a new paragraph"
              onClick={() => put('\n<p>', '</p>')}
            >
              New paragraph
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              title="Break the line here"
              onClick={() => put('<br>')}
            >
              Line break
            </button>
          </div>
          <label className="ep-field" htmlFor="tplBody" style={{ margin: 0 }}>
            <span className="ep-sr-only">The wording, as the page&apos;s code</span>
            <textarea
              id="tplBody"
              ref={area}
              name="bodyHtml"
              className="ep-input ep-tpl__code"
              rows={20}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              spellCheck={false}
              required
            />
            <span className="ep-field__help">
              Text and tables; no scripts or outside addresses (images only as data).
            </span>
          </label>
        </section>
        <details className="ep-ctpl__adv">
          <summary>Advanced: styles (CSS)</summary>
          <label className="ep-field" htmlFor="tplCss" style={{ margin: 'var(--sp-2) 0 0' }}>
            <span className="ep-field__label">Styles</span>
            <textarea
              id="tplCss"
              name="stylesCss"
              className="ep-input ep-tpl__code"
              rows={12}
              value={css}
              onChange={(e) => setCss(e.target.value)}
              spellCheck={false}
            />
            <span className="ep-field__help">Sizes, fonts and spacing of the wording above.</span>
          </label>
        </details>
      </div>
      <section className="ep-ctpl__preview" aria-labelledby="tplPreview">
        <div className="ep-ctpl__previewhead">
          <h3 id="tplPreview" className="ep-tpl__h">
            How it prints
          </h3>
          <span className="ep-field__help" role="status" aria-live="polite" style={{ margin: 0 }}>
            {state === 'busy' ? 'Updating…' : state === 'error' ? '' : 'Up to date'}
          </span>
        </div>
        {t.types.length ? (
          <label className="ep-field ep-ctpl__sampleof" htmlFor="tplSample">
            <span className="ep-field__label">A sample of</span>
            <select
              id="tplSample"
              className="ep-select"
              value={t.forType ?? ''}
              onChange={(e) => sampleOf(e.target.value)}
            >
              {t.types.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.name}
                  {x.audience === 'STAFF' ? ' (staff)' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {error ? (
          <div className="ep-alert ep-alert--warning" role="alert">
            {error}
          </div>
        ) : null}
        {html ? (
          <iframe
            title={`How ${name} prints`}
            className="ep-cert-preview"
            data-paper={page.endsWith('l') ? 'landscape' : 'portrait'}
            sandbox=""
            srcDoc={fitPaper(html, page.endsWith('l') ? 1130 : 800)}
          />
        ) : !error ? (
          <p className="ep-field__help">Making the picture…</p>
        ) : null}
      </section>
      <div className="ep-form-actions ep-ctpl__save" data-sticky="true">
        <button type="submit" className="ep-btn ep-btn--primary" disabled={!changed}>
          Save changes
        </button>
        <span className="ep-field__help" style={{ margin: 0 }} role="status">
          {changed
            ? `Not saved yet. Saving makes version ${String(t.version + 1)}; certificates already issued keep theirs.`
            : `Nothing changed yet · version ${String(t.version)} in use`}
        </span>
      </div>
    </form>
  );
}
