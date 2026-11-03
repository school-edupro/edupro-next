import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  AccessTypeDto,
  CopyGradeRegisterDto,
  CreateGradeRegisterDto,
  GradeBuilderQueryDto,
  GradeRunQueryDto,
  RestoreGradeRegisterDto,
  UpdateGradeRegisterDto,
} from './grade-registers.dto';
import { GradeRegistersService } from './grade-registers.service';
import { RemoveAccessDto, SchemeAccessDto } from './mark-schemes.dto';

/**
 * Grade registers (docs/design/69, part 2): the legacy Grade Register with the mark registers' rights.
 * A manager (exams.registers.manage) builds and changes every register, exams.registers.assign gives
 * people rights on any; anyone else uses the registers given to them. The service checks each.
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams/grade-registers')
@AuthenticatedOnly()
export class GradeRegistersController {
  constructor(private readonly svc: GradeRegistersService) {}

  @Get()
  @ApiOperation({ summary: 'The grade registers I may see, with my rights on each' })
  list(@ReqCtx() ctx: RequestContext) {
    return this.svc.list(ctx);
  }

  @Get('deleted')
  @ApiOperation({ summary: 'Grade registers in the bin' })
  deleted(@ReqCtx() ctx: RequestContext) {
    return this.svc.deleted(ctx);
  }

  @Get('builder')
  @ApiOperation({
    summary: "The builder's classes, the exams that rate indicators and the indicator tree",
  })
  builder(@ReqCtx() ctx: RequestContext, @Query() q: GradeBuilderQueryDto) {
    return this.svc.builder(ctx, q.classIds, q.examIds);
  }

  @Get('staff')
  staff(@ReqCtx() ctx: RequestContext) {
    return this.svc.staff(ctx);
  }

  @Get('rights')
  @ApiOperation({ summary: 'Who holds which right on which grade register' })
  rights(@ReqCtx() ctx: RequestContext) {
    return this.svc.rightsReport(ctx);
  }

  @Post('rights/remove')
  removeRights(@ReqCtx() ctx: RequestContext, @Body() body: RemoveAccessDto) {
    return this.svc.removeAccess(ctx, body);
  }

  @Get(':id')
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }

  @Post()
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateGradeRegisterDto) {
    return this.svc.create(ctx, body);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Save: a draft in place; a locked register makes its next version' })
  update(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: UpdateGradeRegisterDto,
  ) {
    return this.svc.update(ctx, id, body);
  }

  @Delete(':id')
  remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.remove(ctx, id);
  }

  @Post(':id/restore')
  restore(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: RestoreGradeRegisterDto,
  ) {
    return this.svc.restore(ctx, id, body);
  }

  @Post(':id/lock')
  lock(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.lock(ctx, id);
  }

  @Post(':id/unlock')
  unlock(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.unlock(ctx, id);
  }

  @Put(':id/access-type')
  @ApiOperation({
    summary: 'All indicators, or as per mapping (a teacher: the areas given to them)',
  })
  accessType(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AccessTypeDto) {
    return this.svc.setAccessType(ctx, id, body.type);
  }

  @Get(':id/versions')
  versions(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.versions(ctx, id);
  }

  @Post(':id/restore-version')
  restoreVersion(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: RestoreGradeRegisterDto,
  ) {
    return this.svc.restoreVersion(ctx, id, body);
  }

  @Post(':id/copy')
  copy(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: CopyGradeRegisterDto) {
    return this.svc.copy(ctx, id, body);
  }

  @Get(':id/run')
  @ApiOperation({
    summary: 'Run a grade register: class sheet or student-wise, summary, analysis; PDF / Excel',
  })
  run(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: GradeRunQueryDto) {
    return this.svc.run(ctx, id, q);
  }

  @Get(':id/access')
  access(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.access(ctx, id);
  }

  @Put(':id/access')
  putAccess(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: SchemeAccessDto) {
    return this.svc.putAccess(ctx, id, body);
  }
}
