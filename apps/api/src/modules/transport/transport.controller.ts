import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { FleetService } from './fleet.service';
import {
  AssignStudentsDto,
  CreateRouteDto,
  SetStopsDto,
  TRANSPORT,
  UpdateRouteDto,
  UpdateDriverDto,
  UpdateVehicleDto,
  UpsertDriverDto,
  UpsertVehicleDto,
} from './transport.dto';
import { TransportService } from './transport.service';

@ApiTags('transport')
@ApiBearerAuth()
@Controller('transport/routes')
export class TransportController {
  constructor(
    private readonly transport: TransportService,
    private readonly fleet: FleetService,
  ) {}

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

  @Get(':id/stops')
  @ApiOperation({ summary: 'Stops of the route in order, with geo, times and riders per stop' })
  @RequirePermission(TRANSPORT.fleetView, {
    description: 'View vehicles, drivers and route stops',
  })
  async stops(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.fleet.stops(ctx, id) };
  }

  @Put(':id/stops')
  @ApiOperation({ summary: 'Replace the ordered stop list of the route' })
  @RequirePermission(TRANSPORT.fleetManage, {
    description: 'Maintain vehicles, drivers and route stops',
  })
  async setStops(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: SetStopsDto) {
    return { data: await this.fleet.setStops(ctx, id, dto) };
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

@ApiTags('transport')
@ApiBearerAuth()
@Controller('transport')
export class FleetController {
  constructor(private readonly fleet: FleetService) {}

  @Get('vehicles')
  @RequirePermission(TRANSPORT.fleetView)
  async vehicles(@ReqCtx() ctx: RequestContext) {
    return { data: await this.fleet.vehicles(ctx) };
  }

  @Post('vehicles')
  @RequirePermission(TRANSPORT.fleetManage)
  createVehicle(@ReqCtx() ctx: RequestContext, @Body() dto: UpsertVehicleDto) {
    return this.fleet.createVehicle(ctx, dto);
  }

  @Patch('vehicles/:id')
  @RequirePermission(TRANSPORT.fleetManage)
  updateVehicle(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.fleet.updateVehicle(ctx, id, dto);
  }

  @Get('drivers')
  @RequirePermission(TRANSPORT.fleetView)
  async drivers(@ReqCtx() ctx: RequestContext) {
    return { data: await this.fleet.drivers(ctx) };
  }

  @Post('drivers')
  @RequirePermission(TRANSPORT.fleetManage)
  createDriver(@ReqCtx() ctx: RequestContext, @Body() dto: UpsertDriverDto) {
    return this.fleet.createDriver(ctx, dto);
  }

  @Patch('drivers/:id')
  @RequirePermission(TRANSPORT.fleetManage)
  updateDriver(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateDriverDto,
  ) {
    return this.fleet.updateDriver(ctx, id, dto);
  }
}
