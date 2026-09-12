import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CurrentAuth } from "../identity/current-auth.js";
import { IdentityService } from "../identity/identity.service.js";
import type { AuthContext } from "../identity/identity.types.js";
import { setSessionCookie } from "../identity/session-cookie.js";
import { V1_CONFIG, type V1Config } from "../platform/config/v1-config.js";
import { ApiError } from "../platform/http/api-error.js";
import { PageQueryDto } from "../platform/http/page-query.js";
import { PlatformAdmin, Public } from "../platform/http/route-metadata.js";
import { CreateInvitationDto, InvitationCodeDto, RedeemInvitationDto, RegisterInvitationDto } from "./invitations.dto.js";
import { InvitationsService } from "./invitations.service.js";

@Controller("api/v1")
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly identity: IdentityService,
    @Inject(V1_CONFIG) private readonly config: V1Config,
  ) {}

  @PlatformAdmin()
  @Post("admin/invitations")
  createOwner(@CurrentAuth() auth: AuthContext, @Body() _body: CreateInvitationDto) {
    return this.invitations.create(auth, {});
  }

  @PlatformAdmin()
  @Get("admin/invitations")
  listOwners(@CurrentAuth() auth: AuthContext, @Query() query: PageQueryDto) {
    return this.invitations.list(auth, {}, query);
  }

  @PlatformAdmin()
  @Post("admin/invitations/:invitationId/revoke")
  @HttpCode(200)
  revokeOwner(@CurrentAuth() auth: AuthContext, @Param("invitationId") id: string) {
    return this.invitations.revoke(auth, {}, id);
  }

  @Post("labs/:labId/invitations")
  createMember(@CurrentAuth() auth: AuthContext, @Param("labId") labId: string, @Body() _body: CreateInvitationDto) {
    return this.invitations.create(auth, { labId });
  }

  @Get("labs/:labId/invitations")
  listMembers(@CurrentAuth() auth: AuthContext, @Param("labId") labId: string, @Query() query: PageQueryDto) {
    return this.invitations.list(auth, { labId }, query);
  }

  @Post("labs/:labId/invitations/:invitationId/revoke")
  @HttpCode(200)
  revokeMember(@CurrentAuth() auth: AuthContext, @Param("labId") labId: string, @Param("invitationId") id: string) {
    return this.invitations.revoke(auth, { labId }, id);
  }

  @Public()
  @Post("auth/invitations/preview")
  @HttpCode(200)
  preview(@Body() body: InvitationCodeDto) {
    return this.invitations.preview(body.invitationCode);
  }

  @Public()
  @Post("auth/register")
  async register(@Body() body: RegisterInvitationDto, @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply) {
    if (await this.identity.authenticateCookieHeader(request.headers.cookie)) {
      throw new ApiError(409, "already_signed_in", "Use invitation redemption while signed in.");
    }
    const result = await this.invitations.register(body, {
      ipAddress: request.ip, userAgent: String(request.headers["user-agent"] || ""),
    });
    setSessionCookie(reply, this.config, result.token, result.expiresAt);
    return { auth: result.auth, lab: result.lab };
  }

  @Post("auth/invitations/redeem")
  @HttpCode(200)
  redeem(@CurrentAuth() auth: AuthContext, @Body() body: RedeemInvitationDto) {
    return this.invitations.redeem(auth, body);
  }
}
