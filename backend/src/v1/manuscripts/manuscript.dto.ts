import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class ManuscriptPageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateManuscriptDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5_000)
  blocks?: unknown[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1_000)
  pages?: unknown[];

  @IsOptional()
  @IsObject()
  canvasState?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5_000)
  references?: unknown[];
}

export class UpdateManuscriptDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5_000)
  blocks?: unknown[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1_000)
  pages?: unknown[];

  @IsOptional()
  @IsObject()
  canvasState?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5_000)
  references?: unknown[];
}
