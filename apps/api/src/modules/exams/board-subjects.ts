/**
 * CBSE subject codes (docs/design/88, phase B): the codes a Class X or XII result file prints, with their names and
 * kinds — language, main, skill (vocational), additional, internal (XII's graded subjects). The school's list starts
 * from these; a code a file prints that is not here is added unnamed for the school to name; any name can be changed.
 */
export type BoardSubjectKind = 'language' | 'main' | 'skill' | 'additional' | 'internal';

export const CBSE_SUBJECTS: Record<'X' | 'XII', Array<[string, string, BoardSubjectKind]>> = {
  X: [
    ['002', 'Hindi Course-A', 'language'],
    ['085', 'Hindi Course-B', 'language'],
    ['184', 'English Language and Literature', 'language'],
    ['122', 'Sanskrit', 'language'],
    ['119', 'Sanskrit (Communicative)', 'language'],
    ['018', 'French', 'language'],
    ['020', 'German', 'language'],
    ['003', 'Urdu Course-A', 'language'],
    ['303', 'Urdu Course-B', 'language'],
    ['004', 'Punjabi', 'language'],
    ['005', 'Bengali', 'language'],
    ['006', 'Tamil', 'language'],
    ['041', 'Mathematics (Standard)', 'main'],
    ['241', 'Mathematics (Basic)', 'main'],
    ['086', 'Science', 'main'],
    ['087', 'Social Science', 'main'],
    ['165', 'Computer Applications', 'skill'],
    ['154', 'Elements of Business', 'skill'],
    ['254', 'Elements of Book Keeping and Accountancy', 'skill'],
    ['401', 'Retail', 'skill'],
    ['402', 'Information Technology', 'skill'],
    ['409', 'Food Production', 'skill'],
    ['417', 'Artificial Intelligence', 'skill'],
    ['049', 'Painting', 'additional'],
    ['064', 'Home Science', 'additional'],
    ['034', 'Hindustani Music (Vocal)', 'additional'],
    ['035', 'Hindustani Music (Melodic Instruments)', 'additional'],
    ['036', 'Hindustani Music (Percussion Instruments)', 'additional'],
  ],
  XII: [
    ['301', 'English Core', 'language'],
    ['302', 'Hindi Core', 'language'],
    ['002', 'Hindi Elective', 'language'],
    ['322', 'Sanskrit Core', 'language'],
    ['041', 'Mathematics', 'main'],
    ['241', 'Applied Mathematics', 'main'],
    ['042', 'Physics', 'main'],
    ['043', 'Chemistry', 'main'],
    ['044', 'Biology', 'main'],
    ['083', 'Computer Science', 'main'],
    ['065', 'Informatics Practices', 'main'],
    ['030', 'Economics', 'main'],
    ['054', 'Business Studies', 'main'],
    ['055', 'Accountancy', 'main'],
    ['027', 'History', 'main'],
    ['028', 'Political Science', 'main'],
    ['029', 'Geography', 'main'],
    ['037', 'Psychology', 'main'],
    ['039', 'Sociology', 'main'],
    ['074', 'Legal Studies', 'main'],
    ['048', 'Physical Education', 'main'],
    ['049', 'Painting', 'main'],
    ['064', 'Home Science', 'main'],
    ['066', 'Entrepreneurship', 'main'],
    ['034', 'Hindustani Music (Vocal)', 'main'],
    ['035', 'Hindustani Music (Melodic Instruments)', 'main'],
    ['802', 'Information Technology', 'skill'],
    ['809', 'Food Production', 'skill'],
    ['817', 'Typography and Computer Application', 'skill'],
    ['837', 'Fashion Studies', 'skill'],
    ['841', 'Yoga', 'skill'],
    ['500', 'Work Experience', 'internal'],
    ['502', 'Health and Physical Education', 'internal'],
    ['503', 'General Studies', 'internal'],
  ],
};

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2 && !['and', 'the', 'course'].includes(w));

/**
 * The school subject a CBSE subject most likely is (by its words: "Mathematics (Standard)" → Mathematics;
 * "English Language and Literature" → English), or null when none shares a word.
 */
export function likelySubject<T extends { id: string; name: string }>(
  boardName: string,
  subjects: T[],
): T | null {
  const want = words(boardName);
  let best: T | null = null;
  let score = 0;
  for (const s of subjects) {
    const have = words(s.name);
    const common = have.filter((w) => want.includes(w)).length;
    // every word of the school's name found, and the most of them
    const sc = common === have.length && common > 0 ? common * 10 - (want.length - common) : 0;
    if (sc > score) {
      score = sc;
      best = s;
    }
  }
  return best;
}
