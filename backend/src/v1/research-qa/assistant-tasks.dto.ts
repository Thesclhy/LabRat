import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { CreateResearchQuestionDto } from "./research-questions.dto.js";

export class TaskFileDto {
  @IsString() @MinLength(1) @MaxLength(250) name!: string;
  @IsIn(["workbook", "reference"]) kind!: "workbook" | "reference";
}
export class CreateAssistantTaskDto extends CreateResearchQuestionDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => TaskFileDto)
  attachments!: TaskFileDto[];
}
export class AttachTaskFileDto {
  @IsInt() @Min(0) @Max(7) index!: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) workbookReviewSessionId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) documentId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) versionId?: string;
}
export class AssistantTaskPageDto {
  @IsOptional() @IsString() @MaxLength(180) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(40) limit?: number;
}
