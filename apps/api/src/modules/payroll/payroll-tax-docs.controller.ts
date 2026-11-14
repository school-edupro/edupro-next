import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { RUN } from './payroll-inputs.dto';
import { PayrollTaxDocsService } from './payroll-tax-docs.service';
import { FyBodyDto, FyRequiredDto, PartADto, ReturnQueryDto } from './payroll-tax.dto';

const OWN = 'payroll.own.view';
const id = (v: string) => {
  if (!/^\d{1,18}$/.test(v))
    throw new DomainError('validation-failed', 'Not a valid id', { status: 400 });
  return v;
};

/** Income-tax papers (docs/design/86, phase D step 4): the quarterly return files, the declaration, the certificates. */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollTaxDocsController {
  constructor(private readonly docs: PayrollTaxDocsService) {}

  @Get('tax/returns')
  @ApiOperation({
    summary: 'A quarterly TDS return file (24Q / 138): challans, Annexure I or II (a checker)',
  })
  @RequirePermission(RUN.approve)
  returns(@ReqCtx() ctx: RequestContext, @Query() q: ReturnQueryDto) {
    return this.docs.returnFile(ctx, q.fy, q.quarter, q.file);
  }

  @Get('me/tax/declaration-form')
  @ApiOperation({ summary: 'My declaration (Form 124 / 12BB) as a PDF' })
  @RequirePermission(OWN)
  myForm(@ReqCtx() ctx: RequestContext, @Query() q: FyRequiredDto) {
    return this.docs.declarationForm(ctx, q.fy);
  }

  @Get('tax/declaration-form/:employeeId')
  @ApiOperation({ summary: 'An employee’s declaration (Form 124 / 12BB) as a PDF' })
  @RequirePermission(RUN.view)
  form(@ReqCtx() ctx: RequestContext, @Param('employeeId') eid: string, @Query() q: FyRequiredDto) {
    return this.docs.declarationForm(ctx, q.fy, id(eid));
  }

  @Get('tax/certificates')
  @ApiOperation({
    summary: 'The year’s certificates (Form 16 / 130): Part A, made, released, e-mailed',
  })
  @RequirePermission(RUN.approve)
  list(@ReqCtx() ctx: RequestContext, @Query() q: FyRequiredDto) {
    return this.docs.certificates(ctx, q.fy);
  }

  @Post('tax/certificates/part-a')
  @ApiOperation({ summary: 'Part A files from TRACES, matched by the PAN in each file name' })
  @RequirePermission(RUN.approve)
  partA(@ReqCtx() ctx: RequestContext, @Body() dto: PartADto) {
    return this.docs.partA(ctx, dto.fy, dto.fileIds);
  }

  @Post('tax/certificates/make')
  @ApiOperation({ summary: 'Make the year’s certificates (the year fully locked)' })
  @RequirePermission(RUN.approve)
  make(@ReqCtx() ctx: RequestContext, @Body() dto: FyBodyDto) {
    return this.docs.make(ctx, dto.fy);
  }

  @Post('tax/certificates/release')
  @ApiOperation({ summary: 'Release the made certificates in My tax' })
  @RequirePermission(RUN.approve)
  release(@ReqCtx() ctx: RequestContext, @Body() dto: FyBodyDto) {
    return this.docs.release(ctx, dto.fy);
  }

  @Post('tax/certificates/send')
  @ApiOperation({ summary: 'E-mail the released certificates not yet sent' })
  @RequirePermission(RUN.approve)
  send(@ReqCtx() ctx: RequestContext, @Body() dto: FyBodyDto) {
    return this.docs.send(ctx, dto.fy);
  }

  @Get('tax/certificates/:employeeId/file')
  @ApiOperation({ summary: 'An employee’s certificate as stored (a checker)' })
  @RequirePermission(RUN.approve)
  file(@ReqCtx() ctx: RequestContext, @Param('employeeId') eid: string, @Query() q: FyRequiredDto) {
    return this.docs.file(ctx, q.fy, id(eid));
  }

  @Get('me/tax/certificate')
  @ApiOperation({ summary: 'My certificate, once released' })
  @RequirePermission(OWN)
  mine(@ReqCtx() ctx: RequestContext, @Query() q: FyRequiredDto) {
    return this.docs.file(ctx, q.fy);
  }
}
