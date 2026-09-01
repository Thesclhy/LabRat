import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  password!: string;
}

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  displayName!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(1000)
  password!: string;

  @IsOptional()
  @IsBoolean()
  isSuperAdmin?: boolean;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isSuperAdmin?: boolean;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(12)
  @MaxLength(1000)
  password!: string;
}

export class CreateLabDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(200)
  slug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  ownerUserId!: string;
}
