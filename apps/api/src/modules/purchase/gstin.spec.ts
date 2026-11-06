import { GST_STATES, gstinCheckChar, gstinProblem, panOfGstin } from './gstin';

describe('GSTIN checks (docs/design/83)', () => {
  it('works out the check character (Luhn mod 36)', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
    expect(gstinProblem('27AAPFU0939F1ZV')).toBeNull();
  });
  it('says what is wrong', () => {
    expect(gstinProblem('27AAPFU0939F1ZA')).toBe('check');
    expect(gstinProblem('99AAPFU0939F1ZV')).toBe('state');
    expect(gstinProblem('27AAPFU0939F1Z')).toBe('format');
    expect(gstinProblem('27aapfu0939f1zv')).toBe('format');
  });
  it('reads the PAN and the state', () => {
    expect(panOfGstin('27AAPFU0939F1ZV')).toBe('AAPFU0939F');
    expect(GST_STATES['27']).toBe('Maharashtra');
    expect(GST_STATES['36']).toBe('Telangana');
  });
});
