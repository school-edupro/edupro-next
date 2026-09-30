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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  AddDocumentDto,
  CreateStudentDto,
  EnrolDto,
  LinkGuardianDto,
  ListStudentsQueryDto,
  ParentPhotoDto,
  ReplaceDocumentDto,
  UpdateStudentDto,
  VerifyDocumentDto,
} from './people.dto';
import { PEOPLE } from './people.permissions';
import { StudentsService } from './students.service';

@ApiTags('people')
@ApiBearerAuth()
@Controller('people/students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  @ApiOperation({
    summary: 'List students of the working year (class teachers see their sections only)',
  })
  @RequirePermission(PEOPLE.studentView, { description: 'View students (scope: class_section)' })
  async list(@ReqCtx() ctx: RequestContext, @Query() q: ListStudentsQueryDto) {
    const { rows, total } = await this.students.list(ctx, q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Student 360: record, guardians, enrolments, documents, siblings' })
  @RequirePermission(PEOPLE.studentView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.students.get(ctx, id);
  }

  @Get(':id/status-history')
  @ApiOperation({
    summary: 'Status changes of a student (created, inactive, removed) with actor and reason',
  })
  @RequirePermission(PEOPLE.studentView)
  async statusHistory(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.students.statusHistory(ctx, id) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a student with optional guardians and enrolment' })
  @RequirePermission(PEOPLE.studentCreate, { description: 'Admit or create students' })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateStudentDto) {
    return this.students.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission(PEOPLE.studentEdit, {
    description: 'Edit student records, photos and documents',
  })
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UpdateStudentDto) {
    return this.students.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(PEOPLE.studentDelete, { mfa: true, description: 'Remove a student record' })
  async remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string): Promise<void> {
    await this.students.remove(ctx, id);
  }

  @Post(':id/guardians')
  @RequirePermission(PEOPLE.guardianEdit, { description: 'Create, edit and link guardians' })
  linkGuardian(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: LinkGuardianDto,
  ) {
    return this.students.linkGuardian(ctx, id, body);
  }

  @Delete(':id/guardians/:guardianId')
  @HttpCode(200)
  @RequirePermission(PEOPLE.guardianEdit)
  unlinkGuardian(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('guardianId') guardianId: string,
  ) {
    return this.students.unlinkGuardian(ctx, id, guardianId);
  }

  @Post(':id/enrolments')
  @ApiOperation({
    summary: 'Enrol into a section of a year (one enrolment per year; moves on re-enrol)',
  })
  @RequirePermission(PEOPLE.enrolmentManage, {
    description: 'Enrol students into sections; change sections and roll numbers',
  })
  enrol(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: EnrolDto) {
    return this.students.enrol(ctx, id, body);
  }

  @Post(':id/documents')
  @RequirePermission(PEOPLE.studentEdit)
  addDocument(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: AddDocumentDto,
  ) {
    return this.students.addDocument(ctx, id, body);
  }

  @Put(':id/documents/:docId')
  @ApiOperation({ summary: 'Replace a document file (the old one is kept as history)' })
  @RequirePermission(PEOPLE.studentEdit)
  replaceDocument(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body() body: ReplaceDocumentDto,
  ) {
    return this.students.replaceDocument(ctx, id, docId, body);
  }

  @Delete(':id/documents/:docId')
  @ApiOperation({ summary: 'Remove a document (kept in history, audited)' })
  @RequirePermission(PEOPLE.studentEdit)
  removeDocument(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.students.removeDocument(ctx, id, docId);
  }

  @Post(':id/documents/:docId/verify')
  @ApiOperation({ summary: 'Mark a document as checked against the original (or undo)' })
  @RequirePermission(PEOPLE.studentEdit)
  verifyDocument(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body() body: VerifyDocumentDto,
  ) {
    return this.students.verifyDocument(ctx, id, docId, body.verified);
  }

  @Post(':id/profile-print')
  @ApiOperation({ summary: 'Student profile printout (A4 PDF with the student and parent photos)' })
  @RequirePermission(PEOPLE.studentView)
  profilePrint(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.students.requestProfilePrint(ctx, id);
  }

  @Post(':id/parent-photo')
  @ApiOperation({ summary: "Set the father's, mother's or guardian's photo" })
  @RequirePermission(PEOPLE.studentEdit)
  parentPhoto(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: ParentPhotoDto,
  ) {
    return this.students.setParentPhoto(ctx, id, body.party, body.fileId);
  }

  @Post(':id/id-card')
  @ApiOperation({ summary: 'Render the ID card as a PDF export' })
  @RequirePermission(PEOPLE.studentView)
  idCard(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.students.requestIdCard(ctx, id);
  }
}
