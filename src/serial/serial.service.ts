import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { Subject } from 'rxjs';
import { SERIAL_CONFIG } from './serial.config';

// Jika tidak ada data masuk selama 10 detik, anggap koneksi Arduino terputus.
// scan.py pakai timeout=1 per readline(); kita pakai watchdog timer setara.
const INACTIVITY_TIMEOUT_MS = 60_000;

export interface CopRawSample {
  x: number;
  y: number;
  index: number;
}

@Injectable()
export class SerialService implements OnModuleDestroy {
  private readonly logger = new Logger(SerialService.name);
  private port: SerialPort | null = null;
  private sampleCount = 0;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  readonly data$ = new Subject<CopRawSample>();
  readonly error$ = new Subject<string>();

  async start(): Promise<void> {
    if (this.port?.isOpen) {
      this.logger.warn('Serial port already open');
      return;
    }

    this.sampleCount = 0;

    this.port = new SerialPort({
      path: SERIAL_CONFIG.PORT,
      baudRate: SERIAL_CONFIG.BAUD_RATE,
      autoOpen: false,
    });

    const parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', (line: string) => this.handleLine(line));

    this.port.on('error', (err: Error) => {
      this.logger.error(`Serial port error: ${err.message}`);
      this.clearInactivityTimer();
      this.error$.next(err.message);
    });

    await new Promise<void>((resolve, reject) => {
      this.port!.open((err) => {
        if (err) return reject(err);

        // scan.py: ser.setDTR(False) + ser.setRTS(False)
        this.port!.set({ dtr: false, rts: false });

        // scan.py: reset_input_buffer() + reset_output_buffer()
        this.port!.flush((flushErr) => {
          if (flushErr) {
            this.logger.warn(`Buffer flush error: ${flushErr.message}`);
          }
          this.logger.log(`Serial port opened: ${SERIAL_CONFIG.PORT}`);
          this.resetInactivityTimer();
          resolve();
        });
      });
    });
  }

  async stop(): Promise<void> {
    this.clearInactivityTimer();
    if (!this.port?.isOpen) return;

    await new Promise<void>((resolve) => {
      this.port!.close(() => resolve());
    });

    this.port = null;
    this.logger.log('Serial port closed');
  }

  private handleLine(raw: string): void {
    const line = raw.trim();
    if (!line.includes('DATA:')) return;

    try {
      const payload = line.split('DATA:')[1];
      const parts = payload.split(',');
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);

      if (isNaN(x) || isNaN(y)) return;

      const { FIRST_SAMPLE, PHYSICAL } = SERIAL_CONFIG.LIMITS;

      if (
        this.sampleCount === 0 &&
        (x < FIRST_SAMPLE.X_MIN ||
          x > FIRST_SAMPLE.X_MAX ||
          y < FIRST_SAMPLE.Y_MIN ||
          y > FIRST_SAMPLE.Y_MAX)
      ) {
        this.logger.log('Sampel pertama tidak stabil/noise — diabaikan');
        return;
      }

      if (
        x < PHYSICAL.X_MIN ||
        x > PHYSICAL.X_MAX ||
        y < PHYSICAL.Y_MIN ||
        y > PHYSICAL.Y_MAX
      ) {
        this.logger.log(
          `Data noise terdeteksi (X: ${x} | Y: ${y}) — diabaikan`,
        );
        return;
      }

      this.sampleCount++;
      this.logger.debug(
        `[${this.sampleCount}/${SERIAL_CONFIG.SAMPEL_TARGET}] X: ${x} | Y: ${y}`,
      );
      // Reset timer setiap sampel valid masuk (setara timeout=1 di scan.py)
      this.resetInactivityTimer();
      this.data$.next({ x, y, index: this.sampleCount });
    } catch {
      // baris data tidak valid — abaikan
    }
  }

  private resetInactivityTimer(): void {
    this.clearInactivityTimer();
    this.inactivityTimer = setTimeout(() => {
      this.logger.warn('Inactivity timeout: tidak ada data dari Arduino');
      this.error$.next(
        'Koneksi Arduino terputus: tidak ada data selama 60 detik',
      );
      this.stop().catch(() => {});
    }, INACTIVITY_TIMEOUT_MS);
  }

  private clearInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  onModuleDestroy(): void {
    this.clearInactivityTimer();
    this.stop().catch(() => {});
    this.data$.complete();
    this.error$.complete();
  }
}
