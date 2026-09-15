import { collectHttp, collectHttpDetail } from "./providers/http-collector.js";
import {
  collectBet365,
  collectBet365Detail,
  closeBet365,
} from "./providers/bet365.js";
import {
  collectBetano,
  collectBetanoDetail,
  closeBetano,
} from "./providers/betano.js";
import { config, flush, setPreviewMode } from "./publisher.js";
import { count } from "./outbox.js";
import { getDetailInterval } from "../../odds-service/src/modules/collection/scheduling-policy.js";
import type { NormalizedEvent } from "../../odds-service/src/shared/domain/normalized-event.js";

const collectors = {
  bet365: collectBet365,
  betano: collectBetano,
  superbet: () => collectHttp("superbet"),
  blaze: () => collectHttp("blaze"),
  estrelabet: () => collectHttp("estrelabet"),
};
const providers = Object.keys(collectors) as Array<keyof typeof collectors>;
type Provider = keyof typeof collectors;
const details: Record<
  Provider,
  (esport: "cs2" | "lol" | "valorant", id: string) => Promise<number>
> = {
  bet365: collectBet365Detail,
  betano: collectBetanoDetail,
  superbet: (esport, id) => collectHttpDetail("superbet", esport, id),
  blaze: (esport, id) => collectHttpDetail("blaze", esport, id),
  estrelabet: (esport, id) => collectHttpDetail("estrelabet", esport, id),
};
const backoff = [30000, 60000, 120000, 300000];
let ticking = false;
let previewing = false;

interface DetailTask {
  eventId: string;
  esport: "cs2" | "lol" | "valorant";
  startsAt: string;
  dueAt: number;
  failures: number;
}

interface ProviderSchedule {
  dueAt: number;
  failures: number;
  lastSuccessAt: string | null;
  events?: number;
  error?: string | null;
  details?: DetailTask[];
}

async function reloadIfUpdated(): Promise<boolean> {
  const response = await fetch(chrome.runtime.getURL("build-id.txt"), {
    cache: "no-store",
  });
  if (!response.ok) return false;
  const buildId = (await response.text()).trim();
  if (!buildId) return false;
  const stored = await chrome.storage.local.get("extensionBuildId");
  if (!stored.extensionBuildId) {
    await chrome.storage.local.set({ extensionBuildId: buildId });
    return false;
  }
  if (stored.extensionBuildId === buildId) return false;
  await chrome.storage.local.set({ extensionBuildId: buildId });
  await Promise.allSettled([closeBet365(), closeBetano()]);
  chrome.runtime.reload();
  return true;
}

function nextDetails(
  previous: DetailTask[],
  events: NormalizedEvent[],
): DetailTask[] {
  const old = new Map(
    previous.map((task) => [`${task.esport}:${task.eventId}`, task]),
  );
  return events
    .filter(
      (event) =>
        event.status === "scheduled" &&
        getDetailInterval(event.startsAt, Date.now()) !== null,
    )
    .map((event) => {
      const key = `${event.esport}:${event.eventId}`;
      const existing = old.get(key);
      return {
        eventId: event.eventId,
        esport: event.esport,
        startsAt: event.startsAt,
        dueAt: existing?.dueAt ?? 0,
        failures: existing?.failures ?? 0,
      };
    });
}

async function runProvider(
  provider: Provider,
  state: ProviderSchedule,
): Promise<ProviderSchedule> {
  const now = Date.now();
  let next = state;
  if (now >= state.dueAt) {
    try {
      const events = await collectors[provider]();
      next = {
        dueAt: Date.now() + 60000,
        failures: 0,
        lastSuccessAt: new Date().toISOString(),
        events: events.length,
        error: null,
        details: nextDetails(state.details ?? [], events),
      };
    } catch (error) {
      const failures = state.failures + 1;
      return {
        ...state,
        failures,
        dueAt:
          Date.now() +
          (failures >= 5 ? 300000 : backoff[Math.min(failures - 1, 3)]),
        error: error instanceof Error ? error.name : "Error",
      };
    }
  }
  const task = next.details
    ?.filter(
      (item) =>
        item.dueAt <= Date.now() &&
        getDetailInterval(item.startsAt, Date.now()) !== null,
    )
    .sort(
      (a, b) => a.dueAt - b.dueAt || a.startsAt.localeCompare(b.startsAt),
    )[0];
  if (!task) return next;
  const details = next.details!.filter(
    (item) => getDetailInterval(item.startsAt, Date.now()) !== null,
  );
  try {
    await detailsFor(provider, task);
    task.dueAt =
      Date.now() + (getDetailInterval(task.startsAt, Date.now()) ?? 0);
    task.failures = 0;
  } catch (error) {
    task.failures++;
    task.dueAt =
      Date.now() +
      (task.failures >= 5 ? 300000 : backoff[Math.min(task.failures - 1, 3)]);
    next.error = error instanceof Error ? error.name : "Error";
  }
  return { ...next, details };
}

