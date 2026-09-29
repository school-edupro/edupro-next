/**
 * Sprint 22: a small Markdown-to-HTML renderer for the help centre (headings, paragraphs, bullet and
 * numbered lists, tables, bold, italics, inline code, links). Everything is HTML-escaped first; links
 * are only allowed to http(s), mailto and same-app paths, so the output is safe to set as innerHTML.
 */
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

function inline(text: string): string {
  let out = esc(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)]|$)/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const safe = /^(https?:\/\/|mailto:|\/|#)/.test(href) ? href : '#';
    const target = safe.startsWith('http') ? ' target="_blank" rel="noreferrer"' : '';
    return `<a href="${safe.replace(/\.md$/, '')}"${target}>${label}</a>`;
  });
  return out;
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;
  const flushPara = (buf: string[]) => {
    if (buf.length) html.push(`<p>${inline(buf.join(' '))}</p>`);
    buf.length = 0;
  };
  const para: string[] = [];
  while (i < lines.length) {
    const line = lines[i]!;
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(para);
      const level = h[1]!.length;
      const id = h[2]!
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      html.push(`<h${level} id="${id}">${inline(h[2]!)}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flushPara(para);
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) {
        const cells = lines[i]!.trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i += 1;
      }
      const [head, ...body] = rows;
      html.push(
        `<table class="ep-table ep-table--dense"><thead><tr>${(head ?? []).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      flushPara(para);
      const ordered = /\d+\./.test(li[2]!);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]!);
        if (m) {
          items.push(m[3]!);
          i += 1;
        } else if (/^\s{2,}\S/.test(lines[i]!) && items.length) {
          items[items.length - 1] += ` ${lines[i]!.trim()}`;
          i += 1;
        } else break;
      }
      html.push(
        `<${ordered ? 'ol' : 'ul'}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`,
      );
      continue;
    }
    if (line.trim() === '') {
      flushPara(para);
      i += 1;
      continue;
    }
    para.push(line.trim());
    i += 1;
  }
  flushPara(para);
  return html.join('\n');
}

/** The first H1 of a page, for titles and the index. */
export function markdownTitle(md: string): string {
  const m = /^#\s+(.*)$/m.exec(md);
  return m ? m[1]!.trim() : 'Help';
}
