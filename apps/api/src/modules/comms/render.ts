/** Template placeholders look like {{student_name}}. Names are snake or camel case identifiers. */
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export function extractVariables(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER)) names.add(m[1]!);
  return [...names];
}

export type TemplateValue = string | number | boolean;

export function renderTemplate(
  text: string,
  values: Record<string, TemplateValue>,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(PLACEHOLDER, (_m, name: string) => {
    const v = values[name];
    if (v === undefined || v === null) {
      missing.push(name);
      return '';
    }
    return String(v);
  });
  return { text: out, missing: [...new Set(missing)] };
}

/** Bulk sends fill a variable the person does not have (an employee's {{fee_due}}) with nothing. */
export function renderLenient(
  text: string,
  values: Record<string, TemplateValue | null | undefined>,
  escape?: (v: string) => string,
): string {
  return text.replace(PLACEHOLDER, (_m, name: string) => {
    const v = values[name];
    if (v === undefined || v === null) return '';
    return escape ? escape(String(v)) : String(v);
  });
}

export const escapeHtml = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain compose text inside an HTML template: escaped, line breaks kept. */
export const textToHtml = (v: string): string => escapeHtml(v).replace(/\r?\n/g, '<br>');

/** The text part of an HTML email (and the preview in the delivery log). */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// GSM 03.38 basic set and extension (extension characters count twice)
const GSM =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';

/**
 * SMS parts the operator bills: 160 / 153 characters per part in GSM, 70 / 67 when any character
 * (Hindi, ₹, curly quotes) needs Unicode.
 */
export function smsUnits(text: string): { units: number; unicode: boolean; length: number } {
  let gsmLength = 0;
  let unicode = false;
  for (const ch of text) {
    if (GSM.includes(ch)) gsmLength += 1;
    else if (GSM_EXT.includes(ch)) gsmLength += 2;
    else {
      unicode = true;
      break;
    }
  }
  const length = unicode ? [...text].length : gsmLength;
  const [single, multi] = unicode ? [70, 67] : [160, 153];
  const units = length <= single ? 1 : Math.ceil(length / multi);
  return { units: Math.max(1, units), unicode, length };
}
