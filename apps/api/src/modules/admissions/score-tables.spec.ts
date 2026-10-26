import { passoutKey, siblingNosOf } from './score-tables';

describe('merit score tables (docs/design/48)', () => {
  it('reads a pass-out class however the form or the table writes it', () => {
    for (const v of ['X', 'x', '10', '10th', 'Class X', 'class 10'])
      expect(passoutKey(v)).toBe('10');
    for (const v of ['XII', '12', '12th', 'Class XII']) expect(passoutKey(v)).toBe('12');
    expect(passoutKey('Both')).toBe('both');
  });

  it('finds the sibling admission nos. of every siblings question', () => {
    expect(
      siblingNosOf({
        siblings: { count: 2, list: [{ admissionNo: ' A100 ' }, { admissionNo: '' }] },
        other: 'x',
      }),
    ).toEqual(['A100']);
  });
});
