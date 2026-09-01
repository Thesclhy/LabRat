import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ApiError } from "../platform/http/api-error.js";
import {
  PLATFORM_ADMIN_ROUTE,
  PUBLIC_ROUTE,
} from "../platform/http/route-metadata.js";
import type { AuthenticatedRequest } from "./current-auth.js";
import { IdentityService } from "./identity.service.js";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identityService: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = await this.identityService.authenticateCookieHeader(request.headers.cookie);
    if (!auth) throw new ApiError(401, "unauthorized", "Authentication is required.");
    (request as AuthenticatedRequest).labratAuth = auth;

    const requiresPlatformAdmin = this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiresPlatformAdmin && !auth.user.isSuperAdmin) {
      throw new ApiError(403, "forbidden", "Platform administrator access is required.");
    }
    return true;
  }
}
