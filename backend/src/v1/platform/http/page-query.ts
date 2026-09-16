import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { ApiError } from "./api-error.js";

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cursor?: string;
}

export function pageOffset(cursor?: string): number {
  if (!cursor) return 0;
  const value = Buffer.from(cursor, "base64url").toString("utf8");
  const offset = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(offset) || offset > 1_000_000
    || Buffer.from(value).toString("base64url") !== cursor) {
    throw new ApiError(400, "invalid_cursor", "Invalid page cursor.");
  }
  return offset;
}

export function pageResult<T>(rows: T[], offset: number, limit: number) {
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? Buffer.from(String(offset + limit)).toString("base64url") : null,
  };
}
