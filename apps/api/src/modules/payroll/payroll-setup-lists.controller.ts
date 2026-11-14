import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PayrollSetupListsService } from './payroll-setup-lists.service';
import { PAYROLL } from './payroll.dto';

const keyOf = (k: string) => (/^[a-z-]{2,40}$/.test(k) ? k : 'none');

/** The payroll set-up's lists: a filtered page for the screen, every filtered row as Excel or PDF, the Set-up book. */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollSetupListsController {
  constructor(private readonly lists: PayrollSetupListsService) {}

  @Get('setup-lists/:key')
  @ApiOperation({ summary: 'A set-up list: its filters and a page of the rows they leave' })
  @RequirePermission(PAYROLL.view)
  page(
    @ReqCtx() ctx: RequestContext,
    @Param('key') key: string,
    @Query() q: Record<string, unknown>,
  ) {
    return this.lists.page(ctx, keyOf(key), q);
  }

  @Get('setup-lists/:key/file')
  @ApiOperation({
    summary: 'Every row the filters leave as Excel or PDF (format=xlsx|pdf), recorded',
  })
  @RequirePermission(PAYROLL.view)
  file(
    @ReqCtx() ctx: RequestContext,
    @Param('key') key: string,
    @Query() q: Record<string, unknown>,
  ) {
    return this.lists.file(ctx, keyOf(key), q);
  }

  @Get('setup-book')
  @ApiOperation({ summary: 'The whole payroll set-up in one workbook or PDF (format=xlsx|pdf)' })
  @RequirePermission(PAYROLL.view)
  book(@ReqCtx() ctx: RequestContext, @Query() q: Record<string, unknown>) {
    return this.lists.book(ctx, q);
  }
}
