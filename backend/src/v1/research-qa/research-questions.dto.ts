import { IsString, MaxLength, MinLength, Matches } from "class-validator";

export class CreateResearchQuestionDto {
  @IsString() @MinLength(8) @MaxLength(100) @Matches(/^[A-Za-z0-9_-]+$/)
  requestKey!: string;

  @IsString() @MinLength(1) @MaxLength(4000)
  question!: string;
}
