import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly, Public } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { CompatParityService } from './compat-parity.service';
import {
  AlbumImagesDto,
  AppVersionDto,
  AssignmentQueryDto,
  GatePassQueryDto,
  MarkEntryQueryDto,
  SadmissionDto,
  SendQueryDto,
  StudentLeaveDto,
  SubmitGatePassDto,
  SubmitMarkEntryDto,
  SubmitVisitorDto,
  UpdateGatePassStatusDto,
  VisitorQueryDto,
} from './compat.dto';

/**
 * Sprint 20: the remaining endpoints the current student, parent and teacher apps call, answered in
 * their legacy shapes from the new modules (design note 17 section 1). Every route runs under the app
 * session of the handshake; the person type decides what "mine" means.
 */
@ApiTags('compat')
@Controller('compat/v1')
export class CompatParityController {
  constructor(private readonly svc: CompatParityService) {}

  // ---- student / parent app ----
  @Get('student/GetFee')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Fee instalments of a child (legacy GetFee.php)' })
  fee(@ReqCtx() ctx: RequestContext, @Query() q: SadmissionDto) {
    return this.svc.fee(ctx, q);
  }

  @Get('student/GetTransport')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Bus route, stop, vehicle and driver of a child (GetTransport.php)' })
  transport(@ReqCtx() ctx: RequestContext, @Query() q: SadmissionDto) {
    return this.svc.transport(ctx, q);
  }

  @Get('student/GetLibraryTrasaction')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Library loans of a child (GetLibraryTrasaction.php)' })
  library(@ReqCtx() ctx: RequestContext, @Query() q: SadmissionDto) {
    return this.svc.library(ctx, q);
  }

  @Get('student/GetHealthrecord')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Health records of a child (GetHealthrecord.php)' })
  health(@ReqCtx() ctx: RequestContext, @Query() q: SadmissionDto) {
    return this.svc.health(ctx, q);
  }

  @Get('student/GetClinicExamination')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Annual health check and clinic visits (GetClinicExamination.php)' })
  clinic(@ReqCtx() ctx: RequestContext, @Query() q: SadmissionDto) {
    return this.svc.clinic(ctx, q);
  }

  @Get('student/GetDatesheet')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Exam datesheet of a class (GetDatesheet.php)' })
  datesheet(@ReqCtx() ctx: RequestContext, @Query() q: SadmissionDto) {
    return this.svc.datesheet(ctx, q);
  }

  @Get('student/GetStudentDateSheet')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Datesheet as notices (GetStudentDateSheet.php)' })
  studentDatesheet(@ReqCtx() ctx: RequestContext, @Query() q: SadmissionDto) {
    return this.svc.studentDatesheet(ctx, q);
  }

  @Get('student/GetReportCard')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Released report cards of a child (GetReportCard.php)' })
  reportCard(@ReqCtx() ctx: RequestContext, @Query() q: SadmissionDto) {
    return this.svc.reportCard(ctx, q);
  }

  @Get('student/GetAcademicCalander')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Almanac and holidays (GetAcademicCalander.php)' })
  calendar(@ReqCtx() ctx: RequestContext) {
    return this.svc.calendar(ctx);
  }

