import { CollectionService } from "../collection/collection.service.js";
import { Inject, Injectable } from "@nestjs/common";
import {
  MonitorRepository,
  type MonitorMember,
} from "../persistence/repositories/monitor.repository.js";
import { AppConfiguration } from "../../config/configuration.js";
import { sanitize } from "../persistence/sanitize.js";
import { ServiceError } from "../../shared/errors/domain-errors.js";
import { canonicalTeamName } from "../matching/team-aliases.js";
import { displayOdds } from "../../shared/utils/odds-display.js";
import { analyzeMarkets } from "./market-analytics.js";
import { assessDataHealth, issueImpact } from "./data-health.js";
import {
  validate,
  integer,
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
  async staleIssues(providerEventIds?: string[]) {
    const before = new Date(Date.now() - this.config.settings.ttlMs);
    const markets = await this.repo.staleMarkets(before, providerEventIds);
    return markets
      .filter(
        (m) =>
          this.collection.providerRuntime(m.providerEvent.provider.slug).active,
      )
      .map((m) => ({
        id: `stale:${m.id}`,
        type: "STALE",
        severity: "warning",
        scope: "event" as const,
        systemic: false,
        status: "open",
        message: `${m.category === "match_winner" ? "Match winner" : `Map ${m.mapNumber} winner`} last observed at ${m.lastSeenAt.toISOString()}; data exceeded the freshness TTL. Last odds are retained for diagnosis.`,
        marketId: m.id,
        providerEventId: m.providerEvent.id,
        canonicalEventId: m.providerEvent.match?.canonicalEventId ?? null,
        eventId: m.providerEvent.match?.canonicalEventId ?? m.providerEvent.id,
        provider: m.providerEvent.provider.slug,
        title: `${m.providerEvent.rawTeamA} vs ${m.providerEvent.rawTeamB}`,
        detectedAt: new Date(
          m.lastSeenAt.getTime() + this.config.settings.ttlMs,
        ),
      }));
  }
  async providers() {
    const operational = this.collection.operationalHealth().providers;
    return (await this.repo.providers()).map((p) => {
      const runtime = this.collection.providerRuntime(p.id);
      const scheduler = operational[p.id] as { status?: string } | undefined;
      const active = p.enabled && runtime.active;
      return {
        ...p,
        active,
        statusReason: p.enabled ? runtime.reason : "disabled_by_config",
        stale: this.stale(p.lastUpdatedAt),
        status: !active
          ? "disabled"
          : runtime.status === "unavailable"
            ? "unavailable"
            : scheduler?.status === "degraded"
              ? "degraded"
              : !p.lastUpdatedAt
                ? "unavailable"
                : this.stale(p.lastUpdatedAt)
                  ? "stale"
                  : "healthy",
      };
    });
  }
  async expectedProviders() {
    const active = (await this.providers())
      .filter(
        (provider) =>
          provider.active &&
          !(provider.status === "degraded" && provider.eventCount === 0),
      )
      .map((provider) => provider.id);
    return Object.fromEntries(
      this.config.settings.esports.map((esport) => [esport, [...active]]),
    );
  }
  async overview() {
    const providers = await this.providers();
    const eligibleProviders = await this.expectedProviders();
    const [counts, issues, staleIssues, healthIssues] = await Promise.all([
      this.repo.summary(eligibleProviders),
      this.repo.issueCount(eligibleProviders),
      this.staleIssues(),
      this.repo.healthIssues(),
    ]);
    const count = (s: string) => counts.find((c) => c.status === s)?.count ?? 0;
    const events = counts.reduce((n, c) => n + c.count, 0);
    const activeProviders = new Set(
      providers
        .filter((provider) => provider.active)
        .map((provider) => provider.id),
    );
    const dataHealth = assessDataHealth({
      providers,
      issues: healthIssues
        .filter(
          (issue) =>
            issueImpact(issue).scope !== "provider" ||
            !issue.provider?.slug ||
            activeProviders.has(issue.provider.slug),
        )
        .map((issue) => ({
          ...issue,
          eventKey:
            issue.providerEvent?.match?.canonicalEventId ??
            issue.canonicalEventId ??
            issue.providerEventId,
        })),
      eventCount: events,
    });
    return {
      generatedAt: new Date().toISOString(),
      health: {
        status: dataHealth.status,
        reasons: dataHealth.reasons,
        events,
        matched: count("matched"),
        partial: count("partial"),
        unmatched: count("unmatched"),
        notApplicable: count("not_applicable"),
        issues: issues + staleIssues.length,
      },
      providers,
    };
  }
  provider(p: MonitorMember, g: EventGroup) {
    const runtime = this.collection.providerRuntime(p.provider.slug);
    const active = p.provider.enabled && runtime.active;
    const markets = p.markets.map((m) => {
      const stale = this.stale(m.lastSeenAt);
      const validSelections = m.selections.filter((s) => {
        const latest = s.snapshots[0];
        return (
          s.fetchedAt >= m.lastSeenAt &&
          latest?.fetchedAt >= m.lastSeenAt &&
          latest.odds !== null &&
          Number(latest.odds) > 1
        );
      }).length;
      const incomplete =
        (m.category === "match_winner" || m.category === "map_winner") &&
        p.rawTeamA.trim() &&
        p.rawTeamB.trim() &&
        p.rawTeamA.trim() !== p.rawTeamB.trim() &&
        validSelections < 2;
      return {
        ...m,
        status: stale
          ? "stale"
          : incomplete
            ? "incomplete"
            : m.inPlay
              ? "live"
              : m.suspended
                ? "suspended"
                : "healthy",
        selections: m.selections.map((s) => {
          const v = s.snapshots[0];
          const odds = v?.odds == null ? null : Number(v.odds);
          return {
            id: s.id,
            selectionId: s.providerSelectionId,
            name: s.name,
            odds,
            displayOdds: displayOdds(odds),
            suspended:
              m.suspended === true ? true : (v?.suspended ?? s.suspended),
            inPlay: v?.inPlay ?? m.inPlay,
            fetchedAt: v?.fetchedAt ?? null,
            status:
              stale || (v && this.stale(v.fetchedAt))
                ? "stale"
                : v?.odds == null
                  ? "unavailable"
                  : m.suspended || v.suspended || s.suspended
                    ? "suspended"
                    : v.inPlay
                      ? "live"
                      : "healthy",
          };
        }),
      };
    });
    const winner = markets.find((m) => m.category === "match_winner");
    const odd = (name: string) =>
      (winner?.status === "incomplete" ? undefined : winner)?.selections.find(
        (s) =>
          canonicalTeamName(s.name, g.esport as "cs2" | "lol" | "valorant") ===
          canonicalTeamName(name, g.esport as "cs2" | "lol" | "valorant"),
      )?.odds ?? null;
    return {
      id: p.id,
      provider: p.provider.slug,
      active,
      statusReason: p.provider.enabled ? runtime.reason : "disabled_by_config",
      providerEventId: p.providerEventId,
      rawTeamA: p.rawTeamA,
      rawTeamB: p.rawTeamB,
      rawTournament: p.rawTournament,
      startsAt: p.startsAt,
      lastUpdatedAt: p.fetchedAt,
      status: !active
        ? "disabled"
        : !p.listed
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
        displayTeamA: displayOdds(odd(g.teamA)),
        displayTeamB: displayOdds(odd(g.teamB)),
        status: winner?.status ?? "unavailable",
      },
      marketAvailability: {
        matchWinner: winner?.status ?? "unavailable",
        map1Winner:
          markets.find((m) => m.category === "map_winner" && m.mapNumber === 1)
            ?.status ?? "unavailable",
        map2Winner:
          markets.find((m) => m.category === "map_winner" && m.mapNumber === 2)
            ?.status ?? "unavailable",
        map3Winner:
          markets.find((m) => m.category === "map_winner" && m.mapNumber === 3)
            ?.status ?? "unavailable",
      },
      markets,
    };
  }
  async events(q: EventQuery = {}) {
    validate(q);
    const result = await this.repo.groups(
      q,
      undefined,
      await this.expectedProviders(),
      new Date(Date.now() - this.config.settings.ttlMs),
    );
    return { ...result, items: await this.project(result.items) };
  }
  async project(groups: EventGroup[]) {
    const ids = groups.flatMap((g) => g.memberIds);
    const [members, issues, staleIssues] = await Promise.all([
      this.repo.members(ids),
      this.repo.eventIssues(
        ids,
        groups.flatMap((g) => (g.canonicalId ? [g.canonicalId] : [])),
      ),
      this.staleIssues(ids),
    ]);
    return groups.map((g) => {
      const visibleIssues = [
        ...issues.map((issue) => ({
          id: issue.id,
          type: issue.type,
          severity: issue.severity,
          message: issue.message,
          providerEventId: issue.providerEventId,
          canonicalEventId: issue.canonicalEventId,
          ...issueImpact(issue),
        })),
        ...staleIssues,
      ].filter(
        (issue) =>
          g.expectedProviderCount >= 2 || issue.type !== "UNMATCHED_EVENT",
      );
      const renderedProviders = members
        .filter((p) => g.memberIds.includes(p.id))
        .map((p) => this.provider(p, g));
      const analytics = analyzeMarkets({
        canonicalId: g.canonicalId,
        matchingStatus: g.status,
        esport: g.esport as "cs2" | "lol" | "valorant",
        teamA: g.teamA,
        teamB: g.teamB,
        providers: renderedProviders,
        outlierThresholdPercent:
          this.config.settings.oddsOutlierThresholdPercent,
      });
      return {
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
        analytics,
        providers: renderedProviders.map((p) => {
          const { markets, ...item } = p;
          return {
            ...item,
            issues: visibleIssues.filter((i) => i.providerEventId === p.id),
          };
        }),
        issues: visibleIssues.filter(
          (i) =>
            g.memberIds.includes(i.providerEventId ?? "") ||
            (!!g.canonicalId && i.canonicalEventId === g.canonicalId),
        ),
      };
    });
  }
  async group(id: string) {
    uuid(id);
    const g = (
      await this.repo.groups(
        {},
        id,
        await this.expectedProviders(),
        new Date(Date.now() - this.config.settings.ttlMs),
      )
    ).items[0];
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
    const analytics = analyzeMarkets({
      canonicalId: g.canonicalId,
      matchingStatus: g.status,
      esport: g.esport as "cs2" | "lol" | "valorant",
      teamA: g.teamA,
      teamB: g.teamB,
      providers,
      outlierThresholdPercent: this.config.settings.oddsOutlierThresholdPercent,
    });
    return {
      ...projected[0],
      analytics,
      providers,
      markets: providers.flatMap((p) =>
        p.markets.map((m) => ({
          ...m,
          provider: p.provider,
          analytics: analytics.find((a) => a.marketIds.includes(m.id)) ?? null,
        })),
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
          displayOdds: string | null;
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
      const odds = r.odds == null ? null : Number(r.odds);
      item.points.push({
        odds,
        displayOdds: displayOdds(odds),
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
    const eligibleProviders = await this.expectedProviders();
    const staleIssues =
      (!q.status || q.status === "open") &&
      (!q.type || q.type === "STALE") &&
      (!q.severity || q.severity === "warning")
        ? (await this.staleIssues()).filter(
            (issue) =>
              (!q.eventId ||
                issue.eventId === q.eventId ||
                issue.providerEventId === q.eventId) &&
              (!q.provider || issue.provider === q.provider),
          )
        : [];
    return {
      items: [
        ...(await this.repo.issues(q, eligibleProviders)).map((i) => ({
          id: i.id,
          type: i.type,
          severity: i.severity,
          ...issueImpact(i),
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
        ...staleIssues,
      ]
        .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
        .slice(0, integer(q.limit, 100, 500)),
    };
  }
}
