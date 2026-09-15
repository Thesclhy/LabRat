import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "../platform/http/api-error.js";
import {
  PLATFORM_ADMIN_ROUTE,
  PUBLIC_ROUTE,
} from "../platform/http/route-metadata.js";
import type { AuthenticatedRequest } from "./current-auth.js";
import { IdentityService } from "./identity.service.js";
import { guestRequestAllowed } from "./public-guest-policy.js";

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

    if (auth.publicGuest) {
      context.switchToHttp().getResponse<FastifyReply>().header("Cache-Control", "no-store");
      if (!guestRequestAllowed(request.method, request.routeOptions.url || request.url)) {
        throw new ApiError(403, "public_guest_read_only",
          "The public Guest account can only view the demo project. Use a personal account for invitations or changes.");
      }
      // Logout must remain available even after the shared read budget is exhausted.
      if (request.method !== "POST") this.identityService.limitPublicGuestRequest(auth, request.ip);
    }

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
