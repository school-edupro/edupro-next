import { z } from 'zod';

type Bare<S> =
  S extends z.ZodDefault<infer I extends z.core.SomeType>
    ? I
    : S extends z.ZodPrefault<infer I extends z.core.SomeType>
      ? I
      : S;
export type PatchShape<S extends z.core.$ZodShape> = {
  -readonly [K in keyof S]: z.ZodOptional<Bare<S[K]> & z.core.SomeType>;
};

/**
 * The body of an update (PATCH) made from a create schema: every field optional, and a field left out
 * stays out. Use it instead of `.partial()`: zod 4's `.partial()` fills each field's `.default()` in
 * when the field is absent (zod 3 did not), so an update that sends only `{ house }` would also reset
 * gender, address and the rest to their defaults.
 */
export function patchOf<S extends z.core.$ZodShape, C extends z.core.$ZodObjectConfig>(
  schema: z.ZodObject<S, C>,
): z.ZodObject<PatchShape<S>, C> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const bare =
      field instanceof z.ZodDefault || field instanceof z.ZodPrefault ? field.unwrap() : field;
    shape[key] = (bare as z.ZodType).optional();
  }
  return schema.extend(shape) as unknown as z.ZodObject<PatchShape<S>, C>;
}
