import crypto from "node:crypto";

export function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function makeSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

