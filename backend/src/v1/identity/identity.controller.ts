import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { V1_CONFIG, type V1Config } from "../platform/config/v1-config.js";
import { PlatformAdmin, Public } from "../platform/http/route-metadata.js";
import { CurrentAuth } from "./current-auth.js";
import {
  CreateLabDto,
  CreateUserDto,
  LoginDto,
  ResetPasswordDto,
  UpdateUserDto,
} from "./identity.dto.js";
import { IdentityService } from "./identity.service.js";
import type { AuthContext } from "./identity.types.js";

function setSessionCookie(reply: FastifyReply, config: V1Config, token: string, expiresAt: Date) {
  reply.setCookie(config.sessionCookieName, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    expires: expiresAt,
  });
}

function clearSessionCookie(reply: FastifyReply, config: V1Config) {
  reply.clearCookie(config.sessionCookieName, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
  });
}

@Controller("api/v1/auth")
export class AuthController {
  constructor(
    private readonly identityService: IdentityService,
    @Inject(V1_CONFIG) private readonly config: V1Config,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.identityService.login({
      username: body.username,
      password: body.password,
      ipAddress: request.ip,
      userAgent: String(request.headers["user-agent"] || ""),
    });
    setSessionCookie(reply, this.config, result.token, result.expiresAt);
    return result.auth;
  }

  @Post("logout")
  @HttpCode(200)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.identityService.logout(auth, {
      ipAddress: request.ip,
      userAgent: String(request.headers["user-agent"] || ""),
    });
    clearSessionCookie(reply, this.config);
    return { ok: true } as const;
  }

  @Get("me")
  me(@CurrentAuth() auth: AuthContext) {
    return this.identityService.toAuthResponse(auth);
  }
}

@Controller("api/v1")
export class IdentityAdminController {
  constructor(private readonly identityService: IdentityService) {}

  @Get("labs")
  async listMyLabs(@CurrentAuth() auth: AuthContext) {
    return { items: await this.identityService.listLabsFor(auth), nextCursor: null };
  }

  @PlatformAdmin()
  @Get("admin/labs")
  async listLabs() {
    return { items: await this.identityService.listAdminLabs(), nextCursor: null };
  }

  @PlatformAdmin()
  @Post("admin/labs")
  async createLab(@Body() body: CreateLabDto, @CurrentAuth() auth: AuthContext) {
    return {
      lab: await this.identityService.createLab({
        ...body,
        actorUserId: auth.user.id,
      }),
    };
  }

  @PlatformAdmin()
  @Get("admin/users")
  async listUsers() {
    return { items: await this.identityService.listAdminUsers(), nextCursor: null };
  }

  @PlatformAdmin()
  @Post("admin/users")
  async createUser(@Body() body: CreateUserDto, @CurrentAuth() auth: AuthContext) {
    return {
      user: await this.identityService.createUser({
        ...body,
        isSuperAdmin: body.isSuperAdmin === true,
        actorUserId: auth.user.id,
      }),
    };
  }

  @PlatformAdmin()
  @Patch("admin/users/:userId")
  async updateUser(
    @Param("userId") userId: string,
    @Body() body: UpdateUserDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    return {
      user: await this.identityService.updateUser(userId, {
        ...body,
        actorUserId: auth.user.id,
      }),
    };
  }

  @PlatformAdmin()
  @Post("admin/users/:userId/reset-password")
  async resetPassword(
    @Param("userId") userId: string,
    @Body() body: ResetPasswordDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    await this.identityService.resetPassword(userId, body.password, auth.user.id);
    return { ok: true } as const;
  }
}
