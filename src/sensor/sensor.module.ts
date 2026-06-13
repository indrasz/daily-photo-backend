import { Module } from '@nestjs/common';
import { SensorService } from './sensor.service';

@Module({
  providers: [SensorService],
  exports: [SensorService],
})
export class SensorModule {}
