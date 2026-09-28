import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { FleetService } from './fleet.service';
import { TransportRequestsService } from './transport-requests.service';
import {
  AssignStudentsDto,
  CreateRouteDto,
  CreateTransportRequestDto,
  DecideTransportRequestDto,
  ListTransportRequestsQueryDto,
  SetStopsDto,
  TRANSPORT,
  UpdateRouteDto,
  UpdateDriverDto,
  UpdateVehicleDto,
  UpsertDriverDto,
  UpsertVehicleDto,
  UpsertVehicleLogDto,
  VehicleLogsQueryDto,
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
  constructor(
    private readonly fleet: FleetService,
    private readonly requests: TransportRequestsService,
  ) {}

  // ---- Sprint 13: vehicle logs ----
  @Get('vehicles/:id/logs')
  @ApiOperation({ summary: 'Daily logs of a vehicle (odometer, fuel, trips, incidents)' })
  @RequirePermission(TRANSPORT.logView, {
    description: 'View vehicle logs (odometer, fuel, incidents)',
  })
  async logs(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: VehicleLogsQueryDto,
  ) {
    return { data: await this.requests.logs(ctx, id, q) };
  }

  @Put('vehicles/:id/logs')
  @ApiOperation({ summary: 'Record or correct the log of one day' })
  @RequirePermission(TRANSPORT.logManage, { description: 'Record vehicle logs' })
  addLog(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpsertVehicleLogDto) {
    return this.requests.addLog(ctx, id, dto);
  }

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

/** Sprint 13: a family's bus requests and the office's decisions. */
@ApiTags('transport')
@ApiBearerAuth()
@Controller('transport/requests')
export class TransportRequestsController {
  constructor(private readonly requests: TransportRequestsService) {}

  @Get('mine')
  @ApiOperation({ summary: "My children's bus assignment, requests and the routes to choose from" })
  @RequirePermission(TRANSPORT.requestView, { description: 'View transport requests' })
  mine(@ReqCtx() ctx: RequestContext) {
    return this.requests.mine(ctx);
  }

  @Post('mine')
  @ApiOperation({ summary: 'Ask for a seat, a stop or route change, or to leave the bus' })
  @RequirePermission(TRANSPORT.requestCreate, {
    description: "Request a bus seat, a stop change or leaving the bus for one's own children",
  })
  create(@ReqCtx() ctx: RequestContext, @Body() dto: CreateTransportRequestDto) {
    return this.requests.create(ctx, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Transport requests of the working year (pending first)' })
  @RequirePermission(TRANSPORT.requestView)
  async list(@ReqCtx() ctx: RequestContext, @Query() q: ListTransportRequestsQueryDto) {
    return { data: await this.requests.list(ctx, q) };
  }

  @Post(':id/decide')
  @ApiOperation({ summary: 'Approve or reject a request that is not in a workflow' })
  @RequirePermission(TRANSPORT.requestDecide, {
    description: 'Approve or reject transport requests',
  })
  decide(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: DecideTransportRequestDto,
  ) {
    return this.requests.decide(ctx, id, dto);
  }
}
