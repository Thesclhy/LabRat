import { Type } from "class-transformer";
import {
  ArrayMinSize,
  ArrayMaxSize,
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
} from "class-validator";

const OUTPUT_TARGETS = ["chart", "experiment_browser"] as const;
const INPUT_MODES = ["experiment_browser", "workbook"] as const;
const EXECUTION_STRATEGIES = ["model_generated_python", "direct_source_mapping", "chart_template_v1"] as const;

export class AnalysisPageQueryDto {
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

export class AnalysisSelectionQueryDto extends AnalysisPageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  traceCursor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceCursor?: string;
}

export class CreateAnalysisThreadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  originalRequest!: string;

  @IsOptional()
  @IsIn(OUTPUT_TARGETS)
  outputTarget?: typeof OUTPUT_TARGETS[number];

  @IsOptional()
  @IsIn(INPUT_MODES)
  inputMode?: typeof INPUT_MODES[number];
}

export class CreateAgentRunDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  message!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  conversation?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsObject()
  selectedContext?: Record<string, unknown>;
}

export class CreateAnalysisPlanRevisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  feedback?: string;

  @IsOptional()
  @IsObject()
  plan?: Record<string, unknown>;
}

export class ExecuteAnalysisRunDto {
  @IsOptional()
  @IsIn(EXECUTION_STRATEGIES)
  executionStrategy?: typeof EXECUTION_STRATEGIES[number];
}

export class ReviseAnalysisRunDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  feedback!: string;
}

export class PublishAnalysisChartDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  analysisResultId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  defaultVisibleTraceIds!: string[];
}

export class PublishExperimentAnalysisDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  analysisResultId!: string;

  @IsArray()
  @ArrayMaxSize(1_000)
  @IsObject({ each: true })
  identityResolutions!: Array<Record<string, unknown>>;
}
