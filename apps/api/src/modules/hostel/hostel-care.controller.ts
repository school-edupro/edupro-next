import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  ComplaintDto,
  ComplaintsQueryDto,
  DashboardQueryDto,
  HOSTEL,
  HOSTEL_H2,
  HOSTEL_H3,
  HOSTEL_H4,
  IncidentDto,
  IncidentNoteDto,
  IncidentsFileDto,
  IncidentsQueryDto,
  SickbayDto,
} from './hostel.dto';
import { HostelCareService } from './hostel-care.service';

/** Hostel module H4: incidents, the warden's sick-bay note (a clinic visit), the dashboard. */
@ApiTags('hostel')
@ApiBearerAuth()
@Controller('hostel')
export class HostelCareController {
  constructor(private readonly care: HostelCareService) {}

  @Get('mine/complaint-heads')
  @RequirePermission(HOSTEL_H3.family)
  async familyHeads(@ReqCtx() ctx: RequestContext) {
    return { data: await this.care.complaintHeads(ctx) };
  }

  @Get('complaint-heads')
  @RequirePermission(HOSTEL.view)
  async heads(@ReqCtx() ctx: RequestContext) {
    return { data: await this.care.complaintHeads(ctx) };
  }

  @Post('mine/complaints')
  @ApiOperation({
    summary: "A parent's complaint about the child's hostel room (the helpdesk's hostel desk)",
  })
  @RequirePermission(HOSTEL_H3.family)
  familyRaise(@ReqCtx() ctx: RequestContext, @Body() dto: ComplaintDto) {
    return this.care.familyRaise(ctx, dto);
  }

  @Get('mine/complaints')
  @RequirePermission(HOSTEL_H3.family)
  async familyComplaints(@ReqCtx() ctx: RequestContext, @Query('studentId') studentId: string) {
    return { data: await this.care.familyComplaints(ctx, studentId) };
  }

  @Get('complaints')
  @ApiOperation({ summary: 'Hostel complaints (open, closed, all); a warden sees their hostels' })
  @RequirePermission(HOSTEL.view)
  async complaints(@ReqCtx() ctx: RequestContext, @Query() q: ComplaintsQueryDto) {
    return { data: await this.care.complaints(ctx, q) };
  }

  @Post('incidents')
  @ApiOperation({
    summary: 'Record an incident; the parent is told when ticked, the principal when serious',
  })
  @RequirePermission(HOSTEL_H4.incident)
  record(@ReqCtx() ctx: RequestContext, @Body() dto: IncidentDto) {
    return this.care.recordIncident(ctx, dto);
  }

  @Get('incidents')
  @ApiOperation({ summary: 'The incident register: filtered, paged, with the count by status' })
  @RequirePermission(HOSTEL_H4.incidentView)
  incidents(@ReqCtx() ctx: RequestContext, @Query() q: IncidentsQueryDto) {
    return this.care.incidents(ctx, q);
  }

  @Get('incidents/file')
  @ApiOperation({ summary: 'The incident register as Excel or PDF' })
  @RequirePermission(HOSTEL_H4.incidentView)
  async incidentsFile(@ReqCtx() ctx: RequestContext, @Query() q: IncidentsFileDto) {
    const f = await this.care.incidentsFile(ctx, q);
    return { filename: f.filename, contentType: f.contentType, base64: f.bytes.toString('base64') };
  }

  @Get('incidents/:id')
  @ApiOperation({ summary: 'One incident with its follow-up notes and files' })
  @RequirePermission(HOSTEL_H4.incidentView)
  incident(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.care.incident(ctx, id);
  }

  @Post('incidents/:id/notes')
  @ApiOperation({
    summary: 'A follow-up note; it may move the incident to follow-up, open or closed',
  })
  @RequirePermission(HOSTEL_H4.incident)
  addIncidentNote(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: IncidentNoteDto,
  ) {
    return this.care.addIncidentNote(ctx, id, dto);
  }

  @Get('mine/incidents')
  @ApiOperation({ summary: 'The incidents the hostel shared with the family, for a child' })
  @RequirePermission(HOSTEL_H3.family)
  async familyIncidents(@ReqCtx() ctx: RequestContext, @Query('studentId') studentId: string) {
    return { data: await this.care.familyIncidents(ctx, studentId) };
  }

  @Post('sickbay')
  @ApiOperation({ summary: "A warden's sick-bay note, recorded as a clinic visit of the boarder" })
  @RequirePermission(HOSTEL_H2.rollcall)
  sickbay(@ReqCtx() ctx: RequestContext, @Body() dto: SickbayDto) {
    return this.care.sickbay(ctx, dto);
  }

  @Get('sickbay')
  @RequirePermission(HOSTEL_H2.rollcall)
  async sickbayList(@ReqCtx() ctx: RequestContext, @Query('days') days?: string) {
    const n = Math.min(90, Math.max(1, Number(days) || 14));
    return { data: await this.care.sickbayList(ctx, n) };
  }

  @Get('dashboard')
  @ApiOperation({
    summary:
      'Hostel dashboard: today per hostel, trends of the last days, hostel fee of the session',
  })
  @RequirePermission(HOSTEL.view)
  dashboard(@ReqCtx() ctx: RequestContext, @Query() q: DashboardQueryDto) {
    return this.care.dashboard(ctx, q);
  }
}
