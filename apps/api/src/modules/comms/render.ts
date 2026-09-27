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
