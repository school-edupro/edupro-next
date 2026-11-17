import { CBSE_SUBJECTS, likelySubject } from './board-subjects';

const school = [
  { id: '1', name: 'English' },
  { id: '2', name: 'Hindi' },
  { id: '3', name: 'Mathematics' },
  { id: '4', name: 'Science' },
  { id: '5', name: 'Social Science' },
  { id: '6', name: 'Computer Science' },
  { id: '7', name: 'Physics' },
];
const of = (name: string) => likelySubject(name, school)?.name ?? null;

describe('CBSE subject codes (docs/design/88, phase B)', () => {
  it("links a CBSE subject to the school's subject by its words", () => {
    expect(of('English Language and Literature')).toBe('English');
    expect(of('Hindi Course-B')).toBe('Hindi');
    expect(of('Mathematics (Standard)')).toBe('Mathematics');
    expect(of('Social Science')).toBe('Social Science');
    expect(of('Science')).toBe('Science');
    expect(of('Computer Science')).toBe('Computer Science');
    expect(of('Computer Applications')).toBeNull();
    expect(of('Painting')).toBeNull();
  });

  it('every seeded code is three digits, once per class', () => {
    for (const cls of ['X', 'XII'] as const) {
      const codes = CBSE_SUBJECTS[cls].map(([code]) => code);
      expect(codes.every((c) => /^\d{3}$/.test(c))).toBe(true);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });
});
