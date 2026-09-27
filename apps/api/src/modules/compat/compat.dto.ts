import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Legacy handshake: base64url JSON payload and an HMAC-SHA256 signature, joined by a dot. */
export const HandshakeSchema = z.object({
  token: z.string().min(10).max(4000),
  /** student | employee | parent, as the current apps send it */
  type: z.enum(['student', 'employee', 'parent']).optional(),
  device_id: z.string().max(120).optional(),
  fcm_token: z.string().max(400).optional(),
});
export class HandshakeDto extends createZodDto(HandshakeSchema) {}

export const HandshakePayloadSchema = z.object({
  user_id_string: z.string().min(1).max(60),
  school_id: z.union([z.string(), z.number()]),
  mobile_number: z.string().optional(),
  email: z.string().optional(),
  user_type: z.enum(['student', 'employee', 'parent']).optional(),
  exp: z.number().int(),
  iat: z.number().int().optional(),
});
export type HandshakePayload = z.infer<typeof HandshakePayloadSchema>;
