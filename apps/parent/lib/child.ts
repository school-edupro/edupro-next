import { cache } from 'react';
import { cookies } from 'next/headers';
import { bff } from '@/lib/bff';

/** The child the family is looking at, remembered across the portal's pages. */
export const CHILD_COOKIE = 'edupro_child';

export interface FamilyKid {
  id: string;
  name: string;
  section: string | null;
}

/** The children of the signed-in guardian (a student login has one: themself). One call per request. */
export const familyKids = cache(async (): Promise<FamilyKid[]> =>
  bff.api
    .fetch<{ children: FamilyKid[] }>('/engagement/family')
    .then((r) => r.children.map((c) => ({ id: c.id, name: c.name, section: c.section })))
    .catch(() => []),
);

/**
 * Which child the page shows: the one named in the link, else the one chosen last (on any page), else
 * the first. Always one of the family's own children; null when no child is linked.
 */
export async function chosenChild(explicit?: string | null): Promise<FamilyKid | null> {
  const kids = await familyKids();
  if (!kids.length) return null;
  let remembered: string | undefined;
  try {
    remembered = (await cookies()).get(CHILD_COOKIE)?.value;
  } catch {
    remembered = undefined;
  }
  return kids.find((k) => k.id === explicit) ?? kids.find((k) => k.id === remembered) ?? kids[0]!;
}
