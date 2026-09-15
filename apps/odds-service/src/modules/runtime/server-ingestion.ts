import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Inject,
  Injectable,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { timingSafeEqual, createHash } from "node:crypto";
import { PersistenceService } from "../persistence/persistence.service.js";
import { providers, runtimeSettings } from "./runtime-settings.js";
import { fromWire } from "./wire-payload.js";
import { ReceivedCatalog } from "./received-catalog.js";
@Injectable()
export class IngestionGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const expected = runtimeSettings("server").token;
    const header: unknown = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, unknown> }>().headers.authorization;
    const digest = (s: string) => createHash("sha256").update(s).digest();
    if (
      typeof header !== "string" ||
      !timingSafeEqual(digest(header), digest(`Bearer ${expected}`))
    )
      throw new UnauthorizedException();
    return true;
  }
}
@Injectable()
export class AgentHeartbeats {
  private readonly agents = new Map<
    string,
    { agentId: string; providers: string[]; at: string; receivedAt: string }
  >();
  accept(body: unknown) {
    const p = body as { agentId: string; providers: string[]; at: string };
    if (
      !p ||
      typeof p.agentId !== "string" ||
      typeof p.at !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(p.agentId) ||
      !Array.isArray(p.providers) ||
      !p.providers.length ||
      p.providers.length > 5 ||
      new Set(p.providers).size !== p.providers.length ||
      p.providers.some(
        (x) => !providers.includes(x as (typeof providers)[number]),
      ) ||
      !Number.isFinite(Date.parse(p.at))
    )
      throw new BadRequestException("Invalid heartbeat");
    if (!this.agents.has(p.agentId) && this.agents.size >= 100)
      this.agents.delete(this.agents.keys().next().value!);
    this.agents.set(p.agentId, {
      agentId: p.agentId,
      providers: p.providers,
      at: p.at,
      receivedAt: new Date().toISOString(),
    });
    return { accepted: true };
  }
  status() {
    return [...this.agents.values()].map((a) => ({
      ...a,
      online: Date.now() - Date.parse(a.receivedAt) < 90000,
    }));
  }
}
@Controller("internal")
@UseGuards(IngestionGuard)
export class IngestionController {
  constructor(
    @Inject(PersistenceService)
    private readonly persistence: PersistenceService,
    @Inject(ReceivedCatalog) private readonly catalog: ReceivedCatalog,
    @Inject(AgentHeartbeats) private readonly heartbeats: AgentHeartbeats,
  ) {}
  @Post("ingestion/:provider") async ingest(
    @Param("provider") provider: string,
    @Body() body: unknown,
  ) {
    let publication;
    try {
      publication = fromWire(body, provider);
    } catch {
      throw new BadRequestException("Invalid normalized publication");
    }
    if (!this.persistence.enabled)
      throw new BadRequestException("PostgreSQL required");
    await this.persistence.commit(publication, () => this.catalog.refresh());
    return { accepted: true, collectionRunId: publication.collectionRunId };
  }
  @Post("agents/heartbeat") heartbeat(@Body() body: unknown) {
    return this.heartbeats.accept(body);
  }
  @Get("agents") agents() {
    return this.heartbeats.status();
  }
}
