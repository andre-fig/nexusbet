import {
  Inject,
  Injectable,
  type MessageEvent,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Observable, Subject, Subscription } from "rxjs";
import {
  PersistenceNotifications,
  type PublicationNotice,
} from "../persistence/persistence-notifications.js";
import { MonitorRepository } from "../persistence/repositories/monitor.repository.js";
import { MonitorService } from "./monitor.service.js";
/** In-process invalidation only. Reconnecting clients refetch REST; there is no durable replay. */
@Injectable()
export class MonitorEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly messages = new Subject<MessageEvent>();
  private subscription?: Subscription;
  private timer?: ReturnType<typeof setInterval>;
  private previous?: Awaited<ReturnType<MonitorRepository["state"]>>;
  private stale = new Map<string, boolean>();
  private pending = Promise.resolve();
  private sequence = 0;
  subscribers = 0;
  constructor(
    @Inject(PersistenceNotifications)
    readonly notifications: PersistenceNotifications,
    @Inject(MonitorRepository) readonly repo: MonitorRepository,
    @Inject(MonitorService) readonly service: MonitorService,
  ) {}
  onModuleInit() {
    if (this.subscription) return;
    this.subscription = this.notifications.committed.subscribe((n) =>
      this.enqueue(n),
    );
  }
  emit(type: string, data: Record<string, unknown> = {}) {
    this.messages.next({
      id: String(++this.sequence),
      type,
      data: { ...data, at: data.at ?? new Date().toISOString() },
    });
  }
  enqueue(n?: PublicationNotice) {
    if (!this.subscribers) return;
    this.pending = this.pending
      .then(() => this.refresh(n))
      .catch(() => {
        this.emit("resync");
      });
  }
  async refresh(n?: PublicationNotice) {
    const current = await this.repo.state();
    const old = this.previous;
    this.previous = current;
    const eventId = (id: string) =>
      current.events.find((e) => e.id === id)?.match?.canonicalEventId ?? id;
    if (old) {
      for (const e of current.events) {
        const before = old.events.find((x) => x.id === e.id);
        if (JSON.stringify(before?.match) !== JSON.stringify(e.match))
          this.emit("matching.updated", {
            eventId: eventId(e.id),
            status: e.match?.status ?? "unmatched",
          });
      }
      for (const i of current.issues) {
        const before = old.issues.find((x) => x.id === i.id);
        if (
          (i.status === "open" && before?.status !== "open") ||
          (i.status === "resolved" && before?.status !== "resolved")
        )
          this.emit(i.status === "open" ? "issue.created" : "issue.resolved", {
            issueId: i.id,
            eventId: i.providerEventId
              ? eventId(i.providerEventId)
              : i.canonicalEventId,
          });
      }
    }
    if (n) {
      for (const c of n.changes) {
        const e = current.events.find(
          (e) =>
            e.provider.slug === n.provider && e.providerEventId === c.eventId,
        );
        const type =
          c.type === "OddsChanged"
            ? "odds.changed"
            : c.type === "EventAdded"
              ? "event.added"
              : c.type === "EventRemoved"
                ? "event.removed"
                : "market.updated";
        this.emit(type, {
          provider: n.provider,
          eventId: e ? eventId(e.id) : undefined,
          marketId: c.marketId,
          selectionId: c.selectionId,
          at: n.at,
        });
      }
      this.emit("provider.updated", { provider: n.provider, at: n.at });
      if (n.eventIds) {
        const ids = new Set(
          n.eventIds
            .map((id) =>
              current.events.find(
                (e) =>
                  e.provider.slug === n.provider && e.providerEventId === id,
              ),
            )
            .filter((e) => e !== undefined)
            .map((e) => eventId(e.id)),
        );
        for (const id of ids)
          this.emit("event.updated", {
            eventId: id,
            provider: n.provider,
            at: n.at,
          });
      } else this.emit("event.updated", { provider: n.provider, at: n.at });
    }
    for (const p of await this.service.providers()) {
      if (p.stale && this.stale.get(p.id) === false)
        this.emit("provider.stale", { provider: p.id });
      this.stale.set(p.id, p.stale);
    }
  }
  stream() {
    return new Observable<MessageEvent>((subscriber) => {
      this.subscribers++;
      const sub = this.messages.subscribe(subscriber);
      subscriber.next({
        type: "ready",
        data: { at: new Date().toISOString() },
      });
      this.enqueue();
      if (!this.timer)
        this.timer = setInterval(() => {
          this.emit("heartbeat");
          this.enqueue();
        }, 25000);
      return () => {
        sub.unsubscribe();
        this.subscribers--;
        if (!this.subscribers && this.timer) {
          clearInterval(this.timer);
          this.timer = undefined;
        }
      };
    });
  }
  memoryDiagnostics() {
    return {
      subscribers: this.subscribers,
      previousEvents: this.previous?.events.length ?? 0,
      previousIssues: this.previous?.issues.length ?? 0,
      staleProviders: this.stale.size,
      timers: this.timer ? 1 : 0,
      notificationSubscription:
        this.subscription && !this.subscription.closed ? 1 : 0,
    };
  }
  async onModuleDestroy() {
    this.subscription?.unsubscribe();
    if (this.timer) clearInterval(this.timer);
    this.messages.complete();
    await this.pending;
  }
}
