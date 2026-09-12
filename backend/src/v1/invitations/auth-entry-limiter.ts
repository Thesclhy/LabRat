import { ApiError } from "../platform/http/api-error.js";

const ROUTES = new Map([
  ["/api/v1/auth/invitations/preview", { bucket: "preview", limit: 30 }],
  ["/api/v1/auth/register", { bucket: "redeem", limit: 10 }],
  ["/api/v1/auth/invitations/redeem", { bucket: "redeem", limit: 10 }],
]);

export function isInvitationEntry(url: string) {
  return ROUTES.has(url.split("?")[0]!.replace(/\/$/, ""));
}

export class AuthEntryLimiter {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();
  private sweptAt = 0;

  constructor(private readonly maximumEntries = 10_000) {}

  take(ip: string, url: string, now = Date.now()) {
    const rule = ROUTES.get(url.split("?")[0]!.replace(/\/$/, ""));
    if (!rule) return;
    if (now - this.sweptAt >= 60_000) {
      for (const [key, value] of this.entries) if (value.expiresAt <= now) this.entries.delete(key);
      this.sweptAt = now;
    }
    const key = rule.bucket + ":" + ip;
    let entry = this.entries.get(key);
    if (entry && entry.expiresAt <= now) { this.entries.delete(key); entry = undefined; }
    if ((!entry && this.entries.size >= this.maximumEntries) || (entry && entry.count >= rule.limit)) {
      throw new ApiError(429, "too_many_requests", "Too many attempts. Please wait a minute.");
    }
    if (entry) entry.count += 1;
    else this.entries.set(key, { count: 1, expiresAt: now + 60_000 });
  }
}
