import { get, query } from "./client";
import type {
  Overview,
  EventPage,
  Detail,
  History,
  Issue,
  Filters,
} from "./types";
const id = (value: string) => encodeURIComponent(value);
export const monitor = {
  overview: (signal?: AbortSignal) =>
    get<Overview>("/monitor/overview", signal),
  events: (filters: Partial<Filters>, signal?: AbortSignal) =>
    get<EventPage>("/monitor/events" + query(filters), signal),
  detail: (value: string, signal?: AbortSignal) =>
    get<Detail>("/monitor/events/" + id(value), signal),
  issues: (signal?: AbortSignal) =>
    get<{ items: Issue[] }>("/monitor/issues?limit=500", signal),
  history: (
    value: string,
    filters: Record<string, string>,
    signal?: AbortSignal,
  ) =>
    get<History>(
      "/monitor/events/" + id(value) + "/odds-history" + query(filters),
      signal,
    ),
  raw: (value: string, signal?: AbortSignal) =>
    get<unknown>("/monitor/events/" + id(value) + "/raw", signal),
};
