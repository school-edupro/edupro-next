import { describe, expect, it } from 'vitest';
import {
  compile,
  dependencies,
  evaluate,
  FORMULA_MAX_LENGTH,
  microDiv,
  microMul,
  passVars,
  tokenize,
  type Compiled,
} from '../src/formula';
import { decToScaled } from '../src/money';

/** rupees (or a rate, or days) → micro-rupees */
const µ = (v: string | number) => decToScaled(String(v), 6)!;
const rupees = (paise: bigint) => Number(paise) / 100;

const run = (
  src: string,
  heads: Record<string, string | number> = {},
  vars: Record<string, string | number> = {},
  pass?: 1 | 2,
) =>
  evaluate(
    compile(src, pass),
    Object.fromEntries(Object.entries(heads).map(([k, v]) => [k, µ(v)])),
    Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, µ(v)])),
  );
const value = (src: string, heads = {}, vars = {}) => {
  const r = run(src, heads, vars);
  expect(r.errors).toEqual([]);
  return rupees(r.paise);
};
const compileError = (src: string, pass?: 1 | 2) => compile(src, pass).errors[0];

describe('the seeded heads compute as the legacy', () => {
  const pay = { BASIC: 52000, DA: 30160, TA_BASE: 3600 };
  it('DA, HRA, TA, OT', () => {
    expect(value('ROUND([BASIC]*DA_RATE)', pay, { DA_RATE: '0.58' })).toBe(30160);
    expect(value('ROUND([BASIC]*HRA_RATE)', pay, { HRA_RATE: '0.24' })).toBe(12480);
    expect(value('ROUND([TA_BASE]+[TA_BASE]*DA_RATE)', pay, { DA_RATE: '0.58' })).toBe(5688);
    expect(value('ROUND(OT_HOURS*([BASIC]+[DA])/26/8*2)', pay, { OT_HOURS: 10 })).toBe(7900);
  });
  it('rounds to paise only once, at the end', () => {
    // 1 ÷ 3 × 3 keeps micro precision: 0.999999 → ₹1.00, not 0.99
    expect(value('1/3*3')).toBe(1);
    expect(value('1/3')).toBe(0.33);
    expect(value('-1/3')).toBe(-0.33);
    expect(value('2/-3')).toBe(-0.67);
  });
});

describe('operators, precedence and functions', () => {
  it('follows arithmetic precedence and associativity', () => {
    expect(value('1+2*3')).toBe(7);
    expect(value('(1+2)*3')).toBe(9);
    expect(value('2-1-1')).toBe(0);
    expect(value('8/2/2')).toBe(2);
    expect(value('-5')).toBe(-5);
    expect(value('--5')).toBe(5);
    expect(value('2*-3')).toBe(-6);
    expect(value('-2*3')).toBe(-6);
    expect(value('+5')).toBe(5);
    expect(value('2 * +3')).toBe(6);
    expect(value('MIN(1, -2)')).toBe(-2);
  });
  it('compares below arithmetic, giving 1 or 0', () => {
    expect(value('[BASIC] < 24200', { BASIC: 20000 })).toBe(1);
    expect(value('[BASIC] < 24200', { BASIC: 30000 })).toBe(0);
    expect(value('1 + 1 >= 2')).toBe(1);
    expect(value('1 >= 2')).toBe(0);
    expect(value('2 > 1')).toBe(1);
    expect(value('1 > 2')).toBe(0);
    expect(value('1 <= 1')).toBe(1);
    expect(value('2 <= 1')).toBe(0);
    expect(value('1 == 1')).toBe(1);
    expect(value('1 == 2')).toBe(0);
    expect(value('1 != 2')).toBe(1);
    expect(value('1 != 1')).toBe(0);
    expect(value('(IS_PERMANENT == 1) * 500', {}, { IS_PERMANENT: 1 })).toBe(500);
  });
  it('MIN, MAX, ROUND, FLOOR, CEIL, IF', () => {
    expect(value('MIN(3, 1, 2)')).toBe(1);
    expect(value('MAX(1, 3, 2)')).toBe(3);
    expect(value('ROUND(2.5)')).toBe(3);
    expect(value('ROUND(-2.5)')).toBe(-3);
    expect(value('ROUND(2.4)')).toBe(2);
    expect(value('FLOOR(2.5)')).toBe(2);
    expect(value('FLOOR(-2.5)')).toBe(-3);
    expect(value('CEIL(2.1)')).toBe(3);
    expect(value('CEIL(-2.9)')).toBe(-2);
    expect(value('IF(1, 10, 20)')).toBe(10);
    expect(value('IF(0, 10, 20)')).toBe(20);
    expect(value('IF([BASIC] > 50000, 1000, 500)', { BASIC: 52000 })).toBe(1000);
    expect(value('round (2.5)')).toBe(3); // names are case-insensitive, space before '('
  });
  it('evaluates both IF branches: a division by zero in the other branch still fails', () => {
    expect(run('IF(1, 5, 1/0)').errors).toEqual(['Formula error: division by zero.']);
  });
});

