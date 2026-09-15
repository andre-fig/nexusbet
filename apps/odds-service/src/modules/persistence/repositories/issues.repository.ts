import { Injectable, Inject } from "@nestjs/common";
import type { Prisma, IssueStatus } from "../../../generated/prisma/client.js";
import { DatabaseService } from "../../database/database.service.js";
import { sanitize } from "../sanitize.js";
interface IssueInput {
  key: string;
  type: string;
  severity: string;
  message: string;
  providerId?: string;
  providerEventId?: string;
  marketId?: string;
  canonicalEventId?: string;
  details?: unknown;
  at: Date;
}
@Injectable()
export class DataIssuesRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  async open(tx: Prisma.TransactionClient, input: IssueInput) {
    const old = await tx.dataIssue.findUnique({
      where: { dedupeKey: input.key },
    });
    const data = {
      type: input.type,
      severity: input.severity,
      message: input.message,
      providerId: input.providerId,
      providerEventId: input.providerEventId,
      marketId: input.marketId,
      canonicalEventId: input.canonicalEventId,
      details: sanitize(input.details ?? {}),
      status: "open" as const,
      resolvedAt: null,
    };
    if (!old)
      return tx.dataIssue.create({
        data: {
          ...data,
          dedupeKey: input.key,
          detectedAt: input.at,
          history: { create: { status: "open", at: input.at } },
        },
      });
    if (old.status === "ignored") return old;
    return tx.dataIssue.update({
      where: { id: old.id },
      data: {
        ...data,
        ...(old.status !== "open"
          ? {
              detectedAt: input.at,
              history: { create: { status: "open", at: input.at } },
            }
          : {}),
      },
    });
  }
  async transition(
    tx: Prisma.TransactionClient,
    key: string,
    status: IssueStatus,
    at: Date,
  ) {
    const old = await tx.dataIssue.findUnique({ where: { dedupeKey: key } });
    if (!old || old.status === status) return old;
    return tx.dataIssue.update({
      where: { id: old.id },
      data: {
        status,
        resolvedAt: status === "resolved" ? at : null,
        history: { create: { status, at } },
      },
    });
  }
  list(status: IssueStatus = "open") {
    return this.database.read((db) =>
      db.dataIssue.findMany({
        where: { status },
        orderBy: { detectedAt: "desc" },
        take: 100,
        include: { history: { orderBy: { at: "desc" } } },
      }),
    );
  }
}
