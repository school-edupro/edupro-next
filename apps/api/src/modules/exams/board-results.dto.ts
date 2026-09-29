import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const BOARD_RESULTS = {
  view: 'exams.board_result.view',
  import: 'exams.board_result.import',
} as const;

export const BoardUploadSchema = z
  .object({
    board: z
      .string()
      .trim()
      .regex(/^[A-Z]{2,10}$/)
      .default('CBSE'),
    classLabel: z
      .string()
      .trim()
      .regex(/^(X|XII|10|12)$/),
    fileName: z.string().trim().max(200).optional(),
    csv: z.string().max(4_000_000).optional(),
    contentBase64: z.string().max(6_000_000).optional(),
  })
  .refine((v) => Boolean(v.csv) !== Boolean(v.contentBase64), {
    message: 'Send either csv or contentBase64',
  });
export class BoardUploadDto extends createZodDto(BoardUploadSchema) {}

export const BoardListQuerySchema = z.object({
  board: z.string().trim().max(10).optional(),
  classLabel: z.string().trim().max(4).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(500).default(100),
});
export class BoardListQueryDto extends createZodDto(BoardListQuerySchema) {}