describe('what a formula may not do', () => {
  it('fails on an unknown head or variable — never 0', () => {
    expect(run('[HRA] * 2').errors[0]).toContain('Unknown head reference [HRA]');
    expect(run('DA_RATE * 2').errors[0]).toContain("Unknown variable 'DA_RATE'");
  });
  it('refuses operands past the engine limit', () => {
    expect(run('[A] * 2', { A: 10_000_000 }).errors[0]).toContain('operand exceeds');
    expect(run('2 * -[A]', { A: 10_000_000 }).errors[0]).toContain('operand exceeds');
    expect(run('1 / [A]', { A: 10_000_000 }).errors[0]).toContain('divisor exceeds');
    expect(run('1 / -[A]', { A: 10_000_000 }).errors[0]).toContain('divisor exceeds');
  });
  it('keeps a second-pass variable out of a first-pass formula', () => {
    expect(compileError('[BASIC] + GROSS_EARNED', 1)).toContain(
      "'GROSS_EARNED' is a pass-2 variable",
    );
    expect(compile('[BASIC] + GROSS_EARNED', 2).ok).toBe(true);
    expect(compile('[BASIC] * DA_RATE', 1).ok).toBe(true);
    expect(passVars(1)).toEqual(['PAID_DAYS', 'MONTH_DAYS', 'OT_HOURS']);
    expect(passVars(2)).toEqual([
      'PAID_DAYS',
      'MONTH_DAYS',
      'OT_HOURS',
      'GROSS_EARNED',
      'PF_WAGE',
      'BASIC_DA',
    ]);
  });
});

describe('the tokenizer explains what is wrong', () => {
  it.each([
    ['', 'Formula is empty.'],
    ['   ', 'Formula is empty.'],
    ['1'.repeat(FORMULA_MAX_LENGTH + 1), 'Formula exceeds 255 characters.'],
    ['1.1234567', "Number '1.1234567' has more than 6 decimal places."],
    ['99999999', "Number '99999999' exceeds the engine limit (92,00,000)."],
    ['1234567890123', "Number '1234567890123' exceeds the engine limit (92,00,000)."],
    ['[1A]', 'Malformed head reference at position 0 (expected [HEAD_CODE]).'],
    ['FOO(1)', "Unknown function 'FOO' (allowed: MIN, MAX, ROUND, FLOOR, CEIL, IF)."],
    ['1 = 1', "Invalid '=' at position 2 — use '==' to compare."],
    ['!1', "Invalid '!' at position 0 — use '!=' to compare."],
    ['1 $ 2', "Invalid character '$' at position 2."],
  ])('%j → %s', (src, message) => {
    expect(tokenize(src).errors).toEqual([message]);
    expect(compile(src).ok).toBe(false);
  });
  it('reads tabs, lower-case names and head codes', () => {
    const t = tokenize('\t[basic]\t*\tda_rate');
    expect(t.ok).toBe(true);
    expect(t.tokens.map((x) => x.v)).toEqual(['BASIC', '*', 'DA_RATE']);
  });
});

