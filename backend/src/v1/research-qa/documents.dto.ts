import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class RegisterDocumentDto {
  @IsString() @MinLength(1) @MaxLength(160)
  fileObjectId!: string;

  @IsOptional() @IsBoolean() newDocument?: boolean;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) documentId?: string;
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}

export class DocumentPageDto {
  @IsOptional() @IsString() @MaxLength(180)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(40)
  limit?: number;

  @IsOptional() @IsString() @MaxLength(250) search?: string;
  @IsOptional() @IsIn(["", "pdf", "word", "txt"]) type?: string;
  @IsOptional() @IsIn(["", "ready", "partial", "processing", "pending", "failed", "interrupted"]) status?: string;
  @IsOptional() @IsIn(["newest", "oldest"]) sort?: string;
}

export class ArchiveDocumentDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
}

export class EmptyDocumentDto {}
