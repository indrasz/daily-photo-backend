import { Module } from '@nestjs/common';
import { ExamService } from './exam.service';
import { ExamGateway } from './exam.gateway';
import { ExamController } from './exam.controller';
import { ExamLogService } from './exam-log.service';
import { SerialModule } from '../serial/serial.module';
import { SensorModule } from '../sensor/sensor.module';

@Module({
  imports: [SerialModule, SensorModule],
  providers: [ExamService, ExamGateway, ExamLogService],
  controllers: [ExamController],
})
export class ExamModule {}
