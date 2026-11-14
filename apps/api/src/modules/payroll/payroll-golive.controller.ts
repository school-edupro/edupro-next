import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  ExplainDto,
  MonthsDto,
  ResultsQueryDto,
  RollbackDto,
  StartDto,
  SwitchDto,
} from './payroll-golive.dto';
import { PayrollGoLiveService } from './payroll-golive.service';
import { RUN } from './payroll-inputs.dto';
import { PAYROLL } from './payroll.dto';

const id = (v: string) => {
  if (!/^\d{1,18}$/.test(v))
    throw new DomainError('validation-failed', 'Not a valid id', { status: 400 });
  return v;
};

/** Moving from the old payroll (docs/design/86, phase G): read, bring, parity, parallel months, sign-off, switch. */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll/golive')
export class PayrollGoLiveController {
  constructor(private readonly golive: PayrollGoLiveService) {}

  @Get()
  @ApiOperation({ summary: 'Where the move from the old payroll stands' })
  @RequirePermission(RUN.view)
  overview(@ReqCtx() ctx: RequestContext) {
    return this.golive.overview(ctx);
  }

  @Post('start')
  @ApiOperation({ summary: 'Start the move (the payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  start(@ReqCtx() ctx: RequestContext, @Body() dto: StartDto) {
    return this.golive.start(ctx, dto.historyFrom);
  }

  @Post('read')
  @ApiOperation({ summary: 'Ask for the old payroll database to be read again' })
  @RequirePermission(PAYROLL.admin)
  read(@ReqCtx() ctx: RequestContext) {
    return this.golive.read(ctx);
  }

  @Get('preview')
  @ApiOperation({ summary: 'What would come across, and what cannot (nothing kept)' })
  @RequirePermission(RUN.view)
  preview(@ReqCtx() ctx: RequestContext) {
    return this.golive.preview(ctx);
  }

  @Post('prepare')
  @ApiOperation({ summary: 'Prepare the move (the payroll admin); a second person commits it' })
  @RequirePermission(PAYROLL.admin)
  prepare(@ReqCtx() ctx: RequestContext) {
    return this.golive.prepare(ctx);
  }

  @Post('commit')
  @ApiOperation({ summary: 'Commit what was prepared (a second person)' })
  @RequirePermission(RUN.view)
  commit(@ReqCtx() ctx: RequestContext) {
    return this.golive.commit(ctx);
  }

  @Get('archive')
  @ApiOperation({ summary: 'The older years, not brought, as a file' })
  @RequirePermission(RUN.view)
  archive(@ReqCtx() ctx: RequestContext) {
    return this.golive.archive(ctx);
  }

  @Post('parallel-months')
  @ApiOperation({ summary: 'Set the two parallel months' })
  @RequirePermission(PAYROLL.admin)
  setParallel(@ReqCtx() ctx: RequestContext, @Body() dto: MonthsDto) {
    return this.golive.setParallel(ctx, dto.months);
  }

  @Post('parity/replay')
  @ApiOperation({ summary: 'Replay the old locked months through EduPro’s engine and compare' })
  @RequirePermission(RUN.view)
  replay(@ReqCtx() ctx: RequestContext, @Body() dto: MonthsDto) {
    return this.golive.replay(ctx, dto.months);
  }

  @Post('parity/parallel')
  @ApiOperation({ summary: 'Compare EduPro’s parallel months with what the old payroll paid' })
  @RequirePermission(RUN.view)
  parallel(@ReqCtx() ctx: RequestContext) {
    return this.golive.parallel(ctx);
  }

  @Get('parity/:batchId')
  @ApiOperation({ summary: 'A comparison: its results and scoreboard' })
  @RequirePermission(RUN.view)
  results(
    @ReqCtx() ctx: RequestContext,
    @Param('batchId') bid: string,
    @Query() q: ResultsQueryDto,
  ) {
    return this.golive.results(ctx, id(bid), q);
  }

  @Post('parity/:batchId/explain')
  @ApiOperation({ summary: 'Explain differences, with a code and a note' })
  @RequirePermission(RUN.view)
  explain(@ReqCtx() ctx: RequestContext, @Param('batchId') bid: string, @Body() dto: ExplainDto) {
    return this.golive.explain(ctx, id(bid), dto);
  }

  @Post('parity/:batchId/sign')
  @ApiOperation({ summary: 'Sign the parallel months (a payroll checker)' })
  @RequirePermission(RUN.approve)
  sign(@ReqCtx() ctx: RequestContext, @Param('batchId') bid: string) {
    return this.golive.signoff(ctx, id(bid));
  }

  @Post('signoffs/:id/countersign')
  @ApiOperation({ summary: 'Countersign the go-live (the principal)' })
  @RequirePermission('payroll.golive.countersign')
  countersign(@ReqCtx() ctx: RequestContext, @Param('id') sid: string) {
    return this.golive.countersign(ctx, id(sid));
  }

  @Post('switch')
  @ApiOperation({ summary: 'Switch: EduPro pays from the month (the payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  switchOver(@ReqCtx() ctx: RequestContext, @Body() dto: SwitchDto) {
    return this.golive.switchOver(ctx, dto.month);
  }

  @Post('rollback')
  @ApiOperation({
    summary: 'Switch back, until EduPro’s first live month is locked (the payroll admin)',
  })
  @RequirePermission(PAYROLL.admin)
  rollback(@ReqCtx() ctx: RequestContext, @Body() dto: RollbackDto) {
    return this.golive.rollback(ctx, dto.reason);
  }
}
