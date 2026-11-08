import { z } from 'zod';
import { patchOf } from './patch-of';

describe('patchOf', () => {
  const Create = z.object({
    name: z.string().min(1),
    gender: z.enum(['female', 'male', 'unspecified']).default('unspecified'),
    address: z.record(z.string(), z.unknown()).default({}),
    tags: z.array(z.string()).prefault([]),
    house: z.string().nullable(),
  });
  const Update = patchOf(Create);

  it('leaves out what the update leaves out (zod 4 .partial() would fill the defaults in)', () => {
    expect(Create.partial().parse({ house: 'Red' })).toEqual({
      house: 'Red',
      gender: 'unspecified',
      address: {},
      tags: [],
    });
    expect(Update.parse({ house: 'Red' })).toEqual({ house: 'Red' });
    expect(Update.parse({})).toEqual({});
  });

  it('still checks what is sent', () => {
    expect(Update.parse({ gender: 'female', house: null })).toEqual({
      gender: 'female',
      house: null,
    });
    expect(Update.safeParse({ gender: 'other' }).success).toBe(false);
    expect(Update.safeParse({ name: '' }).success).toBe(false);
  });

  it('keeps the object settings and chains like .partial()', () => {
    const Strict = patchOf(z.strictObject({ a: z.string().default('x') }));
    expect(Strict.safeParse({ b: 1 }).success).toBe(false);
    const Refined = patchOf(Create).refine((v) => Object.keys(v).length > 0, 'at least one field');
    expect(Refined.safeParse({}).success).toBe(false);
  });
});
