import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ADMISSIONS } from './admissions.dto';
import { AdmissionGridExportDto } from './grid.dto';
import { AdmissionReadyReportsService } from './ready-reports.service';

/** Ready-made admission reports on the Admissions list's view (docs/design/52, part 1). */
@ApiTags('admissions')
@ApiBearerAuth()
@Controller('admissions/registrations/grid/ready-made')
export class AdmissionReadyReportsController {
  constructor(private readonly svc: AdmissionReadyReportsService) {}

  @Get()
  @ApiOperation({ summary: 'The ready-made admission reports' })
  @RequirePermission(ADMISSIONS.applicationView)
  list() {
    return this.svc.list();
  }

  @Post(':key')
  @ApiOperation({
    summary: 'A ready-made report for the list view (tab, filters, search): Excel or PDF, at once',
  })
  @RequirePermission(ADMISSIONS.applicationView)
  async run(
    @ReqCtx() ctx: RequestContext,
    @Param('key') key: string,
    @Body() dto: AdmissionGridExportDto,
  ) {
    const f = await this.svc.run(ctx, key, dto);
    return { filename: f.filename, contentType: f.contentType, base64: f.bytes.toString('base64') };
  }
}
