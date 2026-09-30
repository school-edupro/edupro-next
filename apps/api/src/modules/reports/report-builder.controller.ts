import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  ExportReportDto,
  PreviewReportDto,
  SaveReportDto,
  ShareOptionsQueryDto,
  ShareReportDto,
} from './report-builder.dto';
import { BUILDER, ReportBuilderService } from './report-builder.service';

const idOf = (id: string): string => {
  if (!/^\d{1,18}$/.test(id)) throw new DomainError('not-found', 'Report not found');
  return id;
};

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports/builder')
export class ReportBuilderController {
  constructor(private readonly builder: ReportBuilderService) {}

  @Get('fields')
  @ApiOperation({ summary: 'Columns, filters and options the report builder offers' })
  @RequirePermission(BUILDER.use, {
    description: 'Build, save, share and download own custom reports',
  })
  fields(@ReqCtx() ctx: RequestContext) {
    return this.builder.fields(ctx);
  }

  @Get('share-options')
  @ApiOperation({ summary: 'Users and roles a report can be shared with' })
  @RequirePermission(BUILDER.use)
  shareOptions(@ReqCtx() ctx: RequestContext, @Query() q: ShareOptionsQueryDto) {
    return this.builder.shareOptions(ctx, q.q);
  }

  @Get()
  @ApiOperation({
    summary: 'My reports, reports shared with me, and (managers) every other report',
  })
  @RequirePermission(BUILDER.use)
  list(@ReqCtx() ctx: RequestContext) {
    return this.builder.list(ctx);
  }

  @Post()
  @RequirePermission(BUILDER.use)
  create(@ReqCtx() ctx: RequestContext, @Body() body: SaveReportDto) {
    return this.builder.create(ctx, body);
  }

  @Post('preview')
  @ApiOperation({ summary: 'Run a report spec live: first rows, total, filters in words' })
  @RequirePermission(BUILDER.use)
  preview(@ReqCtx() ctx: RequestContext, @Body() body: PreviewReportDto) {
    return this.builder.preview(ctx, body);
  }

  @Get(':id')
  @RequirePermission(BUILDER.use)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.builder.get(ctx, idOf(id));
  }

  @Put(':id')
  @RequirePermission(BUILDER.use)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: SaveReportDto) {
    return this.builder.update(ctx, idOf(id), body);
  }

  @Delete(':id')
  @RequirePermission(BUILDER.use)
  remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.builder.remove(ctx, idOf(id));
  }

  @Post(':id/copy')
  @ApiOperation({ summary: 'Save as: a copy owned by the caller' })
  @RequirePermission(BUILDER.use)
  copy(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: { name?: string }) {
    const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
    return this.builder.copy(ctx, idOf(id), name && name.length >= 3 ? name : undefined);
  }

  @Put(':id/shares')
  @ApiOperation({ summary: 'Share with named users or roles, view only or can edit (owner only)' })
  @RequirePermission(BUILDER.use)
  share(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ShareReportDto) {
    return this.builder.share(ctx, idOf(id), body);
  }

  @Post(':id/export')
  @ApiOperation({ summary: 'Branded Excel or PDF of a saved report (export pipeline)' })
  @RequirePermission(BUILDER.use)
  export(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ExportReportDto) {
    return this.builder.export(ctx, idOf(id), body);
  }
}
