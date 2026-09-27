import { Body, Controller, Get, Param, Post, Put, Req, Res, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { Public } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PLATFORM } from '../platform/platform.permissions';
import { CreateUploadDto } from './files.dto';
import { FilesService } from './files.service';

@ApiTags('files')
@ApiBearerAuth()
@Controller('platform/files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @ApiOperation({ summary: 'Register a file and obtain a signed upload URL' })
  @RequirePermission(PLATFORM.filesUpload, { description: 'Obtain signed upload URLs' })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateUploadDto) {
    return this.files.createUpload(ctx, body);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Confirm an upload (object storage drivers)' })
  @RequirePermission(PLATFORM.filesUpload)
  complete(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.files.complete(ctx, id);
  }

  @Get(':id')
  @RequirePermission(PLATFORM.filesView, { description: 'Obtain download URLs for files' })
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.files.get(ctx, id);
  }

  @Get(':id/download-url')
  @ApiOperation({ summary: 'Signed download URL (sensitive downloads are audited)' })
  @RequirePermission(PLATFORM.filesView)
  downloadUrl(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.files.downloadUrl(ctx, id);
  }

  // ---- local driver: token-authenticated byte endpoints -------------------------------------------
  @Put('local')
  @Public()
  @ApiOperation({ summary: 'Local storage driver upload target (HMAC token in the query string)' })
  async localPut(@Query('token') token: string, @Req() req: FastifyRequest) {
    const body = req.body;
    if (!Buffer.isBuffer(body))
      throw new DomainError(
        'validation-failed',
        'Send the file bytes as the request body with its content type',
        { status: 400 },
      );
    return this.files.localPut(token, body);
  }

  @Get('local')
  @Public()
  @ApiOperation({ summary: 'Local storage driver download (HMAC token in the query string)' })
  async localGet(@Query('token') token: string, @Res() reply: FastifyReply) {
    const { bytes, contentType, fileName } = await this.files.localGet(token);
    void reply
      .header('content-type', contentType)
      .header('content-disposition', `attachment; filename="${fileName.replace(/[^\w.-]+/g, '_')}"`)
      .header('cache-control', 'private, no-store')
      .send(bytes);
  }
}
