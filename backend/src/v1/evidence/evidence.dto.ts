import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const SEMANTIC_TYPES = [
  "experiment_table",
  "reaction_rate_time_series",
  "component_distribution",
  "calculation_table",
  "metadata_notes",
  "generic_table",
  "ignored_region",
  "unknown_region",
] as const;

export class RetrieveEvidenceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  query!: string;

  @IsOptional()
  @IsBoolean()
  includePreview?: boolean;

  @IsOptional()
  @IsBoolean()
  includeUnconfirmedSuggestions?: boolean;
}

export class CreateImportRunDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  fileObjectId!: string;
}

export class SourceDocumentQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  query!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class SourceDocumentRangeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  sheetName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  range!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  maxCells?: number;
}

export class CreateWorkbookReviewSessionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  fileObjectId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  sourceDocumentId?: string;
}

export class DeleteWorkbookReviewSessionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  reason?: string;
}

export class CreateWorkbookReviewRegionDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  sourceDocumentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  sourceRegionId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  sheetName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  range!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  selectionMethod?: string;

  @IsOptional()
  @IsIn(SEMANTIC_TYPES)
  semanticType?: typeof SEMANTIC_TYPES[number];

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  deferInterpretation?: boolean;
}

export class InterpretWorkbookReviewRegionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRegionVersion!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  @IsOptional()
  @IsIn(SEMANTIC_TYPES)
  semanticType?: typeof SEMANTIC_TYPES[number];
}

export class ReviseWorkbookReviewRegionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRegionVersion!: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  previousRevisionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  feedback?: string;
}

export class ConfirmWorkbookReviewRegionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  revisionId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRegionVersion!: number;
}

export class IgnoreWorkbookReviewRegionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRegionVersion!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  reason?: string;
}

export class DeleteWorkbookReviewRegionDto extends IgnoreWorkbookReviewRegionDto {}
