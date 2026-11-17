import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { CertificateImportsService } from './certificate-imports.service';
import {
  BulkPreviewDto,
  CERTIFICATE,
  ImportReuploadDto,
  ImportUploadDto,
} from './certificates.dto';

/** Certificates from an Excel sheet (docs/design/87, 17 Nov 2026): the sheet, the upload, the check, the issue. */
@ApiTags('certificates')
@ApiBearerAuth()
@Controller('certificates/imports')
export class CertificateImportsController {
  constructor(private readonly imports: CertificateImportsService) {}

  @Post('sheet')
  @ApiOperation({
    summary: "A certificate's sheet for a scope: one row a person, filled from the records",
  })
  @RequirePermission(CERTIFICATE.issue)
  sheet(@ReqCtx() ctx: RequestContext, @Body() body: BulkPreviewDto) {
    return this.imports.sheet(ctx, body);
  }

  @Get()
  @ApiOperation({ summary: 'The uploads, newest first, with their figures' })
  @RequirePermission(CERTIFICATE.issue)
  list(@ReqCtx() ctx: RequestContext) {
    return this.imports.list(ctx);
  }

  @Post()
  @ApiOperation({ summary: 'Upload a filled sheet: each row checked, kept as a draft' })
  @RequirePermission(CERTIFICATE.issue)
  upload(@ReqCtx() ctx: RequestContext, @Body() body: ImportUploadDto) {
    return this.imports.upload(ctx, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'An upload with its figures and rows' })
  @RequirePermission(CERTIFICATE.issue)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.imports.get(ctx, id);
  }

  @Post(':id/upload')
  @ApiOperation({
    summary: 'A corrected sheet into the same upload; every row not issued checked again',
  })
  @RequirePermission(CERTIFICATE.issue)
  reupload(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: ImportReuploadDto,
  ) {
    return this.imports.reupload(ctx, id, body);
  }

  @Post(':id/verify')
  @ApiOperation({ summary: 'Check every row not issued again' })
  @RequirePermission(CERTIFICATE.issue)
  verify(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.imports.verify(ctx, id);
  }

  @Get(':id/errors')
  @ApiOperation({ summary: 'The rows needing attention as a sheet, with what to fix' })
  @RequirePermission(CERTIFICATE.issue)
  errors(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.imports.errors(ctx, id);
  }

  @Post(':id/issue')
  @ApiOperation({
    summary: 'Issue the rows that are ready, in one run (a batch a section or department)',
  })
  @RequirePermission(CERTIFICATE.issue)
  issue(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.imports.issue(ctx, id);
  }
}
