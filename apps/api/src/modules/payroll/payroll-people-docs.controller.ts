import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { RUN } from './payroll-inputs.dto';
import { PayrollPeopleDocsService } from './payroll-people-docs.service';
import { OWN } from './payroll-payslip.service';
import { FyQueryDto } from './payroll-tax.dto';
import { PayrollTransferService } from './payroll-transfer.service';

const id = (v: string) => {
  if (!/^\d{1,18}$/.test(v))
    throw new DomainError('validation-failed', 'Not a valid id', { status: 400 });
  return v;
};
class LoanPaperDto extends createZodDto(
  z.object({ kind: z.enum(['statement', 'noc']).default('statement') }),
) {}

/**
 * People papers and transfers (docs/design/86, phase E step 5): increment letters, the settlement statement and dues
 * letter, the salary certificate, a loan's statement or no-dues certificate; a transfer's payroll brought across.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollPeopleDocsController {
  constructor(
    private readonly docs: PayrollPeopleDocsService,
    private readonly transfers: PayrollTransferService,
  ) {}

  @Get('revisions/:id/letters/pdf')
  @ApiOperation({ summary: 'A revision’s letters as one PDF, a page each' })
  @RequirePermission(RUN.view)
  revisionLetters(@ReqCtx() ctx: RequestContext, @Param('id') rid: string) {
    return this.docs.letters(ctx, { revisionId: id(rid) });
  }

  @Get('letters/:id/pdf')
  @ApiOperation({ summary: 'One increment letter as a PDF' })
  @RequirePermission(RUN.view)
  letter(@ReqCtx() ctx: RequestContext, @Param('id') lid: string) {
    return this.docs.letters(ctx, { letterId: id(lid) });
  }

  @Get('me/letters')
  @ApiOperation({ summary: 'My increment letters' })
  @RequirePermission(OWN)
  myLetters(@ReqCtx() ctx: RequestContext) {
    return this.docs.myLetters(ctx);
  }

  @Get('me/letters/:id/pdf')
  @ApiOperation({ summary: 'One of my increment letters as a PDF' })
  @RequirePermission(OWN)
  myLetter(@ReqCtx() ctx: RequestContext, @Param('id') lid: string) {
    return this.docs.letters(ctx, { letterId: id(lid), own: true });
  }

  @Get('settlements/:id/statement')
  @ApiOperation({ summary: 'A settlement’s statement as a PDF' })
  @RequirePermission(RUN.view)
  statement(@ReqCtx() ctx: RequestContext, @Param('id') sid: string) {
    return this.docs.statement(ctx, id(sid));
  }

  @Get('settlements/:id/dues-letter')
  @ApiOperation({ summary: 'The dues letter of a settlement below nothing, as a PDF' })
  @RequirePermission(RUN.view)
  duesLetter(@ReqCtx() ctx: RequestContext, @Param('id') sid: string) {
    return this.docs.duesLetter(ctx, id(sid));
  }

  @Get('me/salary-certificate')
  @ApiOperation({ summary: 'My salary certificate of a year' })
  @RequirePermission(OWN)
  myCertificate(@ReqCtx() ctx: RequestContext, @Query() q: FyQueryDto) {
    return this.docs.salaryCertificate(ctx, q.fy);
  }

  @Get('employees/:id/salary-certificate')
  @ApiOperation({ summary: 'An employee’s salary certificate of a year (a checker)' })
  @RequirePermission(RUN.approve)
  certificate(@ReqCtx() ctx: RequestContext, @Param('id') eid: string, @Query() q: FyQueryDto) {
    return this.docs.salaryCertificate(ctx, q.fy, id(eid));
  }

  @Get('loans/:id/paper')
  @ApiOperation({ summary: 'A loan’s statement, or its no-dues certificate once repaid' })
  @RequirePermission(RUN.view)
  loanPaper(@ReqCtx() ctx: RequestContext, @Param('id') lid: string, @Query() q: LoanPaperDto) {
    return this.docs.loanStatement(ctx, id(lid), q.kind);
  }

  @Get('transfers')
  @ApiOperation({ summary: 'Staff from a sister school: payroll brought across or still to bring' })
  @RequirePermission(RUN.view)
  transferList(@ReqCtx() ctx: RequestContext) {
    return this.transfers.list(ctx);
  }

  @Get('transfers/:id')
  @ApiOperation({ summary: 'What a transfer brings across, read from the source now (a checker)' })
  @RequirePermission(RUN.approve)
  transferPreview(@ReqCtx() ctx: RequestContext, @Param('id') tid: string) {
    return this.transfers.preview(ctx, id(tid));
  }

  @Post('transfers/:id/bring')
  @ApiOperation({ summary: 'Bring a transfer’s payroll across (a checker)' })
  @RequirePermission(RUN.approve)
  bring(@ReqCtx() ctx: RequestContext, @Param('id') tid: string) {
    return this.transfers.bring(ctx, id(tid));
  }
}
