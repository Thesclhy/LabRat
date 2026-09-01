import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { AuthContext } from "./identity.types.js";

export type AuthenticatedRequest = FastifyRequest & { labratAuth: AuthContext };

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => (
    context.switchToHttp().getRequest<AuthenticatedRequest>().labratAuth
  ),
);
