/**
 * The pay-head formula language (legacy `payroll_formula.php`, "Formula Engine v2"): a whitelist tokenizer,
 * shunting-yard to postfix, a stack evaluator — formulas are data, never evaluated as code.
 *
 *   number     := \d+ ('.' \d{1,6})?
 *   identifier := [A-Z][A-Z0-9_]*   a system variable (PAID_DAYS, MONTH_DAYS, OT_HOURS; in the second pass
 *                                    also GROSS_EARNED, PF_WAGE, BASIC_DA) or a rate code (DA_RATE …)
 *   head ref   := '[' identifier ']'  another head's amount, or the head's own structure amount ([TA_BASE])
 *   functions  := MIN, MAX (2 or more), ROUND, FLOOR, CEIL (to whole rupees), IF(cond, then, else)
 *                 (both branches evaluated, nesting at most 5)
 *   operators  := + - * / and unary minus; comparisons >= > <= < == != give 1 or 0, below arithmetic
 *
 * All arithmetic is in micro-rupees (rates too: 0.58 → 580000), half-up to the micro on each × and ÷; the
 * result is rounded to paise exactly once at the end. An unknown head or variable fails — never 0.
 */
import {
  MICRO_LIMIT,
  MICRO_PER_RUPEE,
  ceilTo,
  decToScaled,
  divHalfUp,
  floorTo,
  microToPaise,
} from './money';

export const FORMULA_MAX_LENGTH = 255;
export const FORMULA_MAX_TOKENS = 200;
export const IF_MAX_DEPTH = 5;

/** The functions and their argument counts (max null = unbounded). */
export const FUNCTIONS: Record<string, readonly [number, number | null]> = {
  MIN: [2, null],
  MAX: [2, null],
  ROUND: [1, 1],
  FLOOR: [1, 1],
  CEIL: [1, 1],
  IF: [3, 3],
};

const PASS_1_VARS = ['PAID_DAYS', 'MONTH_DAYS', 'OT_HOURS'] as const;
const PASS_2_ONLY_VARS = ['GROSS_EARNED', 'PF_WAGE', 'BASIC_DA'] as const;

/** The system variables the engine supplies in a pass (rate codes are open-ended and come from the registry). */
export const passVars = (pass: 1 | 2): string[] =>
  pass === 2 ? [...PASS_1_VARS, ...PASS_2_ONLY_VARS] : [...PASS_1_VARS];

type TokenType = 'NUM' | 'IDENT' | 'HEADREF' | 'FUNC' | 'OP' | 'LPAREN' | 'RPAREN' | 'COMMA';
interface Token {
  t: TokenType;
  v: string;
  /** a number's value in micro-rupees */
  n?: bigint;
  pos: number;
}

/** A postfix step. */
export type Rpn =
  | { t: 'NUM'; n: bigint }
  | { t: 'HEADREF' | 'IDENT'; v: string }
  | { t: 'OP'; v: string }
  | { t: 'FUNC'; v: string; args: number };

export interface Compiled {
  ok: boolean;
  rpn: Rpn[];
  headsUsed: string[];
  varsUsed: string[];
  errors: string[];
}

export interface Evaluated {
  ok: boolean;
  micro: bigint;
  paise: bigint;
  errors: string[];
}

class FormulaError extends Error {}

const isDigit = (c: string) => c >= '0' && c <= '9';
const isAlpha = (c: string) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');

