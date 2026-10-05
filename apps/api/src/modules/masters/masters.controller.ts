import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  BulkUpdateDto,
  CloneDto,
  RowsQueryDto,
  ExportQueryDto,
  SaveRowDto,
  SetStatusDto,
  UploadDto,
} from './masters.dto';
import { MastersService } from './masters.service';

/**
 * Master-data framework. Every route is authenticated; the master's own view / manage permission is
 * checked by the service against the registry entry, so the same routes serve every master.
 */
@ApiTags('masters')
@ApiBearerAuth()
@Controller('masters')
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  @Get()
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Masters the caller may see, with their fields and abilities' })
  registry(@ReqCtx() ctx: RequestContext) {
    return { data: this.masters.registry(ctx) };
  }

  @Get(':master/rows')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Paged, filtered rows of a master' })
  rows(
    @ReqCtx() ctx: RequestContext,
    @Param('master') master: string,
    @Query() query: RowsQueryDto,
  ) {
    return this.masters.rows(ctx, master, query);
  }

  @Get(':master/lookups')
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Datalist options of every ref field (value, id, parent value for dependent lists)',
  })
  lookups(@ReqCtx() ctx: RequestContext, @Param('master') master: string) {
    return this.masters.lookups(ctx, master);
  }

  @Get(':master/template')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Excel upload template (headers, a sample row, the rules)' })
  async template(
    @ReqCtx() ctx: RequestContext,
    @Param('master') master: string,
    @Res() reply: FastifyReply,
  ) {
    const { fileName, bytes } = await this.masters.template(ctx, master);
    void reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${fileName}"`)
      .send(bytes);
  }

  @Get(':master/export')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'The list (search and status kept) as Excel or PDF, at once' })
  async export(
    @ReqCtx() ctx: RequestContext,
    @Param('master') master: string,
    @Query() q: ExportQueryDto,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.masters.export(ctx, master, q);
    void reply
      .header('content-type', f.contentType)
      .header('content-disposition', `attachment; filename="${f.fileName}"`)
      .send(f.bytes);
  }

  @Get(':master/imports')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Recent uploads of a master' })
  async imports(@ReqCtx() ctx: RequestContext, @Param('master') master: string) {
    return { data: await this.masters.imports(ctx, master) };
  }

  @Post(':master/imports/validate')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Dry run: parse an .xlsx or CSV, validate every row, keep the report' })
  validate(
    @ReqCtx() ctx: RequestContext,
    @Param('master') master: string,
    @Body() body: UploadDto,
  ) {
    return this.masters.validate(ctx, master, body);
  }

  @Post(':master/imports/:id/commit')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Commit a validated upload (insert new keys, update existing ones)' })
  commit(@ReqCtx() ctx: RequestContext, @Param('master') master: string, @Param('id') id: string) {
    return this.masters.commit(ctx, master, id);
  }

  @Post(':master/rows')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Create or update one row from the grid form' })
  save(@ReqCtx() ctx: RequestContext, @Param('master') master: string, @Body() body: SaveRowDto) {
    return this.masters.save(ctx, master, body);
  }

  @Put(':master/rows/:id/status')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Activate or deactivate a row' })
  async status(
    @ReqCtx() ctx: RequestContext,
    @Param('master') master: string,
    @Param('id') id: string,
    @Body() body: SetStatusDto,
  ) {
    await this.masters.setStatus(ctx, master, id, body.status);
    return { ok: true };
  }

  @Post(':master/bulk')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Set one field on many rows' })
  bulk(
    @ReqCtx() ctx: RequestContext,
    @Param('master') master: string,
    @Body() body: BulkUpdateDto,
  ) {
    return this.masters.bulk(ctx, master, body);
  }

  @Post(':master/clone')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Copy a year-bound master from one academic year to another' })
  clone(@ReqCtx() ctx: RequestContext, @Param('master') master: string, @Body() body: CloneDto) {
    return this.masters.clone(ctx, master, body);
  }
}
