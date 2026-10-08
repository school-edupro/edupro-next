import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { FeeGridsService } from './fee-grids.service';
import { FEES } from './fees.dto';

const Id = z.string().regex(/^\d{1,18}$/, 'must be a numeric id');
const Key = z.object({
  classId: Id,
  feeGroup: z
    .string()
    .trim()
    .regex(/^[a-z_]{1,30}$/)
    .default('general'),
  studentType: z.enum(['all', 'new', 'old']).default('all'),
});
const Format = z.object({ format: z.enum(['xlsx', 'pdf']).default('xlsx') });
const File = z.object({ fileBase64: z.string().min(20).max(4_000_000) });
const Money = z.number().min(0).max(100_000_000);

class KeyDto extends createZodDto(Key) {}
class KeyFileDto extends createZodDto(Key.merge(Format)) {}
class SaveStructureDto extends createZodDto(
  Key.extend({
    rows: z.array(z.object({ headId: Id, amounts: z.array(Money).length(12) })).max(200),
  }),
) {}
class CloneStructureDto extends createZodDto(
  Key.extend({ toClassIds: z.array(Id).min(1).max(60) }),
) {}
class ImportStructureDto extends createZodDto(Key.merge(File)) {}
class FormatDto extends createZodDto(Format) {}
class FileDto extends createZodDto(File) {}
class SaveDiscountDto extends createZodDto(
  z.object({
    rows: z
      .array(
        z.object({
          headId: Id,
          percent: z.number().min(0).max(100).nullable().optional(),
          amount: Money.nullable().optional(),
        }),
      )
      .max(200),
  }),
) {}
class CalendarFileDto extends createZodDto(z.object({ classId: Id }).merge(Format)) {}
class CalendarImportDto extends createZodDto(z.object({ classId: Id }).merge(File)) {}

const send = (
  reply: FastifyReply,
  f: { bytes: Buffer | Uint8Array; filename: string; contentType: string },
) =>
  reply
    .header('content-type', f.contentType)
    .header('content-disposition', `attachment; filename="${f.filename}"`)
    .send(f.bytes);

/** Fee set-up grids: class fee structure by month, discount by head, and their Excel / PDF files. */
@ApiTags('fees')
@ApiBearerAuth()
@Controller('fees/grids')
export class FeeGridsController {
  constructor(private readonly grids: FeeGridsService) {}

  @Get('structure')
  @ApiOperation({ summary: 'Fee heads by month for a class, fee group and student type' })
  @RequirePermission(FEES.masterView)
  structure(@ReqCtx() ctx: RequestContext, @Query() q: KeyDto) {
    return this.grids.structure(ctx, q);
  }

  @Put('structure')
  @ApiOperation({ summary: 'Save the month-wise amounts of the heads sent' })
  @RequirePermission(FEES.masterManage)
  saveStructure(@ReqCtx() ctx: RequestContext, @Body() body: SaveStructureDto) {
    const { rows, ...key } = body;
    return this.grids.saveStructure(ctx, key, rows);
  }

  @Post('structure/clone')
  @ApiOperation({ summary: "Copy a class's structure onto other classes" })
  @RequirePermission(FEES.masterManage)
  cloneStructure(@ReqCtx() ctx: RequestContext, @Body() body: CloneStructureDto) {
    const { toClassIds, ...key } = body;
    return this.grids.cloneStructure(ctx, key, toClassIds);
  }

  @Get('structure/file')
  @ApiOperation({ summary: 'The structure as Excel (to correct and upload) or PDF' })
  @RequirePermission(FEES.masterView)
  async structureFile(
    @ReqCtx() ctx: RequestContext,
    @Query() q: KeyFileDto,
    @Res() reply: FastifyReply,
  ) {
    const { format, ...key } = q;
    send(reply, await this.grids.structureFile(ctx, key, format));
  }

  @Post('structure/import')
  @HttpCode(200)
  @ApiOperation({ summary: 'Upload the structure Excel; nothing is saved if a row is wrong' })
  @RequirePermission(FEES.masterManage)
  importStructure(@ReqCtx() ctx: RequestContext, @Body() body: ImportStructureDto) {
    const { fileBase64, ...key } = body;
    return this.grids.importStructure(ctx, key, fileBase64);
  }

  @Get('discount/:id')
  @ApiOperation({ summary: 'A discount head by head: percentage or fixed amount' })
  @RequirePermission(FEES.masterView)
  discount(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.grids.discount(ctx, id);
  }

  @Put('discount/:id')
  @ApiOperation({ summary: 'Save the head lines of a discount' })
  @RequirePermission(FEES.masterManage)
  saveDiscount(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: SaveDiscountDto,
  ) {
    return this.grids.saveDiscount(ctx, id, body.rows);
  }

  @Get('discount/:id/file')
  @ApiOperation({ summary: 'The discount as Excel (to correct and upload) or PDF' })
  @RequirePermission(FEES.masterView)
  async discountFile(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: FormatDto,
    @Res() reply: FastifyReply,
  ) {
    send(reply, await this.grids.discountFile(ctx, id, q.format));
  }

  @Post('discount/:id/import')
  @HttpCode(200)
  @ApiOperation({ summary: 'Upload the discount Excel' })
  @RequirePermission(FEES.masterManage)
  importDiscount(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: FileDto) {
    return this.grids.importDiscount(ctx, id, body.fileBase64);
  }

  @Get('calendar/file')
  @ApiOperation({ summary: 'The class fee calendar as Excel (to correct and upload) or PDF' })
  @RequirePermission(FEES.masterView)
  async calendarFile(
    @ReqCtx() ctx: RequestContext,
    @Query() q: CalendarFileDto,
    @Res() reply: FastifyReply,
  ) {
    send(reply, await this.grids.calendarFile(ctx, q.classId, q.format));
  }

  @Post('calendar/import')
  @HttpCode(200)
  @ApiOperation({ summary: 'Upload the class fee calendar Excel' })
  @RequirePermission(FEES.masterManage)
  importCalendar(@ReqCtx() ctx: RequestContext, @Body() body: CalendarImportDto) {
    return this.grids.importCalendar(ctx, body.classId, body.fileBase64);
  }
}
