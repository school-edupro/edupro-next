import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Content types accepted for upload and the extension stored on the object key. */
export const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

export const MAX_BYTES_BY_CLASS: Record<'public' | 'internal' | 'personal' | 'sensitive', number> =
  {
    public: 25 * 1024 * 1024,
    internal: 25 * 1024 * 1024,
    personal: 10 * 1024 * 1024,
    sensitive: 10 * 1024 * 1024,
  };

export const CreateUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(Object.keys(ALLOWED_CONTENT_TYPES) as [string, ...string[]]),
  sizeBytes: z.number().int().positive(),
  classification: z.enum(['public', 'internal', 'personal', 'sensitive']).default('internal'),
  ownerEntityType: z.string().trim().max(60).optional(),
  ownerEntityId: z.string().trim().max(60).optional(),
});
export class CreateUploadDto extends createZodDto(CreateUploadSchema) {}
