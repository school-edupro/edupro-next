import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { RUN } from './payroll-inputs.dto';
import {
  EcrFileDto,
  EcrFiledDto,
  RegisterFileDto,
  ReturnFileDto,
  StatMonthDto,
  WithdrawDto,
} from './payroll-statutory.dto';
import { PayrollStatutoryService } from './payroll-statutory.service';
import { PAYROLL } from './payroll.dto';

const id = (v: string) => {
  if (!/^\d{1,18}$/.test(v))
    throw new DomainError('validation-failed', 'Not a valid id', { status: 400 });
  return v;
};

/**
 * PF, ESI, profession tax and LWF for a month (docs/design/86, phase C step 2): the registers and challan figures,
 * the PF ECR (regular, then supplementary files) and its filing, the ESIC upload, the registers as Excel or PDF.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll/statutory')
export class PayrollStatutoryController {
  constructor(private readonly stat: PayrollStatutoryService) {}

  @Get()
  @ApiOperation({ summary: 'The month’s statutory figures at a glance' })
  @RequirePermission(RUN.view)
  overview(@ReqCtx() ctx: RequestContext, @Query() q: StatMonthDto) {
    return this.stat.overview(ctx, q.month);
  }

  @Get('pf')
  @ApiOperation({ summary: 'PF: the members, the challan, the ECR filed and the next one' })
  @RequirePermission(RUN.view)
  pf(@ReqCtx() ctx: RequestContext, @Query() q: StatMonthDto) {
    return this.stat.pf(ctx, q.month);
  }

  @Get('pf/ecr')
  @ApiOperation({ summary: 'The next ECR file (not yet filed), or its arrear file (a checker)' })
  @RequirePermission(RUN.approve)
  ecr(@ReqCtx() ctx: RequestContext, @Query() q: EcrFileDto) {
    return this.stat.ecrFile(ctx, q.month, q.part);
  }

  @Post('pf/ecr/filed')
  @ApiOperation({ summary: 'The next ECR is filed: kept with its members (a checker)' })
  @RequirePermission(RUN.approve)
  filed(@ReqCtx() ctx: RequestContext, @Body() dto: EcrFiledDto) {
    return this.stat.ecrFiled(ctx, dto);
  }

  @Get('returns/:id/file')
  @ApiOperation({ summary: 'A filed ECR as it was filed' })
  @RequirePermission(RUN.approve)
  returnFile(@ReqCtx() ctx: RequestContext, @Param('id') rid: string, @Query() q: ReturnFileDto) {
    return this.stat.returnFile(ctx, id(rid), q.part);
  }

  @Post('returns/:id/withdraw')
  @ApiOperation({
    summary: 'Withdraw a filing recorded by mistake (the payroll admin; the latest only)',
  })
  @RequirePermission(PAYROLL.admin)
  withdraw(@ReqCtx() ctx: RequestContext, @Param('id') rid: string, @Body() dto: WithdrawDto) {
    return this.stat.withdraw(ctx, id(rid), dto);
  }

  @Get('esi')
  @ApiOperation({ summary: 'ESI: the covered staff, their days and wages, the challan' })
  @RequirePermission(RUN.view)
  esi(@ReqCtx() ctx: RequestContext, @Query() q: StatMonthDto) {
    return this.stat.esi(ctx, q.month);
  }

  @Get('esi/upload')
  @ApiOperation({ summary: 'The ESIC portal’s monthly upload (Excel; a checker)' })
  @RequirePermission(RUN.approve)
  esic(@ReqCtx() ctx: RequestContext, @Query() q: StatMonthDto) {
    return this.stat.esicUpload(ctx, q.month);
  }

  @Get('pt')
  @ApiOperation({
    summary: 'Profession tax: the register by rate, Maharashtra’s Form IIIB figures',
  })
  @RequirePermission(RUN.view)
  pt(@ReqCtx() ctx: RequestContext, @Query() q: StatMonthDto) {
    return this.stat.pt(ctx, q.month);
  }

  @Get('lwf')
  @ApiOperation({ summary: 'LWF: the register and challan of a due month' })
  @RequirePermission(RUN.view)
  lwf(@ReqCtx() ctx: RequestContext, @Query() q: StatMonthDto) {
    return this.stat.lwf(ctx, q.month);
  }

  @Get('register')
  @ApiOperation({
    summary: 'A register as Excel or PDF (PROVISIONAL while an approved run is not locked)',
  })
  @RequirePermission(RUN.view)
  register(@ReqCtx() ctx: RequestContext, @Query() q: RegisterFileDto) {
    return this.stat.registerFile(ctx, q.month, q.kind, q.format);
  }
}
