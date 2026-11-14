import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  CERTIFICATE,
  CertificatesFileQueryDto,
  IssueCertificateDto,
  ListCertificatesQueryDto,
  PreviewCertificateDto,
  ReasonDto,
  StudentSearchQueryDto,
} from './certificates.dto';
import { CertificatesService } from './certificates.service';

/** The certificate register (docs/design/87): types, preview and issue, the register, duplicates and cancels. */
@ApiTags('certificates')
@ApiBearerAuth()
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get('types')
  @ApiOperation({ summary: 'The certificate types: their checks and the fields each asks for' })
  @RequirePermission(CERTIFICATE.view, {
    description: 'See the certificate register and print a certificate',
  })
  types(@ReqCtx() ctx: RequestContext) {
    return this.certificates.types(ctx);
  }

  @Post('preview')
  @ApiOperation({ summary: 'What a certificate would print and its checks (nothing saved)' })
  @RequirePermission(CERTIFICATE.issue, {
    description: 'Issue a certificate (after its checks) and a duplicate',
  })
  preview(@ReqCtx() ctx: RequestContext, @Body() body: PreviewCertificateDto) {
    return this.certificates.preview(ctx, body);
  }

  @Post('issue')
  @ApiOperation({
    summary:
      'Issue a certificate: checks, the next number of the type and year, frozen fields, the PDF (a failed check needs the override right and a reason)',
  })
  @RequirePermission(CERTIFICATE.issue)
  issue(@ReqCtx() ctx: RequestContext, @Body() body: IssueCertificateDto) {
    return this.certificates.issue(ctx, body);
  }

  @Get()
  @ApiOperation({
    summary: 'The certificate register, filtered, a page at a time, with its figures',
  })
  @RequirePermission(CERTIFICATE.view)
  list(@ReqCtx() ctx: RequestContext, @Query() q: ListCertificatesQueryDto) {
    return this.certificates.list(ctx, q);
  }

  @Get('file')
  @ApiOperation({ summary: 'The certificate register as filtered, as Excel or PDF' })
  @RequirePermission(CERTIFICATE.view)
  async file(@ReqCtx() ctx: RequestContext, @Query() q: CertificatesFileQueryDto) {
    const f = await this.certificates.file(ctx, q);
    return { filename: f.filename, contentType: f.contentType, base64: f.bytes.toString('base64') };
  }

  @Get('students')
  @ApiOperation({
    summary: 'Students to issue to (on the rolls or past), by name or admission no.',
  })
  @RequirePermission(CERTIFICATE.issue)
  students(@ReqCtx() ctx: RequestContext, @Query() q: StudentSearchQueryDto) {
    return this.certificates.students(ctx, q.q);
  }

  @Get('employees')
  @ApiOperation({ summary: 'Employees to issue to (in service or past), by name or employee code' })
  @RequirePermission(CERTIFICATE.issue)
  employees(@ReqCtx() ctx: RequestContext, @Query() q: StudentSearchQueryDto) {
    return this.certificates.employees(ctx, q.q);
  }

  @Get('student/:studentId')
  @ApiOperation({ summary: "A student's certificates" })
  @RequirePermission(CERTIFICATE.view)
  forStudent(@ReqCtx() ctx: RequestContext, @Param('studentId') studentId: string) {
    return this.certificates.forStudent(ctx, studentId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One certificate: its copies, checks and what it printed' })
  @RequirePermission(CERTIFICATE.view)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.certificates.detail(ctx, id);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'A duplicate: the same number and paper, printed DUPLICATE (copy n)' })
  @RequirePermission(CERTIFICATE.issue)
  duplicate(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.certificates.duplicate(ctx, id, body.reason);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel a certificate (and its duplicates); its number is never given again',
  })
  @RequirePermission(CERTIFICATE.cancel, {
    description: 'Cancel an issued certificate with a reason',
  })
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.certificates.cancel(ctx, id, body.reason);
  }

  @Post(':id/render')
  @ApiOperation({ summary: 'Make the PDF again (the same frozen paper)' })
  @RequirePermission(CERTIFICATE.view)
  render(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.certificates.render(ctx, id);
  }
}
