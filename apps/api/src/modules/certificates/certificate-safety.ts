import { DomainError } from '../../common/errors/domain-error';

/**
 * A certificate template is HTML the school writes, rendered by the workers' browser into a PDF: it may hold text,
 * tables, images as data URIs and styles, but nothing that runs or reaches out — no scripts, frames, objects, event
 * handlers, javascript: links, style imports or addresses on the network (docs/design/87, phase B).
 */
const UNSAFE: Array<[RegExp, string]> = [
  [
    /<\s*(script|iframe|frame|object|embed|link|meta|base|form|input|button|svg\s[^>]*onload)\b/i,
    'a script, frame, form or embedded object',
  ],
  [/\son[a-z]+\s*=/i, 'an event handler (on…=)'],
  [/javascript\s*:/i, 'a javascript: link'],
  [/@import/i, 'a style import'],
  [
    /(src|href|action|poster|background)\s*=\s*["']?\s*(https?:|\/\/|ftp:|file:)/i,
    'an address on the network',
  ],
  [/url\(\s*["']?\s*(https?:|\/\/|ftp:|file:)/i, 'an address on the network in the styles'],
];

/** Refuses a template that would run code or reach the network; names what it found. */
export function assertSafeTemplate(bodyHtml: string, stylesCss: string): void {
  for (const [re, what] of UNSAFE) {
    if (re.test(bodyHtml) || re.test(stylesCss))
      throw new DomainError(
        'validation-failed',
        `The template holds ${what}; certificates may hold text, tables, styles and images as data only`,
        { status: 400 },
      );
  }
}
