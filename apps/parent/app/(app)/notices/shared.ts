/** What the Notices screens of the parent app share. */
export interface Notice {
  id: string;
  kind: 'notice' | 'circular' | 'office_order';
  title: string;
  body: string;
  bodyFormat?: 'text' | 'html';
  ackRequired?: boolean;
  ackedFor?: string[];
  publishFrom: string;
  publishedBy?: string | null;
  isPinned: boolean;
  targets: Array<{ label: string }>;
  files: Array<{ id: string; name: string | null }>;
}

/** The first words of a notice, without its formatting, for the list. */
export const excerpt = (n: Notice, max = 180): string => {
  const text = (n.bodyFormat === 'html' ? n.body.replace(/<[^>]+>/g, ' ') : n.body)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
};

export const dayParts = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return {
    day: String(d.getUTCDate()).padStart(2, '0'),
    month: d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }),
    year: String(d.getUTCFullYear()),
  };
};