  @Get('student/GetSchoolnews')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'School-wide notices as news (GetSchoolnews.php)' })
  news(@ReqCtx() ctx: RequestContext) {
    return this.svc.news(ctx);
  }

  @Get('student/get_app_banner_news')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Banner items for the app home (get_app_banner_news.php)' })
  banner(@ReqCtx() ctx: RequestContext) {
    return this.svc.banner(ctx);
  }

  @Get('student/GetAlbum')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Gallery albums (GetAlbum.php)' })
  albums(@ReqCtx() ctx: RequestContext) {
    return this.svc.albums(ctx);
  }

  @Get('student/GetAlbumImages')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Photos of an album with signed links (GetAlbumImages.php)' })
  albumImages(@ReqCtx() ctx: RequestContext, @Query() q: AlbumImagesDto) {
    return this.svc.albumImages(ctx, q);
  }

  @Get('GetGatePass')
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Gate passes: a family sees its own, staff the queue (GetGatePass.php)',
  })
  gatePasses(@ReqCtx() ctx: RequestContext, @Query() q: GatePassQueryDto) {
    return this.svc.gatePasses(ctx, q);
  }

  @Post('SubmitGatePass')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Raise a gate pass (SubmitGatePass.php)' })
  submitGatePass(@ReqCtx() ctx: RequestContext, @Body() body: SubmitGatePassDto) {
    return this.svc.submitGatePass(ctx, body);
  }

  @Post('UpdateGetPassStatus')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Approve or reject a gate pass (UpdateGetPassStatus.php)' })
  updateGatePass(@ReqCtx() ctx: RequestContext, @Body() body: UpdateGatePassStatusDto) {
    return this.svc.updateGatePass(ctx, body);
  }

  @Post('student/student_apply_Leave')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'A family applies for leave (student_apply_Leave.php)' })
  applyLeave(@ReqCtx() ctx: RequestContext, @Body() body: StudentLeaveDto) {
    return this.svc.applyLeave(ctx, body);
  }

  @Get('student/student_leave_list')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Leave requests of the family (student_leave_list.php)' })
  leaveList(@ReqCtx() ctx: RequestContext) {
    return this.svc.leaveList(ctx);
  }

  // ---- teacher app ----
  @Get('teacher/GetUserDetail')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'The signed-in employee (GetUserDetail.php / TeacherProfile.php)' })
  userDetail(@ReqCtx() ctx: RequestContext) {
    return this.svc.userDetail(ctx);
  }

  @Get('teacher/get_class_subject')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Sections, subjects and exams of the teacher (get_class_subject.php)' })
  classSubject(@ReqCtx() ctx: RequestContext) {
    return this.svc.classSubject(ctx);
  }

  @Get('teacher/show_student_for_mark_entry')
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Marks sheet of a section and subject (show_student_for_mark_entry.php)',
  })
  markSheet(@ReqCtx() ctx: RequestContext, @Query() q: MarkEntryQueryDto) {
    return this.svc.markSheet(ctx, q);
  }

  @Post('teacher/submit_mark_entry')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Save marks (submit_mark_entry.php)' })
  submitMarks(@ReqCtx() ctx: RequestContext, @Body() body: SubmitMarkEntryDto) {
    return this.svc.submitMarks(ctx, body);
  }

  @Get('teacher/GetAssignment')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Assignments posted for a class (GetAssignment.php)' })
  assignments(@ReqCtx() ctx: RequestContext, @Query() q: AssignmentQueryDto) {
    return this.svc.assignments(ctx, q);
  }

  @Get('teacher/GetParentQuery')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Family queries for the teacher (GetParentQuery.php)' })
  parentQueries(@ReqCtx() ctx: RequestContext) {
    return this.svc.parentQueries(ctx);
  }

  @Post('SendQuery')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'An employee raises a query (SendQuery.php)' })
  sendQuery(@ReqCtx() ctx: RequestContext, @Body() body: SendQueryDto) {
    return this.svc.sendQuery(ctx, body);
  }

  @Get('GetQueryResponse')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Answers to the employee’s queries (GetQueryResponse.php)' })
  queryResponses(@ReqCtx() ctx: RequestContext) {
    return this.svc.queryResponses(ctx);
  }

  @Get('teacher/GetVistorEntry')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Visitor log of a day (GetVistorEntry.php)' })
  visitors(@ReqCtx() ctx: RequestContext, @Query() q: VisitorQueryDto) {
    return this.svc.visitors(ctx, q);
  }

  @Post('teacher/SubmitVisitorEntry')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Sign a visitor in (SubmitVisitorEntry.php)' })
  submitVisitor(@ReqCtx() ctx: RequestContext, @Body() body: SubmitVisitorDto) {
    return this.svc.submitVisitor(ctx, body);
  }

  @Get('teacher/GetLeaveHistory')
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Staff leave is not on this platform until Release 2 (GetLeaveHistory.php)',
  })
  leaveHistory() {
    return this.svc.staffLeaveStub();
  }

  @Post('teacher/ApplyLeave')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Staff leave is not on this platform until Release 2 (ApplyLeave.php)' })
  staffApplyLeave() {
    return this.svc.staffLeaveStub();
  }

  // ---- before sign-in ----
  @Get('app_version')
  @Public()
  @ApiOperation({
    summary: 'Current app build and forced-update floor (app_version.php / GetUpdateVersion.php)',
  })
  appVersion(@Query() q: AppVersionDto) {
    return this.svc.appVersion(q);
  }
}
