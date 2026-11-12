import { describe, expect, it } from 'vitest';
import {
  ceilTo,
  daysToHundredths,
  decToScaled,
  divHalfUp,
  floorTo,
  microToPaise,
  paiseToMicro,
  paiseToString,
  prorate,
  roundHead,
  toPaise,
} from '../src/money';

describe('divHalfUp — half-up away from zero', () => {
  it('rounds as the legacy examples', () => {
    expect(divHalfUp(125n, 10n)).toBe(13n);
    expect(divHalfUp(-125n, 10n)).toBe(-13n);
    expect(divHalfUp(124n, 10n)).toBe(12n);
    expect(divHalfUp(-124n, 10n)).toBe(-12n);
    expect(divHalfUp(120n, 10n)).toBe(12n);
  });
  it('refuses a denominator of zero or less', () => {
    expect(() => divHalfUp(1n, 0n)).toThrow(RangeError);
    expect(() => divHalfUp(1n, -1n)).toThrow(RangeError);
  });
});

describe('floorTo / ceilTo — mathematical', () => {
  it('floors toward −∞ and ceils toward +∞', () => {
    expect(floorTo(150n, 100n)).toBe(100n);
    expect(floorTo(-150n, 100n)).toBe(-200n);
    expect(floorTo(-200n, 100n)).toBe(-200n);
    expect(ceilTo(150n, 100n)).toBe(200n);
    expect(ceilTo(-150n, 100n)).toBe(-100n);
    expect(ceilTo(200n, 100n)).toBe(200n);
  });
});

describe('decToScaled', () => {
  it('scales exact decimals', () => {
    expect(decToScaled('52000', 2)).toBe(5_200_000n);
    expect(decToScaled('0.58', 6)).toBe(580_000n);
    expect(decToScaled(' -12.34 ', 2)).toBe(-1234n);
    expect(decToScaled('7', 0)).toBe(7n);
  });
  it('accepts trailing zeros past the scale and refuses real precision loss', () => {
    expect(decToScaled('1.2300', 2)).toBe(123n);
    expect(decToScaled('-12.345', 2)).toBeNull();
  });
  it('refuses malformed text and integer parts too long for the scale', () => {
    expect(decToScaled('1e5', 2)).toBeNull();
    expect(decToScaled('', 2)).toBeNull();
    expect(decToScaled('1234567890123', 6)).toBeNull(); // 13 digits > 18 − 6
  });
});

describe('paise helpers', () => {
  it('converts rupees and back', () => {
    expect(toPaise('1234.50')).toBe(123_450n);
    expect(toPaise('0.05')).toBe(5n);
    expect(paiseToString(3_016_000n)).toBe('30160.00');
    expect(paiseToString(-9905n)).toBe('-99.05');
    expect(paiseToString(5n)).toBe('0.05');
  });
  it('rounds micro-rupees to paise once, half-up', () => {
    expect(microToPaise(55_000n)).toBe(6n); // ₹0.055 → 6 paise
    expect(microToPaise(54_999n)).toBe(5n);
    expect(microToPaise(-55_000n)).toBe(-6n);
    expect(paiseToMicro(5n)).toBe(50_000n);
  });
});

describe('roundHead — a pay head rounding rule', () => {
  it('rounds as the legacy examples', () => {
    expect(roundHead(3_016_050n, 'NEAREST_1')).toBe(3_016_100n);
    expect(roundHead(5_356_000n, 'CEIL_100')).toBe(5_360_000n);
    expect(roundHead(5_356_000n, 'NEAREST_100')).toBe(5_360_000n);
    expect(roundHead(1234n, 'NONE')).toBe(1234n);
  });
  it('covers every rule, negatives included', () => {
    expect(roundHead(-3_016_050n, 'NEAREST_1')).toBe(-3_016_100n);
    expect(roundHead(12_399n, 'FLOOR_1')).toBe(12_300n);
    expect(roundHead(-12_301n, 'FLOOR_1')).toBe(-12_400n);
    expect(roundHead(12_301n, 'CEIL_1')).toBe(12_400n);
    expect(roundHead(-12_399n, 'CEIL_1')).toBe(-12_300n); // CEIL on a negative moves toward zero
    expect(roundHead(1_500n, 'NEAREST_10')).toBe(2_000n); // ₹15 → ₹20
    expect(roundHead(1_499n, 'NEAREST_10')).toBe(1_000n);
    expect(roundHead(5_344_999n, 'NEAREST_100')).toBe(5_340_000n);
    expect(roundHead(5_340_000n, 'CEIL_100')).toBe(5_340_000n);
  });
});

describe('proration by paid days', () => {
  it('is rate × paid ÷ month, half-up, exact', () => {
    expect(prorate(3_000_000n, '29.5', '30')).toBe(2_950_000n);
    expect(prorate(3_100_000n, 28, 31)).toBe(2_800_000n);
    expect(prorate(1_000n, '1', '3')).toBe(333n);
    expect(prorate(2_000n, '1', '3')).toBe(667n);
  });
  it('is zero when either count is zero or less', () => {
    expect(prorate(1_000n, '0', '30')).toBe(0n);
    expect(prorate(1_000n, '10', '0')).toBe(0n);
    expect(prorate(1_000n, -1, 30)).toBe(0n);
  });
  it('counts days in hundredths', () => {
    expect(daysToHundredths('29.5')).toBe(2950n);
    expect(daysToHundredths(30.25)).toBe(3025n);
    expect(() => daysToHundredths('thirty')).toThrow(RangeError);
  });
});
