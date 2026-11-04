/**
 * The ready-made Learning record (I–II) (docs/design/73 part 2): an indicator set after the school's old
 * Class I–II card — each subject's skills in skill groups, the personal and social traits and the
 * activities, graded A* to D — and the grade scale its evaluation key prints (the % of each grade).
 * Installed with the Holistic progress card; a school gives the set to its Class I–II exams (or keeps
 * the NEP set) and may change it like any set.
 */
export interface ReadyMadeGroup {
  /** the skill group (a heading); null: the skills stand on their own */
  name: string | null;
  items: string[];
}
export interface ReadyMadeArea {
  area: string;
  /** the indicator codes' prefix */
  prefix: string;
  groups: ReadyMadeGroup[];
}

const LANGUAGE: ReadyMadeGroup[] = [
  { name: 'Listening skills', items: ['Comprehension', 'Application'] },
  {
    name: 'Speaking skills',
    items: ['Vocabulary', 'Conversation / public speaking', 'Recitation'],
  },
  { name: 'Reading skills', items: ['Comprehension', 'Fluency', 'Pronunciation'] },
  { name: 'Writing skills', items: ['Handwriting', 'Creative writing', 'Spelling'] },
  { name: 'Language structure', items: ['Grammar', 'Vocabulary'] },
  { name: null, items: ['Activity / project work'] },
];

export const LEARNING_RECORD_SET: {
  code: string;
  name: string;
  grades: string[];
  levelWords: Record<string, string>;
  areas: ReadyMadeArea[];
  /** the areas printed as co-scholastic (the rest are the subjects) */
  coAreas: string[];
} = {
  code: 'LR_I_II',
  name: 'Learning record (I–II)',
  grades: ['A*', 'A', 'B*', 'B', 'C', 'D'],
  levelWords: {
    'A*': 'Outstanding',
    A: 'Excellent',
    'B*': 'Very good',
    B: 'Good',
    C: 'Average',
    D: 'Scope for improvement',
  },
  areas: [
    { area: 'English', prefix: 'EN', groups: LANGUAGE },
    {
      area: 'Mathematics',
      prefix: 'MA',
      groups: [
        {
          name: null,
          items: [
            'Conceptual understanding',
            'Mental ability',
            'Written work',
            'Activity / project work',
          ],
        },
      ],
    },
    { area: 'Hindi', prefix: 'HI', groups: LANGUAGE },
    {
      area: 'EVS',
      prefix: 'EV',
      groups: [
        {
          name: null,
          items: ['Environmental awareness', 'Class participation', 'Activity / project work'],
        },
      ],
    },
    {
      area: 'General knowledge',
      prefix: 'GK',
      groups: [{ name: null, items: ['General knowledge'] }],
    },
    {
      area: 'Personal and social traits',
      prefix: 'PS',
      groups: [
        {
          name: 'Life skills',
          items: [
            'Courteousness',
            'Confidence / leadership',
            'Care of belongings',
            'Neatness / cleanliness',
            'Regularity and punctuality',
            'Initiative / responsibility',
            'Sharing and caring',
            'Attention span',
            'Self control / discipline',
            "Respect for others' property",
            'Interaction with peers',
            'Interaction with teachers',
            'Participation in group activity / group play',
            'Keenness to work',
          ],
        },
      ],
    },
    {
      area: 'Activities',
      prefix: 'AC',
      groups: [
        { name: 'Music', items: ['Interest', 'Skill'] },
        { name: 'Dance', items: ['Interest', 'Skill'] },
        { name: 'Art / craft', items: ['Interest', 'Skill'] },
        { name: null, items: ['Sports / games', 'Horse riding'] },
      ],
    },
  ],
  coAreas: ['Personal and social traits', 'Activities'],
};

/** The set as indicator rows: a heading per skill group, its skills under it (codes unique in the set). */
export function learningRecordRows(): Array<{
  code: string;
  name: string;
  area: string;
  parentCode: string | null;
  sortOrder: number;
}> {
  const out: Array<{
    code: string;
    name: string;
    area: string;
    parentCode: string | null;
    sortOrder: number;
  }> = [];
  let n = 0;
  for (const a of LEARNING_RECORD_SET.areas)
    a.groups.forEach((g, gi) => {
      const head = g.name ? `${a.prefix}-G${String(gi + 1)}` : null;
      if (head && g.name)
        out.push({ code: head, name: g.name, area: a.area, parentCode: null, sortOrder: (n += 1) });
      g.items.forEach((item, ii) =>
        out.push({
          code: `${a.prefix}-${String(gi + 1)}${String(ii + 1)}`,
          name: item,
          area: a.area,
          parentCode: head,
          sortOrder: (n += 1),
        }),
      );
    });
  return out;
}

/** The evaluation key's grade scale (grade, % from, % to, words). */
export const LEARNING_RECORD_KEY = {
  code: 'LR_KEY',
  name: 'Learning record key (A*–D)',
  bands: [
    { grade: 'A*', minPct: 91, maxPct: 100, remark: 'Outstanding' },
    { grade: 'A', minPct: 81, maxPct: 90.99, remark: 'Excellent' },
    { grade: 'B*', minPct: 71, maxPct: 80.99, remark: 'Very good' },
    { grade: 'B', minPct: 61, maxPct: 70.99, remark: 'Good' },
    { grade: 'C', minPct: 51, maxPct: 60.99, remark: 'Average' },
    { grade: 'D', minPct: 0, maxPct: 50.99, remark: 'Scope for improvement' },
  ],
};

/** The subjects whose remarks the card prints beside them (category added when the school has none). */
export const LEARNING_RECORD_REMARKS: Array<{ code: string; name: string; subjects: string[] }> = [
  { code: 'LR_ENG', name: 'English', subjects: ['ENG', 'English'] },
  { code: 'LR_MAT', name: 'Mathematics', subjects: ['MAT', 'MATHS', 'Mathematics'] },
  { code: 'LR_HIN', name: 'Hindi', subjects: ['HIN', 'Hindi'] },
  { code: 'LR_EVS', name: 'EVS', subjects: ['EVS', 'Environmental Studies', 'EVS'] },
];
