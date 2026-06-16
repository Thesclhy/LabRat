export function parseCookies(req) {
  const header = String(req.headers.cookie || "");
  const cookies = new Map();
  header.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index === -1) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies.set(key, decodeURIComponent(value));
  });
  return cookies;
}

export function appendSetCookie(res, cookie) {
  const existing = res.getHeader("set-cookie");
  const next = existing ? (Array.isArray(existing) ? [...existing, cookie] : [existing, cookie]) : cookie;
  res.setHeader("set-cookie", next);
}

export function setSessionCookie(res, config, token, expiresAt) {
  const parts = [
    `${config.sessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (config.secureCookies) parts.push("Secure");
  appendSetCookie(res, parts.join("; "));
}

export function clearSessionCookie(res, config) {
  const parts = [
    `${config.sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (config.secureCookies) parts.push("Secure");
  appendSetCookie(res, parts.join("; "));
}

