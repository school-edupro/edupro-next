import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators';
import {
  AdmissionCandidateGuard,
  type CandidateRequest,
} from '../admissions/portal/candidate.guard';
import { AnswerBackDto, AskDto, RateAskDto, ReopenAskDto } from './candidate-queries.dto';
import { CandidateQueriesService } from './candidate-queries.service';

/** "Ask the school" and My queries of the admission portal (docs/design/43, part 4). */
@ApiTags('admissions')
@Controller('public/admission/me/queries')
@Public()
@UseGuards(AdmissionCandidateGuard)
export class CandidateQueriesController {
  constructor(private readonly svc: CandidateQueriesService) {}

  @Get('options')
  @ApiOperation({ summary: 'What a family may ask about: the heads and its registrations' })
  options(@Req() req: CandidateRequest) {
    return this.svc.options(req.candidate!);
  }

  @Get()
  @ApiOperation({ summary: "The family's questions to the school" })
  list(@Req() req: CandidateRequest) {
    return this.svc.list(req.candidate!);
  }

  @Post()
  @ApiOperation({ summary: 'Ask the school about a registration (a ticket of the admission desk)' })
  ask(@Req() req: CandidateRequest, @Body() dto: AskDto) {
    return this.svc.ask(req.candidate!, dto);
  }

  @Get(':id')
  get(@Req() req: CandidateRequest, @Param('id') id: string) {
    return this.svc.get(req.candidate!, id);
  }

  @Post(':id/reply')
  reply(@Req() req: CandidateRequest, @Param('id') id: string, @Body() dto: AnswerBackDto) {
    return this.svc.answerBack(req.candidate!, id, dto);
  }

  @Post(':id/reopen')
  reopen(@Req() req: CandidateRequest, @Param('id') id: string, @Body() dto: ReopenAskDto) {
    return this.svc.reopen(req.candidate!, id, dto);
  }

  @Post(':id/rate')
  rate(@Req() req: CandidateRequest, @Param('id') id: string, @Body() dto: RateAskDto) {
    return this.svc.rate(req.candidate!, id, dto);
  }

  @Get(':id/files/:fileId')
  file(@Req() req: CandidateRequest, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.svc.file(req.candidate!, id, fileId);
  }
}
