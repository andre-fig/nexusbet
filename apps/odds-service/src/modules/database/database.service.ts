import {
  Injectable,
  Inject,
  OnModuleInit,
  OnApplicationShutdown,
} from "@nestjs/common";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { clearLogs as clearPrismaDebugLogs } from "@prisma/debug";
import { PrismaClient } from "../../generated/prisma/client.js";
import { AppConfiguration } from "../../config/configuration.js";
import { ServiceError } from "../../shared/errors/domain-errors.js";
@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  readonly enabled: boolean;
  private client?: PrismaClient;
  private debugRetentionTimer?: ReturnType<typeof setInterval>;
  connected = false;
  operationFailed = false;
  constructor(@Inject(AppConfiguration) readonly config: AppConfiguration) {
    this.enabled = config.settings.persistenceMode === "postgres";
  }
  get db() {
    if (!this.client)
      throw new ServiceError("PostgreSQL persistence disabled", 503);
    return this.client;
  }
  async onModuleInit() {
    if (!this.enabled || this.connected) return;
    // Prisma 7's internal debug helper retains the last 100 query arguments
    // even when DEBUG is unset. Large JSON arguments must not survive in production.
    if (process.env.NODE_ENV === "production" && !this.debugRetentionTimer) {
      this.debugRetentionTimer = setInterval(clearPrismaDebugLogs, 1000);
      this.debugRetentionTimer.unref();
      clearPrismaDebugLogs();
    }
    this.client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: this.config.settings.databaseUrl,
        max: 5,
        connectionTimeoutMillis: 5000,
      }),
    });
    try {
      await this.client.$connect();
      await this.validateMigrations();
      this.connected = true;
    } catch {
      await this.client.$disconnect();
      throw new ServiceError(
        "PostgreSQL unavailable or migrations pending: run npm run db:migrate",
        503,
      );
    }
  }
  async read<T>(operation: (db: PrismaClient) => Promise<T>): Promise<T> {
    try {
      const result = await operation(this.db);
      this.operationFailed = false;
      return result;
    } catch (error) {
      this.operationFailed = true;
      if (error instanceof ServiceError) throw error;
      throw new ServiceError("PostgreSQL read unavailable", 503);
    }
  }
  async validateMigrations() {
    const rows = await this.db.$queryRaw<
      {
        migration_name: string;
        checksum: string;
        finished_at: Date | null;
        rolled_back_at: Date | null;
      }[]
    >`SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations`;
    const path = fileURLToPath(
      new URL("../../../prisma/migrations/", import.meta.url),
    );
    for (const d of await readdir(path, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const hash = createHash("sha256")
        .update(await readFile(join(path, d.name, "migration.sql")))
        .digest("hex");
      if (
        !rows.some(
          (r) =>
            r.migration_name === d.name &&
            r.finished_at &&
            !r.rolled_back_at &&
            r.checksum === hash,
        )
      )
        throw Error("Missing or modified migration");
    }
    if (rows.some((r) => !r.finished_at && !r.rolled_back_at))
      throw Error("Failed migration");
  }
  async onApplicationShutdown() {
    clearInterval(this.debugRetentionTimer);
    this.debugRetentionTimer = undefined;
    clearPrismaDebugLogs();
    await this.client?.$disconnect();
    this.connected = false;
  }
}
