import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const blank = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess(
    (v) => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v),
    s.optional(),
  );

/** A file: what it is about, the note, the papers, and the approvers in order (level 1 first). */
export const FileNoteSchema = z
  .object({
    subject: z.string().trim().min(3, 'Write the subject (at least 3 letters)').max(200),
    bodyHtml: z.string().trim().min(1, 'Write the message').max(60_000),
    fileIds: z.array(IdSchema).max(4, 'At most 4 attachments').default([]),
    approverIds: z
      .array(IdSchema)
      .min(1, 'Choose the level 1 approver')
      .max(5, 'At most 5 approval levels'),
  })
  .refine((v) => new Set(v.approverIds).size === v.approverIds.length, {
    message: 'The same person cannot approve at two levels',
    path: ['approverIds'],
  });
export class FileNoteDto extends createZodDto(FileNoteSchema) {}

export const FileDecideSchema = z
  .object({
    outcome: z.enum(['approved', 'returned', 'rejected']),
    remark: blank(z.string().trim().max(1000)),
  })
  .refine((v) => v.outcome === 'approved' || (v.remark && v.remark.length >= 3), {
    message: 'Write the remark: what must change, or why it is rejected',
    path: ['remark'],
  });
export class FileDecideDto extends createZodDto(FileDecideSchema) {}

export const FileListSchema = z.object({
  box: z.enum(['inbox', 'mine', 'acted', 'all']).default('inbox'),
  status: blank(z.enum(['pending', 'returned', 'approved', 'rejected', 'withdrawn'])),
  from: blank(DateSchema),
  to: blank(DateSchema),
  creatorId: blank(IdSchema),
  approverId: blank(IdSchema),
  q: blank(z.string().trim().max(80)),
});
export class FileListDto extends createZodDto(FileListSchema) {}

export const FileExportSchema = FileListSchema.extend({
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
});
export class FileExportDto extends createZodDto(FileExportSchema) {}
