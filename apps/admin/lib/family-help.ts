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

/** Whose Help: the families' (0406) or the staff's (0422); both kept on Helpdesk set-up. */
export type HelpApp = 'family' | 'staff';

/** Each Help's addresses and words on Helpdesk set-up. */
export const HELP_APPS: Record<
  HelpApp,
  { api: string; page: string; title: string; description: string; readers: string }
> = {
  family: {
    api: '/helpdesk/family-help',
    page: '/engagement/helpdesk/setup/family-help',
    title: 'Help for families',
    description:
      'The questions and answers parents and students see on Help, in the app and on the website. Each heading folds on their Help page; a question about a screen someone cannot open is left out for them.',
    readers: 'families',
  },
  staff: {
    api: '/helpdesk/staff-help',
    page: '/engagement/helpdesk/setup/staff-help',
    title: 'Help for staff',
    description:
      'The questions and answers staff see on Help, in the staff app and on the staff website. Each heading folds on their Help page; a question about a screen someone cannot open is left out for them.',
    readers: 'staff',
  },
};

export interface FamilyHelpSetup {
  app?: HelpApp;
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
