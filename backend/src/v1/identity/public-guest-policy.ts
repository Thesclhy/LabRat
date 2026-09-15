import { ApiError } from "../platform/http/api-error.js";

export function guestRequestAllowed(method: string, route: string): boolean {
  return method === "GET" || method === "HEAD"
    || (method === "POST" && route.split("?")[0]!.replace(/\/$/, "") === "/api/v1/auth/logout");
}

export class PublicGuestLimiter {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();
  private sweptAt = 0;

  constructor(private readonly maximumEntries = 10_000) {}

  take(userId: string, ip: string, kind: "login" | "read", now = Date.now()) {
    if (now - this.sweptAt >= 60_000) {
      for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
      this.sweptAt = now;
    }
    const limits = kind === "login" ? [20, 60] : [180, 1200];
    const rules = [
      { key: JSON.stringify([kind, userId, ip]), limit: limits[0]! },
      { key: JSON.stringify([kind, userId]), limit: limits[1]! },
    ];
    for (const rule of rules) {
      const entry = this.entries.get(rule.key);
      if (entry && entry.expiresAt <= now) this.entries.delete(rule.key);
    }
    const missing = rules.filter(({ key }) => !this.entries.has(key)).length;
    if (this.entries.size + missing > this.maximumEntries
      || rules.some(({ key, limit }) => (this.entries.get(key)?.count || 0) >= limit)) {
      throw new ApiError(429, "too_many_requests", "Guest access is busy. Please wait a minute.");
    }
    for (const { key } of rules) {
      const entry = this.entries.get(key);
      if (entry) entry.count += 1;
      else this.entries.set(key, { count: 1, expiresAt: now + 60_000 });
    }
  }
}
