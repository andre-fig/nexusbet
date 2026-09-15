export const providers = [
  "bet365",
  "betano",
  "superbet",
  "blaze",
  "estrelabet",
] as const;
export function runtimeSettings(runtime: "server" | "collector-agent") {
  const token = process.env.ODDS_INGESTION_TOKEN;
  if (!token || token.length < 32 || /\s/.test(token))
    throw Error(
      "ODDS_INGESTION_TOKEN requires at least 32 non-whitespace characters",
    );
  const positive = (name: string, fallback: number) => {
    const n = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(n) || n < 1) throw Error(`Invalid ${name}`);
    return n;
  };
  const serverUrl = process.env.ODDS_SERVER_URL ?? "";
  const agentId = process.env.AGENT_ID ?? "";
  if (runtime === "collector-agent") {
    const u = new URL(serverUrl);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/" ||
      (u.protocol !== "https:" &&
        !(
          u.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
        ))
    )
      throw Error(
        "ODDS_SERVER_URL must be an HTTPS origin (HTTP allowed only on loopback)",
      );
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(agentId))
      throw Error("Invalid AGENT_ID");
  }
  return {
    token,
    serverUrl: serverUrl.replace(/\/$/, ""),
    agentId,
    outboxDir: process.env.ODDS_OUTBOX_DIR ?? "data/agent-outbox",
    maxBytes: positive("ODDS_OUTBOX_MAX_BYTES", 64 * 1024 * 1024),
    maxAgeMs: positive("ODDS_OUTBOX_RETENTION_HOURS", 24) * 3600000,
    heartbeatMs: positive("ODDS_HEARTBEAT_INTERVAL_MS", 30000),
    requestTimeoutMs: positive("ODDS_INGESTION_TIMEOUT_MS", 30000),
  };
}
