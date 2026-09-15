import { serviceUrl } from "../api/client";
export const eventTypes = [
  "ready",
  "resync",
  "provider.updated",
  "provider.stale",
  "event.added",
  "event.updated",
  "event.removed",
  "matching.updated",
  "issue.created",
  "issue.resolved",
  "odds.changed",
  "market.updated",
] as const;
export type Invalidation =
  "overview" | "events" | "detail" | "issues" | "history" | "raw";
export function invalidations(
  type: string,
  eventId: string | undefined,
  selected: string | null,
): Invalidation[] {
  const affects = !!selected && (!eventId || selected === eventId);
  if (type === "ready" || type === "resync")
    return [
      "overview",
      "events",
      "issues",
      ...(selected ? (["detail", "history", "raw"] as Invalidation[]) : []),
    ];
  if (type.startsWith("issue."))
    return [
      "overview",
      "issues",
      ...(affects ? (["detail"] as Invalidation[]) : []),
    ];
  if (type === "odds.changed" || type === "market.updated")
    return [
      "events",
      ...(affects ? (["detail", "history", "raw"] as Invalidation[]) : []),
    ];
  if (type === "matching.updated")
    return [
      "overview",
      "events",
      "issues",
      ...(selected ? (["detail"] as Invalidation[]) : []),
    ];
  if (type.startsWith("provider.")) return ["overview", "events"];
  return [
    "events",
    ...(type === "event.added" || type === "event.removed"
      ? (["overview"] as Invalidation[])
      : []),
    ...(affects ? (["detail", "raw"] as Invalidation[]) : []),
  ];
}
export function connectStream(
  onEvent: (type: string, data: { eventId?: string }) => void,
  onStatus: (s: "connected" | "reconnecting") => void,
  create: (url: string) => EventSource = (url) => new EventSource(url),
) {
  const source = create(serviceUrl + "/monitor/stream");
  source.onopen = () => onStatus("connected");
  source.onerror = () => onStatus("reconnecting");
  const handlers = eventTypes.map((type) => {
    const handler = (e: Event) => {
      try {
        onEvent(type, JSON.parse((e as MessageEvent).data));
      } catch {
        /* Ignore malformed messages; REST remains authoritative. */
      }
    };
    source.addEventListener(type, handler);
    return { type, handler };
  });
  return () => {
    for (const { type, handler } of handlers)
      source.removeEventListener(type, handler);
    source.onopen = null;
    source.onerror = null;
    source.close();
  };
}
