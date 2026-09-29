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

// ---- Sprint 20: parity endpoints (legacy field names kept) ----------------------------------------
const Adm = z.string().trim().max(30).optional();
export const SadmissionSchema = z.object({
  sadmission: Adm,
  sclass: z.string().trim().max(20).optional(),
  srollno: z.string().trim().max(10).optional(),
});
export class SadmissionDto extends createZodDto(SadmissionSchema) {}

export const AlbumImagesSchema = z.object({
  id: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional(),
  album_cover_item_id: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional(),
});
export class AlbumImagesDto extends createZodDto(AlbumImagesSchema) {}

export const GatePassQuerySchema = z.object({
  status: z.string().trim().max(20).optional(),
  type: z.string().trim().max(20).optional(),
  tab: z.string().trim().max(20).optional(),
  limit_value: z.coerce.number().int().min(1).max(200).default(50),
});
export class GatePassQueryDto extends createZodDto(GatePassQuerySchema) {}

export const SubmitGatePassSchema = z.object({
  gt_admission_id: z.string().trim().min(1).max(30),
  gt_type: z.string().trim().max(30).default('Early Leave'),
  gt_reason: z.string().trim().min(3).max(300),
  gt_accompanied: z.string().trim().max(120).optional(),
  gt_accompanied_other: z.string().trim().max(120).optional(),
  gt_accompanied_mobile: z.string().trim().max(15).optional(),
  gt_other_remark: z.string().trim().max(300).optional(),
  gt_issue_name: z.string().trim().max(120).optional(),
});
export class SubmitGatePassDto extends createZodDto(SubmitGatePassSchema) {}

export const UpdateGatePassStatusSchema = z.object({
  slip_no: z.string().trim().min(1).max(30),
  gate_pass_status: z.string().trim().max(20),
  emp_id: z.string().trim().max(20).optional(),
});
export class UpdateGatePassStatusDto extends createZodDto(UpdateGatePassStatusSchema) {}

export const VisitorQuerySchema = z.object({
  date: z.string().trim().max(10).optional(),
  status: z.string().trim().max(20).optional(),
  limit_value: z.coerce.number().int().min(1).max(200).default(50),
});
export class VisitorQueryDto extends createZodDto(VisitorQuerySchema) {}

export const SubmitVisitorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  mobile: z.string().trim().max(15).optional(),
  reason: z.string().trim().min(1).max(300),
  whom_to_meet: z.string().trim().max(120).optional(),
  select_id: z.string().trim().max(40).optional(),
  id_no: z.string().trim().max(40).optional(),
  en_gate_no: z.string().trim().max(20).optional(),
  admission_no: z.string().trim().max(30).optional(),
  type: z.string().trim().max(20).optional(),
});
export class SubmitVisitorDto extends createZodDto(SubmitVisitorSchema) {}

export const StudentLeaveSchema = z.object({
  student_id: z.string().trim().min(1).max(30),
  leave_type: z.string().trim().max(40).default('other'),
  from_date: z.string().trim().max(10),
  to_date: z.string().trim().max(10),
  leave_reason: z.string().trim().min(3).max(2000),
});
export class StudentLeaveDto extends createZodDto(StudentLeaveSchema) {}

export const SendQuerySchema = z.object({
  cboSubject: z.string().trim().max(160).optional(),
  txtQuery: z.string().trim().min(3).max(2000),
  depart: z.string().trim().max(60).optional(),
  EmpId: z.string().trim().max(20).optional(),
});
export class SendQueryDto extends createZodDto(SendQuerySchema) {}

export const AssignmentQuerySchema = z.object({
  class: z.string().trim().max(20).optional(),
  date_from: z.string().trim().max(10).optional(),
  date_to: z.string().trim().max(10).optional(),
});
export class AssignmentQueryDto extends createZodDto(AssignmentQuerySchema) {}

export const MarkEntryQuerySchema = z.object({
  class: z.string().trim().min(2).max(20),
  exam_type: z.string().trim().min(1).max(40),
  subject_code: z.string().trim().min(1).max(60),
});
export class MarkEntryQueryDto extends createZodDto(MarkEntryQuerySchema) {}

export const SubmitMarkEntrySchema = z.object({
  class: z.string().trim().min(2).max(20),
  exam_type: z.string().trim().min(1).max(40),
  subject_code: z.string().trim().max(60).optional(),
  subject_name: z.string().trim().max(60).optional(),
  emp_id: z.string().trim().max(20).optional(),
  data: z
    .array(
      z.object({
        student_id: z.string().trim().min(1).max(30),
        marks: z.union([z.string(), z.number()]).optional(),
        absent: z.union([z.string(), z.boolean()]).optional(),
      }),
    )
    .min(1)
    .max(200),
});
export class SubmitMarkEntryDto extends createZodDto(SubmitMarkEntrySchema) {}

export const AppVersionSchema = z.object({
  platform: z.string().trim().max(20).optional(),
  versioncode: z.string().trim().max(20).optional(),
  school_id: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional(),
});
export class AppVersionDto extends createZodDto(AppVersionSchema) {}
