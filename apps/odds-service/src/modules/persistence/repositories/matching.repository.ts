import { Injectable, Inject } from "@nestjs/common";
import type { Prisma } from "../../../generated/prisma/client.js";
import type { NormalizedEvent } from "../../../shared/domain/normalized-event.js";
import { compareAllProviders } from "../../matching/matching.js";
import { canonicalTeamName } from "../../matching/team-aliases.js";
import type { Esport } from "../../../shared/types/common.js";
import { DataIssuesRepository } from "./issues.repository.js";
@Injectable()
export class MatchingRepository {
  constructor(
    @Inject(DataIssuesRepository) private readonly issues: DataIssuesRepository,
  ) {}
  async reconcile(tx: Prisma.TransactionClient, at: Date, ttlMs: number) {
    const scopes = await tx.feedScope.findMany({
      where: {
        kind: "list",
        fetchedAt: { gte: new Date(at.getTime() - ttlMs) },
      },
    });
    const events = scopes.flatMap(
      (s) => s.events as unknown as NormalizedEvent[],
    );
    const providers = await tx.provider.findMany();
    const providerMap = new Map(providers.map((p) => [p.slug, p.id]));
    const providerSlugs = new Map(providers.map((p) => [p.id, p.slug]));
    const eligibleByEsport = Object.fromEntries(
      [...new Set(scopes.map((scope) => scope.esport))].map((esport) => [
        esport,
        [
          ...new Set(
            scopes
              .filter((scope) => scope.esport === esport)
              .map((scope) => providerSlugs.get(scope.providerId)!)
              .filter(Boolean),
          ),
        ],
      ]),
    );
    const storedAliases = await tx.teamAlias.findMany();
    const aliases: Record<Esport, Record<string, string>> = {
      cs2: {},
      lol: {},
      valorant: {},
    };
    for (const row of storedAliases)
      if (row.esport in aliases)
        aliases[row.esport as Esport][row.alias] = row.canonicalName;
    const result = compareAllProviders(events, eligibleByEsport, aliases);
    const rows = await tx.providerEvent.findMany({
      include: {
        match: true,
        provider: true,
        decisions: {
          where: { canonicalEventId: { not: null } },
          orderBy: { detectedAt: "desc" },
          take: 1,
          include: { canonicalEvent: true },
        },
      },
    });
    const byKey = new Map(
      rows.map((r) => [
        JSON.stringify([r.provider.slug, r.providerEventId]),
        r,
      ]),
    );
    for (const item of result.notApplicable) {
      const row = byKey.get(JSON.stringify([item.provider, item.eventId]));
      if (!row || row.match?.status === "manual") continue;
      await this.issues.transition(tx, "unmatched:" + row.id, "resolved", at);
      if (row.match?.status === "unmatched")
        await tx.eventMatch.delete({ where: { providerEventId: row.id } });
    }
    for (const group of result.matched) {
      const members = Object.entries(group.providers).map(([slug, e]) =>
        byKey.get(JSON.stringify([slug, e.eventId]))!,
      );
      const c = group.canonicalEvent;
      const sameTeams = (a: string, b: string) =>
        [
          canonicalTeamName(a, c.esport, aliases),
          canonicalTeamName(b, c.esport, aliases),
        ]
          .sort()
          .join("\0");
      const historicalId = (r: (typeof members)[number]) => {
        const h = r.decisions[0]?.canonicalEvent;
        return h &&
          h.esport === c.esport &&
          sameTeams(h.teamA, h.teamB) === sameTeams(c.teamA, c.teamB) &&
          Math.abs(h.startsAt.getTime() - new Date(c.startsAt).getTime()) <=
            5 * 60_000
          ? h.id
          : undefined;
      };
      const priorIds = [
        ...new Set(
          members.flatMap((r) =>
            r.match?.canonicalEventId
              ? [r.match.canonicalEventId]
              : historicalId(r)
                ? [historicalId(r)!]
                : [],
          ),
        ),
      ];
      if (priorIds.length > 1) {
        for (const row of members)
          await this.issues.open(tx, {
            key: "canonical-conflict:" + row.id,
            type: "LOW_CONFIDENCE",
            severity: "warning",
            message:
              "Existing canonical identities disagree; automatic merge withheld",
            providerId: row.providerId,
            providerEventId: row.id,
            details: { scope: "event", systemic: false },
            at,
          });
        continue;
      }
      for (const alias of group.learnedAliases) {
        const existing = aliases[alias.esport][alias.alias];
        if (existing && existing !== alias.canonical) continue;
        await tx.teamAlias.upsert({
          where: { esport_alias: { esport: alias.esport, alias: alias.alias } },
          create: {
            esport: alias.esport,
            alias: alias.alias,
            canonicalName: alias.canonical,
            evidence: {
              rule: "abbreviation_same_opponent_tournament_near_time",
              startsAt: c.startsAt,
              providers: Object.keys(group.providers),
            },
          },
          update: {},
        });
        aliases[alias.esport][alias.alias] = alias.canonical;
      }
      const canonical = priorIds[0]
        ? await tx.canonicalEvent.update({
            where: { id: priorIds[0] },
            data: {
              teamA: c.teamA,
              teamB: c.teamB,
              startsAt: new Date(c.startsAt),
            },
          })
        : await tx.canonicalEvent.create({
            data: {
              esport: c.esport,
              tournament: c.tournament,
              teamA: c.teamA,
              teamB: c.teamB,
              startsAt: new Date(c.startsAt),
              status: "scheduled",
            },
          });
      for (const row of members) {
        if (row.match?.status === "manual") continue;
        const data = {
          canonicalEventId: canonical.id,
          confidence: group.confidence,
          status: "matched" as const,
          reason:
            group.evidence.timeDifferenceSeconds > 0
              ? "normalized_team_alias_near_time_same_competition"
              : group.evidence.sameCompetitionAlias
                ? "exact_normalized_teams_time_same_competition"
                : "exact_normalized_teams_time_competition_differs",
          startDeltaSeconds: Math.round(
            Math.abs(row.startsAt.getTime() - canonical.startsAt.getTime()) /
              1000,
          ),
          matchedAt: at,
        };
        if (
          !row.match ||
          row.match.canonicalEventId !== canonical.id ||
          row.match.status !== "matched"
        )
          await tx.matchDecision.create({
            data: {
              providerEventId: row.id,
              canonicalEventId: canonical.id,
              status: "matched",
              confidence: group.confidence,
              reason: data.reason,
              detectedAt: at,
            },
          });
        await tx.eventMatch.upsert({
          where: { providerEventId: row.id },
          create: { providerEventId: row.id, ...data },
          update: data,
        });
        await this.issues.transition(tx, "unmatched:" + row.id, "resolved", at);
      }
    }
    for (const unmatched of result.unmatched) {
      const row = byKey.get(
        JSON.stringify([unmatched.provider, unmatched.eventId]),
      );
      if (!row || row.match?.status === "manual") continue;
      const data = {
        canonicalEventId: null,
        confidence: 0,
        status: "unmatched" as const,
        reason: unmatched.reason,
        startDeltaSeconds: null,
        matchedAt: at,
      };
      if (
        !row.match ||
        row.match.status !== "unmatched" ||
        row.match.reason !== unmatched.reason
      )
        await tx.matchDecision.create({
          data: {
            providerEventId: row.id,
            canonicalEventId: null,
            status: "unmatched",
            confidence: 0,
            reason: unmatched.reason,
            detectedAt: at,
          },
        });
      await tx.eventMatch.upsert({
        where: { providerEventId: row.id },
        create: { providerEventId: row.id, ...data },
        update: data,
      });
      await this.issues.open(tx, {
        key: "unmatched:" + row.id,
        type: "UNMATCHED_EVENT",
        severity: "info",
        message: "No unambiguous cross-provider match",
        providerId: providerMap.get(unmatched.provider),
        providerEventId: row.id,
        details: { reason: unmatched.reason, scope: "event", systemic: false },
        at,
      });
    }
  }
}
