import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class ExperimentBrowserQueryDto {
  @IsOptional() @IsString() @MaxLength(500) search?: string;
  @IsOptional() @IsString() @MaxLength(20_000) filters?: string;
  @IsOptional() @IsString() @MaxLength(10_000) sort?: string;
  @IsOptional() @IsString() @MaxLength(4096) cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(250)
  limit?: number;

  @IsOptional()
  @IsString()
  @IsIn(["true", "false"])
  starredOnly?: "true" | "false";
}

export class ExperimentAnnotationDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsString() @IsIn(["amber", "red", "green", "blue", "purple", "pink"])
  color?: "amber" | "red" | "green" | "blue" | "purple" | "pink";
}

export class CreateExperimentCustomColumnDto {
  @IsString() @IsNotEmpty() @MaxLength(120) label!: string;
}

export class UpdateExperimentCustomColumnDto extends CreateExperimentCustomColumnDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
}

export class SaveExperimentCustomValueDto {
  @IsString() @MaxLength(2000) value!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expectedVersion?: number;
}

export class ProjectBrowserConfigDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @IsObject() payload!: Record<string, unknown>;
}

export class CreateBrowserViewDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @IsObject() payload!: Record<string, unknown>;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateBrowserViewDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
