/**
 * Assistant set-up (0410, docs/design/91 phase C): the shapes of GET /insights/assistant/settings and the editor's
 * helpers. The API checks again on save.
 */

export const SETUP_AUDIENCES = ['student', 'parent', 'teacher', 'admin'] as const;
export type SetupAudience = (typeof SETUP_AUDIENCES)[number];

export const AUDIENCE_LABEL: Record<SetupAudience, string> = {
  student: 'Students',
  parent: 'Parents',
  teacher: 'Teachers',
  admin: 'Office and admin',
};

/** The most starter questions an audience may have (the API's limit). */
export const MAX_STARTERS = 8;
export const DAILY_LIMIT = { min: 1, max: 500 } as const;

export interface AssistantSetupValues {
  audiences: Record<SetupAudience, boolean>;
  dailyLimit: number;
  /** departments switched off per audience */
  topicsOff: Record<SetupAudience, string[]>;
  /** query ids in order; empty: the standard ones */
  starters: Record<SetupAudience, string[]>;
  /** the chat window's name (docs/design/92) */
  name: string;
  /** the school's subtitle per audience; empty: the standard one */
  subtitles: Record<SetupAudience, string>;
  /** docs/design/93: Claude's help per audience (families wait for a consent that names Anthropic) */
  claude: Record<SetupAudience, boolean>;
}

/** Claude's state on this server (docs/design/93): Mobilise's key, the audiences it may help, the month. */
export interface ClaudeInfo {
  /** docs/design/101: which model helps — the AI model for all schools (llm) or Claude; null: none */
  provider?: 'llm' | 'claude' | null;
  available: boolean;
  model: string | null;
  audiences: SetupAudience[];
  monthlyLimit: number;
  limitBy: 'default' | 'school';
  usedThisMonth: number;
}

/** The longest name and subtitle the API takes. */
export const NAME_MAX = 40;
export const SUBTITLE_MAX = 80;

export interface AssistantSetup extends AssistantSetupValues {
  updatedAt: string | null;
  updatedBy: string | null;
  defaults: {
    starters: Record<SetupAudience, string[]>;
    dailyLimit: number;
    name: string;
    subtitles: Record<SetupAudience, { en: string; hi: string }>;
  };
  topics: Array<{ key: string; label: string; labelHi: string }>;
  claudeInfo: ClaudeInfo;
  catalogue: Record<
    SetupAudience,
    Array<{ id: string; department: string; ask: string; askHi: string }>
  >;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The editor's values: a starter list equal to the standard one shows as empty ("the standard ones"). */
export function editableValues(s: AssistantSetup): AssistantSetupValues {
  const starters = Object.fromEntries(
    SETUP_AUDIENCES.map((a) => [
      a,
      same(s.starters[a] ?? [], s.defaults.starters[a] ?? []) ? [] : [...(s.starters[a] ?? [])],
    ]),
  ) as Record<SetupAudience, string[]>;
  return {
    audiences: { ...s.audiences },
    dailyLimit: s.dailyLimit,
    topicsOff: Object.fromEntries(
      SETUP_AUDIENCES.map((a) => [a, [...(s.topicsOff[a] ?? [])]]),
    ) as Record<SetupAudience, string[]>,
    starters,
    name: s.name ?? s.defaults.name,
    subtitles: Object.fromEntries(
      SETUP_AUDIENCES.map((a) => [a, s.subtitles?.[a] ?? '']),
    ) as Record<SetupAudience, string>,
    claude: Object.fromEntries(SETUP_AUDIENCES.map((a) => [a, s.claude?.[a] === true])) as Record<
      SetupAudience,
      boolean
    >,
  };
}

/** Two sets of values the same (topics compared as sets, starters in order). */
export function sameValues(a: AssistantSetupValues, b: AssistantSetupValues): boolean {
  if (a.dailyLimit !== b.dailyLimit || a.name.trim() !== b.name.trim()) return false;
  return SETUP_AUDIENCES.every(
    (k) =>
      a.audiences[k] === b.audiences[k] &&
      a.subtitles[k].trim() === b.subtitles[k].trim() &&
      a.claude[k] === b.claude[k] &&
      same([...a.topicsOff[k]].sort(), [...b.topicsOff[k]].sort()) &&
      same(a.starters[k], b.starters[k]),
  );
}

/** What is wrong before saving (the API checks too). */
export function setupProblems(v: AssistantSetupValues): string[] {
  const problems: string[] = [];
  if (
    !Number.isInteger(v.dailyLimit) ||
    v.dailyLimit < DAILY_LIMIT.min ||
    v.dailyLimit > DAILY_LIMIT.max
  )
    problems.push('Questions a day: a whole number from 1 to 500.');
  if (!v.name.trim()) problems.push('Name: write a name (the standard is MobiAI).');
  else if (v.name.trim().length > NAME_MAX)
    problems.push(`Name: at most ${String(NAME_MAX)} letters.`);
  for (const a of SETUP_AUDIENCES)
    if (v.subtitles[a].trim().length > SUBTITLE_MAX)
      problems.push(`${AUDIENCE_LABEL[a]}' subtitle: at most ${String(SUBTITLE_MAX)} letters.`);
  for (const a of SETUP_AUDIENCES)
    if (v.starters[a].length > MAX_STARTERS)
      problems.push(`${AUDIENCE_LABEL[a]}: at most ${String(MAX_STARTERS)} starter questions.`);
  return problems;
}

export const whenChanged = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      })
    : '';
