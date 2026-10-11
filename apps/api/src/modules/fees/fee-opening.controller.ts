import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { FeeOpeningService } from './fee-opening.service';
import { FEES } from './fees.dto';

const BULK = 'fees.bulk.upload';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const Id = z.string().regex(/^\d{1,18}$/);

class FormatDto extends createZodDto(z.object({ classId: Id.optional() })) {}
class UploadDto extends createZodDto(
  z.object({
    fileBase64: z.string().min(20).max(4_000_000),
    fileName: z.string().trim().max(200).optional(),
  }),
) {}
class SubmitDto extends createZodDto(
  z.object({
    action: z.enum(['submit', 'cancel']),
    reason: z.string().trim().max(300).optional(),
  }),
) {}
class DecideDto extends createZodDto(
  z.object({
    outcome: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(300).optional(),
  }),
) {}

/** Opening balances of many pupils from Excel: format, check, approval, apply (0121). */
@ApiTags('fees')
@ApiBearerAuth()
@Controller('fees/opening')
export class FeeOpeningController {
  constructor(private readonly opening: FeeOpeningService) {}

  @Get('format.xlsx')
  @ApiOperation({
    summary: 'The Excel format for opening balances, optionally with a class filled in',
  })
  @RequirePermission(BULK)
  async format(@ReqCtx() ctx: RequestContext, @Query() q: FormatDto, @Res() reply: FastifyReply) {
    const f = await this.opening.format(ctx, q.classId);
    reply
      .header('content-type', XLSX)
      .header('content-disposition', `attachment; filename="${f.filename}"`)
      .send(f.bytes);
  }

  @Get('uploads')
  @ApiOperation({ summary: 'Opening balance files of the year' })
  @RequirePermission(BULK)
  async list(@ReqCtx() ctx: RequestContext) {
    return { data: await this.opening.list(ctx) };
  }

  @Get('uploads/:id')
  @RequirePermission(BULK)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.opening.get(ctx, id);
  }

  @Post('uploads')
  @ApiOperation({ summary: 'Upload and check an opening balance file (kept as a draft)' })
  @RequirePermission(BULK)
  upload(@ReqCtx() ctx: RequestContext, @Body() body: UploadDto) {
    return this.opening.upload(ctx, body.fileBase64, body.fileName);
  }

  @Post('uploads/:id/submit')
  @ApiOperation({ summary: 'Send a checked file for approval, or drop it' })
  @RequirePermission(BULK)
  submit(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: SubmitDto) {
    return this.opening.submit(ctx, id, body);
  }

  @Post('uploads/:id/decide')
  @ApiOperation({ summary: 'Approve or reject a file where no approval levels are in force' })
  @RequirePermission(FEES.adjustmentApprove)
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: DecideDto) {
    return this.opening.decide(ctx, id, body);
  }
}