function detailsFor(provider: Provider, task: DetailTask) {
  return details[provider](task.esport, task.eventId);
}

async function tick() {
  if (ticking || previewing) return;
  ticking = true;
  try {
    if (await reloadIfUpdated().catch(() => false)) return;
    if (!(await config())) return;
    const activation = await chrome.storage.local.get("collectorEnabled");
    if (activation.collectorEnabled !== true) return;
    await flush().catch(() => {});
    const stored = await chrome.storage.local.get("schedule");
    const schedule: Partial<Record<keyof typeof collectors, ProviderSchedule>> =
      stored.schedule ?? {};
    await Promise.allSettled(
      providers.map(async (provider) => {
        const state = schedule[provider] ?? {
          dueAt: 0,
          failures: 0,
          lastSuccessAt: null,
          details: [],
        };
        schedule[provider] = await runProvider(provider, state);
      }),
    );
    await chrome.storage.local.set({ schedule });
  } finally {
    ticking = false;
  }
}

async function runPreview(selectedProviders: Provider[] = providers) {
  previewing = true;
  setPreviewMode(true);
  try {
    await chrome.storage.local.set({
      preview: { status: "running", startedAt: new Date().toISOString() },
    });
    const results = await Promise.all(
      selectedProviders.map(async (provider) => {
        try {
          const events = await collectors[provider]();
          const event =
            events.find(
              (item) =>
                item.status === "scheduled" &&
                Date.parse(item.startsAt) > Date.now() &&
                item.esport === "cs2",
            ) ??
            events.find(
              (item) =>
                item.status === "scheduled" &&
                Date.parse(item.startsAt) > Date.now(),
            );
          if (!event)
            return {
              provider,
              events: events.length,
              detailMarkets: null,
              status: "Sem evento futuro",
            };
          const detailMarkets = await details[provider](
            event.esport,
            event.eventId,
          );
          return {
            provider,
            events: events.length,
            detailMarkets,
            status: "OK",
          };
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 160)
              : "Error";
          return {
            provider,
            events: null,
            detailMarkets: null,
            status: message,
          };
        }
      }),
    );
    await chrome.storage.local.set({
      preview: {
        status: "complete",
        finishedAt: new Date().toISOString(),
        results,
      },
    });
  } finally {
    await Promise.allSettled([closeBet365(), closeBetano()]);
    setPreviewMode(false);
    previewing = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.kind === "preview") {
    if (message.provider !== undefined && message.provider !== "bet365") {
      sendResponse({ ok: false, reason: "provider" });
      return;
    }
    if (previewing || ticking) {
      sendResponse({ ok: false, reason: "busy" });
      return;
    }
    void chrome.storage.local.get("collectorEnabled").then(
      (state) => {
        if (state.collectorEnabled === true) {
          sendResponse({ ok: false, reason: "active" });
          return;
        }
        void runPreview(
          message.provider === "bet365" ? ["bet365"] : providers,
        ).catch(() => {
          void chrome.storage.local.set({ preview: { status: "failed" } });
        });
        sendResponse({ ok: true });
      },
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  if (message?.kind === "set-enabled") {
    if (typeof message.enabled !== "boolean") {
      sendResponse({ ok: false });
      return;
    }
    void (async () => {
      if (previewing) throw Error("Teste de leitura em andamento");
      if (message.enabled && !(await config()))
        throw Error("Configuração pendente");
      await chrome.storage.local.set({ collectorEnabled: message.enabled });
      if (message.enabled) void tick();
      else {
        const deadline = Date.now() + 180000;
        while (ticking && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 250));
        if (ticking) throw Error("Coleta ainda em andamento");
        await Promise.allSettled([closeBet365(), closeBetano()]);
      }
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.kind !== "status") return;
  Promise.all([
    config(),
    count(),
    chrome.storage.local.get([
      "schedule",
      "extensionBuildId",
      "collectorEnabled",
      "preview",
    ]),
  ]).then(
    ([settings, pending, stored]) => {
      const preview = stored.preview as
        { status?: string; startedAt?: string } | undefined;
      sendResponse({
        status: !settings
          ? "Configuração pendente"
          : stored.collectorEnabled === true
            ? "Coleta ativa"
            : "Coleta pausada",
        pending,
        providers: stored.schedule ?? {},
        buildId: stored.extensionBuildId ?? null,
        enabled: stored.collectorEnabled === true,
        preview:
          preview?.status === "running" &&
          preview.startedAt &&
          Date.now() - Date.parse(preview.startedAt) > 600000
            ? { status: "failed" }
            : (preview ?? null),
      });
    },
    () => sendResponse({ status: "Indisponível" }),
  );
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "collector-tick") void tick().catch(() => {});
});
chrome.alarms.create("collector-tick", { periodInMinutes: 0.5 });
chrome.runtime.onStartup.addListener(() => void tick().catch(() => {}));
void tick().catch(() => {});
