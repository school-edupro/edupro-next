import { createHash } from 'node:crypto';

/** Deterministic shuffle (mulberry32 seeded from sha256 of the seed): a draw can be replayed and checked. */
export function seededOrder<T>(items: T[], seed: string): T[] {
  const h = createHash('sha256').update(seed).digest();
  let a = h.readUInt32LE(0);
  const rnd = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export interface MeritCandidate {
  id: string;
  number: string | null;
  merit: number | null;
  /** date of birth, yyyy-mm-dd */
  dob: string | null;
}

/** How a candidate's place among equal merits was settled. */
export type TieBreak = 'age' | 'draw' | null;

/** The tie-break rule as families and the office read it (merit list, admission page). */
export const TIE_RULE =
  'Higher merit (form points + test and interview marks) first; equal merit: the older child first; still equal: a draw of lots, its seed printed here so it can be checked.';

/**
 * The merit list's order (docs/design/40, part 4): merit high to low (none last), then the older child
 * first (date of birth unknown last), then a draw of lots among those still equal. The draw of each
 * group is seeded by the class's seed with the group's merit and date of birth, so it replays.
 * `needsDraw` says whether any group had to be drawn (the caller records a seed the first time).
 */
export function meritOrder<T extends MeritCandidate>(
  rows: T[],
  seed: string | null,
): { order: Array<T & { rank: number; tie: TieBreak }>; needsDraw: boolean } {
  const key = (x: T) => `${x.merit ?? 'none'}|${x.dob ?? 'none'}`;
  const sorted = [...rows].sort((a, b) => {
    if (a.merit !== b.merit) {
      if (a.merit === null) return 1;
      if (b.merit === null) return -1;
      return b.merit - a.merit;
    }
    if (a.dob !== b.dob) {
      if (a.dob === null) return 1;
      if (b.dob === null) return -1;
      return a.dob < b.dob ? -1 : 1;
    }
    // equal: a stable starting order for the draw
    return (a.number ?? a.id).localeCompare(b.number ?? b.id) || a.id.localeCompare(b.id);
  });
  const sameMerit = new Map<string, number>();
  const sameBoth = new Map<string, number>();
  for (const x of sorted) {
    sameMerit.set(String(x.merit), (sameMerit.get(String(x.merit)) ?? 0) + 1);
    sameBoth.set(key(x), (sameBoth.get(key(x)) ?? 0) + 1);
  }
  const needsDraw = [...sameBoth.values()].some((n) => n > 1);
  const out: T[] = [];
  for (let i = 0; i < sorted.length;) {
    const k = key(sorted[i]!);
    let j = i;
    while (j < sorted.length && key(sorted[j]!) === k) j += 1;
    const group = sorted.slice(i, j);
    out.push(...(group.length > 1 && seed ? seededOrder(group, `${seed}|${k}`) : group));
    i = j;
  }
  return {
    order: out.map((x, i) => ({
      ...x,
      rank: i + 1,
      tie:
        (sameMerit.get(String(x.merit)) ?? 0) < 2
          ? null
          : (sameBoth.get(key(x)) ?? 0) > 1
            ? 'draw'
            : 'age',
    })),
    needsDraw,
  };
}
