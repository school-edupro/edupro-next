/**
 * Document template engine (S7-01). A deliberately small, dependency-free subset of Mustache:
 *   {{path.to.value}}            HTML-escaped value ("" when missing)
 *   {{#if path}} ... {{else}} ... {{/if}}
 *   {{#each path}} ... {{this}} / {{name}} ... {{/each}}
 * Templates are authored by school administrators, so the engine never evaluates code and always
 * escapes values; the surrounding HTML and CSS of the template itself are trusted admin content.
 */
export type TemplateData = Record<string, unknown>;

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function lookup(path: string, scopes: TemplateData[]): unknown {
  const trimmed = path.trim();
  if (trimmed === 'this') return scopes[scopes.length - 1];
  const parts = trimmed.split('.');
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    let cur: unknown = scopes[i];
    let found = true;
    for (const p of parts) {
      if (cur !== null && typeof cur === 'object' && p in (cur as object))
        cur = (cur as Record<string, unknown>)[p];
      else {
        found = false;
        break;
      }
    }
    if (found) return cur;
  }
  return undefined;
}

const truthy = (v: unknown): boolean =>
  Array.isArray(v)
    ? v.length > 0
    : v !== undefined && v !== null && v !== false && v !== '' && v !== 0;

const BLOCK = /{{#(if|each)\s+([\w.]+)\s*}}((?:(?!{{#(?:if|each)\b)[\s\S])*?){{\/\1}}/;

function renderScoped(src: string, scopes: TemplateData[]): string {
  let out = src;
  // innermost blocks first: the pattern refuses nested openers inside its body
  for (let guard = 0; guard < 1000; guard += 1) {
    const m = BLOCK.exec(out);
    if (!m) break;
    const [whole, kind, path, body] = m as unknown as [string, string, string, string];
    let replacement = '';
    const value = lookup(path, scopes);
    if (kind === 'if') {
      const [yes, no = ''] = body.split(/{{else}}/);
      replacement = truthy(value) ? renderScoped(yes ?? '', scopes) : renderScoped(no, scopes);
    } else if (Array.isArray(value)) {
      replacement = value
        .map((item, index) =>
          renderScoped(body, [
            ...scopes,
            typeof item === 'object' && item !== null
              ? { ...(item as TemplateData), index: index + 1 }
              : { this: item, index: index + 1 },
          ]),
        )
        .join('');
    }
    out = out.slice(0, m.index) + replacement + out.slice(m.index + whole.length);
  }
  return out.replace(/{{\s*([\w.]+)\s*}}/g, (_, path: string) => {
    const v = lookup(path, scopes);
    if (path === 'this') {
      const top = scopes[scopes.length - 1];
      return esc(top && typeof top === 'object' && 'this' in top ? top.this : v);
    }
    return esc(v);
  });
}

export function renderTemplate(body: string, data: TemplateData): string {
  return renderScoped(body, [data]);
}

/** Wraps a rendered body in a printable page with the template's CSS and page size. */
export function documentHtml(opts: {
  body: string;
  css: string;
  pageWidth: string;
  pageHeight: string;
}): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: ${opts.pageWidth} ${opts.pageHeight}; margin: 0; }
  html, body { margin: 0; padding: 0; font-family: "Source Sans 3", "Noto Sans Devanagari", Arial, sans-serif; color: #1F2933; }
  .page { width: ${opts.pageWidth}; min-height: ${opts.pageHeight}; box-sizing: border-box; padding: 18mm 16mm; }
  ${opts.css}
  </style></head><body><div class="page">${opts.body}</div></body></html>`;
}

/** Placeholders present in a template body, for the editor's variable list. */
export function templatePlaceholders(body: string): string[] {
  const names = new Set<string>();
  for (const m of body.matchAll(/{{\s*#?(?:if|each)?\s*([\w.]+)\s*}}/g)) {
    const name = m[1]!;
    if (!['if', 'each', 'else', 'this'].includes(name)) names.add(name);
  }
  return [...names].sort();
}
