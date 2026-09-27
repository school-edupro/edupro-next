import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { AssignStudentsDto, CreateRouteDto, TRANSPORT, UpdateRouteDto } from './transport.dto';
import { TransportService } from './transport.service';

@ApiTags('transport')
@ApiBearerAuth()
@Controller('transport/routes')
export class TransportController {
  constructor(private readonly transport: TransportService) {}

  @Get()
  @ApiOperation({ summary: 'Routes with the number of students riding them this year' })
  @RequirePermission(TRANSPORT.routeView)
  async list(@ReqCtx() ctx: RequestContext) {
    return { data: await this.transport.list(ctx) };
  }

  @Post()
  @RequirePermission(TRANSPORT.routeManage)
  create(@ReqCtx() ctx: RequestContext, @Body() dto: CreateRouteDto) {
    return this.transport.create(ctx, dto);
  }

  @Patch(':id')
  @RequirePermission(TRANSPORT.routeManage)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateRouteDto) {
    return this.transport.update(ctx, id, dto);
  }

  @Get(':id/students')
  @RequirePermission(TRANSPORT.routeView)
  async students(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.transport.students(ctx, id) };
  }

  @Put(':id/students')
  @ApiOperation({
    summary: 'Assign students (with stop and times) to the route for the working year',
  })
  @RequirePermission(TRANSPORT.routeManage)
  assign(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: AssignStudentsDto) {
    return this.transport.assign(ctx, id, dto);
  }

  @Delete(':id/students/:studentId')
  @RequirePermission(TRANSPORT.routeManage)
  unassign(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ) {
    return this.transport.unassign(ctx, id, studentId);
  }
}
