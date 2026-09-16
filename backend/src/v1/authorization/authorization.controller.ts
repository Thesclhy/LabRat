import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { CurrentAuth } from "../identity/current-auth.js";
import type { AuthContext } from "../identity/identity.types.js";
import {
  CreateAccessGrantDto,
  CreateGroupDto,
  UpdateGroupDto,
  UpsertLabMemberDto,
} from "./authorization.dto.js";
import { AuthorizationService } from "./authorization.service.js";
import { MemberAccessService, SetMemberAccessDto } from "./member-access.service.js";
import { PageQueryDto } from "../platform/http/page-query.js";

@Controller("api/v1")
export class AuthorizationController {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly memberAccess: MemberAccessService,
  ) {}

  @Get("projects/:projectId/member-access")
  listMemberAccess(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string, @Query() query: PageQueryDto) {
    return this.memberAccess.list(auth, projectId, query);
  }

  @Put("projects/:projectId/member-access/:userId")
  setMemberAccess(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string,
    @Param("userId") userId: string, @Body() body: SetMemberAccessDto) {
    return this.memberAccess.set(auth, projectId, userId, body);
  }

  @Get("labs/:labId/members")
  async listLabMembers(@Param("labId") labId: string, @CurrentAuth() auth: AuthContext) {
    return { items: await this.authorizationService.listLabMembers(auth, labId), nextCursor: null };
  }

  @Put("labs/:labId/members/:userId")
  async upsertLabMember(
    @Param("labId") labId: string,
    @Param("userId") userId: string,
    @Body() body: UpsertLabMemberDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    return { membership: await this.authorizationService.upsertLabMember(auth, labId, userId, body.role) };
  }

  @Delete("labs/:labId/members/:userId")
  async deleteLabMember(
    @Param("labId") labId: string,
    @Param("userId") userId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    await this.authorizationService.deactivateLabMember(auth, labId, userId);
    return { ok: true } as const;
  }

  @Get("labs/:labId/groups")
  async listGroups(@Param("labId") labId: string, @CurrentAuth() auth: AuthContext) {
    return { items: await this.authorizationService.listGroups(auth, labId), nextCursor: null };
  }

  @Post("labs/:labId/groups")
  async createGroup(
    @Param("labId") labId: string,
    @Body() body: CreateGroupDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    return { group: await this.authorizationService.createGroup(auth, labId, body) };
  }

  @Patch("labs/:labId/groups/:groupId")
  async updateGroup(
    @Param("labId") labId: string,
    @Param("groupId") groupId: string,
    @Body() body: UpdateGroupDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    return { group: await this.authorizationService.updateGroup(auth, labId, groupId, body) };
  }

  @Delete("labs/:labId/groups/:groupId")
  async deleteGroup(
    @Param("labId") labId: string,
    @Param("groupId") groupId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    await this.authorizationService.deleteGroup(auth, labId, groupId);
    return { ok: true } as const;
  }

  @Put("labs/:labId/groups/:groupId/members/:userId")
  async addGroupMember(
    @Param("labId") labId: string,
    @Param("groupId") groupId: string,
    @Param("userId") userId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return { group: await this.authorizationService.addGroupMember(auth, labId, groupId, userId) };
  }

  @Delete("labs/:labId/groups/:groupId/members/:userId")
  async removeGroupMember(
    @Param("labId") labId: string,
    @Param("groupId") groupId: string,
    @Param("userId") userId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return { group: await this.authorizationService.removeGroupMember(auth, labId, groupId, userId) };
  }

  @Get("projects/:projectId/access-grants")
  async listAccessGrants(@Param("projectId") projectId: string, @CurrentAuth() auth: AuthContext) {
    return { items: await this.authorizationService.listAccessGrants(auth, projectId), nextCursor: null };
  }

  @Post("projects/:projectId/access-grants")
  async createAccessGrant(
    @Param("projectId") projectId: string,
    @Body() body: CreateAccessGrantDto,
    @CurrentAuth() auth: AuthContext,
  ) {
    return { grant: await this.authorizationService.createAccessGrant(auth, projectId, body) };
  }

  @Delete("projects/:projectId/access-grants/:grantId")
  async deleteAccessGrant(
    @Param("projectId") projectId: string,
    @Param("grantId") grantId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    await this.authorizationService.deleteAccessGrant(auth, projectId, grantId);
    return { ok: true } as const;
  }

  @Get("projects/:projectId/access")
  async getEffectiveAccess(@Param("projectId") projectId: string, @CurrentAuth() auth: AuthContext) {
    return { access: await this.authorizationService.getEffectiveAccess(auth, projectId) };
  }
}
