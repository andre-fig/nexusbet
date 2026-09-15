const configured = (
  import.meta as ImportMeta & { env?: Record<string, string> }
).env?.VITE_ODDS_SERVICE_URL;
export const serviceUrl = (configured || "http://localhost:3650").replace(
  /\/$/,
  "",
);
export function query(values: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) if (v) q.set(k, v);
  return q.size ? "?" + q.toString() : "";
}
export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(serviceUrl + path, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`odds-service returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