/** Splits a formula into tokens; the first problem stops it. */
export function tokenize(source: string): { ok: boolean; tokens: Token[]; errors: string[] } {
  const src = source.trim();
  if (src === '') return { ok: false, tokens: [], errors: ['Formula is empty.'] };
  if (src.length > FORMULA_MAX_LENGTH)
    return {
      ok: false,
      tokens: [],
      errors: [`Formula exceeds ${String(FORMULA_MAX_LENGTH)} characters.`],
    };
  const tokens: Token[] = [];
  const fail = (message: string) => ({ ok: false, tokens, errors: [message] });
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t') {
      i += 1;
      continue;
    }
    if (isDigit(c)) {
      const m = /^(\d+)(?:\.(\d+))?/.exec(src.slice(i))!;
      if ((m[2] ?? '').length > 6) return fail(`Number '${m[0]}' has more than 6 decimal places.`);
      const micro = decToScaled(m[0], 6);
      if (micro === null || micro > MICRO_LIMIT)
        return fail(`Number '${m[0]}' exceeds the engine limit (92,00,000).`);
      tokens.push({ t: 'NUM', v: m[0], n: micro, pos: i });
      i += m[0].length;
      continue;
    }
    if (c === '[') {
      const m = /^\[([A-Za-z][A-Za-z0-9_]*)\]/.exec(src.slice(i));
      if (!m)
        return fail(`Malformed head reference at position ${String(i)} (expected [HEAD_CODE]).`);
      tokens.push({ t: 'HEADREF', v: m[1]!.toUpperCase(), pos: i });
      i += m[0].length;
      continue;
    }
    if (isAlpha(c)) {
      const word = /^[A-Za-z][A-Za-z0-9_]*/.exec(src.slice(i))![0];
      const name = word.toUpperCase();
      let j = i + word.length;
      while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j += 1;
      if (src[j] === '(') {
        if (!(name in FUNCTIONS))
          return fail(
            `Unknown function '${name}' (allowed: ${Object.keys(FUNCTIONS).join(', ')}).`,
          );
        tokens.push({ t: 'FUNC', v: name, pos: i });
      } else tokens.push({ t: 'IDENT', v: name, pos: i });
      i += word.length;
      continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      tokens.push({ t: c === '(' ? 'LPAREN' : c === ')' ? 'RPAREN' : 'COMMA', v: c, pos: i });
      i += 1;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      tokens.push({ t: 'OP', v: c, pos: i });
      i += 1;
      continue;
    }
    if (c === '>' || c === '<' || c === '=' || c === '!') {
      const two = src.slice(i, i + 2);
      if (two === '>=' || two === '<=' || two === '==' || two === '!=') {
        tokens.push({ t: 'OP', v: two, pos: i });
        i += 2;
        continue;
      }
      if (c === '>' || c === '<') {
        tokens.push({ t: 'OP', v: c, pos: i });
        i += 1;
        continue;
      }
      return fail(
        c === '='
          ? `Invalid '=' at position ${String(i)} — use '==' to compare.`
          : `Invalid '!' at position ${String(i)} — use '!=' to compare.`,
      );
    }
    return fail(`Invalid character '${c}' at position ${String(i)}.`);
  }
  return { ok: true, tokens, errors: [] };
}

const PRECEDENCE: Record<string, number> = {
  'u-': 4,
  '*': 3,
  '/': 3,
  '+': 2,
  '-': 2,
  '>=': 1,
  '>': 1,
  '<=': 1,
  '<': 1,
  '==': 1,
  '!=': 1,
};

const failed = (errors: string[]): Compiled => ({
  ok: false,
  rpn: [],
  headsUsed: [],
  varsUsed: [],
  errors,
});

/**
 * Compiles a formula. With `pass` 1, a second-pass variable (GROSS_EARNED, PF_WAGE, BASIC_DA) is an error
 * at authoring time — an earning cannot use what is only known after gross.
 */
