import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { FleetService } from './fleet.service';
import {
  ApplyDto,
  DeskDecideDto,
  DeskExportDto,
  DeskListDto,
  HistoryDto,
  HistoryExportDto,
  QuoteDto,
  TransportSetupDto,
} from './transport-desk.dto';
import { TransportDeskService } from './transport-desk.service';
import { TransportRequestsService } from './transport-requests.service';
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

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const file = (reply: FastifyReply, f: { bytes: Buffer; filename: string }) =>
  reply
    .header('content-type', XLSX)
    .header('content-disposition', `attachment; filename="${f.filename}"`)
    .send(f.bytes);

/** Transport v2: a pupil's request (from the family or made by the office) and its approvals. */
@ApiTags('transport')
@ApiBearerAuth()
@Controller('transport/requests')
export class TransportRequestsController {
  constructor(private readonly desk: TransportDeskService) {}

  // ---- the family ----
  @Get('mine')
  @ApiOperation({ summary: "My children's transport: what runs now, the history and the requests" })
  @RequirePermission(TRANSPORT.requestView, { description: 'View transport requests' })
  mine(@ReqCtx() ctx: RequestContext) {
    return this.desk.familyHistory(ctx);
  }

  @Get('mine/options')
  @ApiOperation({ summary: 'Routes, stoppages with their slab, and the months to choose from' })
  @RequirePermission(TRANSPORT.requestView)
  mineOptions(@ReqCtx() ctx: RequestContext, @Query('studentId') studentId?: string) {
    return this.desk.familyOptions(ctx, studentId && /^\d+$/.test(studentId) ? studentId : null);
  }

  @Post('mine')
  @ApiOperation({ summary: 'Ask for transport, a change, or to stop from a month' })
  @RequirePermission(TRANSPORT.requestCreate, {
    description: "Request transport, a change or a withdrawal for one's own children",
  })
  create(@ReqCtx() ctx: RequestContext, @Body() dto: ApplyDto) {
    return this.desk.familyApply(ctx, dto);
  }

  @Post('mine/:id/cancel')
  @HttpCode(200)
  @RequirePermission(TRANSPORT.requestCreate)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.desk.familyCancel(ctx, id);
  }

  @Get('quote')
  @ApiOperation({ summary: "The monthly charge for a way of riding, by the school's rule" })
  @RequirePermission(TRANSPORT.requestView)
  quote(@ReqCtx() ctx: RequestContext, @Query() q: QuoteDto) {
    return this.desk.quote(ctx, q);
  }

  // ---- the office ----
  @Get()
  @ApiOperation({ summary: 'Transport requests of the working year' })
  @RequirePermission(TRANSPORT.requestView)
  list(@ReqCtx() ctx: RequestContext, @Query() q: DeskListDto) {
    return this.desk.list(ctx, q);
  }

  @Get('export.xlsx')
  @RequirePermission(TRANSPORT.requestView)
  async excel(
    @ReqCtx() ctx: RequestContext,
    @Query() q: DeskExportDto,
    @Res() reply: FastifyReply,
  ) {
    file(reply, await this.desk.listExcel(ctx, q));
  }

  @Get('inbox')
  @ApiOperation({ summary: 'Requests waiting for my approval, and the ones I decided' })
  @AuthenticatedOnly()
  inbox(@ReqCtx() ctx: RequestContext) {
    return this.desk.inbox(ctx);
  }

  @Get('options')
  @RequirePermission(TRANSPORT.requestApply, {
    description: 'Make a transport request for a pupil at the transport office',
  })
  options(@ReqCtx() ctx: RequestContext, @Query('studentId') studentId?: string) {
    return this.desk.deskOptions(ctx, studentId && /^\d+$/.test(studentId) ? studentId : null);
  }

  @Get('students')
  @RequirePermission(TRANSPORT.requestApply)
  students(@ReqCtx() ctx: RequestContext, @Query('q') q?: string) {
    return this.desk.students(ctx, q ?? '');
  }

  @Post()
  @ApiOperation({ summary: 'The transport office asks for a pupil; it goes to the fee department' })
  @RequirePermission(TRANSPORT.requestApply)
  apply(@ReqCtx() ctx: RequestContext, @Body() dto: ApplyDto) {
    return this.desk.deskApply(ctx, dto);
  }

  @Get(':id')
  @AuthenticatedOnly()
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.desk.get(ctx, id);
  }

  @Post(':id/decide')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve or reject at my level' })
  @AuthenticatedOnly()
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: DeskDecideDto) {
    return this.desk.decide(ctx, id, dto);
  }
}

/** Transport v2: the dashboard, the student transport history and the set-up. */
@ApiTags('transport')
@ApiBearerAuth()
@Controller('transport/desk')
export class TransportDeskController {
  constructor(private readonly desk: TransportDeskService) {}

  @Get('dashboard')
  @RequirePermission(TRANSPORT.requestView)
  dashboard(@ReqCtx() ctx: RequestContext) {
    return this.desk.dashboard(ctx);
  }

  @Get('history')
  @ApiOperation({ summary: 'Student transport history: every period a pupil rode' })
  @RequirePermission(TRANSPORT.requestView)
  history(@ReqCtx() ctx: RequestContext, @Query() q: HistoryDto) {
    return this.desk.history(ctx, q);
  }

  @Get('history/export.xlsx')
  @RequirePermission(TRANSPORT.requestView)
  async historyExcel(
    @ReqCtx() ctx: RequestContext,
    @Query() q: HistoryExportDto,
    @Res() reply: FastifyReply,
  ) {
    file(reply, await this.desk.historyExcel(ctx, q));
  }

  @Get('setup')
  @RequirePermission(TRANSPORT.setup, {
    description: 'Transport settings: charge rule and approval levels',
  })
  setup(@ReqCtx() ctx: RequestContext) {
    return this.desk.setup(ctx);
  }

  @Put('setup')
  @RequirePermission(TRANSPORT.setup)
  saveSetup(@ReqCtx() ctx: RequestContext, @Body() dto: TransportSetupDto) {
    return this.desk.saveSetup(ctx, dto);
  }
}
