import crypto from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = crypto.scryptSync(String(password || ""), salt, SCRYPT_KEY_LENGTH).toString("base64url");
  return `scrypt$${salt}$${key}`;
}

export function verifyPassword(password, passwordHash) {
  const [scheme, salt, expected] = String(passwordHash || "").split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ""), salt, SCRYPT_KEY_LENGTH).toString("base64url");
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

