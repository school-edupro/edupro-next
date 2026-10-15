import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  AllotDto,
  BedDto,
  BlockDto,
  BoardQueryDto,
  HOSTEL,
  HostelDto,
  ImportDto,
  RegisterQueryDto,
  RoomDto,
  RoomTypeDto,
  RoomUpdateDto,
  TransferDto,
  VacateDto,
  WardensDto,
} from './hostel.dto';
import { HostelImportService } from './hostel-import.service';
import { HostelService } from './hostel.service';

@ApiTags('hostel')
@ApiBearerAuth()
@Controller('hostel')
export class HostelController {
  constructor(
    private readonly hostel: HostelService,
    private readonly imports: HostelImportService,
  ) {}

  @Get('import/template')
  @ApiOperation({ summary: 'The Excel to set up beds and allot pupils in one go (go-live)' })
  @RequirePermission(HOSTEL.allot)
  importTemplate(@ReqCtx() ctx: RequestContext) {
    return this.imports.template(ctx);
  }

  @Post('import')
  @ApiOperation({
    summary: 'Upload the beds sheet: check (nothing kept) or apply; problems by row',
  })
  @RequirePermission(HOSTEL.allot)
  upload(@ReqCtx() ctx: RequestContext, @Body() dto: ImportDto) {
    return this.imports.upload(ctx, dto);
  }

  // ---- set-up -------------------------------------------------------------------------------------------
  @Get('hostels')
  @ApiOperation({
    summary: 'Hostels with blocks, wardens, rooms, beds and beds taken (a warden sees their own)',
  })
  @RequirePermission(HOSTEL.view)
  async hostels(@ReqCtx() ctx: RequestContext) {
    return { data: await this.hostel.hostels(ctx) };
  }

  @Post('hostels')
  @RequirePermission(HOSTEL.setup)
  createHostel(@ReqCtx() ctx: RequestContext, @Body() dto: HostelDto) {
    return this.hostel.saveHostel(ctx, dto);
  }

