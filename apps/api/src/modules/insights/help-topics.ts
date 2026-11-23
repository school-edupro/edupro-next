import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * docs/design/102: the help centre's pages as topics for the AI model — each `##` section of a page
 * (`apps/admin/content/help/*.md`, synced from docs/training) is one topic, offered only to staff whose rights the
 * page is about. The API build copies the pages to `dist/help`; in development they are read from the admin app.
 */
export interface HelpTopic {
  /** `<page>#<anchor>`, the anchor as the help centre makes it */
  id: string;
  page: string;
  pageTitle: string;
  title: string;
  text: string;
}

/** The rights a page is about (any one of them opens it); a page not listed is for every member of staff. */
const PAGE_RIGHTS: Record<string, readonly string[]> = {
  academics: ['academics.'],
  admissions: ['admissions.', 'application.'],
  attendance: ['attendance.'],
  certificates: ['certificate.'],
  communication: ['comms.'],
  engagement: ['engagement.', 'helpdesk.'],
  exams: ['exams.', 'marks.'],
  fees: ['fees.', 'payments.'],
  payroll: ['payroll.'],
  purchase: ['purchase.', 'store.'],
  students: ['people.'],
};

/** A topic's text is cut to this many characters. */
export const TOPIC_CHARS = 8000;

/** The help centre's heading anchor (apps/admin/lib/markdown.ts). */
export const anchorOf = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

function helpDir(): string | null {
  const tries = [
    process.env.HELP_DIR,
    // dist/modules/insights → dist/help (the API build)
    join(__dirname, '..', '..', 'help'),
    // src/modules/insights → apps/admin/content/help (development and tests)
    join(__dirname, '..', '..', '..', '..', 'admin', 'content', 'help'),
  ].filter((x): x is string => !!x);
  return tries.find((d) => existsSync(d)) ?? null;
}

let cache: HelpTopic[] | null = null;

/** Every page's sections (read once). */
export function allHelpTopics(): HelpTopic[] {
  if (cache) return cache;
  const dir = helpDir();
  const topics: HelpTopic[] = [];
  if (dir) {
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.md') || f === 'README.md') continue;
      const page = f.replace(/\.md$/, '');
      topics.push(...sectionsOf(page, readFileSync(join(dir, f), 'utf8')));
    }
  }
  cache = topics;
  return topics;
}

/** A page's `##` sections, each with the text under it (its `###` parts included). */
export function sectionsOf(page: string, md: string): HelpTopic[] {
  const lines = md.split('\n');
  const pageTitle = (lines.find((l) => /^#\s+/.test(l)) ?? page).replace(/^#\s+/, '').trim();
  const out: HelpTopic[] = [];
  let current: { title: string; body: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.body.join('\n').trim();
    if (text)
      out.push({
        id: `${page}#${anchorOf(current.title)}`,
        page,
        pageTitle,
        title: current.title,
        text: text.slice(0, TOPIC_CHARS),
      });
  };
  for (const line of lines) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      flush();
      current = { title: h[1]!.trim(), body: [] };
    } else if (current) current.body.push(line);
  }
  flush();
  return out;
}

/** The topics of the pages this person's rights are about. */
export function staffHelpTopics(permissions: Iterable<string>): HelpTopic[] {
  const mine = [...permissions];
  return allHelpTopics().filter((t) => {
    const rights = PAGE_RIGHTS[t.page];
    return !rights || mine.some((p) => rights.some((r) => p.startsWith(r)));
  });
}
