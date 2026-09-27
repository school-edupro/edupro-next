import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { IMPORT_COLUMNS, ListImportsQueryDto, ValidateImportDto } from './imports.dto';
import { ImportsService } from './imports.service';
import { PEOPLE } from './people.permissions';

@ApiTags('people')
@ApiBearerAuth()
@Controller('people/imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get()
  @ApiOperation({ summary: 'Import history' })
  @RequirePermission(PEOPLE.importRun, {
    description: 'Validate and commit bulk imports of students and employees',
  })
  async list(@ReqCtx() ctx: RequestContext, @Query() q: ListImportsQueryDto) {
    const { rows, total } = await this.imports.list(ctx, q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Get('columns')
  @ApiOperation({ summary: 'Accepted CSV columns per import kind' })
  @RequirePermission(PEOPLE.importRun)
  columns() {
    return IMPORT_COLUMNS;
  }

  @Get(':id')
  @RequirePermission(PEOPLE.importRun)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.imports.get(ctx, id);
  }

  @Post('validate')
  @ApiOperation({ summary: 'Dry run: parse and validate a CSV, store the report' })
  @RequirePermission(PEOPLE.importRun)
  validate(@ReqCtx() ctx: RequestContext, @Body() body: ValidateImportDto) {
    return this.imports.validate(ctx, body);
  }

  @Post(':id/commit')
  @ApiOperation({ summary: 'Commit a validated import with no rejected rows' })
  @RequirePermission(PEOPLE.importRun)
  commit(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.imports.commit(ctx, id);
  }
}
