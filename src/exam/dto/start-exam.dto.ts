import { IsString, IsIn } from 'class-validator';

export class StartExamDto {
  @IsString()
  patientId!: string;

  @IsIn([1, 2])
  stage!: 1 | 2;
}
