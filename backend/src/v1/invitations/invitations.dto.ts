import { Transform } from "class-transformer";
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class InvitationCodeDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  invitationCode!: string;
}

export class RedeemInvitationDto extends InvitationCodeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  labName?: string;
}

export class RegisterInvitationDto extends RedeemInvitationDto {
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
}

export class CreateInvitationDto {}
