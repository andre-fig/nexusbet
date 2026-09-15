import { CollectionService } from "../collection/collection.service.js";
import { Inject, Injectable } from "@nestjs/common";
import {
  MonitorRepository,
  type MonitorMember,
} from "../persistence/repositories/monitor.repository.js";
import { AppConfiguration } from "../../config/configuration.js";
import { sanitize } from "../persistence/sanitize.js";
import { ServiceError } from "../../shared/errors/domain-errors.js";
import { teamName } from "../../shared/utils/names.js";
import {
  validate,
  uuid,
  date,
  strings,
  type EventQuery,
  type EventGroup,
} from "./dto/monitor.dto.js";
@Injectable()
export class MonitorService {
  constructor(
    @Inject(MonitorRepository) readonly repo: MonitorRepository,
    @Inject(AppConfiguration) readonly config: AppConfiguration,
    @Inject(CollectionService) readonly collection: CollectionService,
  ) {}
  stale(at: Date | null) {
    return !at || Date.now() - at.getTime() > this.config.settings.ttlMs;
  }
  async providers() {
    const operational = this.collection.operationalHealth().providers;
    return (await this.repo.providers()).map((p) => {
      const runtime = operational[p.id] as { status?: string } | undefined;
      const enabled = p.enabled && !!runtime && runtime.status !== "disabled";
      return {
        ...p,
        enabled,
        stale: this.stale(p.lastUpdatedAt),
        status: !enabled
          ? "disabled"
          : runtime?.status === "unavailable"
            ? "unavailable"
            : !p.lastUpdatedAt
              ? "unavailable"
              : this.stale(p.lastUpdatedAt)
                ? "stale"
                : runtime?.status === "degraded"
                  ? "degraded"
                  : "healthy",
      };
    });
  }
  async overview() {
    const [counts, issues, providers] = await Promise.all([
      this.repo.summary(),
      this.repo.issueCount(),
      this.providers(),
    ]);
    const count = (s: string) => counts.find((c) => c.status === s)?.count ?? 0;
    return {
      generatedAt: new Date().toISOString(),
      health: {
        status:
          issues || providers.some((p) => p.enabled && p.stale)
            ? "degraded"
            : "healthy",
        events: counts.reduce((n, c) => n + c.count, 0),
        matched: count("matched"),
        partial: count("partial"),
        unmatched: count("unmatched"),
        issues,
      },
      providers,
    };
  }
  provider(p: MonitorMember, g: EventGroup) {
    const markets = p.markets.map((m) => ({
      ...m,
      status: m.inPlay
        ? "live"
        : m.suspended
          ? "suspended"
          : this.stale(m.lastSeenAt)
            ? "stale"
            : "healthy",
      selections: m.selections.map((s) => {
        const v = s.snapshots[0];
        return {
          id: s.id,
          selectionId: s.providerSelectionId,
          name: s.name,
          odds: v?.odds == null ? null : Number(v.odds),
          suspended:
            m.suspended === true ? true : (v?.suspended ?? s.suspended),
          inPlay: v?.inPlay ?? m.inPlay,
          fetchedAt: v?.fetchedAt ?? null,
          status:
            v?.odds == null
              ? "unavailable"
              : m.suspended || v.suspended || s.suspended
                ? "suspended"
                : v.inPlay
                  ? "live"
                  : this.stale(v.fetchedAt)
                    ? "stale"
                    : "healthy",
        };
      }),
    }));
    const winner = markets.find((m) => m.category === "match_winner");
    const odd = (name: string) =>
      winner?.selections.find(
        (s) =>
          teamName(s.name, g.esport as "cs2" | "lol" | "valorant") ===
          teamName(name, g.esport as "cs2" | "lol" | "valorant"),
      )?.odds ?? null;
    return {
      id: p.id,
      provider: p.provider.slug,
      providerEventId: p.providerEventId,
      rawTeamA: p.rawTeamA,
      rawTeamB: p.rawTeamB,
      rawTournament: p.rawTournament,
      startsAt: p.startsAt,
      lastUpdatedAt: p.fetchedAt,
      status: !p.listed
        ? "removed"
        : p.inPlay
          ? "live"
          : p.suspended
            ? "suspended"
            : this.stale(p.fetchedAt)
              ? "stale"
              : "healthy",
      providerStatus: p.providerStatus,
      matchWinner: {
        teamA: odd(g.teamA),
        teamB: odd(g.teamB),
        status: winner?.status ?? "unavailable",
      },
      markets,
    };
  }
  async events(q: EventQuery = {}) {
    validate(q);
    const result = await this.repo.groups(q);
    return { ...result, items: await this.project(result.items) };
  }
  async project(groups: EventGroup[]) {
    const ids = groups.flatMap((g) => g.memberIds);
    const [members, issues] = await Promise.all([
      this.repo.members(ids),
      this.repo.eventIssues(
        ids,
        groups.flatMap((g) => (g.canonicalId ? [g.canonicalId] : [])),
      ),
    ]);
    return groups.map((g) => ({
      id: g.id,
      canonicalId: g.canonicalId,
      esport: g.esport,
      tournament: g.tournament,
      teamA: g.teamA,
      teamB: g.teamB,
      startsAt: g.startsAt,
      matching: {
        status: g.status,
        confidence: g.confidence,
        providerCount: g.providerCount,
        expectedProviderCount: g.expectedProviderCount,
      },
      providers: members
        .filter((p) => g.memberIds.includes(p.id))
        .map((p) => {
          const { markets, ...item } = this.provider(p, g);
          return {
            ...item,
            issues: issues.filter((i) => i.providerEventId === p.id),
          };
        }),
      issues: issues.filter(
        (i) =>
          g.memberIds.includes(i.providerEventId ?? "") ||
          (!!g.canonicalId && i.canonicalEventId === g.canonicalId),
      ),
    }));
  }
  async group(id: string) {
    uuid(id);
    const g = (await this.repo.groups({}, id)).items[0];
    if (!g) throw new ServiceError("Event not found", 404);
    return g;
  }
  async detail(id: string) {
    const g = await this.group(id);
    const [projected, members] = await Promise.all([
      this.project([g]),
      this.repo.members(g.memberIds),
    ]);
    const providers = members.map((p) => ({
      ...this.provider(p, g),
      issues: projected[0].providers.find((x) => x.id === p.id)?.issues ?? [],
    }));
    return {
      ...projected[0],
      providers,
      markets: providers.flatMap((p) =>
        p.markets.map((m) => ({ ...m, provider: p.provider })),
      ),
    };
  }
  async raw(id: string) {
    const g = await this.group(id);
    return { eventId: id, raw: sanitize(await this.repo.raw(g.memberIds)) };
  }
  async history(
    id: string,
    q: {
      provider?: string;
      market?: string;
      selection?: string;
      from?: string;
      to?: string;
    },
  ) {
    strings(q);
    const g = await this.group(id);
    const from = date(q.from),
      to = date(q.to);
    if (from && to && from > to)
      throw new ServiceError("Invalid time range", 400);
    const rows = await this.repo.history(g.memberIds, { ...q, from, to });
    const series = new Map<
      string,
      {
        provider: string;
        market: { id: string; category: string; mapNumber: number | null };
        selection: string;
        selectionId: string;
        points: {
          odds: number | null;
          fetchedAt: Date;
          suspended: boolean | null;
          inPlay: boolean | null;
        }[];
      }
    >();
    for (const r of rows.slice(0, 2000)) {
      const s = r.selection,
        m = s.market;
      let item = series.get(s.id);
      if (!item) {
        item = {
          provider: m.providerEvent.provider.slug,
          market: { id: m.id, category: m.category, mapNumber: m.mapNumber },
          selection: s.name,
          selectionId: s.id,
          points: [],
        };
        series.set(s.id, item);
      }
      item.points.push({
        odds: r.odds == null ? null : Number(r.odds),
        fetchedAt: r.fetchedAt,
        suspended: r.suspended,
        inPlay: r.inPlay,
      });
    }
    return {
      eventId: id,
      series: [...series.values()],
      truncated: rows.length > 2000,
    };
  }
  async issues(q: Parameters<MonitorRepository["issues"]>[0] = {}) {
    strings(q);
    if (q.eventId) uuid(q.eventId);
    if (q.status && !["open", "resolved", "ignored"].includes(q.status))
      throw new ServiceError("Invalid issue status", 400);
    return {
      items: (await this.repo.issues(q)).map((i) => ({
        id: i.id,
        type: i.type,
        severity: i.severity,
        status: i.status,
        eventId:
          i.providerEvent?.match?.canonicalEventId ??
          i.canonicalEventId ??
          i.providerEventId,
        provider: i.provider?.slug ?? null,
        title: i.canonicalEvent
          ? `${i.canonicalEvent.teamA} vs ${i.canonicalEvent.teamB}`
          : i.providerEvent
            ? `${i.providerEvent.rawTeamA} vs ${i.providerEvent.rawTeamB}`
            : i.type,
        message: i.message,
        detectedAt: i.detectedAt,
      })),
    };
  }
}
