import { Body, Controller, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  LineDto,
  PayrollTaxSetupService,
  RegimeDto,
  TaxReasonDto,
} from './payroll-tax-setup.service';
import { PAYROLL } from './payroll.dto';

const fyOf = (v: string) => {
  if (!/^\d{4}-\d{2}$/.test(v))
    throw new DomainError('validation-failed', 'Not a financial year', { status: 400 });
  return v;
};
const codeOf = (v: string) => {
  const c = v.toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(c))
    throw new DomainError('validation-failed', 'Not a line code', { status: 400 });
  return c;
};

/** Changing a year's income-tax set-up (the payroll admin): a regime, the lines of the tax sheet, the year. */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll/tax')
export class PayrollTaxSetupController {
  constructor(private readonly tax: PayrollTaxSetupService) {}

  @Put(':fy/regimes/:regime')
  @ApiOperation({ summary: 'A regime’s slabs, rules and surcharges for a year (payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  regime(
    @ReqCtx() ctx: RequestContext,
    @Param('fy') fy: string,
    @Param('regime') regime: string,
    @Body() dto: RegimeDto,
  ) {
    return this.tax.saveRegime(ctx, fyOf(fy), regime.toUpperCase(), dto);
  }

  @Post(':fy/lines')
  @ApiOperation({ summary: 'A new line of the tax sheet (payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  addLine(@ReqCtx() ctx: RequestContext, @Param('fy') fy: string, @Body() dto: LineDto) {
    return this.tax.saveLine(ctx, fyOf(fy), null, dto);
  }

  @Put(':fy/lines/:code')
  @ApiOperation({ summary: 'Change a line of the tax sheet (payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  changeLine(
    @ReqCtx() ctx: RequestContext,
    @Param('fy') fy: string,
    @Param('code') code: string,
    @Body() dto: LineDto,
  ) {
    return this.tax.saveLine(ctx, fyOf(fy), codeOf(code), dto);
  }

  @Post(':fy/lines/:code/remove')
  @ApiOperation({ summary: 'Remove an added line no declaration uses (payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  removeLine(
    @ReqCtx() ctx: RequestContext,
    @Param('fy') fy: string,
    @Param('code') code: string,
    @Body() dto: TaxReasonDto,
  ) {
    return this.tax.removeLine(ctx, fyOf(fy), codeOf(code), dto);
  }

  @Post('years/:fy/remove')
  @ApiOperation({ summary: 'Remove a year nothing uses (payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  removeYear(@ReqCtx() ctx: RequestContext, @Param('fy') fy: string, @Body() dto: TaxReasonDto) {
    return this.tax.removeYear(ctx, fyOf(fy), dto);
  }
}
