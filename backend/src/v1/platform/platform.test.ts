import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createV1Application } from "../bootstrap.js";

describe("v1 platform shell", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.LABRAT_AI_PROVIDER = "anthropic";
    delete process.env.DATABASE_URL;
    app = await createV1Application({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  test("serves a versioned health response", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: "labrat-backend",
      apiVersion: "v1",
    });
  });

  test("returns the bounded error envelope with a request id", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "unauthorized",
        message: "Authentication is required.",
      },
    });
    expect(response.json().error.requestId).toEqual(expect.any(String));
  });

  test("rejects unknown login fields before persistence", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "test", password: "secret", unexpected: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "invalid_request",
        message: "Request validation failed.",
      },
    });
  });
});
