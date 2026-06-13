import { Controller, Post, Get, Param, Body, HttpCode } from '@nestjs/common';
import { ExamService } from './exam.service';
import { StartExamDto } from './dto/start-exam.dto';

@Controller('exams')
export class ExamController {
  constructor(private readonly examService: ExamService) {}

  @Post('start')
  start(@Body() dto: StartExamDto): Promise<{ examId: string }> {
    return this.examService.startExam(dto.patientId, dto.stage);
  }

  @Post('stop')
  @HttpCode(200)
  async stop(): Promise<{ message: string }> {
    await this.examService.stopExam();
    return { message: 'Exam dihentikan' };
  }

  @Get(':id')
  getExam(@Param('id') id: string): Promise<any> {
    return this.examService.getExam(id);
  }
}
