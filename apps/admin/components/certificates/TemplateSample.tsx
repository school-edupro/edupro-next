'use client';
import { useEffect, useState } from 'react';
import { fitPaper } from '@/lib/certificates';

/**
 * A saved certificate layout as it prints, with a sample from the school (the templates list's "See"). Fetched when
 * shown, so the list itself stays light.
 */
export function TemplateSample({ id, name }: { id: string; name: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/certificates-template-preview?id=${encodeURIComponent(id)}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = (await r.json()) as { html?: string; landscape?: boolean; detail?: string };
        if (!r.ok || !j.html) {
          setError(j.detail ?? 'The layout could not be shown');
          return;
        }
        setWide(!!j.landscape);
        setHtml(j.html);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError')
          setError('The layout could not be shown');
      });
    return () => ctl.abort();
  }, [id]);
  if (error)
    return (
      <div className="ep-alert ep-alert--warning" role="alert">
        {error}
      </div>
    );
  if (!html)
    return (
      <p className="ep-field__help" role="status">
        Making the picture…
      </p>
    );
  return (
    <iframe
      title={`How ${name} prints`}
      className="ep-cert-preview ep-ctpl__sample"
      sandbox=""
      srcDoc={fitPaper(html, wide ? 1130 : 800)}
    />
  );
}
