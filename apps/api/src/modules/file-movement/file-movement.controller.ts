import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { FileDecideDto, FileExportDto, FileListDto, FileNoteDto } from './file-movement.dto';
import { FileMovementService } from './file-movement.service';

/**
 * Digital file movement (0090). A file waits on the people its creator named, not on a role, so the
 * routes are open to every signed-in member of staff and the service checks who may do what.
 */
@ApiTags('file-movement')
@ApiBearerAuth()
@Controller('file-movement')
export class FileMovementController {
  constructor(private readonly files: FileMovementService) {}

  @Get('people')
  @ApiOperation({ summary: 'The employees who can be chosen as approvers' })
  @AuthenticatedOnly()
  people(@ReqCtx() ctx: RequestContext) {
    return this.files.people(ctx);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Files by status, month by month, who holds what' })
  @AuthenticatedOnly()
  dashboard(@ReqCtx() ctx: RequestContext) {
    return this.files.dashboard(ctx);
  }

  @Get('export')
  @ApiOperation({ summary: 'The list with its filters as Excel or PDF' })
  @AuthenticatedOnly()
  async export(
    @ReqCtx() ctx: RequestContext,
    @Query() q: FileExportDto,
    @Res() reply: FastifyReply,
  ) {
    const { format, ...filters } = q;
    const f = await this.files.export(ctx, filters, format);
    reply
      .header('content-type', f.contentType)
      .header('content-disposition', `attachment; filename="${f.filename}"`)
      .send(f.bytes);
  }

  @Get()
  @ApiOperation({ summary: 'Files: waiting for me, raised by me, decided by me, or all I may see' })
  @AuthenticatedOnly()
  list(@ReqCtx() ctx: RequestContext, @Query() q: FileListDto) {
    return this.files.list(ctx, q);
  }

  @Post()
  @ApiOperation({ summary: 'Raise a file for approval' })
  @AuthenticatedOnly()
  create(@ReqCtx() ctx: RequestContext, @Body() dto: FileNoteDto) {
    return this.files.create(ctx, dto);
  }

  @Get(':id')
  @AuthenticatedOnly()
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.files.get(ctx, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Correct a file that was sent back; it starts again from level 1' })
  @AuthenticatedOnly()
  resubmit(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: FileNoteDto) {
    return this.files.resubmit(ctx, id, dto);
  }

  @Post(':id/decide')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve, send back with a remark, or reject at my level' })
  @AuthenticatedOnly()
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: FileDecideDto) {
    return this.files.decide(ctx, id, dto);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @AuthenticatedOnly()
  withdraw(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.files.withdraw(ctx, id);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'The note sheet of an approved file' })
  @AuthenticatedOnly()
  async pdf(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Res() reply: FastifyReply) {
    const f = await this.files.pdf(ctx, id);
    reply
      .header('content-type', f.contentType)
      .header('content-disposition', `inline; filename="${f.filename}"`)
      .send(f.bytes);
  }

  @Get(':id/files/:fileId')
  @AuthenticatedOnly()
  file(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.files.fileUrl(ctx, id, fileId);
  }
}
