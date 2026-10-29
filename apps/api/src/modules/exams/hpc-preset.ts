import type { UpsertIndicatorSetDto } from './exams.dto';

/**
 * A Holistic Progress Card for the foundational stage (Balvatika to Class II; docs/design/65, part 5),
 * after the National Curriculum Framework for the Foundational Stage: its six domains, a curricular
 * goal per line and the competencies a teacher rates on three levels. The words are plain and the
 * school edits them (Exams → Indicators and HPC).
 */
export const HPC_LEVELS = ['Beginner', 'Progressing', 'Proficient'];
export const HPC_LEVEL_WORDS: Record<string, string> = {
  Beginner: 'Stream',
  Progressing: 'Mountain',
  Proficient: 'Sky',
};

type Goal = { code: string; name: string; competencies: Array<[string, string]> };
const DOMAINS: Array<{ area: string; goals: Goal[] }> = [
  {
    area: 'Physical development',
    goals: [
      {
        code: 'PD1',
        name: 'Develops habits that keep them healthy and safe',
        competencies: [
          ['PD1A', 'Keeps clean: washes hands, eats tidily, uses the toilet on their own'],
          ['PD1B', 'Follows safety rules in class, on the playground and on the road'],
        ],
      },
      {
        code: 'PD2',
        name: 'Sharpens the senses',
        competencies: [
          ['PD2A', 'Tells colours, shapes, sounds, smells and textures apart'],
          ['PD2B', 'Matches and sorts things by what they see, hear and touch'],
        ],
      },
      {
        code: 'PD3',
        name: 'Has a fit and flexible body',
        competencies: [
          ['PD3A', 'Runs, jumps, climbs and balances with control'],
          ['PD3B', 'Uses the fingers with control: holds a crayon, tears, threads, cuts'],
        ],
      },
    ],
  },
  {
    area: 'Socio-emotional and ethical development',
    goals: [
      {
        code: 'SE1',
        name: 'Understands and manages feelings',
        competencies: [
          ['SE1A', 'Names their own feelings and calms down with help'],
          ['SE1B', 'Shows care for others; takes turns and shares'],
        ],
      },
      {
        code: 'SE2',
        name: 'Relates to family, friends and the community',
        competencies: [['SE2A', 'Plays and works with others; respects rules and differences']],
      },
    ],
  },
  {
    area: 'Cognitive development',
    goals: [
      {
        code: 'CD1',
        name: 'Makes sense of the world by observing and thinking',
        competencies: [
          ['CD1A', 'Asks questions and finds out by trying'],
          ['CD1B', 'Sorts, puts in order and spots patterns'],
        ],
      },
      {
        code: 'CD2',
        name: 'Understands numbers, shapes and measures',
        competencies: [
          ['CD2A', 'Counts, reads and compares numbers'],
          ['CD2B', 'Names shapes; compares sizes, lengths and weights'],
        ],
      },
      {
        code: 'CD3',
        name: 'Cares for the natural world',
        competencies: [['CD3A', 'Looks after plants, animals and the surroundings']],
      },
    ],
  },
  {
    area: 'Language and literacy',
    goals: [
      {
        code: 'LL1',
        name: 'Talks and listens well',
        competencies: [
          ['LL1A', 'Listens and answers; speaks in full sentences'],
          ['LL1B', 'Tells about their own experiences and retells stories'],
        ],
      },
      {
        code: 'LL2',
        name: 'Reads and writes in the first language',
        competencies: [
          ['LL2A', 'Knows letters and their sounds; reads simple words and sentences'],
          ['LL2B', 'Writes letters, simple words and sentences'],
        ],
      },
      {
        code: 'LL3',
        name: 'Begins a second language',
        competencies: [['LL3A', 'Understands and uses simple words and phrases']],
      },
    ],
  },
  {
    area: 'Aesthetic and cultural development',
    goals: [
      {
        code: 'AC1',
        name: 'Expresses themselves through the arts',
        competencies: [
          ['AC1A', 'Draws, paints and makes things'],
          ['AC1B', 'Sings, dances and acts out stories'],
        ],
      },
    ],
  },
  {
    area: 'Positive learning habits',
    goals: [
      {
        code: 'LH1',
        name: 'Has habits that help learning',
        competencies: [
          ['LH1A', 'Pays attention and finishes a task'],
          ['LH1B', 'Follows class routines and looks after their things'],
        ],
      },
    ],
  },
];

/** What each level means, until the school writes it per competency. */
const MEANS: Record<string, string> = {
  Beginner: 'Tries it with a lot of help',
  Progressing: 'Does it with some help',
  Proficient: 'Does it on their own',
};

/** The set as the indicator-set upsert takes it. */
export function hpcPresetSet(): UpsertIndicatorSetDto {
  const indicators: UpsertIndicatorSetDto['indicators'] = [];
  let n = 0;
  for (const d of DOMAINS)
    for (const g of d.goals) {
      // the goal is the second level (a heading on the card); its competencies take a level
      indicators.push({
        code: g.code,
        name: g.name,
        area: d.area,
        kind: 'level',
        sortOrder: (n += 1),
        descriptors: {},
      });
      for (const [code, name] of g.competencies)
        indicators.push({
          code,
          name,
          area: d.area,
          parentCode: g.code,
          kind: 'level',
          sortOrder: (n += 1),
          descriptors: { ...MEANS },
        });
    }
  return {
    code: 'HPC_FOUNDATION',
    name: 'Holistic progress card (foundational stage)',
    kind: 'hpc',
    grades: HPC_LEVELS,
    levelWords: HPC_LEVEL_WORDS,
    indicators,
  };
}
