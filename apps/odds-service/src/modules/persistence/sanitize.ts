import type { Prisma } from "../../generated/prisma/client.js";
const sensitive =
  /^(?:headers|requestheaders|responseheaders|password|passwd|pwd|login|username|email|credentials?|authorization|proxyauthorization|cookies?|setcookies?|.*token|.*secret|session|sessionid|apikey|signature)$/i;
/** Also sanitizes JSON encoded inside protocol raw fields and query strings. */
export function sanitize(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined)
    return null as unknown as Prisma.InputJsonValue;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k, v]) =>
            v !== undefined && !sensitive.test(k.replace(/[-_]/g, "")),
        )
        .map(([k, v]) => [k, sanitize(v)]),
    );
  if (typeof value === "string") {
    if (/^[\s]*[\[{]/.test(value)) {
      try {
        return JSON.stringify(sanitize(JSON.parse(value)));
      } catch {}
    }
    let text = value
      .replace(/Bearer\s+[^\s";]+/gi, "Bearer [REDACTED]")
      .replace(
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
        "[REDACTED]",
      );
    if (/^https?:\/\//.test(text)) {
      try {
        const u = new URL(text);
        u.username = "";
        u.password = "";
        for (const k of [...u.searchParams.keys()])
          if (sensitive.test(k.replace(/[-_]/g, ""))) u.searchParams.delete(k);
        text = u.href;
      } catch {}
    }
    return text.replace(
      /((?:password|cookie|authorization|access_token|refresh_token)\s*[=:]\s*)[^\s;|]+/gi,
      "$1[REDACTED]",
    );
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw Error("Non-finite persisted value");
    return value;
  }
  if (typeof value === "boolean") return value;
  throw Error("Unsupported persisted value");
}