describe('the compiler explains what is wrong', () => {
  it.each([
    ['5 5', "Unexpected '5' at position 2 — missing operator?"],
    ['[A] [B]', "Unexpected 'B' at position 4 — missing operator?"],
    ['(1)2', "Unexpected '2' at position 3 — missing operator?"],
    ['(1)MIN(1, 2)', "Unexpected 'MIN' at position 3 — missing operator?"],
    ['X Y', "Unexpected 'Y' at position 2 — missing operator?"],
    ['MIN(,1)', 'Empty function argument at position 4.'],
    ['MIN(1,,2)', 'Empty function argument at position 6.'],
    ['1,2', "Misplaced ',' at position 1."],
    ['(1,2)', "',' outside a function call at position 2."],
    ['()', 'Empty parentheses/argument at position 1.'],
    ['MIN(1,)', 'Empty parentheses/argument at position 6.'],
    ['1)', "Unbalanced ')' at position 1."],
    ['ROUND(1,2)', 'ROUND() expects 1 argument(s), got 2.'],
    ['MIN(1)', 'MIN() expects at least 2 argument(s), got 1.'],
    ['IF(1,2)', 'IF() expects 3 argument(s), got 2.'],
    ['1+', 'Formula ends unexpectedly (trailing operator or empty expression).'],
    ['MIN(1,', 'Formula ends unexpectedly (trailing operator or empty expression).'],
    ['(', 'Formula ends unexpectedly (trailing operator or empty expression).'],
    ['(1', 'Unbalanced parenthesis.'],
    ['MIN(1,2', 'Unbalanced parenthesis.'],
    ['(+)', 'Formula has no computable expression.'],
  ])('%j → %s', (src, message) => {
    expect(compileError(src)).toBe(message);
  });
  it('limits the number of tokens', () => {
    expect(compileError(Array(101).fill('1').join('+'))).toBe(
      'Formula has too many tokens (max 200).',
    );
    expect(compile(Array(100).fill('1').join('+')).ok).toBe(true);
  });
  it('limits IF nesting to five', () => {
    const nest = (n: number): string => (n === 0 ? '1' : `IF(1, ${nest(n - 1)}, 0)`);
    expect(compile(nest(5)).ok).toBe(true);
    expect(compileError(nest(6))).toContain('IF() nested deeper than 5 levels');
  });
  it('lists the heads and variables used', () => {
    const c = compile('ROUND([BASIC]*DA_RATE) + [BASIC] + [TA_BASE]');
    expect(c.headsUsed).toEqual(['BASIC', 'TA_BASE']);
    expect(c.varsUsed).toEqual(['DA_RATE']);
    expect(dependencies('[A] + [B] * 2')).toEqual({ ok: true, heads: ['A', 'B'], errors: [] });
    expect(dependencies('[A] +').ok).toBe(false);
  });
});

describe('the evaluator guards a malformed program', () => {
  const program = (rpn: Compiled['rpn']): Compiled => ({
    ok: true,
    rpn,
    headsUsed: [],
    varsUsed: [],
    errors: [],
  });
  it('reports what the compiler lets through', () => {
    expect(run('*5').errors).toEqual(['Malformed expression (operator arity).']);
    expect(run('5 * * 3').errors).toEqual(['Malformed expression (operator arity).']);
  });
  it('reports a broken postfix program', () => {
    expect(evaluate(program([{ t: 'OP', v: 'u-' }]), {}, {}).errors).toEqual([
      'Malformed expression (unary).',
    ]);
    expect(evaluate(program([{ t: 'FUNC', v: 'MIN', args: 2 }]), {}, {}).errors).toEqual([
      'Malformed expression (function arity).',
    ]);
    expect(
      evaluate(
        program([
          { t: 'NUM', n: 1n },
          { t: 'NUM', n: 2n },
        ]),
        {},
        {},
      ).errors,
    ).toEqual(['Malformed expression (unbalanced result).']);
    expect(evaluate(program([]), {}, {}).errors).toEqual(['Formula was not compiled.']);
    expect(evaluate(compile('1+'), {}, {}).errors[0]).toContain('ends unexpectedly');
  });
  it('lets a programming error through rather than hide it', () => {
    const broken = program([
      { t: 'NUM', n: undefined as unknown as bigint },
      { t: 'NUM', n: 1n },
      { t: 'OP', v: '+' },
    ]);
    expect(() => evaluate(broken, {}, {})).toThrow(TypeError);
  });
  it('multiplies and divides at micro precision', () => {
    expect(microMul(µ('0.5'), µ('0.000001'))).toBe(1n); // 0.0000005 → half-up to 1 micro
    expect(microDiv(µ(1), µ(3))).toBe(333_333n);
    expect(microDiv(µ(2), µ(3))).toBe(666_667n);
    expect(microDiv(-µ(2), µ(3))).toBe(-666_667n);
  });
});
