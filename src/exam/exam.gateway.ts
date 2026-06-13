import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  OnGatewayInit,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ExamService } from './exam.service';

@WebSocketGateway({ cors: { origin: 'http://localhost:3001' } })
export class ExamGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly logger = new Logger(ExamGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly examService: ExamService) {}

  afterInit() {
    this.examService.copSample$.subscribe((payload) => {
      this.server.emit('cop_sample', payload);
    });

    this.examService.metricsUpdate$.subscribe((payload) => {
      this.server.emit('metrics_update', payload);
    });

    this.examService.examComplete$.subscribe((payload) => {
      this.server.emit('exam_complete', payload);
    });

    this.examService.examError$.subscribe((payload) => {
      this.server.emit('exam_error', payload);
    });
  }

  @SubscribeMessage('start_exam')
  async handleStartExam(
    @MessageBody() data: { patientId: string; stage: 1 | 2 },
  ): Promise<void> {
    try {
      const result = await this.examService.startExam(
        data.patientId,
        data.stage,
      );
      this.server.emit('exam_started', result);
    } catch (err: any) {
      this.server.emit('exam_error', { message: err.message });
    }
  }

  @SubscribeMessage('stop_exam')
  async handleStopExam(): Promise<void> {
    try {
      await this.examService.stopExam();
    } catch (err: any) {
      this.server.emit('exam_error', { message: err.message });
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }
}
