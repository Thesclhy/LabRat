import { describe, expect, test } from "vitest";
import { guestRequestAllowed, PublicGuestLimiter } from "./public-guest-policy.js";

describe("public Guest request policy", () => {
  test("permits reads and session logout, never invitations, AI or writes", () => {
    expect(guestRequestAllowed("GET", "/api/v1/projects/project")).toBe(true);
    expect(guestRequestAllowed("HEAD", "/api/v1/projects/project")).toBe(true);
    expect(guestRequestAllowed("POST", "/api/v1/auth/logout?x=1")).toBe(true);
    for (const route of ["/api/v1/auth/invitations/redeem", "/api/v1/projects", "/api/v1/projects/project/agent/runs",
      "/api/v1/auth/logout/other", "/api/v1/auth/logout%2f", "/api/v1/projects/project/evidence/retrieve"]) {
      expect(guestRequestAllowed("POST", route)).toBe(false);
    }
    expect(guestRequestAllowed("PATCH", "/api/v1/projects/project")).toBe(false);
    expect(guestRequestAllowed("DELETE", "/api/v1/projects/project")).toBe(false);
  });

  test("bounds login attempts per IP and expires at the window boundary", () => {
    const limiter = new PublicGuestLimiter();
    for (let i = 0; i < 20; i++) limiter.take("guest", "ip", "login", 1000);
    expect(() => limiter.take("guest", "ip", "login", 2000)).toThrow(/wait a minute/);
    expect(() => limiter.take("guest", "ip", "login", 61_000)).not.toThrow();
  });

  test("adds an account-wide limit across different IPs", () => {
    const limiter = new PublicGuestLimiter();
    for (let i = 0; i < 60; i++) limiter.take("guest", `ip-${i}`, "login", 1000);
    expect(() => limiter.take("guest", "another-ip", "login", 1000)).toThrow(/wait a minute/);
    expect(() => limiter.take("another-guest", "ip", "login", 1000)).not.toThrow();
  });

  test("caps reads independently and fails closed without partial counter writes", () => {
    const limiter = new PublicGuestLimiter(2);
    for (let i = 0; i < 180; i++) limiter.take("guest", "ip", "read", 1000);
    expect(() => limiter.take("guest", "ip", "read", 1000)).toThrow();
    expect(() => limiter.take("guest", "new-ip", "read", 1000)).toThrow();
    expect(() => limiter.take("guest", "new-ip", "read", 61_000)).not.toThrow();
  });
});
