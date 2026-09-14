import { Injectable, Inject } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";
@Injectable()
export class OddsReadRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  providers() {
    return this.database.read((db) =>
      db.provider.findMany({
        include: { _count: { select: { events: true } } },
        orderBy: { slug: "asc" },
      }),
    );
  }
  events(id?: string) {
    return this.database.read((db) =>
      db.canonicalEvent.findMany({
        where: id ? { id } : undefined,
        take: 50,
        orderBy: { startsAt: "asc" },
        include: {
          matches: {
            include: {
              providerEvent: {
                include: {
                  provider: true,
                  markets: {
                    include: {
                      selections: {
                        include: {
                          snapshots: {
                            take: 1,
                            orderBy: [
                              { fetchedAt: "desc" },
                              { createdAt: "desc" },
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    );
  }
  providerEvents(provider?: string) {
    return this.database.read((db) =>
      db.providerEvent.findMany({
        where: provider ? { provider: { slug: provider } } : undefined,
        take: 100,
        orderBy: { startsAt: "asc" },
        include: { provider: true, match: true },
      }),
    );
  }
  history(selectionId: string, before?: Date) {
    return this.database.read((db) =>
      db.oddsSnapshot.findMany({
        where: {
          selectionId,
          ...(before ? { fetchedAt: { lt: before } } : {}),
        },
        take: 200,
        orderBy: [{ fetchedAt: "desc" }, { createdAt: "desc" }],
      }),
    );
  }
}
