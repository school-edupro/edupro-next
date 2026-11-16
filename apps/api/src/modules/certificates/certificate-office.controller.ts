import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { CertificateAwardsService } from './certificate-awards.service';
import { CertificateBulkService } from './certificate-bulk.service';
import { CertificateReportsService } from './certificate-reports.service';
import {
  AllotmentDto,
  AllotmentImportDto,
  AwardDto,
  BulkIssueDto,
  BulkPreviewDto,
  BulkRunDto,
  CERTIFICATE,
  IssueAllotmentsDto,
  ListAllotmentsQueryDto,
  ReportsFileQueryDto,
  ReportsQueryDto,
  TcBookFileQueryDto,
  TcBookQueryDto,
} from './certificates.dto';

/** Certificate management, phase E (docs/design/87): bulk issue, awards, the TC book register and the reports. */
@ApiTags('certificates')
@ApiBearerAuth()
@Controller('certificates')
export class CertificateOfficeController {
  constructor(
    private readonly bulk: CertificateBulkService,
    private readonly awards: CertificateAwardsService,
    private readonly reports: CertificateReportsService,
  ) {}

  // ---- bulk ----
  @Post('bulk/preview')
  @ApiOperation({
    summary: 'Each student of a section, a choice or the leavers, with what issuing would find',
  })
  @RequirePermission(CERTIFICATE.issue)
  bulkPreview(@ReqCtx() ctx: RequestContext, @Body() body: BulkPreviewDto) {
    return this.bulk.preview(ctx, body);
  }

  @Post('bulk/issue')
  @ApiOperation({ summary: 'Issue to each that can have it, in roll order; one PDF of the batch' })
  @RequirePermission(CERTIFICATE.issue)
  bulkIssue(@ReqCtx() ctx: RequestContext, @Body() body: BulkIssueDto) {
    return this.bulk.issue(ctx, body);
  }

  @Get('bulk/sections')
  @ApiOperation({
    summary: 'Classes with their sections and the students on the rolls in each, for bulk issue',
  })
  @RequirePermission(CERTIFICATE.issue)
  bulkSections(@ReqCtx() ctx: RequestContext) {
    return this.bulk.sections(ctx);
  }

  @Get('bulk/departments')
  @ApiOperation({
    summary:
      'Departments with their employees in service and who have left, for bulk issue of staff certificates',
  })
  @RequirePermission(CERTIFICATE.issue)
  bulkDepartments(@ReqCtx() ctx: RequestContext) {
    return this.bulk.departments(ctx);
  }

  @Post('bulk/run')
  @ApiOperation({
    summary:
      'Bulk issue to the students ticked in the preview: a batch (and PDF) for each section, sharing a run id',
  })
  @RequirePermission(CERTIFICATE.issue)
  bulkRun(@ReqCtx() ctx: RequestContext, @Body() body: BulkRunDto) {
    return this.bulk.issueRun(ctx, body);
  }

  @Get('runs/:runId')
  @ApiOperation({ summary: "A bulk run's batches and their PDFs" })
  @RequirePermission(CERTIFICATE.view)
  run(@ReqCtx() ctx: RequestContext, @Param('runId') runId: string) {
    return this.bulk.runOf(ctx, runId);
  }

  @Get('runs/:runId/zip')
  @ApiOperation({ summary: 'Every batch PDF of a run in one ZIP' })
  @RequirePermission(CERTIFICATE.view)
  runZip(@ReqCtx() ctx: RequestContext, @Param('runId') runId: string) {
    return this.bulk.runZip(ctx, runId);
  }

  @Get('batches')
  @RequirePermission(CERTIFICATE.view)
  batches(@ReqCtx() ctx: RequestContext) {
    return this.bulk.batches(ctx);
  }

  @Get('batches/:id')
  @RequirePermission(CERTIFICATE.view)
  batch(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.bulk.batch(ctx, id);
  }

  // ---- awards ----
  @Get('awards')
  @ApiOperation({ summary: 'The awards the school gives' })
  @RequirePermission(CERTIFICATE.view)
  awardList(@ReqCtx() ctx: RequestContext) {
    return this.awards.awards(ctx);
  }

  @Post('awards')
  @RequirePermission(CERTIFICATE.setup)
  awardCreate(@ReqCtx() ctx: RequestContext, @Body() body: AwardDto) {
    return this.awards.saveAward(ctx, null, body);
  }

  @Put('awards/:id')
  @RequirePermission(CERTIFICATE.setup)
  awardUpdate(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AwardDto) {
    return this.awards.saveAward(ctx, id, body);
  }

  @Get('allotments')
  @ApiOperation({ summary: 'Who received which award: filters, pages' })
  @RequirePermission(CERTIFICATE.view)
  allotments(@ReqCtx() ctx: RequestContext, @Query() q: ListAllotmentsQueryDto) {
    return this.awards.allotments(ctx, q);
  }

  @Post('allotments')
  @RequirePermission(CERTIFICATE.issue)
  allot(@ReqCtx() ctx: RequestContext, @Body() body: AllotmentDto) {
    return this.awards.addAllotment(ctx, body);
  }

  @Post('allotments/import')
  @ApiOperation({
    summary: 'Allotments from a CSV: admission_no, award, event, position, date, remarks',
  })
  @RequirePermission(CERTIFICATE.issue)
  importAllotments(@ReqCtx() ctx: RequestContext, @Body() body: AllotmentImportDto) {
    return this.awards.importAllotments(ctx, body);
  }

  @Post('allotments/issue')
  @ApiOperation({ summary: 'The certificates of chosen allotments, a batch a type' })
  @RequirePermission(CERTIFICATE.issue)
  issueAllotments(@ReqCtx() ctx: RequestContext, @Body() body: IssueAllotmentsDto) {
    return this.awards.issue(ctx, body);
  }

  @Post('allotments/:id/remove')
  @RequirePermission(CERTIFICATE.issue)
  removeAllotment(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.awards.removeAllotment(ctx, id);
  }

  // ---- registers and reports ----
  @Get('tc-book')
  @ApiOperation({ summary: 'The TC book register: every TC by book and Sl. No.' })
  @RequirePermission(CERTIFICATE.view)
  tcBook(@ReqCtx() ctx: RequestContext, @Query() q: TcBookQueryDto) {
    return this.reports.tcBook(ctx, q);
  }

  @Get('tc-book/file')
  @RequirePermission(CERTIFICATE.view)
  async tcBookFile(@ReqCtx() ctx: RequestContext, @Query() q: TcBookFileQueryDto) {
    const f = await this.reports.tcBookFile(ctx, q);
    return { filename: f.filename, contentType: f.contentType, base64: f.bytes.toString('base64') };
  }

  @Get('reports')
  @ApiOperation({ summary: 'By type, month and issuer; past a check; requests; public checks' })
  @RequirePermission(CERTIFICATE.view)
  summary(@ReqCtx() ctx: RequestContext, @Query() q: ReportsQueryDto) {
    return this.reports.summary(ctx, q);
  }

  @Get('reports/file')
  @RequirePermission(CERTIFICATE.view)
  async summaryFile(@ReqCtx() ctx: RequestContext, @Query() q: ReportsFileQueryDto) {
    const f = await this.reports.summaryFile(ctx, q);
    return { filename: f.filename, contentType: f.contentType, base64: f.bytes.toString('base64') };
  }
}