export function compile(source: string, pass?: 1 | 2): Compiled {
  const lex = tokenize(source);
  if (!lex.ok) return failed(lex.errors);
  const tokens = lex.tokens;
  if (tokens.length > FORMULA_MAX_TOKENS)
    return failed([`Formula has too many tokens (max ${String(FORMULA_MAX_TOKENS)}).`]);
  if (pass === 1) {
    const later = tokens.find(
      (tk) => tk.t === 'IDENT' && (PASS_2_ONLY_VARS as readonly string[]).includes(tk.v),
    );
    if (later)
      return failed([
        `'${later.v}' is a pass-2 variable (available only after gross is computed) — it cannot be used in a pass-1 earning formula.`,
      ]);
  }
  const out: Rpn[] = [];
  type StackItem =
    { t: 'OP'; v: string } | { t: 'FUNC'; v: string; args: number } | { t: 'LPAREN' };
  const stack: StackItem[] = [];
  const heads = new Set<string>();
  const vars = new Set<string>();
  let prev: TokenType | null = null;
  const top = () => stack[stack.length - 1];
  for (const tk of tokens) {
    if (
      (tk.t === 'NUM' || tk.t === 'IDENT' || tk.t === 'HEADREF' || tk.t === 'FUNC') &&
      (prev === 'NUM' || prev === 'IDENT' || prev === 'HEADREF' || prev === 'RPAREN')
    )
      return failed([`Unexpected '${tk.v}' at position ${String(tk.pos)} — missing operator?`]);
    switch (tk.t) {
      case 'NUM':
        out.push({ t: 'NUM', n: tk.n! });
        break;
      case 'HEADREF':
        heads.add(tk.v);
        out.push({ t: 'HEADREF', v: tk.v });
        break;
      case 'IDENT':
        vars.add(tk.v);
        out.push({ t: 'IDENT', v: tk.v });
        break;
      case 'FUNC': {
        if (
          tk.v === 'IF' &&
          stack.filter((s) => s.t === 'FUNC' && s.v === 'IF').length >= IF_MAX_DEPTH
        )
          return failed([
            `IF() nested deeper than 5 levels at position ${String(tk.pos)} — simplify the formula.`,
          ]);
        stack.push({ t: 'FUNC', v: tk.v, args: 1 });
        break;
      }
      case 'COMMA': {
        if (prev === 'LPAREN' || prev === 'COMMA')
          return failed([`Empty function argument at position ${String(tk.pos)}.`]);
        while (stack.length && top()!.t !== 'LPAREN') out.push(stack.pop() as Rpn);
        if (!stack.length) return failed([`Misplaced ',' at position ${String(tk.pos)}.`]);
        const lp = stack.pop()!;
        const fn = top();
        if (fn?.t !== 'FUNC')
          return failed([`',' outside a function call at position ${String(tk.pos)}.`]);
        fn.args += 1;
        stack.push(lp);
        break;
      }
      case 'OP': {
        let op = tk.v;
        if (
          (op === '-' || op === '+') &&
          (prev === null || prev === 'OP' || prev === 'LPAREN' || prev === 'COMMA')
        ) {
          if (op === '+') break; // unary plus: nothing (as the legacy: `prev` still becomes OP)
          op = 'u-';
        }
        for (let t = top(); t?.t === 'OP'; t = top()) {
          const higher = PRECEDENCE[t.v]! > PRECEDENCE[op]!;
          const leftAssoc = PRECEDENCE[t.v] === PRECEDENCE[op] && op !== 'u-';
          if (!higher && !leftAssoc) break;
          out.push(stack.pop() as Rpn);
        }
        stack.push({ t: 'OP', v: op });
        break;
      }
      case 'LPAREN':
        stack.push({ t: 'LPAREN' });
        break;
      case 'RPAREN': {
        if (prev === 'LPAREN' || prev === 'COMMA')
          return failed([`Empty parentheses/argument at position ${String(tk.pos)}.`]);
        while (stack.length && top()!.t !== 'LPAREN') out.push(stack.pop() as Rpn);
        if (!stack.length) return failed([`Unbalanced ')' at position ${String(tk.pos)}.`]);
        stack.pop();
        const fn = top();
        if (fn?.t === 'FUNC') {
          stack.pop();
          const [min, max] = FUNCTIONS[fn.v]!;
          if (fn.args < min || (max !== null && fn.args > max))
            return failed([
              `${fn.v}() expects ${max === null ? `at least ${String(min)}` : String(min)} argument(s), got ${String(fn.args)}.`,
            ]);
          out.push({ t: 'FUNC', v: fn.v, args: fn.args });
        }
        break;
      }
    }
    prev = tk.t;
  }
  // (a function name is always followed by '(' and the formula is never empty here)
  if (prev === 'OP' || prev === 'COMMA' || prev === 'LPAREN')
    return failed(['Formula ends unexpectedly (trailing operator or empty expression).']);
  while (stack.length) {
    const s = stack.pop()!;
    if (s.t !== 'OP') return failed(['Unbalanced parenthesis.']);
    out.push(s);
  }
  if (out.length === 0) return failed(['Formula has no computable expression.']);
  return { ok: true, rpn: out, headsUsed: [...heads], varsUsed: [...vars], errors: [] };
}

/** micro × micro → micro, half-up to the micro. */
export function microMul(a: bigint, b: bigint): bigint {
  if ((a < 0n ? -a : a) > MICRO_LIMIT || (b < 0n ? -b : b) > MICRO_LIMIT)
    throw new FormulaError('Formula overflow: operand exceeds the 92,00,000 engine limit.');
  return divHalfUp(a * b, MICRO_PER_RUPEE);
}

