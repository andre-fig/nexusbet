import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client.js";
import { DatabaseService } from "../../database/database.service.js";
import type { EventGroup, EventQuery } from "../../monitor/dto/monitor.dto.js";
import { integer } from "../../monitor/dto/monitor.dto.js";
import type { EligibleProviders } from "../../matching/matching.js";
const groupSql = (
  eligibleProviders: EligibleProviders,
  includeRemoved = false,
  staleBefore?: Date,
) => {
  const eligibility = JSON.stringify(eligibleProviders);
  const eligible = Prisma.sql`provider_slug IN (SELECT jsonb_array_elements_text(COALESCE(${eligibility}::jsonb -> esport,'[]'::jsonb)))`;
  const expected = Prisma.sql`max(jsonb_array_length(COALESCE(${eligibility}::jsonb -> esport,'[]'::jsonb)))`;
  return Prisma.sql`WITH base AS (
 SELECT pe.*, em.canonical_event_id, em.status AS match_status, em.confidence,
 p.slug AS provider_slug,coalesce(em.canonical_event_id,pe.id) AS group_id, c.team_a AS canonical_a,c.team_b AS canonical_b,c.tournament AS canonical_tournament,c.starts_at AS canonical_start
 FROM provider_events pe JOIN providers p ON p.id=pe.provider_id LEFT JOIN event_matches em ON em.provider_event_id=pe.id LEFT JOIN canonical_events c ON c.id=em.canonical_event_id
 WHERE ${includeRemoved} OR pe.listed
), grouped AS (
 SELECT group_id AS id, CASE WHEN bool_or(canonical_event_id IS NOT NULL) THEN group_id ELSE NULL END AS "canonicalId",
 min(esport) AS esport,min(coalesce(canonical_tournament,raw_tournament)) AS tournament,min(coalesce(canonical_a,raw_team_a)) AS "teamA",min(coalesce(canonical_b,raw_team_b)) AS "teamB",min(coalesce(canonical_start,starts_at)) AS "startsAt",
 count(DISTINCT provider_id) FILTER(WHERE ${eligible})::int AS "providerCount",${expected}::int AS "expectedProviderCount",min(coalesce(confidence,0))::float AS confidence,
 CASE WHEN ${expected}<2 THEN 'not_applicable' WHEN count(DISTINCT provider_id) FILTER(WHERE ${eligible})<2 THEN 'unmatched' WHEN bool_or(match_status='low_confidence') THEN 'low_confidence' WHEN bool_or(match_status='manual') THEN 'manual' WHEN count(DISTINCT provider_id) FILTER(WHERE ${eligible})<${expected} THEN 'partial' ELSE 'matched' END AS status,
 CASE WHEN ${expected}<2 THEN bool_or(EXISTS(SELECT 1 FROM data_issues i WHERE i.status='open' AND i.type<>'UNMATCHED_EVENT' AND (i.provider_event_id=base.id OR i.canonical_event_id=base.canonical_event_id))) ELSE bool_or(EXISTS(SELECT 1 FROM data_issues i WHERE i.status='open' AND (i.provider_event_id=base.id OR i.canonical_event_id=base.canonical_event_id))) END OR bool_or(${eligible} AND base.in_play IS NOT TRUE AND base.suspended IS NOT TRUE AND ${staleBefore ?? null}::timestamptz IS NOT NULL AND EXISTS(SELECT 1 FROM markets m WHERE m.provider_event_id=base.id AND m.in_play IS NOT TRUE AND m.suspended IS NOT TRUE AND m.last_seen_at < ${staleBefore ?? null}::timestamptz AND (m.category='match_winner' OR (m.category='map_winner' AND m.map_number IN (1,2,3))))) AS attention,
 array_agg(id) AS "memberIds", array_agg(provider_id) AS provider_ids
 FROM base GROUP BY group_id
)`;
};
const publicEvent = {
  id: true,
  providerEventId: true,
  esport: true,
  rawTeamA: true,
  rawTeamB: true,
  normalizedTeamA: true,
  normalizedTeamB: true,
  rawTournament: true,
  startsAt: true,
  providerStatus: true,
  inPlay: true,
  suspended: true,
  fetchedAt: true,
  listed: true,
  provider: { select: { slug: true, name: true, enabled: true } },
  match: { select: { canonicalEventId: true, status: true, confidence: true } },
  markets: {
    where: {
      OR: [
        { category: "match_winner" },
        { category: "map_winner", mapNumber: { in: [1, 2, 3] } },
      ],
    },
    select: {
      id: true,
      providerMarketId: true,
      category: true,
      name: true,
      mapNumber: true,
      line: true,
      period: true,
      suspended: true,
      inPlay: true,
      lastSeenAt: true,
      selections: {
        select: {
          id: true,
          providerSelectionId: true,
          name: true,
          suspended: true,
          fetchedAt: true,
          snapshots: {
            take: 1,
            orderBy: [{ fetchedAt: "desc" }, { createdAt: "desc" }],
            select: {
              odds: true,
              fetchedAt: true,
              suspended: true,
              inPlay: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ProviderEventSelect;
@Injectable()
export class MonitorRepository {
  constructor(@Inject(DatabaseService) readonly database: DatabaseService) {}
  groups(
    q: EventQuery = {},
    id?: string,
    eligibleProviders: EligibleProviders = {},
    staleBefore?: Date,
  ) {
    const page = integer(q.page, 1, 100000),
      limit = integer(q.limit, 50, 100),
      search = "%" + (q.search ?? "") + "%";
    const until =
      q.start === "24h"
        ? new Date(Date.now() + 86400000)
        : q.start === "7d"
          ? new Date(Date.now() + 7 * 86400000)
          : undefined;
    const where = Prisma.sql`WHERE (${id ?? null}::uuid IS NULL OR id=${id ?? null}::uuid) AND (${q.esport ?? null}::text IS NULL OR esport=${q.esport ?? null}) AND (${q.status ?? null}::text IS NULL OR status=${q.status ?? null}) AND (${q.search ?? null}::text IS NULL OR concat("teamA",' ',"teamB",' ',tournament) ILIKE ${search}) AND (${q.attentionOnly === "true"}=false OR attention OR status IN ('partial','unmatched','low_confidence')) AND (${q.provider ?? null}::text IS NULL OR EXISTS(SELECT 1 FROM providers p WHERE p.slug=${q.provider ?? null} AND p.id=ANY(provider_ids))) AND (${until ?? null}::timestamptz IS NULL OR "startsAt" BETWEEN now() AND ${until ?? null}::timestamptz) AND (${q.start === "today"}=false OR ("startsAt" AT TIME ZONE 'America/Sao_Paulo')::date=(now() AT TIME ZONE 'America/Sao_Paulo')::date)`;
    return this.database.read(async (db) => {
      const [items, count] = await db.$transaction(
        [
          db.$queryRaw<EventGroup[]>(
            Prisma.sql`${groupSql(eligibleProviders, !!id, staleBefore)} SELECT * FROM grouped ${where} ORDER BY "startsAt",id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
          ),
          db.$queryRaw<{ total: number }[]>(
            Prisma.sql`${groupSql(eligibleProviders, !!id, staleBefore)} SELECT count(*)::int AS total FROM grouped ${where}`,
          ),
        ],
        { isolationLevel: "RepeatableRead" },
      );
      return {
        items,
        pagination: {
          page,
          limit,
          total: count[0].total,
          pages: Math.ceil(count[0].total / limit),
        },
      };
    });
  }
  summary(eligibleProviders: EligibleProviders = {}) {
    return this.database.read((db) =>
      db.$queryRaw<{ status: string; count: number }[]>(
        Prisma.sql`${groupSql(eligibleProviders)} SELECT status,count(*)::int AS count FROM grouped GROUP BY status`,
      ),
    );
  }
  providers() {
    return this.database.read(
      (db) =>
        db.$queryRaw<
          {
            id: string;
            name: string;
            enabled: boolean;
            eventCount: number;
            lastUpdatedAt: Date | null;
          }[]
        >`SELECT p.slug AS id,p.name,p.enabled,count(pe.id) FILTER(WHERE pe.listed)::int AS "eventCount",max(pe.fetched_at) AS "lastUpdatedAt" FROM providers p LEFT JOIN provider_events pe ON pe.provider_id=p.id GROUP BY p.id ORDER BY p.slug`,
    );
  }
  members(ids: string[]) {
    return this.database.read(async (db) => {
      if (!ids.length) return [];
      const [members, current] = await Promise.all([
        db.providerEvent.findMany({
          where: { id: { in: ids } },
          select: publicEvent,
        }),
        db.$queryRaw<
          {
            eventId: string;
            marketId: string;
            selectionIds: string[];
            at: string;
          }[]
        >(Prisma.sql`
 WITH batches AS (SELECT DISTINCT ON (fs.provider_id,b->>'scope') fs.provider_id,b
 FROM feed_scopes fs CROSS JOIN LATERAL jsonb_array_elements(fs.observations) b
 WHERE fs.provider_id IN (SELECT provider_id FROM provider_events WHERE id IN (${Prisma.join(ids)}))
 ORDER BY fs.provider_id,b->>'scope',(b->>'fetchedAt')::timestamptz DESC)
 SELECT pe.id AS "eventId",m->>'marketId' AS "marketId",ARRAY(SELECT s->>'selectionId' FROM jsonb_array_elements(m->'selections') s) AS "selectionIds",b->>'fetchedAt' AS at
 FROM batches CROSS JOIN LATERAL jsonb_array_elements(b->'matches') e
 JOIN provider_events pe ON pe.provider_id=batches.provider_id AND pe.provider_event_id=e->>'eventId'
 CROSS JOIN LATERAL jsonb_array_elements(e->'markets') m WHERE pe.id IN (${Prisma.join(ids)})`),
      ]);
      return members.map((e) => ({
        ...e,
        markets: e.markets.flatMap((m) => {
          const observations = current
            .filter(
              (c) => c.eventId === e.id && c.marketId === m.providerMarketId,
            )
            .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
          if (!observations.length) return [];
          return [
            {
              ...m,
              selections: m.selections.filter((s) =>
                observations[0].selectionIds.includes(s.providerSelectionId),
              ),
            },
          ];
        }),
      }));
    });
  }
  raw(ids: string[]) {
    return this.database.read((db) =>
      db.providerEvent.findMany({
        where: { id: { in: ids } },
        select: {
          provider: { select: { slug: true } },
          rawData: true,
          markets: { select: { providerMarketId: true, rawData: true } },
        },
      }),
    );
  }
  issues(
    q: {
      severity?: string;
      type?: string;
      provider?: string;
      eventId?: string;
      status?: string;
      limit?: string;
    } = {},
    eligibleProviders?: EligibleProviders,
  ) {
    const comparableEsports = eligibleProviders
      ? Object.entries(eligibleProviders)
          .filter(([, providers]) => providers.length >= 2)
          .map(([esport]) => esport)
      : undefined;
    return this.database.read((db) =>
      db.dataIssue.findMany({
        where: {
          status: (q.status ?? "open") as "open" | "resolved" | "ignored",
          severity: q.severity,
          type: q.type,
          ...(comparableEsports
            ? {
                OR: [
                  { type: { not: "UNMATCHED_EVENT" } },
                  {
                    providerEvent: {
                      esport: { in: comparableEsports },
                    },
                  },
                ],
              }
            : {}),
          provider: q.provider ? { slug: q.provider } : undefined,
          ...(q.eventId
            ? {
                OR: [
                  { canonicalEventId: q.eventId },
                  { providerEventId: q.eventId },
                  { providerEvent: { match: { canonicalEventId: q.eventId } } },
                ],
              }
            : {}),
        },
        take: integer(q.limit, 100, 500),
        orderBy: [{ detectedAt: "desc" }, { id: "asc" }],
        include: {
          provider: { select: { slug: true } },
          canonicalEvent: { select: { teamA: true, teamB: true } },
          providerEvent: {
            select: {
              id: true,
              rawTeamA: true,
              rawTeamB: true,
              match: { select: { canonicalEventId: true } },
            },
          },
        },
      }),
    );
  }
  eventIssues(ids: string[], canonicalIds: string[]) {
    return this.database.read((db) =>
      db.dataIssue.findMany({
        where: {
          status: "open",
          OR: [
            { providerEventId: { in: ids } },
            { canonicalEventId: { in: canonicalIds } },
          ],
        },
        select: {
          id: true,
          type: true,
          severity: true,
          details: true,
          message: true,
          providerId: true,
          providerEventId: true,
          canonicalEventId: true,
          marketId: true,
        },
      }),
    );
  }
  issueCount(eligibleProviders?: EligibleProviders) {
    const comparableEsports = eligibleProviders
      ? Object.entries(eligibleProviders)
          .filter(([, providers]) => providers.length >= 2)
          .map(([esport]) => esport)
      : undefined;
    return this.database.read((db) =>
      db.dataIssue.count({
        where: {
          status: "open",
          ...(comparableEsports
            ? {
                OR: [
                  { type: { not: "UNMATCHED_EVENT" } },
                  {
                    providerEvent: {
                      esport: { in: comparableEsports },
                    },
                  },
                ],
              }
            : {}),
        },
      }),
    );
  }
  healthIssues() {
    return this.database.read((db) =>
      db.dataIssue.findMany({
        where: { status: "open" },
        select: {
          type: true,
          severity: true,
          details: true,
          providerId: true,
          provider: { select: { slug: true } },
          providerEventId: true,
          canonicalEventId: true,
          marketId: true,
          providerEvent: {
            select: { match: { select: { canonicalEventId: true } } },
          },
        },
      }),
    );
  }
  staleMarkets(before: Date, providerEventIds?: string[]) {
    return this.database.read((db) =>
      db.market.findMany({
        where: {
          lastSeenAt: { lt: before },
          AND: [
            { OR: [{ inPlay: false }, { inPlay: null }] },
            { OR: [{ suspended: false }, { suspended: null }] },
          ],
          OR: [
            { category: "match_winner" },
            { category: "map_winner", mapNumber: { in: [1, 2, 3] } },
          ],
          providerEvent: {
            listed: true,
            AND: [
              { OR: [{ inPlay: false }, { inPlay: null }] },
              { OR: [{ suspended: false }, { suspended: null }] },
            ],
            ...(providerEventIds ? { id: { in: providerEventIds } } : {}),
            provider: { enabled: true },
          },
        },
        select: {
          id: true,
          category: true,
          mapNumber: true,
          lastSeenAt: true,
          providerEvent: {
            select: {
              id: true,
              rawTeamA: true,
              rawTeamB: true,
              match: { select: { canonicalEventId: true } },
              provider: { select: { slug: true } },
            },
          },
        },
      }),
    );
  }
  history(
    ids: string[],
    q: {
      provider?: string;
      market?: string;
      selection?: string;
      from?: Date;
      to?: Date;
    },
  ) {
    return this.database.read((db) =>
      db.oddsSnapshot.findMany({
        where: {
          selection: {
            ...(q.selection
              ? {
                  OR: [
                    { providerSelectionId: q.selection },
                    ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                      q.selection,
                    )
                      ? [{ id: q.selection }]
                      : []),
                  ],
                }
              : {}),
            market: {
              providerEvent: {
                id: { in: ids },
                ...(q.provider ? { provider: { slug: q.provider } } : {}),
              },
              ...(q.market
                ? {
                    OR: [
                      { category: q.market },
                      { providerMarketId: q.market },
                      ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                        q.market,
                      )
                        ? [{ id: q.market }]
                        : []),
                    ],
                  }
                : { category: { in: ["match_winner", "map_winner"] } }),
            },
          },
          fetchedAt: { gte: q.from, lte: q.to },
        },
        orderBy: [{ fetchedAt: "asc" }, { id: "asc" }],
        take: 2001,
        select: {
          id: true,
          odds: true,
          fetchedAt: true,
          suspended: true,
          inPlay: true,
          selection: {
            select: {
              id: true,
              name: true,
              providerSelectionId: true,
              market: {
                select: {
                  id: true,
                  category: true,
                  mapNumber: true,
                  providerMarketId: true,
                  providerEvent: {
                    select: { provider: { select: { slug: true } } },
                  },
                },
              },
            },
          },
        },
      }),
    );
  }
  state() {
    return this.database.read(async (db) => {
      const [events, issues] = await Promise.all([
        db.providerEvent.findMany({
          select: {
            id: true,
            providerEventId: true,
            provider: { select: { slug: true } },
            match: {
              select: {
                canonicalEventId: true,
                status: true,
                confidence: true,
              },
            },
          },
        }),
        db.dataIssue.findMany({
          select: {
            id: true,
            status: true,
            canonicalEventId: true,
            providerEventId: true,
          },
        }),
      ]);
      return { events, issues };
    });
  }
}
export type MonitorMember = Awaited<
  ReturnType<MonitorRepository["members"]>
>[number];
