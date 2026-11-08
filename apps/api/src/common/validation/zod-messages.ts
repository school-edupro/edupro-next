import { z } from 'zod';

/**
 * zod 4 words its default messages differently from zod 3 ("Invalid input: expected string, received
 * undefined" where zod 3 said "Required"). The screens show these messages under each box
 * ("path: message"), so the API keeps zod 3's wording: this map gives zod 3's default sentence for
 * each issue and leaves anything else to zod's own English. A message written on a schema
 * (`.min(1, 'Give the name')`, `{ message }` or `{ error }`) still wins over this map.
 */
type RawIssue = z.core.$ZodRawIssue;

const v3Type = (input: unknown): string => {
  if (input === undefined) return 'undefined';
  if (input === null) return 'null';
  if (typeof input === 'number') return Number.isNaN(input) ? 'nan' : 'number';
  if (Array.isArray(input)) return 'array';
  if (input instanceof Date) return 'date';
  if (input instanceof Map) return 'map';
  if (input instanceof Set) return 'set';
  if (input instanceof Promise) return 'promise';
  return typeof input;
};

const quote = (values: readonly unknown[], sep: string) =>
  values.map((v) => (typeof v === 'string' ? `'${v}'` : String(v))).join(sep);

/** zod 4's names for string formats where zod 3 used another */
const FORMAT_V3: Record<string, string> = {
  guid: 'uuid',
  ipv4: 'ip',
  ipv6: 'ip',
  cidrv4: 'cidr',
  cidrv6: 'cidr',
};

export function zod3Message(issue: RawIssue): string | undefined {
  switch (issue.code) {
    case 'invalid_type': {
      if (issue.input === undefined) return 'Required';
      if (issue.expected === 'int')
        return `Expected integer, received ${typeof issue.input === 'number' ? 'float' : v3Type(issue.input)}`;
      return `Expected ${issue.expected}, received ${v3Type(issue.input)}`;
    }
    case 'invalid_value': {
      const def = (issue.inst as { _zod?: { def?: { type?: string } } } | undefined)?._zod?.def;
      if (def?.type === 'literal' && issue.values.length === 1)
        return `Invalid literal value, expected ${JSON.stringify(issue.values[0])}`;
      return `Invalid enum value. Expected ${quote(issue.values, ' | ')}, received '${String(issue.input)}'`;
    }
    case 'too_small': {
      const { minimum, inclusive, exact } = issue;
      switch (issue.origin) {
        case 'array':
          return `Array must contain ${exact ? 'exactly' : inclusive ? 'at least' : 'more than'} ${String(minimum)} element(s)`;
        case 'string':
          return `String must contain ${exact ? 'exactly' : inclusive ? 'at least' : 'over'} ${String(minimum)} character(s)`;
        case 'number':
        case 'int':
        case 'bigint':
          return `Number must be ${exact ? 'exactly equal to ' : inclusive ? 'greater than or equal to ' : 'greater than '}${String(minimum)}`;
        case 'date':
          return `Date must be ${exact ? 'exactly equal to ' : inclusive ? 'greater than or equal to ' : 'greater than '}${new Date(Number(minimum)).toString()}`;
        default:
          return undefined;
      }
    }
    case 'too_big': {
      const { maximum, inclusive, exact } = issue;
      switch (issue.origin) {
        case 'array':
          return `Array must contain ${exact ? 'exactly' : inclusive ? 'at most' : 'less than'} ${String(maximum)} element(s)`;
        case 'string':
          return `String must contain ${exact ? 'exactly' : inclusive ? 'at most' : 'under'} ${String(maximum)} character(s)`;
        case 'number':
        case 'int':
        case 'bigint':
          return `Number must be ${exact ? 'exactly' : inclusive ? 'less than or equal to' : 'less than'} ${String(maximum)}`;
        case 'date':
          return `Date must be ${exact ? 'exactly' : inclusive ? 'smaller than or equal to' : 'smaller than'} ${new Date(Number(maximum)).toString()}`;
        default:
          return undefined;
      }
    }
    case 'invalid_format': {
      const i = issue as RawIssue & { prefix?: string; suffix?: string; includes?: string };
      switch (issue.format) {
        case 'starts_with':
          return `Invalid input: must start with "${String(i.prefix)}"`;
        case 'ends_with':
          return `Invalid input: must end with "${String(i.suffix)}"`;
        case 'includes':
          return `Invalid input: must include "${String(i.includes)}"`;
        case 'regex':
          return 'Invalid';
        case 'lowercase':
        case 'uppercase':
          return undefined;
        default:
          return `Invalid ${FORMAT_V3[issue.format] ?? issue.format}`;
      }
    }
    case 'not_multiple_of':
      return `Number must be a multiple of ${String(issue.divisor)}`;
    case 'unrecognized_keys':
      return `Unrecognized key(s) in object: ${quote(issue.keys, ', ')}`;
    case 'invalid_key':
      // zod 3 reported the key schema's own issue (often a message written on the key's regex)
      return issue.issues[0]?.message;
    default:
      return undefined;
  }
}

z.config({ customError: zod3Message });
