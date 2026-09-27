import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../../common/http/request-context';
import { CreatePeriodDto, SetSlotDto, TimetableQueryDto } from './academics.dto';
import { ACADEMICS } from './academics.permissions';
import { TimetableService } from './timetable.service';

@ApiTags('academics')
@ApiBearerAuth()
@Controller('academics/timetable')
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Get('periods')
  @ApiOperation({ summary: 'Periods of the school day' })
  @RequirePermission(ACADEMICS.timetableView, {
    description: 'View timetables (scope: class_section)',
  })
  async periods(@ReqCtx() ctx: RequestContext) {
    return { data: await this.timetable.listPeriods(ctx) };
  }

  @Post('periods')
  @RequirePermission(ACADEMICS.timetableManage, { description: 'Edit periods and timetable slots' })
  createPeriod(@ReqCtx() ctx: RequestContext, @Body() body: CreatePeriodDto) {
    return this.timetable.createPeriod(ctx, body);
  }

  @Delete('periods/:id')
  @HttpCode(204)
  @RequirePermission(ACADEMICS.timetableManage)
  async removePeriod(@ReqCtx() ctx: RequestContext, @Param('id') id: string): Promise<void> {
    await this.timetable.removePeriod(ctx, id);
  }

  @Get('slots')
  @ApiOperation({ summary: 'Timetable of a section or a teacher for the working year' })
  @RequirePermission(ACADEMICS.timetableView)
  async slots(@ReqCtx() ctx: RequestContext, @Query() q: TimetableQueryDto) {
    return { data: await this.timetable.slots(ctx, q) };
  }

  @Get('mine')
  @ApiOperation({ summary: 'My own week (teacher app)' })
  @RequirePermission(ACADEMICS.timetableView)
  async mine(@ReqCtx() ctx: RequestContext) {
    return { data: await this.timetable.mine(ctx) };
  }

  @Put('slots')
  @ApiOperation({ summary: 'Set or replace one slot; refuses a double-booked teacher' })
  @RequirePermission(ACADEMICS.timetableManage)
  setSlot(@ReqCtx() ctx: RequestContext, @Body() body: SetSlotDto) {
    return this.timetable.setSlot(ctx, body);
  }

  @Delete('slots/:id')
  @HttpCode(204)
  @RequirePermission(ACADEMICS.timetableManage)
  async removeSlot(@ReqCtx() ctx: RequestContext, @Param('id') id: string): Promise<void> {
    await this.timetable.removeSlot(ctx, id);
  }
}
