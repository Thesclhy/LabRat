import { Type } from "class-transformer";
import { IsString, MaxLength, MinLength, Matches, IsOptional, IsArray, ArrayMaxSize, ValidateNested, IsIn } from "class-validator";

export class QuestionReferenceDto {
  @IsString() @MinLength(1) @MaxLength(160) documentId!: string;
  @IsString() @MinLength(1) @MaxLength(160) versionId!: string;
}

export class QuestionConversationDto {
  @IsIn(["user", "assistant"]) role!: "user" | "assistant";
  @IsString() @MaxLength(1000) text!: string;
}

export class CreateResearchQuestionDto {
  @IsString() @MinLength(8) @MaxLength(100) @Matches(/^[A-Za-z0-9_-]+$/)
  requestKey!: string;

  @IsString() @MinLength(1) @MaxLength(4000)
  question!: string;

  @IsOptional() @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => QuestionReferenceDto)
  referenceDocuments?: QuestionReferenceDto[];

  @IsOptional() @IsIn(["project", "selected"])
  sourceScope?: "project" | "selected";

  @IsOptional() @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => QuestionConversationDto)
  conversation?: QuestionConversationDto[];

  @IsOptional() @IsString() @MaxLength(250)
  selectedExperimentLabel?: string;
}
