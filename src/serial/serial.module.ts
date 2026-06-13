import { Module } from '@nestjs/common';
import { SerialService } from './serial.service';

@Module({
  providers: [SerialService],
  exports: [SerialService],
})
export class SerialModule {}
