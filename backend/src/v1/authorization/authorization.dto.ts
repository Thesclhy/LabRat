import { Type } from "class-transformer";
import {
  ArrayUnique,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { CAPABILITIES, type Capability, type GrantScope } from "./authorization.policy.js";

export class UpsertLabMemberDto {
  @IsString()
  @IsIn(["lab_admin", "lab_member"])
  role!: "lab_admin" | "lab_member";
}

export class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn(["active", "inactive"])
  status?: "active" | "inactive";
}

export class AccessSubjectDto {
  @IsString()
  @IsIn(["user", "group"])
  type!: "user" | "group";

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  id!: string;
}

export class CreateAccessGrantDto {
  @ValidateNested()
  @Type(() => AccessSubjectDto)
  subject!: AccessSubjectDto;

  @IsString()
  @IsIn(["all_experiments", "selected_experiments"])
  scope!: GrantScope;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(CAPABILITIES, { each: true })
  capabilities!: Capability[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  experimentIds?: string[];
}
