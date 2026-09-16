import type { FastifyReply } from "fastify";
import type { V1Config } from "../platform/config/v1-config.js";

export function setSessionCookie(reply: FastifyReply, config: V1Config, token: string, expiresAt: Date) {
  reply.setCookie(config.sessionCookieName, token, {
    path: "/", httpOnly: true, sameSite: "lax", secure: config.secureCookies, expires: expiresAt,
  });
}
