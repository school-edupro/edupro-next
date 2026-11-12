import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PEOPLE } from './people.permissions';
import {
  ReportingAssignDto,
  ReportingImportDto,
  ReportingMoveDto,
  ReportingQueryDto,
} from './people.dto';
import { ReportingService } from './reporting.service';

/** Reporting managers (docs/design/30): who each employee reports to this year, one by one or in bulk. */
@ApiTags('people')
@ApiBearerAuth()
@Controller('people/reporting')
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @Get()
  @ApiOperation({
    summary: 'Every active employee with their reporting manager this year, filtered, a page',
  })
  @RequirePermission(PEOPLE.employeeView)
  list(@ReqCtx() ctx: RequestContext, @Query() q: ReportingQueryDto) {
    return this.reporting.list(ctx, q);
  }

  @Post('assign')
  @ApiOperation({ summary: 'These employees report to this manager (or nobody) from now on' })
  @RequirePermission(PEOPLE.employeeEdit)
  assign(@ReqCtx() ctx: RequestContext, @Body() body: ReportingAssignDto) {
    return this.reporting.assign(ctx, body);
  }

  @Post('move')
  @ApiOperation({ summary: 'Everyone reporting to one manager moves to another (or nobody)' })
  @RequirePermission(PEOPLE.employeeEdit)
  move(@ReqCtx() ctx: RequestContext, @Body() body: ReportingMoveDto) {
    return this.reporting.move(ctx, body);
  }

  @Get('format')
  @ApiOperation({ summary: 'The sheet of every employee with their manager’s code now' })
  @RequirePermission(PEOPLE.employeeEdit)
  format(@ReqCtx() ctx: RequestContext) {
    return this.reporting.format(ctx);
  }

  @Post('import')
  @ApiOperation({
    summary: 'Reporting managers from Excel: checked (old → new), then the good rows saved',
  })
  @RequirePermission(PEOPLE.employeeEdit)
  import(@ReqCtx() ctx: RequestContext, @Body() body: ReportingImportDto) {
    return this.reporting.import(ctx, body);
  }
}
