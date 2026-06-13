import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export type LogLevel = 'info' | 'warn' | 'error';

@Injectable()
export class ExamLogService {
  private readonly logger = new Logger(ExamLogService.name);

  constructor(private readonly supabase: SupabaseService) {}

  log(
    level: LogLevel,
    context: string,
    message: string,
    examId?: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.supabase.supabase
      .from('exam_logs')
      .insert({
        exam_id: examId ?? null,
        level,
        context,
        message,
        metadata: metadata ?? null,
        created_at: new Date().toISOString(),
      })
      .then(({ error }) => {
        if (error) {
          this.logger.warn(`Gagal simpan log ke Supabase: ${error.message}`);
        }
      });
  }
}
