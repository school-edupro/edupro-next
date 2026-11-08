import { z } from 'zod';
import './zod-messages';

const messages = (schema: z.ZodType, value: unknown) => {
  const r = schema.safeParse(value);
  if (r.success) throw new Error('expected a failure');
  return r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('zod messages keep zod 3 wording', () => {
  it('missing and wrong types', () => {
    const s = z.object({
      name: z.string(),
      any: z.unknown(),
      on: z.coerce.boolean(),
      n: z.coerce.number(),
      i: z.number().int(),
      k: z.string(),
    });
    expect(messages(s, { i: 1.5, k: null, n: 'x' })).toEqual([
      'name: Required',
      'any: Required',
      'on: Required',
      'n: Expected number, received nan',
      'i: Expected integer, received float',
      'k: Expected string, received null',
    ]);
  });

  it('sizes, formats, enums and keys', () => {
    expect(messages(z.string().min(1), '')).toEqual([
      ': String must contain at least 1 character(s)',
    ]);
    expect(messages(z.string().max(2), 'abc')).toEqual([
      ': String must contain at most 2 character(s)',
    ]);
    expect(messages(z.string().length(2), 'a')).toEqual([
      ': String must contain exactly 2 character(s)',
    ]);
    expect(messages(z.number().min(3), 1)).toEqual([': Number must be greater than or equal to 3']);
    expect(messages(z.number().positive(), 0)).toEqual([': Number must be greater than 0']);
    expect(messages(z.number().max(9), 10)).toEqual([': Number must be less than or equal to 9']);
    expect(messages(z.array(z.string()).min(1), [])).toEqual([
      ': Array must contain at least 1 element(s)',
    ]);
    expect(messages(z.array(z.string()).max(1), ['a', 'b'])).toEqual([
      ': Array must contain at most 1 element(s)',
    ]);
    expect(messages(z.string().email(), 'x')).toEqual([': Invalid email']);
    expect(messages(z.string().uuid(), 'x')).toEqual([': Invalid uuid']);
    expect(messages(z.string().url(), 'x')).toEqual([': Invalid url']);
    expect(messages(z.string().datetime(), 'x')).toEqual([': Invalid datetime']);
    expect(messages(z.string().regex(/^\d+$/), 'x')).toEqual([': Invalid']);
    expect(messages(z.string().startsWith('a'), 'x')).toEqual([
      ': Invalid input: must start with "a"',
    ]);
    expect(messages(z.number().multipleOf(5), 3)).toEqual([': Number must be a multiple of 5']);
    expect(messages(z.enum(['a', 'b']), 'c')).toEqual([
      ": Invalid enum value. Expected 'a' | 'b', received 'c'",
    ]);
    expect(messages(z.literal('a'), 'c')).toEqual([': Invalid literal value, expected "a"']);
    expect(messages(z.strictObject({ a: z.string() }), { a: 'x', b: 1 })).toEqual([
      ": Unrecognized key(s) in object: 'b'",
    ]);
    expect(
      messages(z.record(z.string().regex(/^[a-z]+$/, 'small letters'), z.number()), { A: 1 }),
    ).toEqual(['A: small letters']);
  });

  it('a message on the schema still wins', () => {
    expect(messages(z.object({ a: z.string().min(2, 'too short') }), { a: 'x' })).toEqual([
      'a: too short',
    ]);
    expect(messages(z.object({ a: z.string({ error: 'Give a' }) }), {})).toEqual(['a: Give a']);
    expect(
      messages(
        z.object({ a: z.string() }).refine(() => false, { message: 'no', path: ['a'] }),
        { a: 'x' },
      ),
    ).toEqual(['a: no']);
  });
});
