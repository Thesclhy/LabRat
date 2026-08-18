export function sanitizeProviderDetail(value, secrets = []) {
  let detail = String(value || "").trim().replace(/\s+/g, " ");
  for (const secret of secrets) {
    const normalized = String(secret || "");
    if (normalized) detail = detail.split(normalized).join("[REDACTED]");
  }
  return detail
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[REDACTED]")
    .replace(/(Bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .slice(0, 1000);
}
