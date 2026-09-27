import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class RegisterDocumentDto {
  @IsString() @MinLength(1) @MaxLength(160)
  fileObjectId!: string;
}

export class DocumentPageDto {
  @IsOptional() @IsString() @MaxLength(180)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(40)
  limit?: number;
}

export class ArchiveDocumentDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
}

export class EmptyDocumentDto {}
