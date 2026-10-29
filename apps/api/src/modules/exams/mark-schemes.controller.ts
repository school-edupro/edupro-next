import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { EXAMS } from './exams.dto';
import { CreateSchemeDto, RegisterQueryDto, UpdateSchemeDto } from './mark-schemes.dto';
import { MarkSchemesService } from './mark-schemes.service';

/**
 * Mark schemes and registers (docs/design/65, part 3): build and lock schemes (exam masters), work out
 * the term results, read any scheme's register (the marks view right).
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams/schemes')
export class MarkSchemesController {
  constructor(private readonly svc: MarkSchemesService) {}

  @Get('presets')
  @ApiOperation({ summary: 'The ready-made schemes (the old DPS Noida formulas)' })
  @RequirePermission(EXAMS.masterView)
  presets() {
    return this.svc.presets();
  }

  @Get()
  @RequirePermission(EXAMS.masterView)
  list(@ReqCtx() ctx: RequestContext) {
    return this.svc.list(ctx);
  }

  @Get(':id')
  @RequirePermission(EXAMS.masterView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }

  @Post()
  @ApiOperation({ summary: 'A scheme from a ready-made one (its exams mapped) or from columns' })
  @RequirePermission(EXAMS.masterManage)
  create(@ReqCtx() ctx: RequestContext, @Body() dto: CreateSchemeDto) {
    return this.svc.create(ctx, dto);
  }

  @Put(':id')
  @RequirePermission(EXAMS.masterManage)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateSchemeDto) {
    return this.svc.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(EXAMS.masterManage)
  remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.remove(ctx, id);
  }

  @Post(':id/lock')
  @ApiOperation({ summary: "Lock a version; a result scheme becomes its classes' term result" })
  @RequirePermission(EXAMS.masterManage)
  lock(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.lock(ctx, id);
  }

  @Post(':id/new-version')
  @RequirePermission(EXAMS.masterManage)
  newVersion(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.newVersion(ctx, id);
  }

  @Post(':id/compute')
  @ApiOperation({ summary: "Work out and keep the term results of a result scheme's classes" })
  @RequirePermission(EXAMS.masterManage)
  compute(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.compute(ctx, id);
  }

  @Get(':id/register')
  @ApiOperation({ summary: 'The register of a section or class (JSON, or Excel / PDF as base64)' })
  @RequirePermission(EXAMS.marksView)
  register(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: RegisterQueryDto) {
    return this.svc.register(ctx, id, q);
  }
}
