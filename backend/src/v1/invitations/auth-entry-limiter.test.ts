import { describe, expect, test } from "vitest";
import { AuthEntryLimiter } from "./auth-entry-limiter.js";
import { createV1Application, trustProxyForEnvironment } from "../bootstrap.js";
import fastify from "fastify";

describe("invitation entry protection", () => {
  test("production trusts loopback Caddy but never arbitrary forwarded clients", async () => {
    const server = fastify({ trustProxy: trustProxyForEnvironment("production") });
    server.get("/", (request) => ({ ip: request.ip }));
    try {
      const external = await server.inject({ url: "/", remoteAddress: "198.51.100.4", headers: { "x-forwarded-for": "203.0.113.7" } });
      expect(external.json().ip).toBe("198.51.100.4");
      const caddy = await server.inject({ url: "/", remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.7" } });
      expect(caddy.json().ip).toBe("203.0.113.7");
      expect(trustProxyForEnvironment("development")).toBe(false);
    } finally { await server.close(); }
  });

  test("public DTOs reject self-elevation and short passwords before touching the database", async () => {
    process.env.NODE_ENV = "test";
    process.env.LABRAT_AI_PROVIDER = "anthropic";
    const app = await createV1Application({ logger: false });
    try {
      for (const extra of [{ isSuperAdmin: true }, { role: "lab_owner" }, { labId: "another_lab" }, { password: "short" }]) {
        const response = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: {
          invitationCode: "x".repeat(43), username: "member", displayName: "Member", password: "LongTestPassword", ...extra,
        } });
        expect(response.statusCode, response.body).toBe(400);
      }
    } finally { await app.close(); }
  });
  test("preview and shared register/redeem limits expire, and capacity fails closed", () => {
    const limiter = new AuthEntryLimiter(2);
    for (let i = 0; i < 30; i++) limiter.take("ip", "/api/v1/auth/invitations/preview", 1000);
    expect(() => limiter.take("ip", "/api/v1/auth/invitations/preview", 1000)).toThrow(/Too many/);
    for (let i = 0; i < 10; i++) limiter.take("ip", i % 2 ? "/api/v1/auth/register" : "/api/v1/auth/invitations/redeem", 1000);
    expect(() => limiter.take("ip", "/api/v1/auth/register", 1000)).toThrow(/Too many/);
    expect(() => limiter.take("another", "/api/v1/auth/register", 1000)).toThrow(/Too many/);
    expect(() => limiter.take("another", "/api/v1/auth/register", 62000)).not.toThrow();
  });

  test("HTTP body limit and forwarded-header spoofing are enforced before registration", async () => {
    process.env.NODE_ENV = "test";
    process.env.LABRAT_AI_PROVIDER = "anthropic";
    const app = await createV1Application({ logger: false });
    try {
      const large = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { invitationCode: "a".repeat(9000) } });
      expect(large.statusCode, large.body).toBe(413);
      expect(large.json().error.code).toBe("body_too_large");
      for (let i = 0; i < 9; i++) {
        const response = await app.inject({
          method: "POST", url: "/api/v1/auth/register", headers: { "x-forwarded-for": `203.0.113.${i}` }, payload: {},
        });
        expect(response.statusCode).toBe(400);
      }
      const limited = await app.inject({ method: "POST", url: "/api/v1/auth/invitations/redeem", payload: {} });
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.code).toBe("too_many_requests");
    } finally { await app.close(); }
  });
});
