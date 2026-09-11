import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class ReusableChartPageQueryDto {
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

  @IsOptional()
  @IsIn(["true", "false"])
  includeArchived?: "true" | "false";
}

export class CreateChartStyleProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  description?: string;

  @IsOptional()
  @IsObject()
  style?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  definition?: Record<string, unknown>;
}

export class CreateChartStyleProfileVersionDto {
  @IsOptional()
  @IsObject()
  style?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  definition?: Record<string, unknown>;
}

export class CreateReusableChartTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  description?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  sourceChartSpecId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  chartStyleProfileVersionId?: string | null;
}

export class CreateReusableChartTemplateVersionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  sourceChartSpecId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  chartStyleProfileVersionId?: string | null;
}

export class ReusableChartTemplateBindingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  slotId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  columnId!: string;
}

export class ApplyReusableChartTemplateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(200, { each: true })
  experimentIds!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ReusableChartTemplateBindingDto)
  bindings?: ReusableChartTemplateBindingDto[];
}
