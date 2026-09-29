import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownTitle } from '@/lib/markdown';

const HELP_DIR = join(process.cwd(), 'content', 'help');

export function helpPages(): Array<{ slug: string; title: string; summary: string }> {
  let files: string[] = [];
  try {
    files = readdirSync(HELP_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md');
  } catch {
    return [];
  }
  return files
    .map((f) => {
      const md = readFileSync(join(HELP_DIR, f), 'utf8');
      const firstPara =
        md.split('\n').find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('|')) ?? '';
      return {
        slug: f.replace(/\.md$/, ''),
        title: markdownTitle(md),
        summary: firstPara.slice(0, 160),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}
