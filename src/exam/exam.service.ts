import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { Subject, Subscription } from 'rxjs';
import { SerialService, CopRawSample } from '../serial/serial.service';
import { SensorService } from '../sensor/sensor.service';
import { SupabaseService } from '../supabase/supabase.service';
import { SERIAL_CONFIG } from '../serial/serial.config';
import { CopSample, ExamMetrics } from '../sensor/sensor.types';
import { ExamLogService } from './exam-log.service';

interface ExamSession {
  examId: string;
  patientId: string;
  stage: 1 | 2;
}

@Injectable()
export class ExamService {
  private readonly logger = new Logger(ExamService.name);

  readonly copSample$ = new Subject<{
    x: number;
    y: number;
    index: number;
    total: number;
  }>();
  readonly metricsUpdate$ = new Subject<ExamMetrics & { index: number }>();
  readonly examComplete$ = new Subject<ExamMetrics & { examId: string }>();
  readonly examError$ = new Subject<{ message: string }>();

  private samples: CopSample[] = [];
  private session: ExamSession | null = null;
  private dataSubscription: Subscription | null = null;
  private errorSubscription: Subscription | null = null;

  constructor(
    private readonly serialService: SerialService,
    private readonly sensorService: SensorService,
    private readonly supabase: SupabaseService,
    private readonly examLog: ExamLogService,
  ) {}

  isRunning(): boolean {
    return this.session !== null;
  }

  async startExam(
    patientId: string,
    stage: 1 | 2,
  ): Promise<{ examId: string }> {
    if (this.session) {
      throw new InternalServerErrorException('Sesi exam sedang berjalan');
    }

    const { data, error } = await this.supabase.supabase
      .from('exams')
      .insert({
        patient_id: patientId,
        stage,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) {
      this.examLog.log(
        'error',
        'ExamService',
        `Gagal insert exam ke Supabase: ${error.message}`,
        undefined,
        { patientId, stage },
      );
      throw new InternalServerErrorException(error.message);
    }

    this.session = { examId: data.id, patientId, stage };
    this.samples = [];

    this.dataSubscription = this.serialService.data$.subscribe((raw) =>
      this.handleSample(raw),
    );
    this.errorSubscription = this.serialService.error$.subscribe((msg) => {
      this.examLog.log('error', 'SerialService', msg, this.session?.examId);
      this.examError$.next({ message: msg });
    });

    try {
      await this.serialService.start();
    } catch (err: any) {
      this.examLog.log(
        'error',
        'ExamService',
        `Gagal membuka serial port: ${err.message}`,
        data.id,
        { patientId, stage },
      );
      this.cleanup();
      throw new InternalServerErrorException(
        `Gagal membuka serial port: ${err.message}`,
      );
    }

    this.examLog.log('info', 'ExamService', 'Exam dimulai', data.id, {
      patientId,
      stage,
    });
    this.logger.log(
      `Exam dimulai: ${data.id} (pasien: ${patientId}, stage: ${stage})`,
    );
    return { examId: data.id };
  }

  async stopExam(): Promise<void> {
    if (!this.session) return;
    await this.finalizeExam();
  }

  async getExam(id: string): Promise<any> {
    const { data, error } = await this.supabase.supabase
      .from('exams')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }

  private handleSample(raw: CopRawSample): void {
    if (!this.session) return;

    const sample: CopSample = { x: raw.x, y: raw.y, timestamp: Date.now() };
    this.samples.push(sample);

    const total = SERIAL_CONFIG.SAMPEL_TARGET;
    this.copSample$.next({ x: raw.x, y: raw.y, index: raw.index, total });

    if (this.samples.length >= 2) {
      const metrics = this.sensorService.computeMetrics(this.samples);
      this.metricsUpdate$.next({ ...metrics, index: raw.index });
    }

    if (raw.index >= total) {
      this.finalizeExam();
    }
  }

  private async finalizeExam(): Promise<void> {
    if (!this.session) return;
    const session = this.session;
    this.cleanup();

    await this.serialService.stop();

    if (this.samples.length < 2) {
      this.examLog.log(
        'warn',
        'ExamService',
        'Data tidak cukup untuk menghitung metrik',
        session.examId,
        { sampleCount: this.samples.length },
      );
      this.examError$.next({
        message: 'Data tidak cukup untuk menghitung metrik',
      });
      return;
    }

    const metrics = this.sensorService.computeMetrics(this.samples);

    const { error } = await this.supabase.supabase
      .from('exams')
      .update({
        spl: metrics.spl,
        aoe: metrics.aoe,
        v_ap: metrics.vAP,
        v_ml: metrics.vML,
        spl_series: metrics.splSeries,
        velocity_series: metrics.velocitySeries,
        cop_scatter: metrics.copScatter,
      })
      .eq('id', session.examId);

    if (error) {
      this.logger.error(`Gagal menyimpan hasil exam: ${error.message}`);
      this.examLog.log(
        'error',
        'ExamService',
        `Gagal menyimpan hasil exam: ${error.message}`,
        session.examId,
      );
    }

    this.examLog.log('info', 'ExamService', 'Exam selesai', session.examId, {
      spl: metrics.spl,
      aoe: metrics.aoe,
      vAP: metrics.vAP,
      vML: metrics.vML,
      sampleCount: this.samples.length,
    });
    this.examComplete$.next({ ...metrics, examId: session.examId });
    this.logger.log(`Exam selesai: ${session.examId}`);
  }

  private cleanup(): void {
    this.session = null;
    this.dataSubscription?.unsubscribe();
    this.errorSubscription?.unsubscribe();
    this.dataSubscription = null;
    this.errorSubscription = null;
  }
}
