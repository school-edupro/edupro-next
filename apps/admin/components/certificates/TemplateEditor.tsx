'use client';
import { useEffect, useRef, useState } from 'react';
import { PAGE_SIZES, fitPaper, type CertificateTemplateDetail } from '@/lib/certificates';

/**
 * The certificate template editor (docs/design/87, phase B): the name and page, the body (HTML with {{placeholders}}
 * and EduPro's {{{blocks}}}) and the styles; the field list inserts a placeholder where the cursor is; the preview shows
 * the paper as it would print, with a sample student or employee, a moment after each change. Save makes a new version.
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
  const area = useRef<HTMLTextAreaElement>(null);
  const changed =
    body !== t.bodyHtml ||
    css !== t.stylesCss ||
    name !== t.name ||
    page !== pageOf(t.pageWidth, t.pageHeight);

  useEffect(() => {
    if (!t.forType) return;
    const size = PAGE_SIZES.find((p) => p.value === page) ?? PAGE_SIZES[0]!;
    const ctl = new AbortController();
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
    }, 700);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [body, css, page, t.forType]);

  const insert = (token: string) => {
    const el = area.current;
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

  return (
    <form action={action} className="ep-tpl">
      <input type="hidden" name="id" value={t.id} />
      <input type="hidden" name="type" value={t.forType ?? ''} />
      <div className="ep-tpl__edit">
        <div className="ep-tpl__row">
          <label className="ep-field" htmlFor="tplName">
            <span className="ep-field__label">Name</span>
            <input
              id="tplName"
              name="name"
              className="ep-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label className="ep-field" htmlFor="tplPage">
            <span className="ep-field__label">Page</span>
            <select
              id="tplPage"
              name="page"
              className="ep-input"
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
        <label className="ep-field" htmlFor="tplBody">
          <span className="ep-field__label">The certificate (HTML)</span>
          <textarea
            id="tplBody"
            ref={area}
            name="bodyHtml"
            className="ep-input ep-tpl__code"
            rows={18}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            required
          />
          <span className="ep-field__help">
            Text and tables with placeholders; no scripts or outside addresses (images as data
            only).
          </span>
        </label>
        <details className="ep-tpl__css">
          <summary>Styles (CSS)</summary>
          <label className="ep-field" htmlFor="tplCss">
            <span className="ep-field__label">Styles</span>
            <textarea
              id="tplCss"
              name="stylesCss"
              className="ep-input ep-tpl__code"
              rows={10}
              value={css}
              onChange={(e) => setCss(e.target.value)}
              spellCheck={false}
            />
          </label>
        </details>
        <div
          style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <button type="submit" className="ep-btn ep-btn--primary" disabled={!changed}>
            Save as version {t.version + 1}
          </button>
          <span className="ep-field__help" style={{ margin: 0 }}>
            {changed
              ? 'Not saved yet. Certificates already issued keep the version they were made with.'
              : `Version ${String(t.version)}`}
          </span>
        </div>
        <section className="ep-tpl__fields" aria-labelledby="tplFields">
          <h3 id="tplFields" className="ep-tpl__h">
            Field list
          </h3>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Click a field to put it where the cursor is.
          </p>
          {t.catalogue.map((g) => (
            <details key={g.group} className="ep-tpl__group" open={g.group.startsWith('Blocks')}>
              <summary>{g.group}</summary>
              <ul>
                {g.items.map((i) => (
                  <li key={i.token}>
                    <button
                      type="button"
                      className="ep-tpl__token"
                      onClick={() => insert(i.token)}
                      title={`Insert ${i.token}`}
                    >
                      <code>{i.token}</code>
                      <span>{i.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      </div>
      <section className="ep-tpl__preview" aria-labelledby="tplPreview">
        <h3 id="tplPreview" className="ep-tpl__h">
          Preview{' '}
          <span className="ep-field__help" role="status" aria-live="polite" style={{ margin: 0 }}>
            {state === 'busy'
              ? 'updating…'
              : state === 'error'
                ? ''
                : 'with a sample from the school'}
          </span>
        </h3>
        {error ? (
          <div className="ep-alert ep-alert--warning" role="alert">
            {error}
          </div>
        ) : null}
        {html ? (
          <iframe
            title={`Preview of ${name}`}
            className="ep-cert-preview"
            sandbox=""
            srcDoc={fitPaper(html, page.endsWith('l') ? 1130 : 800)}
          />
        ) : !error ? (
          <p className="ep-field__help">Making the preview…</p>
        ) : null}
      </section>
    </form>
  );
}
