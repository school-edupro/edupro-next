import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { StrengthExportDto, StrengthQueryDto, StrengthStudentsQueryDto } from './strength.dto';
import { STRENGTH, StrengthReportsService } from './strength.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports/strength')
export class StrengthReportsController {
  constructor(private readonly strength: StrengthReportsService) {}

  @Get('options')
  @ApiOperation({
    summary: 'Years, classes with sections and concessions for the strength filters',
  })
  @RequirePermission(STRENGTH.view)
  options(@ReqCtx() ctx: RequestContext, @Query('academicYearId') academicYearId?: string) {
    return this.strength.options(
      ctx,
      academicYearId && /^\d{1,18}$/.test(academicYearId) ? academicYearId : undefined,
    );
  }

  @Get()
  @ApiOperation({ summary: 'A student strength report (class-wise, category, discount or age)' })
  @RequirePermission(STRENGTH.view)
  report(@ReqCtx() ctx: RequestContext, @Query() q: StrengthQueryDto) {
    return this.strength.report(ctx, q);
  }

  @Get('students')
  @ApiOperation({ summary: 'The students behind one count of a strength report' })
  @RequirePermission(STRENGTH.view)
  students(@ReqCtx() ctx: RequestContext, @Query() q: StrengthStudentsQueryDto) {
    return this.strength.students(ctx, q);
  }

  @Post('export')
  @ApiOperation({ summary: 'Queue the branded Excel or PDF of a strength report' })
  @RequirePermission(STRENGTH.view)
  export(@ReqCtx() ctx: RequestContext, @Body() body: StrengthExportDto) {
    return this.strength.export(ctx, body);
  }
}
