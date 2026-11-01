import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  BuilderQueryDto,
  CopySchemeDto,
  CreateSchemeDto,
  RegisterQueryDto,
  RemoveAccessDto,
  RestoreSchemeDto,
  SchemeAccessDto,
  UpdateSchemeDto,
} from './mark-schemes.dto';
import { MarkSchemesService } from './mark-schemes.service';

/**
 * Mark registers (docs/design/68; the schemes of docs/design/65 part 3). Rights are per register: a
 * manager (exams.registers.manage) builds and changes every register, exams.registers.assign gives
 * people rights on any; anyone else uses the registers given to them (Run / Edit / Delete / Assign).
 * The service checks each, so the routes need only a sign-in.
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams/schemes')
export class MarkSchemesController {
  constructor(private readonly svc: MarkSchemesService) {}

  @Get('presets')
  @ApiOperation({ summary: 'The ready-made schemes (the old DPS Noida formulas)' })
  @AuthenticatedOnly()
  presets() {
    return this.svc.presets();
  }

  @Get()
  @ApiOperation({ summary: 'The registers the person may use, one row per register' })
  @AuthenticatedOnly()
  list(@ReqCtx() ctx: RequestContext) {
    return this.svc.list(ctx);
  }

  @Get('deleted')
  @ApiOperation({ summary: 'The bin: registers deleted this year' })
  @AuthenticatedOnly()
  deleted(@ReqCtx() ctx: RequestContext) {
    return this.svc.deleted(ctx);
  }

  @Get('builder')
  @ApiOperation({
    summary:
      'For the builder: exams, the classes’ subjects with maxima and parts, slots, codes, grades',
  })
  @AuthenticatedOnly()
  builder(@ReqCtx() ctx: RequestContext, @Query() q: BuilderQueryDto) {
    return this.svc.builderData(ctx, q.classIds);
  }

  @Get('staff')
  @ApiOperation({ summary: 'Staff who can sign in (the Assign dialog)' })
  @AuthenticatedOnly()
  staff(@ReqCtx() ctx: RequestContext) {
    return this.svc.staff(ctx);
  }

  @Get('rights')
  @ApiOperation({ summary: 'Rights report: who holds which right on which register' })
  @AuthenticatedOnly()
  rights(@ReqCtx() ctx: RequestContext) {
    return this.svc.rightsReport(ctx);
  }

  @Post('rights/remove')
  @ApiOperation({ summary: 'Take people off registers (the Rights report)' })
  @AuthenticatedOnly()
  removeRights(@ReqCtx() ctx: RequestContext, @Body() dto: RemoveAccessDto) {
    return this.svc.removeAccess(ctx, dto);
  }

  @Get(':id')
  @AuthenticatedOnly()
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }

  @Post()
  @ApiOperation({
    summary: 'A new register: built, or from a ready-made scheme with its exams mapped',
  })
  @AuthenticatedOnly()
  create(@ReqCtx() ctx: RequestContext, @Body() dto: CreateSchemeDto) {
    return this.svc.create(ctx, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Save: a draft in place, a locked register as its next version' })
  @AuthenticatedOnly()
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateSchemeDto) {
    return this.svc.update(ctx, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Put a draft in the bin' })
  @AuthenticatedOnly()
  remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.remove(ctx, id);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Back from the bin (renamed when its name is taken now)' })
  @AuthenticatedOnly()
  restore(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: RestoreSchemeDto) {
    return this.svc.restore(ctx, id, dto);
  }

  @Post(':id/lock')
  @ApiOperation({
    summary: 'Lock a draft as a version (a result register: its classes’ term result)',
  })
  @AuthenticatedOnly()
  lock(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.lock(ctx, id);
  }

  @Post(':id/unlock')
  @ApiOperation({ summary: 'Unlock a register to change it in place' })
  @AuthenticatedOnly()
  unlock(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.unlock(ctx, id);
  }

  @Post(':id/new-version')
  @AuthenticatedOnly()
  newVersion(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.newVersion(ctx, id);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'Every saved version of a register' })
  @AuthenticatedOnly()
  versions(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.versions(ctx, id);
  }

  @Post(':id/restore-version')
  @ApiOperation({ summary: 'A saved version as a new register' })
  @AuthenticatedOnly()
  restoreVersion(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: RestoreSchemeDto,
  ) {
    return this.svc.restoreVersion(ctx, id, dto);
  }

  @Post(':id/copy')
  @ApiOperation({ summary: 'A copy for other classes, saved at once' })
  @AuthenticatedOnly()
  copy(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CopySchemeDto) {
    return this.svc.copy(ctx, id, dto);
  }

  @Get(':id/access')
  @ApiOperation({ summary: 'The people given rights on a register' })
  @AuthenticatedOnly()
  access(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.access(ctx, id);
  }

  @Put(':id/access')
  @ApiOperation({ summary: 'Give people Run / Edit / Delete / Assign on a register' })
  @AuthenticatedOnly()
  putAccess(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: SchemeAccessDto) {
    return this.svc.putAccess(ctx, id, dto);
  }

  @Post(':id/compute')
  @ApiOperation({ summary: 'Work out and keep the term results of a locked result register' })
  @AuthenticatedOnly()
  compute(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.compute(ctx, id);
  }

  @Get(':id/register')
  @ApiOperation({
    summary:
      'Run: a section, a class ranked together, an exam or a subject; on screen, PDF or Excel',
  })
  @AuthenticatedOnly()
  register(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: RegisterQueryDto) {
    return this.svc.register(ctx, id, q);
  }
}