/** micro ÷ micro → micro, half-up to the micro. */
export function microDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new FormulaError('Formula error: division by zero.');
  if ((b < 0n ? -b : b) > MICRO_LIMIT)
    throw new FormulaError('Formula overflow: divisor exceeds the engine limit.');
  const sign = a < 0n !== b < 0n ? -1n : 1n;
  const ua = a < 0n ? -a : a;
  const ub = b < 0n ? -b : b;
  return sign * divHalfUp(ua * MICRO_PER_RUPEE, ub);
}

const TRUE = MICRO_PER_RUPEE;

/**
 * Evaluates a compiled formula. `heads` and `vars` hold micro-rupees ([BASIC] → 52000 rupees =
 * 52_000_000_000n; DA_RATE 0.58 → 580_000n; PAID_DAYS 30 → 30_000_000n).
 */
export function evaluate(
  compiled: Compiled,
  heads: Readonly<Record<string, bigint>>,
  vars: Readonly<Record<string, bigint>>,
): Evaluated {
  const bad = (errors: string[]): Evaluated => ({ ok: false, micro: 0n, paise: 0n, errors });
  if (!compiled.ok || compiled.rpn.length === 0)
    return bad(compiled.errors.length ? compiled.errors : ['Formula was not compiled.']);
  const stack: bigint[] = [];
  try {
    for (const node of compiled.rpn) {
      switch (node.t) {
        case 'NUM':
          stack.push(node.n);
          break;
        case 'HEADREF':
          if (!Object.prototype.hasOwnProperty.call(heads, node.v))
            return bad([
              `Unknown head reference [${node.v}] — not in the value bag (check DependsOn / calc order).`,
            ]);
          stack.push(heads[node.v]!);
          break;
        case 'IDENT':
          if (!Object.prototype.hasOwnProperty.call(vars, node.v))
            return bad([
              `Unknown variable '${node.v}' — no rate/system value supplied for this pass.`,
            ]);
          stack.push(vars[node.v]!);
          break;
        case 'OP': {
          if (node.v === 'u-') {
            if (stack.length < 1) return bad(['Malformed expression (unary).']);
            stack.push(-stack.pop()!);
            break;
          }
          if (stack.length < 2) return bad(['Malformed expression (operator arity).']);
          const b = stack.pop()!;
          const a = stack.pop()!;
          stack.push(binary(node.v, a, b));
          break;
        }
        case 'FUNC': {
          if (stack.length < node.args) return bad(['Malformed expression (function arity).']);
          const args = stack.splice(stack.length - node.args, node.args);
          stack.push(call(node.v, args));
          break;
        }
      }
    }
  } catch (e) {
    if (e instanceof FormulaError) return bad([e.message]);
    throw e;
  }
  if (stack.length !== 1) return bad(['Malformed expression (unbalanced result).']);
  const micro = stack[0]!;
  return { ok: true, micro, paise: microToPaise(micro), errors: [] };
}

function binary(op: string, a: bigint, b: bigint): bigint {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return microMul(a, b);
    case '/':
      return microDiv(a, b);
    case '>':
      return a > b ? TRUE : 0n;
    case '<':
      return a < b ? TRUE : 0n;
    case '>=':
      return a >= b ? TRUE : 0n;
    case '<=':
      return a <= b ? TRUE : 0n;
    case '==':
      return a === b ? TRUE : 0n;
    default: // '!='
      return a !== b ? TRUE : 0n;
  }
}

function call(fn: string, args: bigint[]): bigint {
  switch (fn) {
    case 'MIN':
      return args.reduce((m, x) => (x < m ? x : m));
    case 'MAX':
      return args.reduce((m, x) => (x > m ? x : m));
    case 'ROUND': // to the whole rupee, half-up away from zero
      return divHalfUp(args[0]!, MICRO_PER_RUPEE) * MICRO_PER_RUPEE;
    case 'FLOOR':
      return floorTo(args[0]!, MICRO_PER_RUPEE);
    case 'CEIL':
      return ceilTo(args[0]!, MICRO_PER_RUPEE);
    default: // IF: both branches are already evaluated
      return args[0] !== 0n ? args[1]! : args[2]!;
  }
}

/** The heads a formula refers to ([X]) — the input of the calculation order. */
export function dependencies(source: string): { ok: boolean; heads: string[]; errors: string[] } {
  const c = compile(source);
  return { ok: c.ok, heads: c.headsUsed, errors: c.errors };
}
