import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";

export class ProjectProfileDto {
  @IsOptional()
  @IsString()
  @IsIn(["labrat.projectProfile.v1"])
  schemaVersion?: "labrat.projectProfile.v1";

  @IsOptional() @IsString() @MaxLength(20000) researchGoal?: string;
  @IsOptional() @IsString() @MaxLength(20000) experimentBackground?: string;
  @IsOptional() @IsString() @MaxLength(20000) materials?: string;
  @IsOptional() @IsString() @MaxLength(20000) methods?: string;
  @IsOptional() @IsString() @MaxLength(20000) instruments?: string;
  @IsOptional() @IsString() @MaxLength(20000) analysisNotes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  tags?: string[];
}

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  labId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProjectProfileDto)
  projectProfile?: ProjectProfileDto;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn(["active", "archived"])
  status?: "active" | "archived";
}
