import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient;

  constructor(private config: ConfigService) {
    const url = this.config.getOrThrow<string>('DB_URL');
    const key = this.config.getOrThrow<string>('DB_PUBLISH_KEY');
    this.client = createClient(url, key);
  }

  get supabase(): SupabaseClient {
    return this.client;
  }
}
