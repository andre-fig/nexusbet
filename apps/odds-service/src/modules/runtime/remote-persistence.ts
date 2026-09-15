import {
  Injectable,
  Logger,
  OnModuleInit,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  open,
} from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  PersistencePort,
  PersistencePublication,
} from "../../shared/interfaces/persistence-port.interface.js";
import type { MarketBatch } from "../../shared/domain/market-model.js";
import { providers, runtimeSettings } from "./runtime-settings.js";
import { toWire, fromWire, type WirePayload } from "./wire-payload.js";
@Injectable()
export class RemotePersistence
  implements
    PersistencePort,
    OnModuleInit,
    OnApplicationBootstrap,
    OnModuleDestroy
{
  readonly enabled = true; // Durable acceptance means local pending payload, never SQL.
  private readonly logger = new Logger("AgentDelivery");
  private readonly settings = runtimeSettings("collector-agent");
  private checkpoints = new Map<string, unknown>();
  private timer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private heartbeatTask: Promise<void> = Promise.resolve();
  private work: Promise<void> = Promise.resolve();
  private queue: Promise<void> = Promise.resolve();
  private sending = false;
  private stopped = false;
  private initialized = false;
  private failures = 0;
  private nextAttempt = 0;
  async onModuleInit() {
    if (this.initialized) return;
    await mkdir(this.settings.outboxDir, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.settings.outboxDir))
      if (/^\d+-[a-f0-9-]+\.json\.tmp$/.test(name))
        await unlink(join(this.settings.outboxDir, name));
    this.initialized = true;
  }
  onApplicationBootstrap() {
    this.timer = setInterval(() => this.tick(), 1000);
    this.heartbeatTimer = setInterval(() => {
      this.heartbeatTask = this.heartbeatTask.then(() => this.heartbeat());
    }, this.settings.heartbeatMs);
    this.tick();
    this.heartbeatTask = this.heartbeatTask.then(() => this.heartbeat());
  }
  async baselines() {
    return [];
  }
  async restore<T>(key: string) {
    return this.checkpoints.get(key) as T | undefined;
  }
  equivalentObservation(a: MarketBatch, b: MarketBatch) {
    return isDeepStrictEqual(a, b);
  }
  async commit(
    p: PersistencePublication,
    afterCommit?: () => Promise<void> | void,
  ) {
    const payload = toWire(p);
    fromWire(payload, p.provider);
    const task = this.queue.then(async () => {
      await this.onModuleInit();
      const files = await this.pending();
      const content = JSON.stringify(payload);
      const size = Buffer.byteLength(content);
      if (
        size > 8 * 1024 * 1024 ||
        files.length >= 1000 ||
        files.reduce((n, f) => n + f.bytes, 0) + size > this.settings.maxBytes
      )
        throw Error("Agent outbox full; collection backpressure");
      const filename = join(
        this.settings.outboxDir,
        `${Date.now()}-${payload.collectionRunId}.json`,
      );
      const file = await open(`${filename}.tmp`, "wx", 0o600);
      try {
        await file.writeFile(content);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(`${filename}.tmp`, filename);
      // Windows does not permit fsync on a directory handle. The file itself
      // is synced before the atomic rename on every platform.
      if (process.platform !== "win32") {
        const dir = await open(this.settings.outboxDir, "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      }
      this.checkpoints.set(p.checkpoint.key, p.checkpoint.payload);
      await afterCommit?.();
    });
    this.queue = task.catch(() => {});
    await task;
  }
  private async pending() {
    const result: { path: string; payload: WirePayload; bytes: number }[] = [];
    for (const name of (await readdir(this.settings.outboxDir))
      .filter((n) => /^\d+-[a-f0-9-]+\.json$/.test(n))
      .sort()) {
      const path = join(this.settings.outboxDir, name);
      const content = await readFile(path, "utf8");
      const payload = JSON.parse(content) as WirePayload;
      if (Date.now() - Number(name.split("-")[0]) > this.settings.maxAgeMs) {
        await unlink(path);
        this.logger.warn("Pending publication expired by outbox retention");
        continue;
      }
      result.push({ path, payload, bytes: Buffer.byteLength(content) });
    }
    return result;
  }
  private async post(path: string, payload: unknown) {
    const response = await fetch(`${this.settings.serverUrl}${path}`, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.settings.token}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.settings.requestTimeoutMs),
    });
    await response.body?.cancel();
    if (!response.ok) throw Error("Server did not acknowledge payload");
  }
  tick() {
    if (this.stopped || this.sending || Date.now() < this.nextAttempt) return;
    this.sending = true;
    this.work = this.queue
      .then(async () => {
        const pending = await this.pending();
        for (const item of pending) {
          if (this.stopped) break;
          await this.post(
            `/internal/ingestion/${item.payload.provider}`,
            item.payload,
          );
          await unlink(item.path);
        }
        this.failures = 0;
        this.nextAttempt = 0;
      })
      .catch(() => {
        this.nextAttempt =
          Date.now() +
          [30000, 60000, 120000, 300000][Math.min(this.failures++, 3)];
        this.logger.warn(
          "Delivery failed; pending publications retained for retry",
        );
      })
      .finally(() => {
        this.sending = false;
      });
    // Serialize file enumeration/removal with acceptance to keep capacity accounting exact.
    this.queue = this.work;
  }
  private async heartbeat() {
    try {
      await this.post("/internal/agents/heartbeat", {
        agentId: this.settings.agentId,
        providers: providers.filter(
          (p) =>
            !["false", "0"].includes(
              process.env[`COLLECT_${p.toUpperCase()}`] ?? "true",
            ),
        ),
        at: new Date().toISOString(),
      });
    } catch {
      this.logger.warn("Heartbeat delivery failed");
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.timer);
    clearInterval(this.heartbeatTimer);
    await Promise.all([this.queue, this.work, this.heartbeatTask]);
  }
}
