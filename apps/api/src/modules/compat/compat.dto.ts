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

// ---- Sprint 11: teacher app writes (legacy field names kept) --------------------------------------------
export const UploadDailyworkSchema = z
  .object({
    SubmitType: z.string().trim().max(20).optional(),
    cboClass: z.string().trim().min(2).max(20),
    cboSubject: z.string().trim().max(60).optional(),
    txtDate: z.string().trim().max(10).optional(),
    txtDueDate: z.string().trim().max(10).optional(),
    txtTitle: z.string().trim().max(160).optional(),
    homework: z.string().trim().max(8000).optional(),
    classwork: z.string().trim().max(8000).optional(),
    txtDescription: z.string().trim().max(8000).optional(),
    EmpId: z.string().trim().max(20).optional(),
  })
  .refine((v) => (v.homework ?? v.classwork ?? v.txtDescription ?? '').length > 0, {
    message: 'homework or classwork text is required',
    path: ['homework'],
  });
export class UploadDailyworkDto extends createZodDto(UploadDailyworkSchema) {}

export const UploadAttendanceSchema = z.object({
  cboClass: z.string().trim().min(2).max(20),
  cboSubject: z.string().trim().max(60).optional(),
  txtDate: z.string().trim().max(10).optional(),
  EmpId: z.string().trim().max(20).optional(),
  attendance: z
    .array(
      z.object({
        sadmission: z.string().trim().min(1).max(30),
        attendance: z.string().trim().max(10).default('P'),
        remark: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(200),
});
export class UploadAttendanceDto extends createZodDto(UploadAttendanceSchema) {}

export const NoticeActionSchema = z.object({
  action: z.string().trim().max(20).optional(),
  class: z.string().trim().max(20).optional(),
  sclass: z.string().trim().max(20).optional(),
  notice_title: z.string().trim().max(200).optional(),
  notice: z.string().trim().min(1).max(20000),
  notice_date: z.string().trim().max(10).optional(),
  EmpId: z.string().trim().max(20).optional(),
});
export class NoticeActionDto extends createZodDto(NoticeActionSchema) {}
