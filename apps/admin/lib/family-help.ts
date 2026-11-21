/** The families' Help as the office edits it (GET /helpdesk/family-help, 0406). */
export interface FamilyHelpHeading {
  id: string;
  title: string;
  titleHi: string | null;
  position: number;
  standard: boolean;
}

export type FamilyHelpAudience = 'both' | 'parent' | 'student';

export interface FamilyHelpQuestion {
  id: string;
  headingId: string | null;
  question: string;
  questionHi: string | null;
  answer: string;
  answerHi: string | null;
  audience: FamilyHelpAudience;
  page: string | null;
  hidden: boolean;
  position: number;
  standard: boolean;
  yes: number;
  no: number;
  updatedAt: string;
}

export interface FamilyHelpSetup {
  headings: FamilyHelpHeading[];
  questions: FamilyHelpQuestion[];
  pages: Array<{ href: string; label: string }>;
  standardMissing: number;
}

export const AUDIENCE_LABEL: Record<FamilyHelpAudience, string> = {
  both: 'Parents and students',
  parent: 'Parents',
  student: 'Students',
};

/** More families said an answer did not help than that it did, and at least three said so. */
export const needsALook = (q: Pick<FamilyHelpQuestion, 'yes' | 'no'>) => q.no > q.yes && q.no >= 3;