  @Put('hostels/:id')
  @RequirePermission(HOSTEL.setup)
  updateHostel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: HostelDto) {
    return this.hostel.saveHostel(ctx, dto, id);
  }

  @Put('hostels/:id/wardens')
  @ApiOperation({ summary: 'Replace the wardens of a hostel (staff; one may be the head warden)' })
  @RequirePermission(HOSTEL.setup)
  setWardens(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: WardensDto) {
    return this.hostel.setWardens(ctx, id, dto);
  }

  @Post('blocks')
  @RequirePermission(HOSTEL.setup)
  createBlock(@ReqCtx() ctx: RequestContext, @Body() dto: BlockDto) {
    return this.hostel.saveBlock(ctx, dto);
  }

  @Put('blocks/:id')
  @RequirePermission(HOSTEL.setup)
  updateBlock(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: BlockDto) {
    return this.hostel.saveBlock(ctx, dto, id);
  }

  @Delete('blocks/:id')
  @RequirePermission(HOSTEL.setup)
  deleteBlock(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.hostel.deleteBlock(ctx, id);
  }

  @Get('room-types')
  @RequirePermission(HOSTEL.view)
  async roomTypes(@ReqCtx() ctx: RequestContext) {
    return { data: await this.hostel.roomTypes(ctx) };
  }

  @Post('room-types')
  @ApiOperation({ summary: 'A room type: seater, AC and the hostel fee group its pupils pay by' })
  @RequirePermission(HOSTEL.setup)
  createRoomType(@ReqCtx() ctx: RequestContext, @Body() dto: RoomTypeDto) {
    return this.hostel.saveRoomType(ctx, dto);
  }

  @Put('room-types/:id')
  @ApiOperation({
    summary: 'Change a room type; a new fee group re-prices the unpaid hostel months of its pupils',
  })
  @RequirePermission(HOSTEL.setup)
  updateRoomType(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: RoomTypeDto) {
    return this.hostel.saveRoomType(ctx, dto, id);
  }

  @Get('rooms')
  @RequirePermission(HOSTEL.view)
  async rooms(@ReqCtx() ctx: RequestContext, @Query('hostelId') hostelId?: string) {
    return {
      data: await this.hostel.rooms(ctx, /^\d{1,18}$/.test(hostelId ?? '') ? hostelId : undefined),
    };
  }

  @Post('rooms')
  @ApiOperation({ summary: 'A room with its beds (A, B, ... as many as the seater unless given)' })
  @RequirePermission(HOSTEL.setup)
  createRoom(@ReqCtx() ctx: RequestContext, @Body() dto: RoomDto) {
    return this.hostel.createRoom(ctx, dto);
  }

  @Patch('rooms/:id')
  @RequirePermission(HOSTEL.setup)
  updateRoom(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: RoomUpdateDto) {
    return this.hostel.updateRoom(ctx, id, dto);
  }

  @Post('rooms/:id/beds')
  @RequirePermission(HOSTEL.setup)
  addBed(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: BedDto) {
    return this.hostel.addBed(ctx, id, dto);
  }

  @Put('beds/:id')
  @RequirePermission(HOSTEL.setup)
  updateBed(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: BedDto) {
    return this.hostel.updateBed(ctx, id, dto);
  }

  @Delete('beds/:id')
  @RequirePermission(HOSTEL.setup)
  deleteBed(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.hostel.deleteBed(ctx, id);
  }

  // ---- occupancy and allotment --------------------------------------------------------------------------
  @Get('board')
  @ApiOperation({
    summary: 'Occupancy board: rooms and beds with who holds each on the day, and totals',
  })
  @RequirePermission(HOSTEL.view)
  board(@ReqCtx() ctx: RequestContext, @Query() q: BoardQueryDto) {
    return this.hostel.board(ctx, q);
  }

  @Get('free-beds')
  @RequirePermission(HOSTEL.allot)
  async freeBeds(
    @ReqCtx() ctx: RequestContext,
    @Query('on') on?: string,
    @Query('hostelId') hostelId?: string,
  ) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(on ?? '') ? on! : new Date().toISOString().slice(0, 10);
    return {
      data: await this.hostel.freeBeds(
        ctx,
        day,
        /^\d{1,18}$/.test(hostelId ?? '') ? hostelId : undefined,
      ),
    };
  }

  @Get('no-bed')
  @ApiOperation({ summary: 'Hostellers of the session (fee profile) who hold no bed' })
  @RequirePermission(HOSTEL.view)
  async noBed(@ReqCtx() ctx: RequestContext) {
    return { data: await this.hostel.noBed(ctx) };
  }

  @Get('register')
  @ApiOperation({ summary: 'Allotment register: every stay with hostel, room, bed, from and to' })
  @RequirePermission(HOSTEL.view)
  async register(@ReqCtx() ctx: RequestContext, @Query() q: RegisterQueryDto) {
    return { data: await this.hostel.register(ctx, q) };
  }

  @Get('students')
  @ApiOperation({
    summary: 'Find pupils of the session by name or admission no., with the bed held today',
  })
  @RequirePermission(HOSTEL.view)
  async search(@ReqCtx() ctx: RequestContext, @Query('q') q?: string) {
    const term = (q ?? '').trim().slice(0, 60);
    return { data: term.length < 2 ? [] : await this.hostel.search(ctx, term) };
  }

  @Get('students/:id')
  @ApiOperation({ summary: "One pupil's hostel: the bed held now, wardens and every stay" })
  @RequirePermission(HOSTEL.view)
  student(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.hostel.student(ctx, id);
  }

  @Post('allotments')
  @ApiOperation({
    summary: 'Allot a bed from a date; the hostel fee follows (hosteller, months, fee group)',
  })
  @RequirePermission(HOSTEL.allot)
  allot(@ReqCtx() ctx: RequestContext, @Body() dto: AllotDto) {
    return this.hostel.allot(ctx, dto);
  }

  @Post('students/:id/transfer')
  @ApiOperation({
    summary:
      'Move a pupil to another bed from a date; unpaid hostel months re-priced from that month',
  })
  @RequirePermission(HOSTEL.allot)
  transfer(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: TransferDto) {
    return this.hostel.transfer(ctx, id, dto);
  }

  @Post('students/:id/vacate')
  @ApiOperation({ summary: 'End the stay on a date; the hostel fee stops after that month' })
  @RequirePermission(HOSTEL.allot)
  vacate(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: VacateDto) {
    return this.hostel.vacate(ctx, id, dto);
  }
}
