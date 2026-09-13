import { Type } from "class-transformer";
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt,
  IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested,
} from "class-validator";

export class TemplateListQueryDto {
  @IsOptional() @IsIn(["true", "false"]) includeArchived?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}
export class TemplateRegionDto {
  @IsString() @MinLength(1) @MaxLength(160) regionId!: string;
}
export class CreateRegionTemplateDto extends TemplateRegionDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}
export class MatchRegionTemplateDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique()
  @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(160, { each: true })
  sourceDocumentIds!: string[];
}
export class ApplyRegionTemplateDto extends MatchRegionTemplateDto {
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2) @ArrayUnique()
  @IsIn(["exact", "shifted"], { each: true }) onlyStatuses?: string[];
}
export class ConfirmRegionItemDto {
  @IsString() @MinLength(1) @MaxLength(160) regionId!: string;
  @IsString() @MinLength(1) @MaxLength(160) revisionId!: string;
  @Type(() => Number) @IsInt() @Min(1) expectedRegionVersion!: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) linkedExperimentId?: string;
}
export class ConfirmRegionBatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => ConfirmRegionItemDto)
  items!: ConfirmRegionItemDto[];
}
export class LinkedComparisonDto {
  @IsString() @MinLength(1) @MaxLength(160) dataKind!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(64) @ArrayUnique()
  @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(160, { each: true })
  experimentIds!: string[];
  @IsOptional() @IsIn(["grouped_bar", "bar", "scatter", "point", "stacked_bar"]) chartType?: string;
  @IsOptional() @IsBoolean() dryRun?: boolean;
}
