import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreatePatientDto } from './dto/create-patient.dto';

@Injectable()
export class PatientService {
  constructor(private supabase: SupabaseService) {}

  async create(dto: CreatePatientDto) {
    const { data, error } = await this.supabase.supabase
      .from('patients')
      .insert({
        name: dto.name,
        age: dto.age,
        gender: dto.gender,
        height: dto.height ?? null,
        weight: dto.weight ?? null,
        notes: dto.notes ?? null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabase.supabase
      .from('patients')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new NotFoundException(`Patient ${id} not found`);
    return data;
  }
}
